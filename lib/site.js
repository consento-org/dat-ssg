const { mkdir, readFile, writeFile, rename: _rename, unlink, access } = require('fs').promises
const logger = require('pino')({ name: 'dat-ssg-site' })
const { randomBytes } = require('crypto')
const createDat = require('dat-node')
const { spawn } = require('child_process')
const path = require('path')
const del = require('del')
const processExists = require('process-exists')
const { name } = require('../package.json')
const { replaceLinks } = require('./replaceLinks.js')
const { mkdtemp } = require('./fs.js')
const { checkAbort } = require('./abort.js')
const fileLocked = {}

async function lockFile (file) {
  if (fileLocked[file] !== undefined) {
    return
  }
  let pid
  try {
    pid = parseInt(await readFile(file, 'utf-8'), 10)
  } catch (_) {}
  if (pid !== undefined && await processExists(pid)) {
    return
  }
  try {
    await writeFile(file, process.pid.toString(10))
    pid = parseInt(await readFile(file, 'utf-8'), 10)
    if (pid === process.pid) {
      fileLocked[file] = true
      return async () => {
        delete fileLocked[file]
        await unlink(file)
      }
    }
  } catch (_) {}
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

async function fileExists (pth, { signal } = {}) {
  checkAbort(signal)
  try {
    await access(pth)
    return true
  } catch (_) {}
  return false
}

function operate (cwd, { signal } = {}) {
  const exec = (cmd, args = [], opts = {}) => new Promise((resolve, reject) => {
    const child = spawn(cmd, args, Object.assign({}, { cwd }, opts))
    const stdout = []
    child.stdout.on('data', data => stdout.push(data))
    const stderr = []
    child.stderr.on('data', data => stderr.push(data))
    // child.stdout.pipe(process.stdout, { end: false })
    // child.stderr.pipe(process.stderr, { end: false })
    child.on('error', error => {
      const out = Buffer.concat(stdout).toString()
      const err = Buffer.concat(stderr).toString()
      reject(
        Object.assign(
          new Error(`Error while running ${cmd} ${args.join(' ')}\nMessage: ${error.message}\nOut: ${out}\nError: ${error}`),
          { code: error.code, message: error.message, out, err }
        )
      )
    })
    child.on('exit', exitCode => resolve({
      get stdout () {
        return Buffer.concat(stdout)
      },
      get stderr () {
        return Buffer.concat(stderr)
      },
      exitCode
    }))
  })
  return {
    dirname: cwd,
    cd: (...folders) => operate(path.join(cwd, ...folders)),
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
    move: async (folders, target) => rename(path.join(cwd, ...folders), path.join(target, ...folders)),
    deployNetlify: ({ authToken, production }) =>
      exec(
        require.resolve('netlify-cli/bin/run'),
        ['deploy', '--dir', cwd, '--auth', authToken, '--json', production && '--prod'].filter(Boolean),
        { signal }
      ),
    datPush: async (timeout, ...folders) => {
      const dat = await new Promise((resolve, reject) =>
        createDat(path.join(cwd, ...folders), { createIfMissing: false }, (error, dat) => {
          if (error) return reject(error)
          resolve(dat)
        })
      )
      await new Promise((resolve, reject) => dat.importFiles(err => err ? reject(err) : resolve()))
      await new Promise(resolve => {
        const stream = peer => {
          const stream = dat.archive.replicate({ live: false })
          logger.info('Synching peer: %s', peer.host)
          stream.on('error', function (err) {
            logger.error('Peer error: %s %o', peer.host, err)
          })
          stream.on('close', () => {
            logger.info('Closing peer: %s', peer.host)
          })
          return stream
        }
        dat.joinNetwork({ stream }).on('listening', () => logger.info('Searching for targets...'))
        setTimeout(() => dat.close(resolve), timeout)
      })
    },
    datKey: (...folders) => new Promise((resolve, reject) => {
      createDat(path.join(cwd, ...folders), { createIfMissing: false }, (err, dat) => {
        if (err) return reject(err)
        const key = dat.key
        dat.close((err) => {
          if (err) return reject(err)
          resolve(key)
        })
      })
    }),
    datInit: (...folders) => new Promise((resolve, reject) => {
      createDat(path.join(cwd, ...folders), { errorIfExists: true }, (err, dat) => {
        if (err) return reject(err)
        logger.info('Initial File import')
        dat.importFiles((err) => {
          if (err) return reject(err)
          logger.info('Initial import finished')
          dat.close((err) => {
            if (err) return reject(err)
            resolve()
          })
        })
      })
    })
  }
}

class Site {
  constructor (config, folder) {
    this.config = config
    this.folder = folder
    this.count = 0
  }

  async update ({ signal } = {}) {
    this.count += 1
    const unlock = await lockFile(`${this.folder}_lock`, { signal })
    try {
      let isFresh = false
      const inFolder = operate(this.folder, { signal })
      logger.info((await inFolder.exec('wget', ['--version'])).stdout.toString())
      logger.info((await inFolder.exec('git', ['--version'])).stdout.toString())
      if (!await inFolder.exists('.git')) {
        await this._init()
        isFresh = true
      }
      await this._download({ signal })
      const commitHappened = await this._commit(isFresh, { signal })
      if (!commitHappened && this.count > 1) {
        logger.info('no changes[%s] %s', this.count, commitHappened)
        return
      }
      if (this.config.netlify) {
        logger.info('deploying to netlify')
        await inFolder.cd(this.config.domain).deployNetlify(this.config.netlify)
      } else {
        logger.info('skipping netlify')
      }
      if (this.config.dat && this.config.dat.pushTime) {
        logger.info(`syncing dat:${(await inFolder.cd(this.config.domain).datKey()).toString('hex')}`)
        await inFolder.cd(this.config.domain).datPush(this.config.dat.pushTime)
      } else {
        logger.info('skipping dat')
      }
    } finally {
      await unlock()
    }
  }

  async _commit (isFresh, { signal }) {
    const inFolder = operate(this.folder, { signal })
    await inFolder.git('add', '.')
    let changes
    if (!isFresh) {
      const { exitCode } = await inFolder.git('diff', 'HEAD', '-s', '--exit-code')
      if (exitCode === 0) {
        logger.info('No changes.')
        return false
      }
      changes = `Update:\n${(await inFolder.git('status', '-s')).stdout.toString()}`
    } else {
      changes = 'Initial commit'
    }
    logger.info('Creating commit: %s', changes)
    await inFolder.git('config', 'user.name', this.config.git.name)
    await inFolder.git('config', 'user.email', this.config.git.email)
    await inFolder.git('commit', '-s', '-m', changes)
    return true
  }

  async _init () {
    const infolder = operate(this.folder)
    logger.info('Initing %s', this.folder)
    await infolder.mkdir()
    await infolder.git('init', '-q')
  }

  get paths () {
    const site = (this.config.https === false ? 'http' : 'https') + '://' + this.config.domain
    return this.config.roots.map(root => `${site}${root}`)
  }

  async _download ({ signal } = {}) {
    const intemp = operate(await mkdtemp(name), { signal })
    logger.info('Downloading to %s', intemp.dirname)
    await intemp.download(this.paths)
    await intemp.write(['.gitignore'], [
      '.pidfile',
      '.dat'
    ].join('\n'))
    logger.info('Domain: %s', `http${this.config.https ? 's' : ''}://${this.config.domain}`)
    await replaceLinks({ dir: intemp.dirname, domain: this.config.domain, newDomain: this.config.newDomain, signal })
    const inTmpDomain = intemp.cd(this.config.domain)
    if (this.config.netlify) {
      await inTmpDomain.mkdir('.netlify')
      await inTmpDomain.write(['.netlify', 'state.json'], JSON.stringify({
        siteId: this.config.netlify.siteId
      }, null, 2))
      if (this.config.netlify.config) {
        await inTmpDomain.write(['netlify.toml'], this.config.netlify.config)
      }
    }
    if (this.config.dat) {
      await inTmpDomain.write(['dat.json'], JSON.stringify({
        title: this.config.title,
        description: this.config.description,
        url: `dat://${this.config.newDomain}`
      }, null, 2))
    }
    const state = {
      datMoved: false,
      gitMoved: false
    }
    await safeReplace(this.folder, intemp.dirname, {
      signal,
      op: {
        run: async (backup, target) => {
          const inBackup = operate(backup, { signal })
          if (await inBackup.exists(this.config.domain, '.dat')) {
            await inBackup.move([this.config.domain, '.dat'], target)
            state.datMoved = true
          } else if (this.config.dat) {
            await operate(target, { signal }).datInit(this.config.domain)
          }
          logger.info('Moving git')
          await inBackup.move(['.git'], target)
          state.gitMoved = true
        },
        rewind: async (backup, target) => {
          logger.info('Rewinding')
          const inTarget = operate(target, { signal })
          if (state.datMoved) {
            await inTarget.move([this.config.domain, '.dat'], backup)
          }
          if (state.gitMoved) {
            await inTarget.move(['.git'], backup)
          }
        }
      }
    })
  }
}

module.exports = Site
