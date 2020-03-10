const { AbortController } = require('abort-controller')
const logger = require('pino')({ name: 'dat-ssg-abort' })

function checkAbort (signal) {
  if (isAborted(signal)) {
    throw new AbortError()
  }
}

function isAborted (signal) {
  return signal !== undefined && signal !== null && signal.aborted
}

function abortPromise (signal) {
  let release
  const abortPromise = new Promise((resolve, reject) => {
    release = err => {
      unlisten()
      if (err) {
        return reject(err)
      }
      resolve()
    }
    const unlisten = listenAbort(signal, release)
  })
  return {
    abortPromise,
    release
  }
}

function untilAbort (signal, op) {
  const { abortPromise: promise, release } = abortPromise(signal)
  return {
    abortPromise: promise.then(() => op(null, signal), err => op(err, signal)),
    release
  }
}

function listenAbort (signal, handler) {
  if (signal === null || signal === undefined) {
    return () => {}
  }
  const eventHandler = () => handler(new AbortError())
  signal.addEventListener('abort', eventHandler)
  return () => signal.removeEventListener('abort', eventHandler)
}

class AbortError extends Error {
  constructor () {
    super('Aborted.')
    this.type = 'abort'
    this.code = 'abort'
  }
}

const abortController = new AbortController()
process.on('SIGINT', (_, signal) => {
  logger.info('Aborted with sigint: %s', signal)
  abortController.abort()
})

module.exports = {
  checkAbort,
  listenAbort,
  abortPromise,
  isAborted,
  AbortError,
  AbortController,
  untilAbort,
  processSignal: abortController.signal
}
