
describe('readFile', () => {
  const { readFile } = require('../../lib/fs')
  it('can read a file', async () => {
    const buffer = new Uint8Array(4)
    for await (const bytesRead of readFile(`${__dirname}/_data/sample`, { buffer })) {
      expect(bytesRead).toBe(4)
      expect(Buffer.from(buffer).toString('utf-8')).toEqual('abcd')
    }
  })
  it('can read a file in parts', async () => {
    const buffer = new Uint8Array(3)
    const iter = readFile(`${__dirname}/_data/sample`, { buffer })
    const a = await iter.next()
    expect(a.value).toBe(3)
    expect(a.done).toBe(false)
    const b = await iter.next()
    expect(b.value).toBe(1)
    expect(b.done).toBe(false)
    expect(Buffer.from(buffer).toString('utf-8')).toEqual('dbc')
    const c = await iter.next()
    expect(c.done).toBe(true)
  })
  it('passes an open error', async () => {
    expect(readFile(`${__dirname}/missing`).next())
      .rejects.toEqual(expect.objectContaining({
        code: 'ENOENT'
      }))
  })
})
describe('readFileData', () => {
  const { readFileData } = require('../../lib/fs')
  it('can read a file', async () => {
    for await (const uint8Array of readFileData(`${__dirname}/_data/sample`, { highWaterMark: 4 })) {
      expect(uint8Array.length).toBe(4)
      expect(Buffer.from(uint8Array).toString('utf-8')).toEqual('abcd')
    }
  })
  it('can read a file in parts', async () => {
    const iter = readFileData(`${__dirname}/_data/sample`, { highWaterMark: 3 })
    const a = await iter.next()
    expect(Buffer.from(a.value).toString('utf-8')).toBe('abc')
    expect(a.done).toBe(false)
    const b = await iter.next()
    expect(Buffer.from(b.value).toString('utf-8')).toBe('d')
    expect(b.done).toBe(false)
    const c = await iter.next()
    expect(c.done).toBe(true)
  })
  it('passes an open error', async () => {
    expect(readFileData(`${__dirname}/missing`).next())
      .rejects.toEqual(expect.objectContaining({
        code: 'ENOENT'
      }))
  })
})
describe('readStringFile', () => {
  const { readStringFile } = require('../../lib/fs')
  it('can read a file', async () => {
    for await (const string of readStringFile(`${__dirname}/_data/sample`)) {
      expect(string).toEqual('abcd')
    }
  })
  it('can read a file in parts', async () => {
    const iter = readStringFile(`${__dirname}/_data/sample`, { encoding: 'utf-8', highWaterMark: 3 })
    const a = await iter.next()
    expect(a.value).toBe('abc')
    expect(a.done).toBe(false)
    const b = await iter.next()
    expect(b.value).toBe('d')
    expect(b.done).toBe(false)
    const c = await iter.next()
    expect(c.done).toBe(true)
  })
  it('passes an open error', async () => {
    expect(readStringFile(`${__dirname}/missing`).next())
      .rejects.toEqual(expect.objectContaining({
        code: 'ENOENT'
      }))
  })
})

async function * strIter (...strings) {
  for (const string of strings) {
    yield string
  }
}

describe('match', () => {
  const { match } = require('../../lib/fs')
  it('cant find nothing', async () => {
    for await (const result of match({ stream: strIter('abcd'), patterns: [] })) {
      expect(result).toEqual({
        end: 'abcd'
      })
    }
  })
  it('can find something', async () => {
    const pattern = /b/g
    const iter = match({ stream: strIter('abcd'), patterns: [pattern] })
    const a = await iter.next()
    expect(a.done).toBe(false)
    expect(a.value.result).toBeDefined()
    expect(a.value.pattern).toBe(pattern)
    expect(a.value.result.index).toBe(1)
    expect(a.value.result.input).toBe('ab')
    const b = await iter.next()
    expect(b.value.end).toBe('cd')
    expect(b.done).toBe(false)
  })
  it('can find it multiple times, over chunks', async () => {
    const pattern = /cd/g
    const iter = match({ stream: strIter('abc', 'def'), patterns: [pattern] })
    const a = await iter.next()
    expect(a.done).toBe(false)
    expect(a.value.result).toBeDefined()
    expect(a.value.pattern).toBe(pattern)
    expect(a.value.result.index).toBe(2)
    expect(a.value.result.input).toBe('abcd')
    const b = await iter.next()
    expect(b.value.end).toBe('ef')
    expect(b.done).toBe(false)
  })
  it('can find several patterns in a file', async () => {
    const patternA = /b/g
    const patternB = /2/g
    const patternC = /b?cd/g
    const iter = match({ stream: strIter('abcd-1234'), patterns: [patternA, patternB, patternC] })
    const a = await iter.next()
    expect(a.done).toBe(false)
    expect(a.value.result).toBeDefined()
    expect(a.value.pattern).toBe(patternA)
    expect(a.value.result.index).toBe(1)
    expect(a.value.result.input).toBe('ab')
    const b = await iter.next()
    expect(b.done).toBe(false)
    expect(b.value.result).toBeDefined()
    expect(b.value.pattern).toBe(patternC)
    expect(b.value.result.index).toBe(0)
    expect(b.value.result.input).toBe('cd')
    const c = await iter.next()
    expect(c.done).toBe(false)
    expect(c.value.result).toBeDefined()
    expect(c.value.pattern).toBe(patternB)
    expect(c.value.result.index).toBe(2)
    expect(c.value.result.input).toBe('-12')
    const d = await iter.next()
    expect(d.value.end).toBe('34')
    expect(d.done).toBe(false)
  })
  it('can find patterns exceeding chunks', async () => {
    const pattern = /cd/g
    const iter = match({ stream: strIter('abc', 'def'), patterns: [pattern] })
    const a = await iter.next()
    expect(a.done).toBe(false)
    expect(a.value.result).toBeDefined()
    expect(a.value.pattern).toBe(pattern)
    expect(a.value.result.index).toBe(2)
    expect(a.value.result.input).toBe('abcd')
    const c = await iter.next()
    expect(c.value.end).toBe('ef')
    expect(c.done).toBe(false)
  })
  it('can find repeatingly patterns exceeding chunks', async () => {
    const pattern = /[0-9]{3}/ig
    const iter = match({ stream: strIter('abc1', '23def4', '56ghi', '789jkl'), patterns: [pattern] })
    const a = await iter.next()
    expect(a.value.result).toBeDefined()
    expect(a.value.result.input).toBe('abc123')
    const b = await iter.next()
    expect(b.value.result).toBeDefined()
    expect(b.value.result.input).toBe('def456')
    const c = await iter.next()
    expect(c.value.result).toBeDefined()
    expect(c.value.result.input).toBe('ghi789')
    const d = await iter.next()
    expect(d.value.end).toBe('jkl')
  })
})
describe('replace', () => {
  const { replace, iterToString } = require('../../lib/fs')
  it('replace several occurances in a file', async () => {
    const patternA = /b/g
    const patternB = /[23]{2}/g
    const patternC = /y?b?cd/g
    const patternMap = new Map()
    patternMap.set(patternA, result => result[0].toUpperCase())
    patternMap.set(patternB, result => result[0].split('').reverse().join(''))
    patternMap.set(patternC, () => '')
    expect(await iterToString(replace({ stream: strIter('hello: ', 'a', 'bcd-12', '34ybcdef4321'), patternMap })))
      .toBe('hello: aB-1324ef4231')
  })
})
describe('writeStringFile', () => {
  const { writeStringFile, sinkTo, readStringFile, iterToString } = require('../../lib/fs')
  const { unlink } = require('fs').promises
  const unlinkSafe = async (pth) => {
    try {
      await unlink(pth)
    } catch (_) {}
  }
  it('write a stream to a file', async () => {
    const path = `${__dirname}/_data/test`
    await unlinkSafe(path)
    try {
      await sinkTo(strIter('this is a', ' こんにちは', ' world'), await writeStringFile(path))
      expect(await iterToString(readStringFile(path))).toBe('this is a こんにちは world')
    } finally {
      await unlinkSafe(path)
    }
  })
  it('write with different encoding', async () => {
    const path = `${__dirname}/_data/test-shift-jis`
    await unlinkSafe(path)
    try {
      await sinkTo(strIter('this is a', ' こんにちは', ' world'), await writeStringFile(path, { encoding: 'shift-jis' }))
      expect(await iterToString(readStringFile(path, 'shift-jis'))).toBe('this is a こんにちは world')
    } finally {
      await unlinkSafe(path)
    }
  })
})
describe('replaceInFile', () => {
  const { replaceInFile } = require('../../lib/fs')
  const { writeFile, readFile, unlink } = require('fs').promises
  it('replace file', async () => {
    const filepath = `${__dirname}/_data/toreplace`
    await writeFile(filepath, 'Hello world, this is fun!')
    await replaceInFile(filepath, { patternMap: new Map([[/world/ig, () => '世界']]) })
    expect(await readFile(filepath, 'utf-8')).toBe('Hello 世界, this is fun!')
    await unlink(filepath)
  })
})
