// Hover-to-preview for image links in strims.gg chat (chat.strims.gg,
// including when it's iframed into strims.gg stream pages). Chat's own
// UrlFormatter (chat-gui) only builds special embeds for a hardcoded list of
// video hosts (YouTube/Facebook/media.ccc.de) - plain image links, including
// ones from very common hosts like imgur/gyazo, render as a bare
// <a class="externallink">. This fills that gap without touching chat-gui
// itself: a delegated hover listener over the scrolling .chat-lines
// container, resolving link hrefs to a previewable image URL, showing a
// floating <img> near the cursor.
(function() {
  'use strict';

  var IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|apng|bmp|svg)(?:\?.*)?(?:#.*)?$/i;
  // imgur.com/<id> (a single image's page, not an album/gallery) has no
  // extension in the URL - what you get pasting from imgur's own UI. Their
  // CDN doesn't validate the extension against the actual file, so ".jpg" is
  // a safe guess regardless of the source format (standard trick, used by
  // most browser extensions/userscripts that do imgur previews).
  var IMGUR_SINGLE_RE = /^https?:\/\/(?:www\.)?imgur\.com\/([a-zA-Z0-9]+)(?:[?#]|$)/i;
  // imgur.com/a/<id> or /gallery/<id> - an album/gallery page, which is
  // imgur's default share link even for a single uploaded image. Unlike the
  // single-image case above there's no URL-pattern shortcut to a direct
  // image - resolved asynchronously in the background via ImgurResolver.
  var IMGUR_ALBUM_RE = /^https?:\/\/(?:www\.)?imgur\.com\/(?:a|gallery)\/[a-zA-Z0-9]+(?:[/?#]|$)/i;
  var HOVER_DELAY_MS = 200;
  var HIDE_DELAY_MS = 100;

  var previewEl = null;
  var hoverTimer = null;
  var hideTimer = null;
  var activeLink = null;
  var lastMouseEvent = null;
  var enabled = true;

  chrome.storage.sync.get({ chatImagePreviewEnabled: true }, function(result) {
    enabled = result.chatImagePreviewEnabled;
  });

  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area === 'sync' && changes.chatImagePreviewEnabled) {
      enabled = changes.chatImagePreviewEnabled.newValue;
      if (!enabled) hidePreview();
    }
  });

  function ensurePreviewEl() {
    if (previewEl) return previewEl;
    previewEl = document.createElement('div');
    previewEl.id = 'strims-live-chat-image-preview';
    previewEl.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'display:none',
      'pointer-events:none',
      'max-width:min(360px, 90vw)',
      'max-height:min(360px, 90vh)',
      'border:1px solid #D17134',
      'border-radius:4px',
      'background:#121212',
      'box-shadow:0 4px 16px rgba(0,0,0,0.6)',
      'padding:3px'
    ].join(';');

    var img = document.createElement('img');
    img.style.cssText = 'display:block;max-width:100%;max-height:354px;border-radius:2px;';
    img.addEventListener('load', function() {
      if (previewEl.style.display === 'block' && lastMouseEvent) positionPreview(lastMouseEvent);
    });
    img.addEventListener('error', hidePreview);
    previewEl.appendChild(img);

    document.documentElement.appendChild(previewEl);
    return previewEl;
  }

  function positionPreview(mouseEvent) {
    var el = ensurePreviewEl();
    var margin = 14;
    var rect = el.getBoundingClientRect();
    var x = mouseEvent.clientX + margin;
    var y = mouseEvent.clientY + margin;

    if (x + rect.width > window.innerWidth) x = mouseEvent.clientX - rect.width - margin;
    if (y + rect.height > window.innerHeight) y = mouseEvent.clientY - rect.height - margin;

    el.style.left = Math.max(0, x) + 'px';
    el.style.top = Math.max(0, y) + 'px';
  }

  function showPreview(imageUrl, mouseEvent) {
    var el = ensurePreviewEl();
    var img = el.querySelector('img');
    lastMouseEvent = mouseEvent;
    if (img.src !== imageUrl) img.src = imageUrl;
    el.style.display = 'block';
    positionPreview(mouseEvent);
  }

  function hidePreview() {
    if (previewEl) previewEl.style.display = 'none';
    activeLink = null;
  }

  function looksPreviewable(href) {
    return IMAGE_EXT_RE.test(href) || IMGUR_SINGLE_RE.test(href) || IMGUR_ALBUM_RE.test(href);
  }

  // Resolves the URL to actually load in the preview <img>, calling back
  // with null if this link isn't something we know how to preview (or the
  // async imgur-album lookup came back empty). Synchronous cases call back
  // immediately.
  function resolvePreviewUrl(link, callback) {
    if (!link || !link.classList.contains('externallink')) {
      callback(null);
      return;
    }
    var href = link.href;

    if (IMAGE_EXT_RE.test(href)) {
      callback(href);
      return;
    }

    var imgurSingleMatch = href.match(IMGUR_SINGLE_RE);
    if (imgurSingleMatch) {
      callback('https://i.imgur.com/' + imgurSingleMatch[1] + '.jpg');
      return;
    }

    if (IMGUR_ALBUM_RE.test(href)) {
      chrome.runtime.sendMessage({ message: 'resolveImgurAlbum', url: href }, function(result) {
        callback(result ? result.imageUrl : null);
      });
      return;
    }

    callback(null);
  }

  function onMouseOver(e) {
    if (!enabled) return;
    var link = e.target.closest ? e.target.closest('a.externallink') : null;
    if (!link || link === activeLink || !looksPreviewable(link.href)) return;
    activeLink = link;
    clearTimeout(hideTimer);
    clearTimeout(hoverTimer);

    hoverTimer = setTimeout(function() {
      if (activeLink !== link) return;
      resolvePreviewUrl(link, function(imageUrl) {
        if (imageUrl && activeLink === link) showPreview(imageUrl, e);
      });
    }, HOVER_DELAY_MS);
  }

  function onMouseMove(e) {
    if (activeLink && previewEl && previewEl.style.display === 'block') {
      positionPreview(e);
    }
  }

  function onMouseOut(e) {
    var link = e.target.closest ? e.target.closest('a.externallink') : null;
    if (!link || link !== activeLink) return;

    clearTimeout(hoverTimer);
    hideTimer = setTimeout(hidePreview, HIDE_DELAY_MS);
  }

  function attach() {
    var container = document.querySelector('.chat-lines');
    if (!container) {
      setTimeout(attach, 500);
      return;
    }
    container.addEventListener('mouseover', onMouseOver, true);
    container.addEventListener('mouseout', onMouseOut, true);
    container.addEventListener('mousemove', onMouseMove, true);
  }

  attach();
})();
