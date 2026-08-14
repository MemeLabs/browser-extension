// Checks GitHub Releases for a newer version than the one currently
// installed. Since this extension is sideloaded (not distributed through the
// Chrome/Firefox stores), there's no store update pipeline — this is the
// closest equivalent: a periodic check that surfaces an "update available"
// state the popup can show, linking out to the release for the user to
// download and reinstall manually.
var UpdateChecker = function() {
  'use strict';

  var RELEASES_API = 'https://api.github.com/repos/MemeLabs/browser-extension/releases/latest';
  var CHECK_ALARM = 'strims-live-update-check';
  var CHECK_PERIOD_MINUTES = 12 * 60;

  // Returns true if `a` (e.g. "0.2.0") is newer than `b` (e.g. "0.1.0").
  function isNewer(a, b) {
    var partsA = a.replace(/^v/i, '').split('.').map(Number);
    var partsB = b.replace(/^v/i, '').split('.').map(Number);
    var len = Math.max(partsA.length, partsB.length);
    var i, numA, numB;
    for (i = 0; i < len; i += 1) {
      numA = partsA[i] || 0;
      numB = partsB[i] || 0;
      if (numA > numB) return true;
      if (numA < numB) return false;
    }
    return false;
  }

  function check(callback) {
    var currentVersion = chrome.runtime.getManifest().version;

    fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then(function(response) {
        if (!response.ok) throw new Error('GitHub API returned ' + response.status);
        return response.json();
      })
      .then(function(release) {
        var latestVersion = String(release.tag_name || '').replace(/^v/i, '');
        var updateAvailable = !!latestVersion && isNewer(latestVersion, currentVersion);
        var result = {
          updateAvailable: updateAvailable,
          latestVersion: latestVersion,
          releaseUrl: release.html_url || 'https://github.com/MemeLabs/browser-extension/releases/latest',
          checkedAt: Date.now(),
          checkError: false
        };
        chrome.storage.local.set({ updateInfo: result });
        if (callback) callback(result);
      })
      .catch(function(error) {
        console.log('UpdateChecker: [ERROR:check] ' + error.message);
        var result = { checkedAt: Date.now(), checkError: true };
        chrome.storage.local.set({ updateInfo: result });
        if (callback) callback(result);
      });
  }

  function startPeriodicChecks() {
    chrome.alarms.create(CHECK_ALARM, { periodInMinutes: CHECK_PERIOD_MINUTES });
  }

  chrome.alarms.onAlarm.addListener(function(alarm) {
    if (alarm.name === CHECK_ALARM) check();
  });

  this.check = check;
  this.startPeriodicChecks = startPeriodicChecks;
};
