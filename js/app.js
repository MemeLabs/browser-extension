/*globals $, chrome, Popup */
/*jslint browser: true */
var app = new App();
var generalPanel = new GeneralPanel(app);
var latencyPanel = new LatencyPanel();

app.show();

// Toggle between the channel list and the settings panel
$(document).on('click', '#settingsbutton', function() {
  $('.channels').hide();
  $('#settingsPanel').show();
  switchTab('general');
});

$(document).on('click', '#settingsback', function() {
  $('#settingsPanel').hide();
  $('.channels').show();
  latencyPanel.stopPolling();
});

// Settings sub-tabs
function switchTab(tab) {
  var isGeneral = tab === 'general';
  $('#tabGeneralBtn').toggleClass('active', isGeneral);
  $('#tabLatencyBtn').toggleClass('active', !isGeneral);
  $('#tabGeneral').prop('hidden', !isGeneral);
  $('#tabLatency').prop('hidden', isGeneral);

  if (isGeneral) {
    latencyPanel.stopPolling();
    generalPanel.open();
  } else {
    latencyPanel.open();
  }
}

$(document).on('click', '#tabGeneralBtn', function() { switchTab('general'); });
$(document).on('click', '#tabLatencyBtn', function() { switchTab('latency'); });

$(document).on('click', '#retryStreams', function() {
  app.showLoading();
  chrome.runtime.sendMessage({ message: 'getStreams' });
});

// All / Favorites filter
$(document).on('click', '#filterAllBtn', function() { app.setFilter('all'); });
$(document).on('click', '#filterFavoritesBtn', function() { app.setFilter('favorites'); });

var messageHandler = function(request) {
  'use strict';
  switch (request.message) {
    case 'successGetStreams':
      console.log("App: [GET:messageHandler] Streams [RECEIVED].")
      app.refreshStreams();
      break;
    case 'errorGetStreams':
      console.log("App: [ERROR:messageHandler] Streams fetch failed.")
      app.showError();
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
  var child = this.firstElementChild;
  var src = child.src;
  if (src.indexOf("empty") > 0) {
    child.src = "/images/favorite-full.png";
    app.addFavorite(child.getAttribute("channel"))
  } else {
    child.src = "/images/favorite-empty.png";
    app.removeFavorite(child.getAttribute("channel"))
  }
});

// Redirect tab to Strims.gg
function redirect(tabs) {
  var current_tab = tabs[0];
  var URL = current_tab.url;
  // Twitch Stream
  if (URL.includes('twitch.tv') === true && URL.includes('/videos/') !== true && URL != "https://www.twitch.tv/") {
    var username = URL.split('.twitch.tv/')
    username.shift()[0]
    chrome.tabs.update(current_tab.id, {
      url: `https://strims.gg/twitch/${username}`
    })
  }
  // Twitch VOD
  else if (URL.includes('twitch.tv/videos/')) {
    var id = URL.substr(URL.lastIndexOf('/') + 1)
    chrome.tabs.update(current_tab.id, {
      url: `https://strims.gg/twitch-vod/${id}`
    })
  }
  // Youtube Video
  else if (URL.includes('youtube.com') === true && URL.includes('&list=') !== true) {
    var id = URL.substr(URL.indexOf('watch?v=') + 8)
    chrome.tabs.update(current_tab.id, {
      url: `https://strims.gg/youtube/${id}`
    })
  }
  // Youtube Playlist
  else if (URL.includes('youtube.com') === true && URL.includes('&list=') === true) {
    var link = URL.substr(URL.indexOf('&list=') + 6)
    chrome.tabs.update(current_tab.id, {
      url: `https://strims.gg/youtube-playlist/${link}`
    })
  }
};

function valid_redirect_url(URL) {
  // Twitch Stream
  if (URL.includes('twitch.tv') === true && URL.includes('/videos/') !== true && URL != "https://www.twitch.tv/") {
    return true;
  }
  // Twitch VOD
  else if (URL.includes('twitch.tv/videos/')) {
    return true;
  }
  // Youtube Video
  else if (URL.includes('youtube.com') === true && URL.includes('&list=') !== true) {
    return true;
  }
  // Youtube Playlist
  else if (URL.includes('youtube.com') === true && URL.includes('&list=') === true) {
    return true;
  }
  return false;
};

// Check if tab that we would redirect to strims
chrome.tabs.query({
  currentWindow: true,
  active: true
}, function(tabs) {
  if(valid_redirect_url(tabs[0].url)){
    document.getElementById("externalbutton").style.visibility = "visible";
  }
})

$(document).on('click', ".ggbtn-external", function(e) {
  console.log("App: [REDIRECT:external] Redirect tab.");
  chrome.tabs.query({
    currentWindow: true,
    active: true
  }, redirect)
});

chrome.runtime.onMessage.addListener(messageHandler);
