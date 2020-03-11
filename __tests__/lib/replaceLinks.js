describe('replaceOptions', () => {
  const { replaceOptions } = require('../../lib/replaceLinks')
  const { replace, iterToString, readStringFile } = require('../../lib/fs')
  const { readFile } = require('fs').promises
  it('testing with sample data', async () => {
    const prefix = `${__dirname}/_data/tanja`
    const filepath = `${prefix}.html`
    const images = []
    const { value: patternMap } = replaceOptions('write.georepublic.net', 'https://consento.org', image => images.push(image)).values().next()
    expect(await iterToString(
      replace({
        stream: readStringFile(filepath),
        patternMap
      })
    )).toBe(await readFile(`${prefix}.expected.html`, 'utf-8'))
    expect(images).toEqual([
      'https://write.georepublic.net/content/images/2020/03/human-centric@1x-1.png',
      'https://write.georepublic.net/images/2020/03/human-centric@1x.png'
    ])
  })
})
