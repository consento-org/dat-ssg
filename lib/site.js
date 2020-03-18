const { readFile, writeFile, unlink } = require('fs').promises
const logger = require('pino')({ name: 'dat-ssg-site' })
const processExists = require('process-exists')
const { name } = require('../package.json')
const { replaceLinks } = require('./replaceLinks.js')
const { mkdtemp } = require('./fs.js')
const operate = require('./operate.js')
const fileLocked = {}

const wait = time => new Promise(resolve => setTimeout(resolve, time * 1000))

async function lockFile (file) {
  if (fileLocked[file] !== undefined) {
    throw new Error('locked')
  }
  fileLocked[file] = true
  let pid
  try {
    pid = parseInt(await readFile(file, 'utf-8'), 10)
  } catch (_) {}
  if (pid !== undefined && await processExists(pid)) {
    delete fileLocked[file]
    throw new Error(`locked by pid=${pid}`)
  }
  await writeFile(file, process.pid.toString(10))
  pid = parseInt(await readFile(file, 'utf-8'), 10)
  if (pid !== process.pid) {
    delete fileLocked[file]
    throw new Error(`locked in race condition by pid=${pid}`)
  }
  return async () => {
    delete fileLocked[file]
    await unlink(file)
  }
}

function getNetlifyConfig (config) {
  const toml = config.netlify.config
  if (config.notFound) {
    return `${toml || ''}

[[redirects]]
from = "/*"
to = "${config.notFound}"
status = 404
`
  }
  return toml
}

function getDatJSON (config) {
  if (!config.dat) {
    return
  }
  const datJSON = {
    title: config.title,
    description: config.description,
    url: `dat://${config.newDomain}`
  }
  if (config.notFound) {
    datJSON.fallback_page = config.notFound
  }
  return JSON.stringify(datJSON, null, 2)
}

function toLinks (roots, config) {
  const site = (config.https === false ? 'http' : 'https') + '://' + config.domain
  return roots.filter(Boolean).map(root => `${site}${root}`)
}

class Site {
  constructor (config, folder) {
    this.config = config
    this.folder = folder
    this.count = 0
  }

  async update ({ signal }) {
    this.count += 1
    const unlock = await lockFile(`${this.folder}_lock`, { signal })
    try {
      let isFresh = false
      const inFolder = operate(this.folder, { signal })
      logger.info((await inFolder.exec('wget', ['--version'])).stdout.toString())
      logger.info((await inFolder.exec('git', ['--version'])).stdout.toString())
      if (!await inFolder.exists('.git')) {
        await this._init({ signal })
        isFresh = true
      }
      await this._download({ signal })
      const commitHappened = await this._commit(isFresh, { signal })
      if (!commitHappened && this.count > 1) {
        logger.info('No changes[%s] %s', this.count, commitHappened)
        return
      }
      if (this.config.netlify) {
        logger.info('Deploying to netlify')
        try {
          const data = await inFolder.cd(this.config.domain).deployNetlify(this.config.netlify)
          logger.info('Deployed to %s [deploy_id=%s]', data.deploy_url, data.deploy_id)
        } catch (err) {
          logger.info('Error while deploying to netlify')
          await wait(1)
          throw err
        }
      } else {
        logger.info('Skipping netlify')
      }
      if (this.config.dat && this.config.dat.pushTime) {
        logger.info(`Syncing dat:${(await inFolder.cd(this.config.domain).datKey()).toString('hex')}`)
        await inFolder.cd(this.config.domain).datPush(this.config.dat.pushTime)
      } else {
        logger.info('Skipping dat')
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
      try {
        await inFolder.git('diff', 'HEAD', '-s', '--exit-code')
        return false
      } catch (err) {
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

  async _init ({ signal }) {
    const infolder = operate(this.folder, { signal })
    logger.info('Initing %s', this.folder)
    await infolder.mkdir()
    await infolder.git('init', '-q')
  }

  async _download ({ signal }) {
    const intemp = operate(await mkdtemp(name), { signal })
    logger.info('Downloading to %s', intemp.dirname)
    await intemp.download(toLinks(this.config.roots.concat(this.config.notFound), this.config), { opts: ['--recursive'] })
    await intemp.write(['.gitignore'], [
      '.pidfile',
      '.dat'
    ].join('\n'))
    logger.info('Domain: %s', `http${this.config.https ? 's' : ''}://${this.config.domain}`)
    const { files } = await replaceLinks({ dir: intemp.dirname, domain: this.config.domain, newDomain: this.config.newDomain, signal, https: this.config.https })
    if (files.length > 0) {
      logger.info('Additionally downloading %o', files)
      await intemp.download(files)
    }
    const inTmpDomain = intemp.cd(this.config.domain)
    if (this.config.netlify) {
      await inTmpDomain.mkdir('.netlify')
      await inTmpDomain.write(['.netlify', 'state.json'], JSON.stringify({
        siteId: this.config.netlify.siteId
      }, null, 2))
      inTmpDomain.writeIfGiven(['netlify.toml'], getNetlifyConfig(this.config))
    }
    inTmpDomain.writeIfGiven(['dat.json'], getDatJSON(this.config))
    const state = {
      datMoved: false,
      gitMoved: false
    }
    await (operate(this.folder).safeReplaceWith(intemp.dirname, {
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
    }))
  }
}

module.exports = Site
