var App = function() {
  'use strict';

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

  show: function() {
    'use strict';
    console.log("App: Sending Get Streams...");
    chrome.runtime.sendMessage({message : 'getStreams'});
    chrome.storage.local.get(['streams'], function(result) {

    });
  },

  showStreams: function() {
    'use strict';
    var elements = {
        live : $('.channels .live'),
      },
      stream,
      i,
      streamsHTML = '';

    elements.live.find('div[data-name]').remove();

    for (i = 0; i < this.streams.length; i += 1) {
      stream = this.streams[i];
      streamsHTML += this.templates.liveChannel
        .replace('{live}', stream.live)
        .replace('{thumbnail}', stream.thumbnail)
        .replace('{title}', stream.title || "Random")
        .replace('{viewers}', stream.viewers.toString().replace(/(\d)(?=(\d\d\d)+([^\d]|$))/g, '$1,'))
        .replace(/\{url\}/g, 'http://strims.gg/' + stream.channel)
        .replace(/\{url\}/g, 'http://strims.gg/' + stream.channel)
        .replace('{channel}', stream.channel)
        .replace('{channel}', stream.channel)
        .replace('{service}', stream.service);
    }
    elements.live.append(streamsHTML);
  }
};
