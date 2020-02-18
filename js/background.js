var background = new Background();

background.getStreams();

setInterval(function() {
  background.getStreams();
}, 120 * 1000); // Two minutes between updates.

var messageHandler = function (request) {
  'use strict';
  switch (request.message) {
    case 'getStreams':
      console.log("Background: Getting Streams...");
      background.getStreams();
      break;
    default:
      console.log("Background: Default");
      break;
  }
};

chrome.runtime.onMessage.addListener(messageHandler);
