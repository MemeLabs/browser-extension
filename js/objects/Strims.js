var Strims = function () {
    'use strict';
    this.streams = [];
};

Strims.prototype = {

    getStreams : function () {
        'use strict';

        this.streams = [];

        var self = this;
        var limit = 100;
        var offset = 0;

        (function streams() {
          $.ajax({
            url : 'https://strims.gg/api',
            data : {},
            type : 'GET',
            // beforeSend: function (request) {
            //   setRequestHeaders(request)
            // },
            success : function (response) {
              self.streams = response.stream_list.filter(strim => strim.service == 'angelthump');
              self.streams.sort(function (a, b) {
                return b.viewers - a.viewers;
              });
              $(document)
                .trigger('successGetStreams');
            },
            error : function () {
              $(document)
                .trigger('errorGetStreams');
            }
          });
        }());
    }

};
