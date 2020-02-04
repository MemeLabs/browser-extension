/*globals $, chrome, Popup */
/*jslint browser: true */
var app = new App();

app.show();

var messageHandler = function(request) {
  'use strict';
  switch (request.message) {
    case 'successGetStreams':
      console.log("App: [GET] Streams [RECEIVED].")
      app.streams = request.streams;
      app.showStreams();
      break;
    default:
      console.log("App: [DEFAULT] Message [RECEIVED].")
      break;
  }
};

function init() {
  console.log("App: Booted.")
  app.show();
  chrome.runtime.onMessage.addListener(messageHandler);
}

// Copy paste javascript for share button with setTooltip
function setTooltip(btn, message) {
  $(btn).tooltip('hide')
    .attr('data-original-title', message)
    .tooltip('show');
}

function hideTooltip(btn) {
  setTimeout(function() {
    $(btn).tooltip('hide');
  }, 1000);
}

var clipboard = new ClipboardJS('.btn');

clipboard.on('success', function(e) {
  setTooltip(e.trigger, 'Copied!');
  hideTooltip(e.trigger);
  e.clearSelection();
});

clipboard.on('error', function(e) {
  setTooltip(e.trigger, 'Failed!');
  hideTooltip(e.trigger);
});

$('[data-toggle="tooltip"]').tooltip();

$('.copy').on('click', function(e) {
  $(this).tooltip()
});

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
chrome.runtime.onMessage.addListener(messageHandler);
