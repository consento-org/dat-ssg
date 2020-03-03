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

async function * match ({ stream, patterns, signal }) {
  let data
  if (!Array.isArray(patterns)) {
    patterns = Array.from(patterns)
  }
  for await (const string of stream) {
    if (data === undefined) {
      data = string
    } else {
      data += string
    }
    while (true) {
      checkAbort(signal)
      let result = null
      let pattern
      for (const onePattern of patterns) {
        const oneResult = onePattern.exec(data)
        onePattern.lastIndex = 0
        if (oneResult !== null) {
          if (result === null || result.index > oneResult.index) {
            result = oneResult
            pattern = onePattern
          }
        }
      }
      if (result === null) {
        break
      }
      const end = result.index + result[0].length
      if (end === data.length) {
        yield { result, pattern }
        data = undefined
        break
      }
      result.input = data.substr(0, end)
      yield { result, pattern }
      data = data.substr(end)
    }
  }
  if (data !== undefined) {
    yield { end: data }
  }
}

async function * replace ({ stream, patternMap, signal }) {
  for await (const { end, result, pattern } of match({ stream, patterns: patternMap.keys(), signal })) {
    checkAbort(signal)
    if (result !== undefined) {
      yield result.input.substr(0, result.index)
      checkAbort(signal)
      const opResult = patternMap.get(pattern)(result)
      if (opResult !== undefined && opResult !== null) {
        yield opResult
      }
    } else {
      yield end
    }
  }
}

async function * recursiveFiles (dir, { signal } = {}) {
  for (const entry of await readdir(dir)) {
    checkAbort(signal)
    const filepath = `${dir}/${entry}`
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

async function replaceInDir (dir, { fileMap, signal } = {}) {
  for await (const filepath of recursiveFiles(dir)) {
    for (const fileFilter of fileMap.keys()) {
      if (await fileFilter(filepath)) {
        checkAbort(signal)
        await replaceInFile(filepath, {
          patternMap: fileMap.get(fileFilter),
          signal
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

async function replaceToTarget (source, target, { patternMap, signal, encoding = 'utf-8', highWaterMark = 1024 * 64 } = {}) {
  await sinkTo(
    replace(
      {
        stream: readStringFile(source, { signal, encoding, highWaterMark }),
        patternMap
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

async function mkdtemp () {
  const pth = join(os.tmpdir(), randomBytes(4).toString('hex'))
  await mkdir(pth, { recursive: true })
  return pth
}

async function replaceInFile (filepath, { patternMap, signal }) {
  const tmpfile = `${await mkdtemp()}/_replace_${Date.now().toString(16)}${randomBytes(4).toString('hex')}`
  let successful = false
  try {
    await replaceToFile(filepath, tmpfile, { patternMap, signal })
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
  match,
  replace,
  sinkTo,
  replaceInFile,
  replaceToFile,
  replaceToTarget,
  replaceInDir,
  writeFile,
  writeStringFile
}
