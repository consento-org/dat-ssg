const { replaceInDir } = require('./fs')
const escape = require('escape-string-regexp')

const relativeIndexRegExp = /(href=["']((?!https?:\/\/)[^"']+)).+(index\.html)/ig
const noFeedlyRegExp = /https:\/\/feedly\.com\/i\/subscription\/feed\//ig
const noGeneratorRegExp = /\s*<meta\s+name\s*=\s*["']generator["']\s+content\s*=\s*["'][^"']+['"][^>]+>/igm
const indexHtmlRegExp = /(href\s*=\s*["'])\s*index.html\s*(["'])/ig

function replaceOptions (domain, newDomain) {
  const absoluteRegExp = new RegExp(`((twitter|og):(url|image).*)?(https?://${escape(domain)}/?)`, 'g')
  return new Map([
    [
      filepath => /\.(html|css)$/.test(filepath),
      new Map([
        [noGeneratorRegExp, () => ''],
        [noFeedlyRegExp, () => ''],
        [absoluteRegExp, ([_, og]) => {
          if (og) {
            return `${og}${newDomain}/`
          }
          return '/'
        }],
        [relativeIndexRegExp, ([_, hrefWithoutIndex]) => hrefWithoutIndex],
        [indexHtmlRegExp, ([_, prefix, suffix]) => `${prefix}.${suffix}`]
      ])
    ]
  ])
}

function replaceLinks ({ dir, domain, newDomain, signal }) {
  return replaceInDir(dir, { fileMap: replaceOptions(domain, newDomain), signal })
}

module.exports = {
  replaceLinks,
  replaceOptions
}
