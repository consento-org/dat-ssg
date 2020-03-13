const { spawn } = require('child_process')
const path = require('path')
const { randomBytes } = require('crypto')
const del = require('del')
const logger = require('pino')({ name: 'dat-ssg-operate' })
const { mkdir, writeFile, rename: _rename, access } = require('fs').promises
const { datPush, datInit, datKey } = require('./dat.js')
const { checkAbort, isAborted, listenAbort, AbortError } = require('./abort.js')

async function fileExists (pth, { signal } = {}) {
  checkAbort(signal)
  try {
    await access(pth)
    return true
  } catch (_) {}
  return false
}

async function rename (oldPath, newPath, { signal } = {}) {
  checkAbort(signal)
  return _rename(oldPath, newPath)
}

async function safeReplace (target, newPath, { signal, op } = {}) {
  const backup = `${target}_${randomBytes(8).toString('hex')}`
  logger.info('Safely replacing %s with %s [backup=%s]', target, newPath, backup)
  let state = 'start'
  const rewind = async () => {
    if (state !== 'none') {
      if (op !== undefined && state === 'op') {
        await op.rewind(backup, target)
      }
      await del(target)
      await rename(backup, target)
    }
  }
  try {
    await rename(target, backup, { signal })
    state = 'replaced'
    await rename(newPath, target, { signal })
    if (op !== undefined) {
      state = 'op'
      await op.run(backup, target)
    }
  } catch (err) {
    logger.error('Error while replacing: %o', err)
    try {
      await rewind()
    } catch (_) {}
    throw err
  }
  await del(backup)
}

function operate (cwd, { signal } = {}) {
  const exec = (cmd, args = [], opts = {}) => new Promise((resolve, reject) => {
    const child = spawn(cmd, args, Object.assign({}, { cwd }, opts))
    const stdout = []
    child.stdout.on('data', data => stdout.push(data))
    const stderr = []
    child.stderr.on('data', data => stderr.push(data))

    const execError = (error) => {
      const out = Buffer.concat(stdout).toString()
      const err = Buffer.concat(stderr).toString()
      return Object.assign(
        new Error(`Error while running ${cmd} ${args.join(' ')}\nMessage: ${error.message}\nOut: ${out}\nError: ${err}`),
        { code: error.code, exitCode: error.exitCode, original: error.message, out, err }
      )
    }

    let close = err => {
      close = () => {}
      unlisten()
      if (err) {
        // Even if it is aborted another error may have occured
        // while shutting down, lets not eat this error and actually show it
        return reject(err)
      }
      if (isAborted(signal)) {
        return reject(new AbortError())
      }
      resolve({
        get stdout () {
          return Buffer.concat(stdout)
        },
        get stderr () {
          return Buffer.concat(stderr)
        }
      })
    }

    // child.stdout.pipe(process.stdout, { end: false })
    // child.stderr.pipe(process.stderr, { end: false })
    child.on('error', close)
    child.on('exit', exitCode => {
      if (exitCode !== 0 && exitCode !== null) {
        return close(execError({ exitCode, code: 'exit-error', message: `Returned error code ${exitCode}` }))
      }
      close()
    })
    const unlisten = listenAbort(signal, () => {
      logger.info('Killing process with SIGINT on abort signal.')
      child.kill('SIGINT')
    })
  })
  const thisOp = {
    dirname: cwd,
    cd: (...folders) => operate(path.join(cwd, ...folders), { signal }),
    exec,
    git: (...args) => exec('git', args, { signal }),
    exists: (...folders) => fileExists(path.join(cwd, ...folders)),
    mkdir: (...folders) => mkdir(path.join(cwd, ...folders), { recursive: true }),
    download: paths => exec('wget', [
      '--recursive',
      '--adjust-extension',
      '-e', 'robots=off',
      '--no-proxy',
      '--no-cache',
      '--no-check-certificate',
      '--page-requisites',
      '--html-extension',
      '--convert-links',
      '--restrict-file-names=windows',
      '--no-verbose'
    ].concat(paths), { signal }),
    write: async (folders, data, opts) => {
      checkAbort(signal)
      return writeFile(path.join(cwd, ...folders), data, opts)
    },
    writeIfGiven: async (folders, data, opts) => {
      if (!data) return
      return thisOp.write(folders, data, opts)
    },
    move: async (folders, target) => rename(path.join(cwd, ...folders), path.join(target, ...folders)),
    deployNetlify: async ({ authToken, production }) => {
      const { stdout } = await exec(
        require.resolve('netlify-cli/bin/run'),
        ['deploy', '--dir', cwd, '--auth', authToken, '--json', production && '--prod'].filter(Boolean),
        { signal }
      )
      return JSON.parse(stdout.toString())
    },
    datPush: (timeout, ...folders) => datPush(signal, cwd, timeout, ...folders),
    datKey: (...folders) => datKey(cwd, ...folders),
    datInit: (...folders) => datInit(signal, cwd, ...folders),
    safeReplaceWith: (target, op) => safeReplace(cwd, target, { signal, op })
  }
  return thisOp
}

module.exports = operate
