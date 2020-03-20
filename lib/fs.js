const { TextDecoder, TextEncoder } = require('util')
const { open, unlink, rename, lstat, readdir, mkdir } = require('fs').promises
const { resolve, join } = require('path')
const { randomBytes } = require('crypto')
const os = require('os')
const { checkAbort } = require('./abort.js')

async function * readFile (filepath, { fileHandle, buffer, signal } = {}) {
  checkAbort(signal)
  if (fileHandle === null || fileHandle === undefined) {
    fileHandle = await open(filepath, 'r')
  }
  try {
    while (true) {
      checkAbort(signal)
      const { bytesRead } = await fileHandle.read(buffer, null, buffer.length)
      if (bytesRead > 0) yield bytesRead
      if (bytesRead < buffer.length) break
    }
  } catch (error) {
    error.message += ` while reading ${filepath}`
    error.filepath = filepath
    throw error
  } finally {
    await fileHandle.close()
  }
}

async function * readFileData (filepath, { fileHandle, signal, highWaterMark = 1024 * 64 } = {}) {
  const buffer = new Uint8Array(highWaterMark)
  for await (const bytesRead of readFile(filepath, { fileHandle, buffer, signal })) {
    if (bytesRead < buffer.length) {
      yield buffer.slice(0, bytesRead)
    } else {
      yield buffer
    }
  }
}

async function * readStringFile (filepath, { fileHandle, signal, highWaterMark = 1024 * 64, encoding = 'utf-8' } = {}) {
  const decoder = new TextDecoder(encoding)
  for await (const buffer of readFileData(filepath, { fileHandle, signal, highWaterMark })) {
    yield decoder.decode(buffer)
  }
}

const positions = new Map()

function getNextMatch (data, patterns) {
  let result = null
  let pattern
  for (const onePattern of patterns) {
    const previousLastIndex = onePattern.lastIndex
    const oneResult = onePattern.exec(data)
    if (oneResult !== null) {
      if (result === null || result.index > oneResult.index) {
        if (result !== null) {
          pattern.lastIndex = positions.get(pattern)
          positions.delete(pattern)
        }
        result = oneResult
        pattern = onePattern
        positions.set(onePattern, previousLastIndex)
      } else {
        onePattern.lastIndex = previousLastIndex
      }
    } else {
      onePattern.lastIndex = previousLastIndex
    }
  }
  positions.delete(pattern)
  if (positions.size > 0) {
    throw new Error('memory')
  }
  return { pattern, result }
}

async function * replace ({ stream, patternMap, signal, context }) {
  let data
  const patternCount = new Map()
  for await (const string of stream) {
    checkAbort(signal)
    if (data === undefined) {
      data = string
    } else {
      data += string
    }
    while (true) {
      const { result, pattern } = getNextMatch(data, patternMap.keys())
      if (result === null) {
        break
      }
      const end = result.index + result[0].length
      if (end !== data.length) {
        result.input = data.substr(0, end)
      }
      let min = Number.MAX_VALUE
      for (const onePattern of patternMap.keys()) {
        min = Math.max(Math.min(min, onePattern.lastIndex), 0)
      }
      const count = patternCount.has(pattern) ? patternCount.get(pattern) : 0
      patternCount.set(pattern, count + 1)
      data = data.substr(0, result.index) + patternMap.get(pattern)(result, context, count) + data.substr(end)
      if (min > 0) {
        if (min === data.length) {
          yield data
          data = undefined
          for (const onePattern of patternMap.keys()) {
            onePattern.lastIndex = 0
          }
        } else {
          yield data.substr(0, min)
          data = data.substr(min)
          for (const onePattern of patternMap.keys()) {
            onePattern.lastIndex = Math.max(0, onePattern.lastIndex - min)
          }
        }
      }
    }
  }
  if (data !== undefined) {
    yield data
  }
  for (const onePattern of patternMap.keys()) {
    onePattern.lastIndex = 0
  }
}

async function * recursiveFiles (dir, { signal } = {}) {
  for (const entry of await readdir(dir)) {
    checkAbort(signal)
    const filepath = join(dir, entry)
    const stat = await lstat(filepath)
    checkAbort(signal)
    if (stat.isDirectory()) {
      for await (const childpath of recursiveFiles(filepath)) {
        yield childpath
      }
    }
    if (stat.isFile()) {
      yield filepath
    }
  }
}

async function replaceInDir (dir, { fileMap, signal, context = {} } = {}) {
  for await (const filepath of recursiveFiles(dir)) {
    for (const fileFilter of fileMap.keys()) {
      if (await fileFilter(filepath)) {
        checkAbort(signal)
        await replaceInFile(filepath, {
          patternMap: fileMap.get(fileFilter),
          signal,
          context: {
            filepath,
            ...context
          }
        })
      }
    }
  }
}

async function writeFile (filepath, { fileHandle } = {}) {
  if (fileHandle === null || fileHandle === undefined) {
    fileHandle = await open(filepath, 'w')
  }
  let closed = false
  return async (buffer, length) => {
    if (closed) {
      throw new Error('closed.')
    }
    if (buffer === null) {
      closed = true
      await fileHandle.close()
    } else {
      await fileHandle.write(buffer, null, length)
    }
  }
}

async function writeStringFile (filepath, { fileHandle, encoding = 'utf-8' } = {}) {
  const writer = await writeFile(filepath, { fileHandle })
  const encoder = new TextEncoder(encoding)
  return async string => {
    if (string === null) {
      return writer(null)
    }
    const buffer = encoder.encode(string)
    await writer(buffer)
  }
}

const noop = () => {}

async function sinkTo (inStream, processor) {
  let previous
  try {
    for await (const value of inStream) {
      await previous
      previous = processor(value)
      if (previous && previous.catch) {
        previous.catch(noop)
      }
    }
    await previous
  } finally {
    await processor(null)
  }
}

async function iterToString (inStream) {
  let result = ''
  await sinkTo(inStream, data => {
    if (data !== null) {
      result += data
    }
  })
  return result
}

async function replaceToTarget (source, target, { patternMap, signal, encoding = 'utf-8', highWaterMark = 1024 * 64, context } = {}) {
  await sinkTo(
    replace(
      {
        stream: readStringFile(source, { signal, encoding, highWaterMark }),
        patternMap,
        context
      }
    ),
    target
  )
}

async function replaceToFile (source, target, replaceToTargetOptions = {}) {
  if (resolve(source) === resolve(target)) {
    throw new Error('Replacing to same file doesnt work')
  }
  await replaceToTarget(source, await writeStringFile(target, { encoding: replaceToTargetOptions.encoding }), replaceToTargetOptions)
}

async function mkdtemp (...folders) {
  const pth = join(os.tmpdir(), randomBytes(4).toString('hex'), ...folders)
  await mkdir(pth, { recursive: true })
  return pth
}

async function replaceInFile (filepath, { patternMap, signal, context }) {
  const tmpfile = join(await mkdtemp(), `_replace_${Date.now().toString(16)}${randomBytes(4).toString('hex')}`)
  let successful = false
  try {
    await replaceToFile(filepath, tmpfile, { patternMap, signal, context })
    successful = true
  } finally {
    if (successful) {
      await unlink(filepath)
      await rename(tmpfile, filepath)
    } else {
      await unlink(tmpfile)
    }
  }
}

module.exports = {
  readFile,
  readFileData,
  readStringFile,
  iterToString,
  replace,
  sinkTo,
  mkdtemp,
  replaceInFile,
  replaceToFile,
  replaceToTarget,
  replaceInDir,
  writeFile,
  writeStringFile
}
