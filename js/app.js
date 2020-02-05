/*globals $, chrome, Popup */
/*jslint browser: true */
var app = new App();

app.show();

var messageHandler = function(request) {
  'use strict';
  switch (request.message) {
    case 'successGetStreams':
      console.log("App: [GET:messageHandler] Streams [RECEIVED].")
      app.refreshStreams();
      break;
    default:
      console.log("App: [DEFAULT:messageHandler] Message [RECEIVED].")
      break;
  }
};

// Copy paste javascript for share button with setTooltip
function setTooltip(btn, message) {
  $(btn).attr('data-original-title', message)
    .tooltip('show');
}

function hideTooltip(btn) {
  setTimeout(function() {
    $(btn).tooltip('hide');
  }, 2000);
}

var clipboard = new ClipboardJS('.ggbtn');

clipboard.on('success', function(e) {
  setTooltip(e.trigger, 'Copied!');
  hideTooltip(e.trigger);
  e.clearSelection();
});

clipboard.on('error', function(e) {
  setTooltip(e.trigger, 'Failed!');
  hideTooltip(e.trigger);
  e.clearSelection();
});

// Toggle favorite button img from empty to full vice versa
$(document).on('click', ".favbtn", function(e) {
  console.log("App: [CLICK:fav-btn]");
  var child= this.firstElementChild;
  var src = child.src;
  if (src.indexOf("empty") > 0) {
    child.src = "/images/favorite-full.png";
    app.addFavorite(child.getAttribute("channel"))
  } else {
    child.src = "/images/favorite-empty.png";
    app.removeFavorite(child.getAttribute("channel"))
  }
});

chrome.runtime.onMessage.addListener(messageHandler);
