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

var messageHandler = function (request, sender, sendResponse) {
  'use strict';
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
