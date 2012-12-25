//CLIENT

 // Fallbacks for vendor-specific variables until the spec is finalized.
	
var PeerConnection = window.PeerConnection || window.webkitPeerConnection00 || window.webkitRTCPeerConnection;
var URL = window.URL || window.webkitURL || window.msURL || window.oURL;
var getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;

(function() {

  var rtc;
  if ('undefined' === typeof module) {
    rtc = this.rtc = {};
  } else {
    rtc = module.exports = {};
  }

 
  // Holds a connection to the server.
  rtc._socket = null;

  // Holds callbacks for certain events.
  rtc._events = {};

  rtc.on = function(eventName, callback) {
    rtc._events[eventName] = rtc._events[eventName] || [];
    rtc._events[eventName].push(callback);
  };

  rtc.fire = function(eventName, _) {
    var events = rtc._events[eventName];
    var args = Array.prototype.slice.call(arguments, 1);

    if (!events) {
      return;
    }

    for (var i = 0, len = events.length; i < len; i++) {
      events[i].apply(null, args);
    }
  };

  // Holds the STUN/ICE server to use for PeerConnections.
  rtc.SERVER = {iceServers:[{url:"stun:stun.l.google.com:19302"}]};

  // Referenc e to the lone PeerConnection instance.
  rtc.peerConnections = {};

  // Array of known peer socket ids
  rtc.connections = [];
  // Stream-related variables.
  rtc.streams = [];
  rtc.numStreams = 0;
  rtc.initializedStreams = 0;

  /**
   * Connects to the websocket server.
   */
  rtc.connect = function(server, room) {
    room = room || ""; // by default, join a room called the blank string
    rtc._socket = new WebSocket(server);

    rtc._socket.onopen = function() {
      rtc._socket.send(JSON.stringify({
        "eventName": "login",
        "data":{
          "nickname": nickname
        }
      }), function(error){
          if(error){console.log(error);}
        });

      rtc._socket.send(JSON.stringify({
        "eventName": "join_room",
        "data":{
          "room": room
        }
      }), function(error){
          if(error){console.log(error);}
        });

      rtc._socket.onmessage = function(msg) {
        var json = JSON.parse(msg.data);
        rtc.fire(json.eventName, json.data);
      };

      rtc._socket.onerror = function(err) {
        console.log('onerror');
        console.log(err);
      };

      rtc._socket.onclose = function(data) {
        rtc.fire('disconnect stream', rtc._socket.id);
        delete rtc.peerConnections[rtc._socket.id];
      };

      rtc.on('get_peers', function(data) {
        rtc.connections = data.connections;
        // fire connections event and pass peers
        rtc.fire('connections', rtc.connections);
      });

      rtc.on('receive_ice_candidate', function(data) {
    	var candidate = new RTCIceCandidate(data);
    	rtc.peerConnections[data.socketId].addIceCandidate(candidate);
        rtc.fire('receive ice candidate', candidate);
      });

      rtc.on('new_peer_connected', function(data) {
        rtc.connections.push(data.socketId);

        var pc = rtc.createPeerConnection(data.socketId);
        for (var i = 0; i < rtc.streams.length; i++) {
          var stream = rtc.streams[i];
          pc.addStream(stream);
        }
      });

      rtc.on('remove_peer_connected', function(data) {  
        rtc.fire('disconnect stream', data.socketId);
        delete rtc.peerConnections[data.socketId];
      });

      rtc.on('receive_offer', function(data) {
        rtc.receiveOffer(data.socketId, data.sdp);
        rtc.fire('receive offer', data);
      });

      rtc.on('receive_answer', function(data) {
        rtc.receiveAnswer(data.socketId, data.sdp);
        rtc.fire('receive answer', data);
      });

      rtc.fire('connect');
    };
  };


  rtc.sendOffers = function() {
    for (var i = 0, len = rtc.connections.length; i < len; i++) {
      var socketId = rtc.connections[i];
      rtc.sendOffer(socketId);
    }
  }

  rtc.onClose = function(data) {
    rtc.on('close_stream', function() {
      rtc.fire('close_stream', data);
    });
  }

  rtc.createPeerConnections = function() {
    for (var i = 0; i < rtc.connections.length; i++) {
      rtc.createPeerConnection(rtc.connections[i]);
    }
  };

  rtc.createPeerConnection = function(id) {
    console.log('createPeerConnection');
    var pc = rtc.peerConnections[id] = new PeerConnection(rtc.SERVER);
    pc.onicecandidate = function(event) {
      if (event.candidate) {
         rtc._socket.send(JSON.stringify({
           "eventName": "send_ice_candidate",
           "data": {
              "label": event.candidate.label,
              "candidate": event.candidate.candidate,
              "socketId": id
           }
         }), function(error){
           if(error){console.log(error);}
         });
       }
       rtc.fire('ice candidate', event.candidate);
     };

    pc.onopen = function() {
      // TODO: Finalize this API
      rtc.fire('peer connection opened');
    };

    pc.onaddstream = function(event) {
      // TODO: Finalize this API
      rtc.fire('add remote stream', event.stream, id);
    };
    return pc;
  };

  rtc.sendOffer = function(socketId) {
    var pc = rtc.peerConnections[socketId];
    pc.createOffer( function(session_description) {
    pc.setLocalDescription(session_description);
    rtc._socket.send(JSON.stringify({
        "eventName": "send_offer",
        "data":{
            "socketId": socketId,
            "sdp": session_description
            }
        }), function(error){
            if(error){console.log(error);
        }
   });
    });
  };


  rtc.receiveOffer = function(socketId, sdp) {
    var pc = rtc.peerConnections[socketId];
    pc.setRemoteDescription(new RTCSessionDescription(sdp));
    rtc.sendAnswer(socketId);
  };


  rtc.sendAnswer = function(socketId) {
    var pc = rtc.peerConnections[socketId];
    pc.createAnswer( function(session_description) {
    pc.setLocalDescription(session_description);
    rtc._socket.send(JSON.stringify({
        "eventName": "send_answer",
        "data":{
            "socketId": socketId,
            "sdp": session_description
            }
        }), function(error){
            if(error){console.log(error);
        }
   });
    var offer = pc.remoteDescription;
    });
  };


  rtc.receiveAnswer = function(socketId, sdp) {
    var pc = rtc.peerConnections[socketId];
    pc.setRemoteDescription(new RTCSessionDescription(sdp));
  };


  rtc.createStream = function(opt, onSuccess, onFail) {
    var options;
    onSuccess = onSuccess ||
    function() {};
    onFail = onFail ||
    function() {};

    if(opt.audio && opt.video){
      options = {
        video: true,
        audio: true
      };
    }else if(opt.video){
      options = {
        video: true,
        audio: false
      };
    }else if(opt.audio){
      options = {
        video: false,
        audio: true
      };
    }else {
      options = {
        video: false,
        audio: false
      };
    }

    if (getUserMedia) {
      rtc.numStreams++;
      getUserMedia.call(navigator, options, function(stream) {
        
        rtc.streams.push(stream);
        rtc.initializedStreams++;
        onSuccess(stream);
        if (rtc.initializedStreams === rtc.numStreams) {
          rtc.fire('ready');
        }
      }, function() {
        alert("Could not connect stream.");
        onFail();
      });
    } else {
      alert('webRTC is not yet supported in this browser.');
    }
  }


  rtc.addStreams = function() {
    for (var i = 0; i < rtc.streams.length; i++) {
      var stream = rtc.streams[i];
      for (var connection in rtc.peerConnections) {
        rtc.peerConnections[connection].addStream(stream);
      }
    }
  };


  rtc.attachStream = function(stream, domId) {
    document.getElementById(domId).src = URL.createObjectURL(stream);
  };

  rtc.on('ready', function() {
    rtc.createPeerConnections();
    rtc.addStreams();
    rtc.sendOffers();
  });

}).call(this);
