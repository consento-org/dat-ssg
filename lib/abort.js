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
  isAborted,
  AbortError,
  AbortController,
  untilAbort,
  processSignal: abortController.signal
}
