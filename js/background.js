var background = new Background();

background.getStreams();

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
