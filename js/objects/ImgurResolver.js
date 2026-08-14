// Resolves an imgur album/gallery URL (e.g. https://imgur.com/a/<id>) to a
// single previewable image URL, for the chat hover-preview feature. Albums
// have no single "the image" URL, unlike a direct i.imgur.com file link or a
// single-image imgur.com/<id> page - the cover/first image is read from the
// album page's Open Graph <meta property="og:image"> tag. This requires an
// actual page fetch (imgur doesn't expose this over a public JSON endpoint
// without an API key), so it runs here in the background, where
// host_permissions grants cross-origin fetch; the chat.strims.gg content
// script can't do this fetch itself without hitting CORS.
var ImgurResolver = function() {
  'use strict';

  var OG_IMAGE_RE = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i;
  var cache = {};

  function resolve(url, callback) {
    if (Object.prototype.hasOwnProperty.call(cache, url)) {
      callback(cache[url]);
      return;
    }

    fetch(url)
      .then(function(response) {
        if (!response.ok) throw new Error('imgur returned ' + response.status);
        return response.text();
      })
      .then(function(html) {
        var match = html.match(OG_IMAGE_RE);
        var imageUrl = match ? match[1].replace(/&amp;/g, '&') : null;
        cache[url] = imageUrl;
        callback(imageUrl);
      })
      .catch(function(error) {
        console.log('ImgurResolver: [ERROR:resolve] ' + error.message);
        cache[url] = null;
        callback(null);
      });
  }

  this.resolve = resolve;
};
