describe('replaceOptions', () => {
  const { replaceOptions } = require('../../lib/replaceLinks')
  const { replace, iterToString, readStringFile } = require('../../lib/fs')
  const { readFile } = require('fs').promises
  it('testing with sample data', async () => {
    const prefix = `${__dirname}/_data/tanja`
    const filepath = `${prefix}.html`
    const { value: patternMap } = replaceOptions('write.georepublic.net', 'https://consento.org').values().next()
    expect(await iterToString(
      replace({
        stream: readStringFile(filepath),
        patternMap
      })
    )).toBe(await readFile(`${prefix}.expected.html`, 'utf-8'))
  })
})
