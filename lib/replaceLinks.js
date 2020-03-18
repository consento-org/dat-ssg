const { replaceInDir } = require('./fs')
const { dirname, resolve } = require('path')
const escape = require('escape-string-regexp')

const relativeIndexRegExp = /(href=["']((?!https?:\/\/)[^"']+)).+(index\.html)/ig
const noFeedlyRegExp = /https:\/\/feedly\.com\/i\/subscription\/feed\//ig
const noGeneratorRegExp = /\s*<meta\s+name\s*=\s*["']generator["']\s+content\s*=\s*["'][^"']+['"][^>]+>/igm
const indexHtmlRegExp = /(href\s*=\s*["'])\s*index.html\s*(["'])/ig
const cssSourceMapRegExp = /\/\*\s*#\s*sourceMappingURL\s*=\s*(main\.css\.map)\s*\*\//ig

function replaceOptions (https, domain, newDomain, handleFile) {
  const ogRegExp = new RegExp(`(<meta\\s+(name|property)\\s*=\\s*["'](twitter|og):(url|image)["']\\s+content\\s*=\\s*["'])(https?://${escape(domain)}(/[^"']*)?)`, 'igm')
  const absDomain = `${https ? 'https' : 'http'}://${domain}`
  const manifestLink = new RegExp(`"src"\\s*:\\s*"(${absDomain})?(/[^"]+)"`, 'g')
  const absoluteRegExp = new RegExp(`${absDomain}/?`, 'g')
  return new Map([
    [
      filepath => /\.(html|css)$/.test(filepath),
      new Map([
        [noGeneratorRegExp, () => ''],
        [noFeedlyRegExp, () => ''],
        [ogRegExp, ([_, og, _nameProp, _twitterOg, urlImage, link, route]) => {
          if (urlImage === 'image') {
            handleFile(link)
          }
          return `${og}${newDomain}${route}`
        }],
        [cssSourceMapRegExp, ([section, mapUrl], { filepath, dir }) => {
          const relativePath = filepath.substr(dir.length)
          if (relativePath.indexOf(domain) === 1) {
            const domainPath = dirname(relativePath.substr(domain.length + 1))
            handleFile(`${https ? 'https' : 'http'}://${domain}${resolve(domainPath, mapUrl)}`)
          }
          return section
        }],
        [absoluteRegExp, () => '/'],
        [relativeIndexRegExp, ([_, hrefWithoutIndex]) => hrefWithoutIndex],
        [indexHtmlRegExp, ([_, prefix, suffix]) => `${prefix}.${suffix}`]
      ])
    ],
    [
      filepath => /\.webmanifest(@.*)?$/.test(filepath),
      new Map([
        [manifestLink, ([section, _, path]) => {
          handleFile(`${absDomain}/${path}`)
          return section
        }]
      ])
    ]
  ])
}

async function replaceLinks ({ dir, https, domain, newDomain, signal }) {
  const files = {}
  await replaceInDir(dir, {
    fileMap: replaceOptions(https, domain, newDomain, file => { files[file] = true }),
    signal,
    context: { dir }
  })
  return { files: Object.keys(files) }
}

module.exports = {
  replaceLinks,
  replaceOptions
}
