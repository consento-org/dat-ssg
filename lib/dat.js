const createDat = require('dat-node')
const logger = require('pino')({ name: 'dat-ssg-tools' })
const { listenAbort } = require('./abort.js')
const path = require('path')

function datInit (cwd, ...folders) {
  return new Promise((resolve, reject) => {
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

async function datPush (signal, cwd, timeout, ...folders) {
  const dat = await new Promise((resolve, reject) =>
    createDat(path.join(cwd, ...folders), { createIfMissing: false }, (error, dat) => {
      if (error) return reject(error)
      resolve(dat)
    })
  )
  await new Promise((resolve, reject) => dat.importFiles(err => err ? reject(err) : resolve()))
  await new Promise((resolve, reject) => {
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
    let _close = (triggerError) => {
      unlisten()
      clearTimeout(timer)
      _close = () => {}
      logger.info('Closing dat')
      dat.close(closeError => {
        logger.info('Dat closed.')
        if (triggerError) return reject(triggerError)
        if (closeError) return reject(closeError)
        resolve()
      })
    }
    const unlisten = listenAbort(signal, _close)
    const until = new Date(Date.now() + timeout)
    dat.joinNetwork({ stream }, (err) => {
      if (err) return _close(err)
    })
      .on('listening', () => logger.info(`Searching for targets for ${timeout}ms until ${until}`))
      .on('error', _close)

    const timer = setTimeout(_close, timeout)
  })
}

function datKey (cwd, ...folders) {
  return new Promise((resolve, reject) => {
    createDat(path.join(cwd, ...folders), { createIfMissing: false }, (err, dat) => {
      if (err) return reject(err)
      const key = dat.key
      dat.close((err) => {
        if (err) return reject(err)
        resolve(key)
      })
    })
  })
}

module.exports = {
  datInit,
  datPush,
  datKey
}
