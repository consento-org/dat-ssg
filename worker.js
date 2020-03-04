#!/usr/bin/env node
const path = require('path')
const { readlink, stat } = require('fs').promises
const logger = require('pino')({ name: 'dat-ssg-worker' })
const { processSignal, AbortError } = require('./lib/abort.js')
const Site = require('./lib/site.js')
const { version } = require('./package.json')
const filename = process.argv[2]
const workdir = process.argv[3]

logger.info('start: [version=%s, workdir=%s]', version, workdir)

const waitFor = (time, signal) => new Promise((resolve, reject) => {
  const signalHandler = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    reject(new AbortError())
  }
  let timer = setTimeout(() => {
    if (signal) {
      signal.removeEventListener('abort', signalHandler)
    }
    timer = undefined
    resolve()
  }, time)

  if (signal) {
    signal.addEventListener('abort', signalHandler)
  }
})

;(async () => {
  const status = await stat(filename)
  const actualFile = status.isSymbolicLink() ? path.resolve(process.cwd(), await readlink(filename)) : filename
  if (filename !== actualFile) {
    logger.info('filename: %s (→ %s)', filename, actualFile)
  } else {
    logger.info('filename: %s', filename)
  }
  const config = require(actualFile)
  logger.info('config: %o', config)
  const site = new Site(config, workdir)

  while (true) {
    await site.update({ signal: processSignal })
    logger.info('waiting: %d ms until %s', config.update, new Date(Date.now() + config.update).toString())
    await waitFor(config.update, processSignal)
  }
})()
  .catch(err => {
    logger.error(err ? err.stack : err)
    process.exit(1)
  })
