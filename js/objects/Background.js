// Background process for keeping local information up to date
var Background = function() {
  'use strict';
  console.log("Background: [CONSRUCT:Background] New Background created.");
  this.strims = new Strims();

  var self = this;

  setInterval(function() {
    self.getStreams();
  }, 120 * 1000); // Two minutes between updates.
};

Background.prototype = {

  saveStreams: function(streams) {
    'use strict';
    console.log("Background: [STORAGE:saveStreams] Streams received.");
    if (!streams.length) {
      chrome.browserAction.setBadgeText({
        text: ''
      });
      return false;
    }

    chrome.browserAction.setBadgeBackgroundColor({
      color: '#333'
    });

    chrome.browserAction.setBadgeText({
      text: streams.length.toString()
    });

    var msg = {
      message: 'successGetStreams',
      streams: streams
    }

    chrome.runtime.sendMessage(msg);
    chrome.storage.local.set({
      streams: streams
    }, function() {
      console.log('Background: [STORAGE:saveStreams] Streams stored.');
    });
  },

  getStreams: function() {
    'use strict';
    var self = this;
    this.strims.getStreams(this.saveStreams);
    console.log("Background: [GET:getStreams] Streams.");
  }

};
