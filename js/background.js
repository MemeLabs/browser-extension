// Chrome runs this file as a service worker, where importScripts() loads the
// dependencies below. Firefox instead loads background.scripts as separate
// <script> tags (see manifest.json) in a non-worker page context, where
// importScripts doesn't exist — those files are already loaded by the time
// this one runs, so this call is skipped there.
if (typeof importScripts === 'function') {
  importScripts('objects/Strims.js', 'objects/Background.js', 'objects/LatencyLock.js', 'objects/UpdateChecker.js', 'objects/ImgurResolver.js');
}

// One-time migration: favorites used to live in storage.local; move them to
// storage.sync so they follow the user across signed-in Chrome instances.
chrome.runtime.onInstalled.addListener(function() {
  chrome.storage.sync.get(['favorites'], function(syncResult) {
    if (Array.isArray(syncResult.favorites)) return;
    chrome.storage.local.get(['favorites'], function(localResult) {
      if (Array.isArray(localResult.favorites) && localResult.favorites.length) {
        chrome.storage.sync.set({ favorites: localResult.favorites });
      }
    });
  });
});

var background = new Background();
var updateChecker = new UpdateChecker();
var imgurResolver = new ImgurResolver();

background.getStreams();
updateChecker.startPeriodicChecks();
updateChecker.check();

var lastStallNotificationCreatedAt = 0;

// Off by default in every build (dev and released alike) -- there's no
// store/sideload distinction to key off since this ships as a zip handed
// directly to users either way. Enable it yourself for a debugging session by
// running this in the extension's background console (chrome://extensions ->
// "Inspect views: service worker", or about:debugging for Firefox):
//   chrome.storage.local.set({ atllStallDebug: true })
// and disable again with atllStallDebug: false (or just reload the extension,
// since storage.local isn't touched by anything else here).
var stallDebugEnabled = false;
chrome.storage.local.get({ atllStallDebug: false }, function(result) {
  stallDebugEnabled = Boolean(result.atllStallDebug);
});
chrome.storage.onChanged.addListener(function(changes, area) {
  if (area === 'local' && changes.atllStallDebug) {
    stallDebugEnabled = Boolean(changes.atllStallDebug.newValue);
  }
});

var messageHandler = function (request, sender, sendResponse) {
  'use strict';
  if (request.type === 'atll-stall') {
    if (!stallDebugEnabled) return;
    // Notifications are already throttled per-frame in page.js; this is a
    // second belt-and-suspenders throttle in case multiple frames/tabs report
    // stalls close together.
    var now = Date.now();
    if (now - lastStallNotificationCreatedAt > 30000) {
      lastStallNotificationCreatedAt = now;
      chrome.notifications.create('atll-stall:' + now, {
        type: 'basic',
        iconUrl: 'images/icon.png',
        title: 'Stream player stalled',
        message: 'AngelThump Latency Lock is auto-recovering: ' + (request.reason || 'playback stalled') + '.',
        priority: 1
      });
    }
    return;
  }
  switch (request.message) {
    case 'getStreams':
      console.log("Background: Getting Streams...");
      background.getStreams();
      break;
    case 'checkForUpdate':
      console.log("Background: Checking for update...");
      updateChecker.check(function(result) { sendResponse(result); });
      return true;
    case 'resolveImgurAlbum':
      imgurResolver.resolve(request.url, function(imageUrl) { sendResponse({ imageUrl: imageUrl }); });
      return true;
    default:
      console.log("Background: Default");
      break;
  }
};

chrome.runtime.onMessage.addListener(messageHandler);
