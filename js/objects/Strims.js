var Strims = function() {
  'use strict';
  console.log("Strims: [CONSRUCT:Strims] New Strims created.");
  this.streams = [];
  this.bot_streams = [];
};

Strims.prototype = {

  getStreams: function(getStreamsCallback) {
    'use strict';

    this.streams = [];
    this.bot_streams = [];

    var self = this;
    var limit = 100;
    var offset = 0;

    (function streams() {
      $.ajax({
        url: 'https://strims.gg/api',
        data: {},
        type: 'GET',
        // beforeSend: function (request) {
        //   setRequestHeaders(request)
        // },
        success: function(response) {
          self.streams = response.stream_list.filter(strim => strim.service == "angelthump" && strim.channel != "contrakino" && strim.channel != "psrngafk");
          self.bot_streams = response.stream_list.filter(strim => strim.channel == "contrakino" || strim.channel == "psrngafk");
          self.streams.sort(function(a, b) {
            return b.viewers - a.viewers;
          });
          self.bot_streams.sort(function(a, b) {
            return b.viewers - a.viewers;
          });
          getStreamsCallback(self.streams, self.bot_streams);
          $(document)
            .trigger('successGetStreams');
        },
        error: function() {
          $(document)
            .trigger('errorGetStreams');
        }
      });
    }());
  }

};
