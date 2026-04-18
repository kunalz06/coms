import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../../core/config/app_config.dart';
import '../domain/call_models.dart';

final webRtcCallServiceProvider = Provider<WebRtcCallService>((ref) {
  return WebRtcCallService(ref.watch(appConfigProvider));
});

class WebRtcCallService {
  WebRtcCallService(this._config);

  final AppConfig _config;
  RTCPeerConnection? _peer;
  MediaStream? _localStream;

  MediaStream? get localStream => _localStream;

  Future<MediaStream> acquireMedia(CallMode mode) async {
    _localStream?.getTracks().forEach((track) => track.stop());
    final stream = await navigator.mediaDevices.getUserMedia({
      'audio': true,
      'video': mode == CallMode.video
          ? {
              'facingMode': 'user',
              'width': {'ideal': 1280},
              'height': {'ideal': 720},
            }
          : false,
    });
    _localStream = stream;
    return stream;
  }

  Future<RTCPeerConnection> ensurePeer({
    required void Function(Map<String, dynamic> candidate) onIceCandidate,
    required void Function(MediaStream stream) onRemoteStream,
  }) async {
    if (_peer != null) return _peer!;

    final peer = await createPeerConnection(_rtcConfig());
    _peer = peer;

    final stream = _localStream;
    if (stream != null) {
      for (final track in stream.getTracks()) {
        await peer.addTrack(track, stream);
      }
    }

    peer.onIceCandidate = (candidate) {
      if (candidate.candidate == null) return;
      onIceCandidate({
        'candidate': candidate.candidate,
        'sdpMid': candidate.sdpMid,
        'sdpMLineIndex': candidate.sdpMLineIndex,
      });
    };
    peer.onTrack = (event) {
      if (event.streams.isNotEmpty) onRemoteStream(event.streams.first);
    };

    return peer;
  }

  Future<Map<String, dynamic>> createOffer() async {
    final peer = _requirePeer();
    final offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    return {'type': offer.type, 'sdp': offer.sdp};
  }

  Future<Map<String, dynamic>> acceptOffer(Object offer) async {
    final peer = _requirePeer();
    final description = _descriptionFrom(offer);
    await peer.setRemoteDescription(description);
    final answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    return {'type': answer.type, 'sdp': answer.sdp};
  }

  Future<void> acceptAnswer(Object answer) async {
    await _requirePeer().setRemoteDescription(_descriptionFrom(answer));
  }

  Future<void> addCandidate(Object candidate) async {
    final data = Map<String, dynamic>.from(candidate as Map);
    await _requirePeer().addCandidate(
      RTCIceCandidate(
        data['candidate'] as String?,
        data['sdpMid'] as String?,
        (data['sdpMLineIndex'] as num?)?.toInt(),
      ),
    );
  }

  Future<void> disposeCall() async {
    await _peer?.close();
    _peer = null;
    _localStream?.getTracks().forEach((track) => track.stop());
    _localStream = null;
  }

  bool setMicrophoneEnabled(bool enabled) {
    final tracks = _localStream?.getAudioTracks() ?? const <MediaStreamTrack>[];
    for (final track in tracks) {
      track.enabled = enabled;
    }
    return enabled;
  }

  bool setCameraEnabled(bool enabled) {
    final tracks = _localStream?.getVideoTracks() ?? const <MediaStreamTrack>[];
    for (final track in tracks) {
      track.enabled = enabled;
    }
    return enabled;
  }

  RTCPeerConnection _requirePeer() {
    final peer = _peer;
    if (peer == null) throw StateError('Peer connection is not ready.');
    return peer;
  }

  RTCSessionDescription _descriptionFrom(Object value) {
    final data = Map<String, dynamic>.from(value as Map);
    return RTCSessionDescription(
      data['sdp'] as String?,
      data['type'] as String?,
    );
  }

  Map<String, dynamic> _rtcConfig() {
    final iceServers = <Map<String, dynamic>>[];
    if (_config.stunUrls.isNotEmpty) {
      iceServers.add({'urls': _config.stunUrls});
    }
    if (_config.turnUrls.isNotEmpty) {
      iceServers.add({
        'urls': _config.turnUrls,
        if (_config.turnUsername != null) 'username': _config.turnUsername,
        if (_config.turnCredential != null)
          'credential': _config.turnCredential,
      });
    }
    return {
      'iceServers': iceServers,
      'iceCandidatePoolSize': 4,
    };
  }
}
