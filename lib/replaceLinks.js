const { replaceInDir } = require('./fs')
const escape = require('escape-string-regexp')

const relativeIndexRegExp = /(href=["']((?!https?:\/\/)[^"']+)).+(index\.html)/ig
const noFeedlyRegExp = /https:\/\/feedly\.com\/i\/subscription\/feed\//ig
const noGeneratorRegExp = /\s*<meta\s+name\s*=\s*["']generator["']\s+content\s*=\s*["'][^"']+['"][^>]+>/igm
const indexHtmlRegExp = /(href\s*=\s*["'])\s*index.html\s*(["'])/ig

function replaceOptions (domain, newDomain, handleImage) {
  const ogRegExp = new RegExp(`(<meta\\s+(name|property)\\s*=\\s*["'](twitter|og):(url|image)["']\\s+content\\s*=\\s*["'])(https?://${escape(domain)}(/[^"']*)?)`, 'igm')
  const absoluteRegExp = new RegExp(`https?://${escape(domain)}/?`, 'g')
  return new Map([
    [
      filepath => /\.(html|css)$/.test(filepath),
      new Map([
        [noGeneratorRegExp, () => ''],
        [noFeedlyRegExp, () => ''],
        [ogRegExp, ([_, og, _nameProp, _twitterOg, urlImage, link, route]) => {
          if (urlImage === 'image') {
            handleImage(link)
          }
          return `${og}${newDomain}${route}`
        }],
        [absoluteRegExp, () => '/'],
        [relativeIndexRegExp, ([_, hrefWithoutIndex]) => hrefWithoutIndex],
        [indexHtmlRegExp, ([_, prefix, suffix]) => `${prefix}.${suffix}`]
      ])
    ]
  ])
}

async function replaceLinks ({ dir, domain, newDomain, signal }) {
  const images = {}
  await replaceInDir(dir, { fileMap: replaceOptions(domain, newDomain, image => { images[image] = true }), signal })
  return { images: Object.keys(images) }
}

module.exports = {
  replaceLinks,
  replaceOptions
}
