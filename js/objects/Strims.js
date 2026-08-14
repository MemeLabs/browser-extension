var Strims = function() {
  'use strict';
  console.log("Strims: [CONSRUCT:Strims] New Strims created.");
  this.streams = [];
};

Strims.prototype = {

  getStreams: function(getStreamsCallback, getStreamsErrorCallback) {
    'use strict';

    this.streams = [];

    var self = this;

    fetch('https://strims.gg/api')
      .then(function(response) {
        if (!response.ok) throw new Error('strims.gg API responded with ' + response.status);
        return response.json();
      })
      .then(function(data) {
        self.streams = data.stream_list.filter(strim => strim.service == 'angelthump');
        self.streams.sort(function(a, b) {
          return b.viewers - a.viewers;
        });
        getStreamsCallback(self.streams);
      })
      .catch(function(err) {
        console.log("Strims: [GET:getStreams] Error fetching streams.", err);
        if (getStreamsErrorCallback) getStreamsErrorCallback(err);
      });
  }

};
