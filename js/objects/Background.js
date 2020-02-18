// Background process for keeping local information up to date
var Background = function() {
  'use strict';
  console.log("Background: [CONSRUCT:Background] New Background created.");
  this.strims = new Strims();

  var self = this;

};

Background.prototype = {

  saveStreams: function(streams, bot_streams) {
    'use strict';
    console.log("Background: [STORAGE:saveStreams] Streams received.");
    var length = streams.length + bot_streams.length
    if (!length) {
      chrome.browserAction.setBadgeText({
        text: ''
      });
      return false;
    }

    chrome.browserAction.setBadgeBackgroundColor({
      color: '#e45e07'
    });

    chrome.browserAction.setBadgeText({
      text: length.toString()
    });

    var msg = {
      message: 'successGetStreams',
      streams: streams,
      bot_streams: bot_streams
    }

    chrome.runtime.sendMessage(msg);
    // Store community streams
    chrome.storage.local.set({
      streams: streams
    }, function() {
      console.log("Background: [STORAGE:saveStreams] " + streams.length + " streams stored.");
    });
    // Store bot streams
    chrome.storage.local.set({
      bot_streams: bot_streams
    }, function() {
      console.log("Background: [STORAGE:saveStreams] " + bot_streams.length + " bot streams stored.");
    });
    // Update favorites badge
    chrome.storage.local.get(['favorites'], function(result) {
      var favs = Array.isArray(result.favorites) ? result.favorites : [];
      if(favs.length > 0) {
        var i = 0;
        var c = 0;
        var stream;
        for(i = 0; i < streams.length; i += 1) {
          stream = streams[i];
          if(favs.indexOf(stream.channel) > -1){
            c++
          }
        }
        if(c == 0){c = ''}
        chrome.browserAction.setBadgeText({
          text: c.toString()
        });
      }
    });
  },

  getStreams: function() {
    'use strict';
    var self = this;
    this.strims.getStreams(this.saveStreams);
    console.log("Background: [GET:getStreams] Streams.");
  }

};
