describe('replaceOptions', () => {
  const { replaceOptions } = require('../../lib/replaceLinks')
  const { replace, iterToString, readStringFile } = require('../../lib/fs')
  const { readFile } = require('fs').promises
  const newDomain = 'https://me.com'
  const oldDomain = 'mydomain.org'
  const files = [
    ['index', [
      `https://${oldDomain}/content/images/2020/02/banner-trapeze--1--1.png`,
      `https://${oldDomain}/content/images/2020/02/banner-trapeze--1-.png`
    ]],
    ['tanja', [
      `https://${oldDomain}/main.css.map`,
      `https://${oldDomain}/content/images/2020/03/human-centric@1x-1.png`,
      `https://${oldDomain}/images/2020/03/human-centric@1x.png`
    ]]
  ]
  for (const [file, links] of files) {
    it(`testing with sample: ${file}`, async () => {
      const prefix = `${__dirname}/_data/${file}`
      const filepath = `${prefix}.html`
      const files = []
      const { value: patternMap } = replaceOptions(true, oldDomain, newDomain, file => files.push(file)).values().next()
      expect(await iterToString(
        replace({
          stream: readStringFile(filepath),
          patternMap,
          context: {
            filepath: `/abcd/efg/${oldDomain}/xyz`,
            dir: '/abcd/efg'
          }
        })
      )).toBe(await readFile(`${prefix}.expected.html`, 'utf-8'))
      expect(files).toEqual(links)
    })
  }
})
