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
        { cmd, args, code: error.code, exitCode: error.exitCode, original: error.message, stdout: out, stderr: err }
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
    download: async (paths, { opts } = {}) => {
      if (!Array.isArray(paths) || paths.length === 0) {
        return
      }
      try {
        return await exec('wget', [
          '--adjust-extension',
          '-e', 'robots=off',
          '--no-proxy',
          '--no-cache',
          '--level=0',
          '--no-check-certificate',
          '--page-requisites',
          '--adjust-extension=on',
          '--convert-links',
          '--restrict-file-names=windows',
          '--no-verbose',
          '--content-on-error',
          ...(opts || []),
          ...paths
        ].filter(Boolean), { signal })
      } catch (err) {
        // Error Code 8 (status error for page): https://www.gnu.org/software/wget/manual/html_node/Exit-Status.html#Exit-Status-1
        if (err.exitCode === 8) {
          logger.warn('Received http error code.\n%s %s\n%s', err.cmd, err.args, err.stderr.toString())
          return {
            stdout: err.stdout,
            stderr: err.stderr
          }
        }
        throw err
      }
    },
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
      const { stdout, stderr } = await exec(
        require.resolve('netlify-cli/bin/run'),
        ['deploy', '--dir', cwd, '--auth', authToken, '--json', production && '--prod'].filter(Boolean),
        { signal }
      )
      try {
        return JSON.parse(stdout.toString())
      } catch (err) {
        return Object.assign(
          new Error(`[json-parse-error] Couldn't parse netlify result: ${stdout.toString()} (error: ${stderr.toString()})`),
          { code: 'json-parse-error', stderr, stdout }
        )
      }
    },
    datPush: (timeout, ...folders) => datPush(signal, cwd, timeout, ...folders),
    datKey: (...folders) => datKey(cwd, ...folders),
    datInit: (...folders) => datInit(signal, cwd, ...folders),
    safeReplaceWith: (target, op) => safeReplace(cwd, target, { signal, op })
  }
  return thisOp
}

module.exports = operate
