const { AbortController } = require('abort-controller')

function checkAbort (signal) {
  if (isAborted(signal)) {
    throw new AbortError()
  }
}

function isAborted (signal) {
  return signal !== undefined && signal !== null && signal.aborted
}

function untilAbort (signal, op) {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => {
      const abortError = new AbortError()
      ;(async () => {
        await op(abortError, signal)
      })()
        .then(
          () => reject(abortError),
          error => reject(error)
        )
    })
  })
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
process.on('SIGINT', () => abortController.abort())

module.exports = {
  checkAbort,
  listenAbort,
  isAborted,
  AbortError,
  AbortController,
  untilAbort,
  processSignal: abortController.signal
}
