/*global $, chrome, Twitch, SpeechSynthesisUtterance, speechSynthesis */
/*jslint browser: true */
var Background = function() {
  'use strict';
  console.log("Background: New Background created.");
  this.strims = new Strims();

  var self = this;

  setInterval(function() {
    self.getStreams();
  }, 300 * 1000); // Five minutes between updates.
};

Background.prototype = {

  getStreamsJobs: function() {
    'use strict';
  };

  saveStreams: function(streams) {
    'use strict';
    chrome.storage.local.set({
      streams: streams
    }, function() {
      console.log('Background: [SET] Streams Interval');
    });
  };

  getStreams: function() {
    'use strict';
    var self = this;
    this.strims.getStreams();
    console.log("Background: [GET] Streams");
    $(document)
      .unbind('successGetStreams').one('successGetStreams', function() {
        console.log("Background: [GET] Streams COMPLETE.");
        if (!self.strims.streams.length) {
          chrome.browserAction.setBadgeText({
            text: ''
          });

          return false;
        }

        chrome.browserAction.setBadgeBackgroundColor({
          color: '#333'
        });

        chrome.browserAction.setBadgeText({
          text: self.strims.streams.length.toString()
        });

        var msg = {
          message: 'successGetStreams',
          streams: self.strims.streams
        }
        chrome.runtime.sendMessage(msg);
      })
      .unbind('errorGetStreams').one('errorGetStreams', function() {
        console.log("Background: [GET] Streams [FAILED].");
        chrome.runtime.sendMessage({
          message: 'errorGetStreams'
        });
      });
  };

};
