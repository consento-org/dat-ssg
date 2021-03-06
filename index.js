const { spawn } = require('child_process')
const path = require('path')
const chokidar = require('chokidar')
const { createLock } = require('flexlock')
const { name } = require('./package.json')
const logger = require('pino')({ name })
const { untilAbort } = require('./lib/abort.js')
const { createWriteStream, promises: { mkdir, stat } } = require('fs')

function closeStream (stream) {
  const p = new Promise(resolve => stream.on('close', resolve))
  stream.close()
  return p
}

async function createFileWorker (filename, workFolder, respawnTime) {
  let closeChild
  let destroyed = false
  let respawnTimer
  const workerPath = path.join(workFolder, path.basename(filename))
  await mkdir(workerPath, { recursive: true })

  const triggerRespawn = () => {
    if (destroyed) {
      return
    }
    if (respawnTimer !== undefined) {
      return
    }
    logger.info('Trigger respawn of %s in %dms at %s', filename, respawnTime, new Date(Date.now() + respawnTime).toString())
    respawnTimer = setTimeout(() => {
      respawnTimer = undefined
      logger.info('forcing respawn of %s', filename)
      update()
    }, respawnTime)
  }

  const destroy = async () => {
    if (destroyed === true) {
      logger.info('Skipping repeat destroying of %s', workerPath)
      return
    }
    logger.info('Destroying %s', workerPath)
    destroyed = true
    if (respawnTimer !== undefined) {
      clearTimeout(respawnTimer)
    }
    if (closeChild !== undefined) {
      await closeChild()
    }
  }
  const update = async () => {
    if (destroyed) {
      return
    }
    if (respawnTimer !== undefined) {
      clearTimeout(respawnTimer)
    }
    if (closeChild !== undefined) {
      await closeChild()
    }
    const err = createWriteStream(`${workerPath}.err`, { flags: 'a' })
    err.on('error', err => {
      logger.info('Write-stream Eeror for %s.err: %s', workerPath, err.message)
      triggerRespawn()
    })
    const out = createWriteStream(`${workerPath}.out`, { flags: 'a' })
    out.on('error', err => {
      logger.info('Write-stream error for %s.out: %s', workerPath, err.message)
      triggerRespawn()
    })
    logger.info('Spawning worker for %s in workfolder %s', filename, workerPath)
    const child = spawn(path.join(__dirname, 'worker.js'), [filename, workerPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout.pipe(out, { end: false })
    child.stderr.pipe(err, { end: false })
    child.on('exit', (code, signal) => {
      logger.info('%s closed with code %s and signal %s', filename, code || 0, signal)
      triggerRespawn()
    })
    const closed = new Promise(resolve => child.on('close', resolve))
    closeChild = async () => {
      child.kill('SIGINT')
      await closed
      await Promise.all([
        closeStream(err).catch(err => logger.info('warning %s.err couldnt properly be closed: %s', workerPath, err.message)),
        closeStream(out).catch(err => logger.info('warning %s.out couldnt properly be closed: %s', workerPath, err.message))
      ])
      closeChild = undefined
    }
  }
  update()
  return {
    destroy,
    update
  }
}

async function assertDir (name, folder) {
  if (typeof folder !== 'string') {
    throw Object.assign(new Error(`Expected ${name} to be a directory`), { code: 'assert-dir-empty', folder })
  }
  const status = await stat(folder)
  if (!status.isDirectory()) {
    throw Object.assign(new Error(`Expected ${name} pointing to "${folder}" to be a directory.`), { code: 'assert-dir-nodir', folder })
  }
  return path.resolve(process.cwd(), folder)
}

module.exports = async ({ configurationFolder, workFolder, signal, respawnTime }) => {
  const workers = new Map()
  configurationFolder = await assertDir('configuration-folder', configurationFolder)
  workFolder = await assertDir('work-folder', workFolder)
  logger.info('configurationFolder: %s', configurationFolder)
  logger.info('workFolder: %s', workFolder)
  const lock = createLock()

  const updateWorker = async filename => lock(async () => {
    if (workers.has(filename)) {
      logger.info('~ %s', [filename])
      await (workers.get(filename)).update()
    } else {
      logger.info('+ %s', [filename])
      workers.set(filename, await createFileWorker(filename, workFolder, respawnTime))
    }
  })

  const closeWorker = async filename => lock(async () => {
    const fileWorker = workers.get(filename)
    if (fileWorker === undefined) {
      return
    }
    logger.info('- %s', [filename])

    await fileWorker.destroy()
    workers.delete(filename)
  })

  const watcher = chokidar.watch(`${configurationFolder}/*.js`, {
    followSymlinks: false,
    recursive: false
  })
  watcher.on('add', updateWorker)
  watcher.on('change', updateWorker)
  watcher.on('unlink', closeWorker)

  const { abortPromise, release } = untilAbort(signal, async () => {
    logger.info('close')
    watcher.close()
  })

  try {
    await Promise.race([
      new Promise((resolve, reject) => watcher.on('error', reject)),
      abortPromise
    ])
  } finally {
    release()
    for (const filename of workers.keys()) {
      await closeWorker(filename)
    }
  }
}
