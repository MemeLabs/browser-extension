// General settings tab: extension info, refresh interval, and favorites
// list with per-favorite unfollow/mute.
var GeneralPanel = function(app) {
  'use strict';

  var listEl = document.getElementById('favoritesList');
  var emptyEl = document.getElementById('favoritesEmpty');
  var versionEl = document.getElementById('extVersion');
  var refreshIntervalEl = document.getElementById('refreshInterval');
  var chatImagePreviewEl = document.getElementById('chatImagePreviewEnabled');

  var currentVersion = chrome.runtime.getManifest().version;
  versionEl.textContent = 'v' + currentVersion;

  function renderUpdateInfo(info) {
    if (info && info.updateAvailable) {
      versionEl.textContent = 'Out of date (v' + currentVersion + ')';
      versionEl.href = info.releaseUrl;
      versionEl.classList.add('update-available');
    } else {
      versionEl.textContent = info && info.checkedAt ? 'Up to date (v' + currentVersion + ')' : 'v' + currentVersion;
      versionEl.removeAttribute('href');
      versionEl.classList.remove('update-available');
    }
  }

  function loadUpdateInfo() {
    chrome.storage.local.get({ updateInfo: null }, function(result) {
      renderUpdateInfo(result.updateInfo);
    });
  }

  refreshIntervalEl.addEventListener('change', function() {
    chrome.storage.sync.set({ refreshIntervalMinutes: Number(refreshIntervalEl.value) });
  });

  function loadRefreshInterval() {
    chrome.storage.sync.get({ refreshIntervalMinutes: 2 }, function(result) {
      refreshIntervalEl.value = String(result.refreshIntervalMinutes);
    });
  }

  chatImagePreviewEl.addEventListener('change', function() {
    chrome.storage.sync.set({ chatImagePreviewEnabled: chatImagePreviewEl.checked });
  });

  function loadChatImagePreview() {
    chrome.storage.sync.get({ chatImagePreviewEnabled: true }, function(result) {
      chatImagePreviewEl.checked = result.chatImagePreviewEnabled;
    });
  }

  function unfollow(channel) {
    chrome.storage.sync.get({ favorites: [] }, function(result) {
      var favs = result.favorites;
      var idx = favs.indexOf(channel);
      if (idx > -1) favs.splice(idx, 1);
      chrome.storage.sync.set({ favorites: favs }, function() {
        app.favorites = favs;
        app.sortStreams();
        app.renderStreams();
        render();
      });
    });
  }

  function toggleMute(channel, muted) {
    chrome.storage.sync.get({ mutedFavorites: [] }, function(result) {
      var muteList = result.mutedFavorites;
      var idx = muteList.indexOf(channel);
      if (muted && idx === -1) muteList.push(channel);
      if (!muted && idx > -1) muteList.splice(idx, 1);
      chrome.storage.sync.set({ mutedFavorites: muteList }, render);
    });
  }

  function render() {
    chrome.storage.sync.get({ favorites: [], mutedFavorites: [] }, function(result) {
      var favs = result.favorites;
      var muted = result.mutedFavorites;
      listEl.innerHTML = '';
      emptyEl.style.display = favs.length ? 'none' : 'block';

      favs.forEach(function(channel) {
        var isMuted = muted.indexOf(channel) > -1;

        var row = document.createElement('div');
        row.className = 'favorite-row';

        var name = document.createElement('span');
        name.className = 'favorite-name';
        name.textContent = channel;

        var muteBtn = document.createElement('button');
        muteBtn.type = 'button';
        muteBtn.className = 'mute-btn' + (isMuted ? ' active' : '');
        muteBtn.title = isMuted ? 'Notifications muted — click to unmute' : 'Mute go-live notifications';
        muteBtn.textContent = isMuted ? 'Muted' : 'Mute';
        muteBtn.addEventListener('click', function() { toggleMute(channel, !isMuted); });

        var unfollowBtn = document.createElement('button');
        unfollowBtn.type = 'button';
        unfollowBtn.className = 'unfollow-btn';
        unfollowBtn.textContent = 'Unfollow';
        unfollowBtn.addEventListener('click', function() { unfollow(channel); });

        row.appendChild(name);
        row.appendChild(muteBtn);
        row.appendChild(unfollowBtn);
        listEl.appendChild(row);
      });
    });
  }

  this.open = function() {
    loadRefreshInterval();
    loadChatImagePreview();
    loadUpdateInfo();
    render();
  };
};
