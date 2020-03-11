const createDat = require('dat-node')
const logger = require('pino')({ name: 'dat-ssg-tools' })
const { listenAbort } = require('./abort.js')
const path = require('path')

function datCreate (cwd, folders, opts) {
  return new Promise((resolve, reject) =>
    createDat(path.join(cwd, ...folders), opts, (error, dat) => {
      if (error) return reject(error)
      resolve(dat)
    })
  )
}

function datImport (signal, dat) {
  return new Promise((resolve, reject) => {
    const progress = dat.importFiles()
    let close = err => {
      close = () => {}
      unlisten()
      if (err) return reject(err)
      resolve()
    }

    logger.info('Starting import process')
    progress.on('error', err => {
      logger.info('Error while importing: %s', err.message)
      close(err)
    })
    progress.on('end', () => {
      logger.info('Initial import.')
      close()
    })
    const unlisten = listenAbort(signal, close)
  })
}

function datClose (dat) {
  return new Promise((resolve, reject) => dat.close(err => {
    if (err) return reject(err)
    resolve()
  }))
}

async function datInit (signal, cwd, ...folders) {
  const dat = await datCreate(cwd, folders, { errorIfExists: true })
  try {
    await datImport(signal, dat)
  } finally {
    await datClose(dat)
  }
}

function datSync (signal, dat, timeout) {
  return new Promise((resolve, reject) => {
    const stream = peer => {
      const stream = dat.archive.replicate({ live: false })
      logger.info('Synching peer: %s', peer.host)
      stream.on('error', err => {
        logger.warn('Peer error: %s %o', peer.host, (err && (err.stack || err.message)) || err)
      })
      stream.on('close', () => {
        logger.info('Closing peer: %s', peer.host)
      })
      return stream
    }
    let close = err => {
      close = () => {}
      clearTimeout(timer)
      unlisten()
      if (err) return reject(err)
      resolve()
    }
    const unlisten = listenAbort(signal, close)
    const until = new Date(Date.now() + timeout)
    dat.joinNetwork({ stream }, err => {
      if (err) close(err)
    })
      .on('listening', () => logger.info(`Searching for targets for ${timeout}ms until ${until}`))
      .on('error', close)

    const timer = setTimeout(close, timeout)
  })
}

async function datPush (signal, cwd, timeout, ...folders) {
  const dat = await datCreate(cwd, folders, { createIfMissing: false })
  try {
    await datImport(signal, dat)
    await datSync(signal, dat, timeout)
  } finally {
    await datClose(dat)
  }
}

async function datKey (cwd, ...folders) {
  const dat = await datCreate(cwd, folders, { createIfMissing: false })
  const key = dat.key
  await datClose(dat)
  return key
}

module.exports = {
  datInit,
  datPush,
  datKey
}
