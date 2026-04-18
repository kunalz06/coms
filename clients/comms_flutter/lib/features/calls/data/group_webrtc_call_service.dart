import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../../core/config/app_config.dart';
import '../domain/call_models.dart';

final groupWebRtcCallServiceProvider = Provider<GroupWebRtcCallService>((ref) {
  return GroupWebRtcCallService(ref.watch(appConfigProvider));
});

class GroupWebRtcCallService {
  GroupWebRtcCallService(this._config);

  final AppConfig _config;
  final _peers = <String, RTCPeerConnection>{};
  final _remoteStreams = <String, MediaStream>{};
  MediaStream? _localStream;

  MediaStream? get localStream => _localStream;
  Map<String, MediaStream> get remoteStreams =>
      Map.unmodifiable(_remoteStreams);

  Future<MediaStream> acquireMedia(CallMode mode) async {
    if (_localStream != null) return _localStream!;
    _localStream = await navigator.mediaDevices.getUserMedia({
      'audio': true,
      'video': mode == CallMode.video
          ? {
              'facingMode': 'user',
              'width': {'ideal': 960},
              'height': {'ideal': 540},
            }
          : false,
    });
    return _localStream!;
  }

  Future<RTCPeerConnection> ensurePeer({
    required String peerId,
    required void Function(String peerId, Map<String, dynamic> candidate)
        onIceCandidate,
    required void Function(String peerId, MediaStream stream) onRemoteStream,
  }) async {
    final existing = _peers[peerId];
    if (existing != null) return existing;

    final peer = await createPeerConnection(_rtcConfig());
    _peers[peerId] = peer;

    final stream = _localStream;
    if (stream != null) {
      for (final track in stream.getTracks()) {
        await peer.addTrack(track, stream);
      }
    }

    peer.onIceCandidate = (candidate) {
      if (candidate.candidate == null) return;
      onIceCandidate(peerId, {
        'candidate': candidate.candidate,
        'sdpMid': candidate.sdpMid,
        'sdpMLineIndex': candidate.sdpMLineIndex,
      });
    };
    peer.onTrack = (event) {
      if (event.streams.isEmpty) return;
      _remoteStreams[peerId] = event.streams.first;
      onRemoteStream(peerId, event.streams.first);
    };
    return peer;
  }

  Future<Map<String, dynamic>> createOffer(String peerId) async {
    final peer = _requirePeer(peerId);
    final offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    return {'type': offer.type, 'sdp': offer.sdp};
  }

  Future<Map<String, dynamic>> acceptOffer(String peerId, Object offer) async {
    final peer = _requirePeer(peerId);
    await peer.setRemoteDescription(_descriptionFrom(offer));
    final answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    return {'type': answer.type, 'sdp': answer.sdp};
  }

  Future<void> acceptAnswer(String peerId, Object answer) async {
    await _requirePeer(peerId).setRemoteDescription(_descriptionFrom(answer));
  }

  Future<void> addCandidate(String peerId, Object candidate) async {
    final data = Map<String, dynamic>.from(candidate as Map);
    await _requirePeer(peerId).addCandidate(
      RTCIceCandidate(
        data['candidate'] as String?,
        data['sdpMid'] as String?,
        (data['sdpMLineIndex'] as num?)?.toInt(),
      ),
    );
  }

  Future<void> removePeer(String peerId) async {
    await _peers.remove(peerId)?.close();
    _remoteStreams.remove(peerId);
  }

  Future<void> disposeCall() async {
    for (final peer in _peers.values) {
      await peer.close();
    }
    _peers.clear();
    _remoteStreams.clear();
    _localStream?.getTracks().forEach((track) => track.stop());
    _localStream = null;
  }

  bool setMicrophoneEnabled(bool enabled) {
    for (final track
        in _localStream?.getAudioTracks() ?? const <MediaStreamTrack>[]) {
      track.enabled = enabled;
    }
    return enabled;
  }

  bool setCameraEnabled(bool enabled) {
    for (final track
        in _localStream?.getVideoTracks() ?? const <MediaStreamTrack>[]) {
      track.enabled = enabled;
    }
    return enabled;
  }

  RTCPeerConnection _requirePeer(String peerId) {
    final peer = _peers[peerId];
    if (peer == null) throw StateError('Group peer is not ready.');
    return peer;
  }

  RTCSessionDescription _descriptionFrom(Object value) {
    final data = Map<String, dynamic>.from(value as Map);
    return RTCSessionDescription(
        data['sdp'] as String?, data['type'] as String?);
  }

  Map<String, dynamic> _rtcConfig() {
    final iceServers = <Map<String, dynamic>>[];
    if (_config.stunUrls.isNotEmpty) iceServers.add({'urls': _config.stunUrls});
    if (_config.turnUrls.isNotEmpty) {
      iceServers.add({
        'urls': _config.turnUrls,
        if (_config.turnUsername != null) 'username': _config.turnUsername,
        if (_config.turnCredential != null)
          'credential': _config.turnCredential,
      });
    }
    return {'iceServers': iceServers, 'iceCandidatePoolSize': 4};
  }
}
