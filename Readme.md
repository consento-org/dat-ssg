# dat-ssg

`dat-ssg` is a command line tool that uses configuration in a folder to download websites with `wget` and publish the content to:

- [`netlify`](https://www.netlify.com/)
- [`dat`](https://dat.foundation/)
- ... (your Pull Request)

## Why?

Prior to `dat-ssg`, to host a website on dat you can either edit it by hand or setup a static site generator and a CI system
to do the publishing. This, however, prevents the use of any cms. Be it [Ghost](https://ghost.org/), [Wordpress](https://wordpress.com/)
, [Drupal](https://www.drupal.com/) or any other dynamic publishing system. With `dat-ssg` you can finally start using 
those systems and host the site to be accessible through `dat`.

It is also quite useful if you want to use cheaper static-site hosting that deploys well in a global cdn.

## Introduction

For `dat-ssg` you need to have two folders: the _"configuration-folder" and the _"work-folder"_.

- The _configuration-folder_ can have a list of configuration files, each specifying a download process of files.
- The _work-folder_ will be holding a folder for every file in the configuration folder and the `.out` and `.error`
    files for the process of each configuration.

`dat-ssg` needs [`wget`](https://www.gnu.org/software/wget/) and [`git`](https://git-scm.com/) available in the command line.
`wget` is used to download the site, `git` is used to only trigger a publication if the site has changed.

`dat-ssg` will rewrite the downloaded files (e.g. the meta tags and links) to look correct when hosted on the target.

## Installation

`dat-ssg` is a node application and can be run quickly using

```sh
$ npx dat-ssg --work-folder ./work --configuration-folder ./config
```

The process will look for any changes in the configuruation folder and start a process for each file.

## Configuration files

For configuration you can simply add a file with the ending `.js` to the configuration folder.

The file needs to export a javascript object looking like this:

```javascript
module.exports = {
  title: "My Site", // Title to be used in the process, e.g. for the dat config file
  description: "This is my homepage", // Description used for the process, e.g. for the dat config file
  domain: "mydomain.com", // domain to download data from
  https: true, // The domain support https
  newDomain: "https://targetdomain.org", // domain of the new site (needed for content-rewrites)
  /*
   * wget will download all files that are found at the domain's root but there may be extra roots to look for content.
   * You need to specify all the roots 
   */
  roots: [
    "/",
    "/b.html",
    "/c.html"
  ],
  // Interval to look for updates
  update: 1000 * 60 * 20, // Update every 10 minutes
  // The process will use following user name to make commits
  git: {
    email: "my@domain.com",
    name: "The Name"
  },
  // If you want to publish the page to netlify you need to specify this property, else you can skip it!
  netlify: {
    siteId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", // Id, provided in the netlify setup
    production: false, // Publish as production = true, else = false
    /*
     * Auth token as provided through the netlify user interface, can be also loaded through `process.env`
     */
    authToken: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    config: `# Optional configuration, see https://docs.netlify.com/configure-builds/file-based-configuration/#sample-file`
  },
  dat: {
    // Time to push after changes, in which a hosting service can connect and download the latest update.
    pushTime: 1000 * 60 * 2 // 2 minutes
  }
}
```

Every time you change the file, the process will be restarted and a deploy will be triggered.

## Caching notes

Some CMS add query parameters to javascript or css links, e.g.: `assets/main/css/main.css?v=25be6de7e6`
These files will be transformed with wget to: `assets/main/css/main.css@v=25be6de7e6.css`.

You may want to specify the cache settings in `netlify.config` to cache the files "forever":

```toml
[[headers]]
  for = "/*@v=*"
  [headers.values]
    cache-control = "public, max-age=31536000"
```

## DAT notes

The first time a configuration is fetched will create a new dat in the workfolder. This new dat
will have a new link, so every time you delete the folder, you will need to update replication
links and the links you used in your dat-dns settings.

## License

[MIT](./LICENSE)

