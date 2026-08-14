// chrome.runtime.sendMessage broadcasts to the popup whether or not it's
// open. Chrome silently no-ops when there's no receiver; Firefox's Promise
// rejects with "Could not establish connection" in that case, which would
// otherwise surface as an unhandled rejection on every background poll while
// the popup is closed.
function sendRuntimeMessage(payload) {
  'use strict';
  try {
    var result = chrome.runtime.sendMessage(payload);
    if (result && typeof result.catch === 'function') result.catch(function() {});
  } catch (_error) {
    // No listener / extension context gone — safe to ignore.
  }
}

// Fires a desktop notification when a favorited channel goes live, and
// opens the stream when the user clicks it.
var favoriteNotificationUrls = {};

function notifyFavoriteLive(channel, url) {
  'use strict';
  var notificationId = 'favorite-live:' + channel;
  favoriteNotificationUrls[notificationId] = url;
  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'images/icon.png',
    title: channel + ' is live!',
    message: 'One of your favorites just went live on Strims.',
    priority: 1
  });
}

chrome.notifications.onClicked.addListener(function(notificationId) {
  'use strict';
  var url = favoriteNotificationUrls[notificationId];
  if (url) chrome.tabs.create({ url: url });
  chrome.notifications.clear(notificationId);
});

// Background process for keeping local information up to date
var Background = function() {
  'use strict';
  console.log("Background: [CONSRUCT:Background] New Background created.");
  this.strims = new Strims();
  this.pollTimer = null;

  var self = this;

  chrome.storage.sync.get({ refreshIntervalMinutes: 2 }, function(result) {
    self.startPolling(result.refreshIntervalMinutes);
  });

  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area === 'sync' && changes.refreshIntervalMinutes) {
      self.startPolling(changes.refreshIntervalMinutes.newValue);
    }
  });
};

Background.prototype = {

  startPolling: function(minutes) {
    'use strict';
    var self = this;
    var clamped = Math.min(15, Math.max(1, Number(minutes) || 2));
    console.log("Background: [POLL:startPolling] Refreshing every " + clamped + " minute(s).");
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(function() {
      self.getStreams();
    }, clamped * 60 * 1000);
  },

  saveStreams: function(streams) {
    'use strict';
    console.log("Background: [STORAGE:saveStreams] Streams received.");
    if (!streams.length) {
      chrome.action.setBadgeText({
        text: ''
      });
    } else {
      chrome.action.setBadgeBackgroundColor({
        color: '#e45e07'
      });
      chrome.action.setBadgeText({
        text: streams.length.toString()
      });
    }

    var msg = {
      message: 'successGetStreams',
      streams: streams
    }

    sendRuntimeMessage(msg);
    chrome.storage.local.set({
      streams: streams
    }, function() {
      console.log('Background: [STORAGE:saveStreams] Streams stored.');
    });

    chrome.storage.sync.get({ favorites: [], mutedFavorites: [] }, function(syncResult) {
      var favs = syncResult.favorites;
      if (favs.length === 0) return;

      chrome.storage.local.get({ liveFavorites: [] }, function(localResult) {
        var i = 0;
        var c = 0;
        var stream;
        var nowLive = [];
        var previouslyLive = localResult.liveFavorites;
        var muted = syncResult.mutedFavorites;
        var notifyUrls = {};

        for (i = 0; i < streams.length; i += 1) {
          stream = streams[i];
          if (favs.indexOf(stream.channel) > -1) {
            c++;
            nowLive.push(stream.channel);
            if (previouslyLive.indexOf(stream.channel) === -1 && muted.indexOf(stream.channel) === -1) {
              notifyUrls[stream.channel] = 'https://strims.gg' + stream.url;
            }
          }
        }
        if (c > 0) {
          chrome.action.setBadgeText({
            text: c.toString()
          });
        }

        chrome.storage.local.set({ liveFavorites: nowLive });
        Object.keys(notifyUrls).forEach(function(channel) {
          notifyFavoriteLive(channel, notifyUrls[channel]);
        });
      });
    });
  },

  handleError: function() {
    'use strict';
    console.log("Background: [ERROR:handleError] Failed to fetch streams.");
    sendRuntimeMessage({ message: 'errorGetStreams' });
  },

  getStreams: function() {
    'use strict';
    var self = this;
    this.strims.getStreams(this.saveStreams, this.handleError);
    console.log("Background: [GET:getStreams] Streams.");
  }

};
