// App code that updates UI elements and runs when user interacts with extension
var App = function() {
  'use strict';
  console.log("App: [CONSRUCT:App] New App created.");

  this.streams = [];
  this.favorites = [];

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
};

App.prototype = {

  renderStreams: function() {
    'use strict';
    var elements = {
        live: $('.channels .live'),
      },
      stream,
      i,
      streamsHTML = '';

    elements.live.find('div[data-name]').remove();

    console.log("App: [RENDER:renderStreams] " + this.streams.length + " streams.");

    for (i = 0; i < this.streams.length; i += 1) {
      stream = this.streams[i];
      streamsHTML += this.templates.liveChannel
        .replace('{live}', stream.live)
        .replace('{thumbnail}', stream.thumbnail)
        .replace('{title}', stream.title || "Random")
        .replace('{viewers}', stream.rustlers.toString().replace(/(\d)(?=(\d\d\d)+([^\d]|$))/g, '$1,'))
        .replace(/\{url\}/g, 'https://strims.gg' + stream.url)
        .replace(/\{url\}/g, 'https://strims.gg' + stream.url)
        .replace('{channel}', stream.channel)
        .replace('{channel}', stream.channel)
        .replace('{channel}', stream.channel)
        .replace('{service}', stream.service)
        .replace('{favorite}', this.favorites.indexOf(stream.channel) > -1 ? "full" : "empty");
    }
    elements.live.append(streamsHTML);
  },

  refreshStreams: function() {
    'use strict';
    var self = this;
    chrome.storage.local.get(['streams'], function(result) {
      console.log("App: [GET:refreshStreams] Streams from storage.");
      if (result) {
        self.streams = result.streams.sort(function(a, b) {
          return b.rustlers - a.rustlers
        });
        console.log("App: [GET:refreshStreams] Retrieved " + self.streams.length + " streams.");
        self.renderStreams();
      }
    });
  },

  show: function() {
    'use strict';
    console.log("App: [GET:show] Streams");
    this.refreshStreams();
    chrome.runtime.sendMessage({
      message: 'getStreams'
    });
  },

  addFavorite: function(channel) {
    'use strict';
    var self = this;
    console.log("App: [FAVORITE:addFavorite] Favorite " + channel + ".");
    chrome.storage.local.get(['favorites'], function(result) {
      var favs = Array.isArray(result.favorites) ? result.favorites : [];
      if (!(favs.indexOf(channel) > -1)) {
        favs.push(channel);
        chrome.storage.local.set({
          favorites: favs
        });
        self.favorites = favs;
      }
    });
  },

  removeFavorite: function(channel) {
    'use strict';
    var self = this;
    console.log("App: [FAVORITE:removeFavorite] Favorite " + channel + ".");
    chrome.storage.local.get(['favorites'], function(result) {
      var favs = Array.isArray(result.favorites) ? result.favorites : [];
      if ((favs.indexOf(channel) > -1)) {
        var index = favs.indexOf(channel);
        if (index !== -1) favs.splice(index, 1);
        chrome.storage.local.set({
          favorites: favs
        });
        self.favorites = favs;
      }
    });
  },

  loadFavorites: function() {
    'use strict';
    var self = this;
    console.log("app: [FAVORITE:loadFavorites] Favorites.");
    chrome.storage.local.get(['favorites'], function(result) {
      var favs = Array.isArray(result.favorites) ? result.favorites : [];
      self.favorites = favs;
    });
  }
};
