// App code that updates UI elements and runs when user interacts with extension
var App = function() {
  'use strict';
  console.log("App: [CONSRUCT:App] New App created.");

  this.streams = [];

  this.templates = {
    liveChannel: 'liveChannel'
  };

  var templateName;

  for (templateName in this.templates) {
    if (this.templates.hasOwnProperty(templateName)) {
      this.templates[templateName] = $('[data-template="' + this.templates[templateName] + '"]')[0].innerHTML;
    }
  }
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
        .replace('{viewers}', stream.viewers.toString().replace(/(\d)(?=(\d\d\d)+([^\d]|$))/g, '$1,'))
        .replace(/\{url\}/g, 'https://strims.gg' + stream.url)
        .replace(/\{url\}/g, 'https://strims.gg' + stream.url)
        .replace('{channel}', stream.channel)
        .replace('{channel}', stream.channel)
        .replace('{service}', stream.service);
    }
    elements.live.append(streamsHTML);
  },

  refreshStreams: function() {
    var self = this;
    chrome.storage.local.get(['streams'], function(result) {
      console.log("App: [GET:refreshStreams] Streams from storage.");
      if (result) {
        self.streams = result.streams;
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
  }
};
