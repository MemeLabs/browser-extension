// App code that updates UI elements and runs when user interacts with extension
var App = function() {
  'use strict';
  console.log("App: [CONSRUCT:App] New App created.");

  this.streams = [];
  this.favorites = [];
  this.filter = 'all'; // 'all' | 'favorites'

  this.templates = {
    liveChannel: 'liveChannel'
  };

  var templateName;

  for (templateName in this.templates) {
    if (this.templates.hasOwnProperty(templateName)) {
      this.templates[templateName] = $('[data-template="' + this.templates[templateName] + '"]')[0].innerHTML;
    }
  }

  this.loadFavorites();
  this.loadFilter();
};

App.prototype = {

  sortStreams: function() {
    'use strict';
    var self = this;
    this.streams.sort(function(a, b) {
      var aFav = self.favorites.indexOf(a.channel) > -1 ? 1 : 0;
      var bFav = self.favorites.indexOf(b.channel) > -1 ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav; // favorites first
      return b.rustlers - a.rustlers;
    });
  },

  renderStreams: function() {
    'use strict';
    var elements = {
        live: $('.channels .live'),
      },
      stream,
      isFavorite,
      i,
      visibleCount = 0,
      streamsHTML = '';

    elements.live.find('div[data-name]').remove();

    console.log("App: [RENDER:renderStreams] " + this.streams.length + " streams, filter=" + this.filter + ".");

    for (i = 0; i < this.streams.length; i += 1) {
      stream = this.streams[i];
      isFavorite = this.favorites.indexOf(stream.channel) > -1;
      if (this.filter === 'favorites' && !isFavorite) continue;
      visibleCount += 1;
      streamsHTML += this.templates.liveChannel
        .replace('{live}', stream.live)
        .replace('{thumbnail}', stream.thumbnail)
        .replace('{title}', stream.title || "Random")
        .replace('{viewers}', stream.rustlers.toString().replace(/(\d)(?=(\d\d\d)+([^\d]|$))/g, '$1,'))
        .replace(/\{url\}/g, 'https://strims.gg' + stream.url)
        .replace(/\{channel\}/g, stream.channel)
        .replace('{service}', stream.service)
        .replace('{favorite}', isFavorite ? "full" : "empty");
    }
    elements.live.append(streamsHTML);

    if (this.filter === 'favorites' && visibleCount === 0) {
      this.setStatus(
        this.favorites.length ? 'None of your favorites are live right now.' : 'No favorites yet — tap the heart on a channel to follow it.',
        false
      );
    } else {
      this.setStatus(null);
    }
  },

  refreshStreams: function() {
    'use strict';
    var self = this;
    chrome.storage.local.get(['streams'], function(result) {
      console.log("App: [GET:refreshStreams] Streams from storage.");
      var streams = Array.isArray(result.streams) ? result.streams : [];
      self.streams = streams;
      self.sortStreams();
      console.log("App: [GET:refreshStreams] Retrieved " + self.streams.length + " streams.");
      self.renderStreams();
    });
  },

  show: function() {
    'use strict';
    console.log("App: [GET:show] Streams");
    if (!this.streams.length) this.showLoading();
    this.refreshStreams();
    chrome.runtime.sendMessage({
      message: 'getStreams'
    });
  },

  setFilter: function(filter) {
    'use strict';
    this.filter = filter;
    chrome.storage.sync.set({ streamFilter: filter });
    this.updateFilterButtons();
    this.renderStreams();
  },

  loadFilter: function() {
    'use strict';
    var self = this;
    chrome.storage.sync.get({ streamFilter: 'all' }, function(result) {
      self.filter = result.streamFilter;
      self.updateFilterButtons();
      self.renderStreams();
    });
  },

  updateFilterButtons: function() {
    'use strict';
    $('#filterAllBtn').toggleClass('active', this.filter === 'all');
    $('#filterFavoritesBtn').toggleClass('active', this.filter === 'favorites');
  },

  showLoading: function() {
    'use strict';
    this.setStatus('Loading streams…', false);
  },

  showError: function() {
    'use strict';
    this.setStatus("Couldn't load streams.", true);
  },

  setStatus: function(text, showRetry) {
    'use strict';
    var statusEl = document.getElementById('streamsStatus');
    if (!statusEl) return;
    if (!text) {
      statusEl.hidden = true;
      statusEl.innerHTML = '';
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = text + ' ';
    if (showRetry) {
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.id = 'retryStreams';
      retry.className = 'retry-btn';
      retry.textContent = 'Retry';
      statusEl.appendChild(retry);
    }
  },

  addFavorite: function(channel) {
    'use strict';
    var self = this;
    console.log("App: [FAVORITE:addFavorite] Favorite " + channel + ".");
    chrome.storage.sync.get(['favorites'], function(result) {
      var favs = Array.isArray(result.favorites) ? result.favorites : [];
      if (!(favs.indexOf(channel) > -1)) {
        favs.push(channel);
        chrome.storage.sync.set({
          favorites: favs
        });
        self.favorites = favs;
        self.sortStreams();
        self.renderStreams();
      }
    });
  },

  removeFavorite: function(channel) {
    'use strict';
    var self = this;
    console.log("App: [FAVORITE:removeFavorite] Favorite " + channel + ".");
    chrome.storage.sync.get(['favorites'], function(result) {
      var favs = Array.isArray(result.favorites) ? result.favorites : [];
      if ((favs.indexOf(channel) > -1)) {
        var index = favs.indexOf(channel);
        if (index !== -1) favs.splice(index, 1);
        chrome.storage.sync.set({
          favorites: favs
        });
        self.favorites = favs;
        self.sortStreams();
        self.renderStreams();
      }
    });
  },

  loadFavorites: function() {
    'use strict';
    var self = this;
    console.log("app: [FAVORITE:loadFavorites] Favorites.");
    chrome.storage.sync.get(['favorites'], function(result) {
      var favs = Array.isArray(result.favorites) ? result.favorites : [];
      self.favorites = favs;
      self.sortStreams();
      self.renderStreams();
    });
  }
};
