
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
describe('replace()', () => {
  const { replace, iterToString } = require('../../lib/fs')
  it('cant find nothing', async () => {
    for await (const result of replace({ stream: strIter('abcd'), patternMap: new Map() })) {
      expect(result).toEqual('abcd')
    }
  })
  it('can replace something', async () => {
    const pattern = /b/g
    const iter = replace({
      stream: strIter('abcd'),
      patternMap: new Map([[pattern, ([match], context, count) => {
        expect(match).toBe('b')
        expect(context).toBe(undefined)
        expect(count).toBe(0)
        return 'X'
      }]])
    })
    expect(await iterToString(iter)).toBe('aXcd')
    expect(pattern.lastIndex).toBe(0)
  })
  it('can find it over chunks', async () => {
    const pattern = /cd/g
    const iter = replace({
      stream: strIter('abc', 'def'),
      patternMap: new Map([[pattern, ([match]) => {
        expect(match).toBe('cd')
        return 'XY'
      }]])
    })
    expect(await iterToString(iter)).toBe('abXYef')
  })
  it('can find it multiple times over multiple chunks', async () => {
    const pattern = /cd/g
    const iter = replace({
      stream: strIter('abc', 'def-abc', 'def-ab', 'cdef'),
      patternMap: new Map([[pattern, ([match], _, count) => {
        expect(match).toBe('cd')
        if (count < 0 || count > 2 || isNaN(count)) {
          throw new Error(`unexpected count ${count}`)
        }
        return 'XY'
      }]])
    })
    expect(await iterToString(iter)).toBe('abXYef-abXYef-abXYef')
  })
  it('can find several patterns in a file', async () => {
    const patternA = /b/g
    const patternB = /2/g
    const patternC = /b?cd/ig
    const iter = replace({
      stream: strIter('abcd-1234-b'),
      patternMap: new Map([
        [patternA, () => 'B'],
        [patternB, () => 'X'],
        [patternC, ([match]) => {
          expect(match).toBe('Bcd')
          return 'rst'
        }]
      ])
    })
    expect(await iterToString(iter)).toBe('arst-1X34-B')
    expect(patternA.lastIndex).toBe(0)
    expect(patternB.lastIndex).toBe(0)
    expect(patternC.lastIndex).toBe(0)
  })
  it('can find repeatingly patterns exceeding multiple chunks', async () => {
    const pattern = /[0-9]{6}/ig
    const iter = replace({
      stream: strIter('abc1', '234', '56ghi', '789jkl'),
      patternMap: new Map([
        [pattern, () => 'XXX']
      ])
    })
    expect(await iterToString(iter)).toBe('abcXXXghi789jkl')
  })
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
