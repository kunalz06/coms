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
  MediaStream? _screenStream;
  MediaStream? _previewStream;
  CallVideoQuality _videoQuality = CallVideoQuality.p720;

  MediaStream? get localStream => _localStream;
  MediaStream? get previewStream =>
      _previewStream ?? _screenStream ?? _localStream;

  bool get hasActivePeer => _peer != null;
  CallVideoQuality get videoQuality => _videoQuality;

  Future<MediaStream> acquireMedia(CallMode mode) async {
    _localStream?.getTracks().forEach((track) => track.stop());
    try {
      final stream = await navigator.mediaDevices.getUserMedia(
        _mediaConstraints(mode, _videoQuality),
      );
      _localStream = stream;
      _previewStream = stream;
      return stream;
    } catch (_) {
      if (mode != CallMode.video) rethrow;
      // Fallback: keep the call alive as audio-only when camera access fails.
      final stream = await navigator.mediaDevices.getUserMedia({
        'audio': true,
        'video': false,
      });
      _localStream = stream;
      _previewStream = stream;
      return stream;
    }
  }

  Future<MediaStream> startScreenShare() async {
    final peer = _requirePeer();
    final display = await navigator.mediaDevices.getDisplayMedia({
      'video': true,
      'audio': false,
    });
    final displayTrack = display.getVideoTracks().isNotEmpty
        ? display.getVideoTracks().first
        : null;
    if (displayTrack == null) {
      display.getTracks().forEach((track) => track.stop());
      throw StateError('Screen share stream is unavailable.');
    }

    for (final sender in await peer.getSenders()) {
      if (sender.track?.kind == 'video') {
        await sender.replaceTrack(displayTrack);
      }
    }

    displayTrack.onEnded = () {
      stopScreenShare();
    };

    _screenStream = display;
    _previewStream = display;
    return display;
  }

  Future<MediaStream?> stopScreenShare() async {
    final peer = _peer;
    final localTrack = _localStream?.getVideoTracks().isNotEmpty == true
        ? _localStream!.getVideoTracks().first
        : null;
    if (peer != null) {
      for (final sender in await peer.getSenders()) {
        if (sender.track?.kind == 'video') {
          await sender.replaceTrack(localTrack);
        }
      }
    }
    _screenStream?.getTracks().forEach((track) => track.stop());
    _screenStream = null;
    _previewStream = _localStream;
    return _previewStream;
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

  Future<MediaStream?> setVideoQuality(CallVideoQuality quality) async {
    _videoQuality = quality;
    if (_localStream == null || _localStream!.getVideoTracks().isEmpty) {
      return _previewStream;
    }
    if (_screenStream != null) return _previewStream;

    final replacement = await navigator.mediaDevices.getUserMedia(
      _mediaConstraints(CallMode.video, quality, audio: false),
    );
    final videoTrack = replacement.getVideoTracks().isNotEmpty
        ? replacement.getVideoTracks().first
        : null;
    if (videoTrack == null) {
      replacement.getTracks().forEach((track) => track.stop());
      return _previewStream;
    }

    final previousVideoTracks = _localStream!.getVideoTracks();
    _localStream!.addTrack(videoTrack);
    final peer = _peer;
    if (peer != null) {
      for (final sender in await peer.getSenders()) {
        if (sender.track?.kind == 'video') {
          await sender.replaceTrack(videoTrack);
        }
      }
    }
    for (final track in previousVideoTracks) {
      _localStream!.removeTrack(track);
      track.stop();
    }
    _previewStream = _localStream;
    return _previewStream;
  }

  Future<CallPacketStats> packetStats() async {
    final peer = _peer;
    if (peer == null) return const CallPacketStats.empty();
    return _packetStatsFrom(await peer.getStats());
  }

  Future<void> disposeCall() async {
    await _peer?.close();
    _peer = null;
    _screenStream?.getTracks().forEach((track) => track.stop());
    _screenStream = null;
    _localStream?.getTracks().forEach((track) => track.stop());
    _localStream = null;
    _previewStream = null;
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

  Map<String, dynamic> _mediaConstraints(
    CallMode mode,
    CallVideoQuality quality, {
    bool audio = true,
  }) {
    return {
      'audio': audio,
      'video': mode == CallMode.video
          ? {
              'facingMode': 'user',
              'width': {'ideal': quality.width},
              'height': {'ideal': quality.height},
              'frameRate': {'ideal': quality.frameRate, 'max': 30},
            }
          : false,
    };
  }
}

enum CallVideoQuality {
  p240(426, 240, 15, '240p'),
  p480(854, 480, 24, '480p'),
  p720(1280, 720, 30, '720p');

  const CallVideoQuality(this.width, this.height, this.frameRate, this.label);

  final int width;
  final int height;
  final int frameRate;
  final String label;

  CallVideoQuality lower() {
    return switch (this) {
      CallVideoQuality.p720 => CallVideoQuality.p480,
      CallVideoQuality.p480 => CallVideoQuality.p240,
      CallVideoQuality.p240 => CallVideoQuality.p240,
    };
  }

  CallVideoQuality higher() {
    return switch (this) {
      CallVideoQuality.p240 => CallVideoQuality.p480,
      CallVideoQuality.p480 => CallVideoQuality.p720,
      CallVideoQuality.p720 => CallVideoQuality.p720,
    };
  }
}

class CallPacketStats {
  const CallPacketStats({
    required this.packetsSent,
    required this.packetsReceived,
    required this.bytesSent,
    required this.bytesReceived,
    required this.packetsLost,
  });

  const CallPacketStats.empty()
      : packetsSent = 0,
        packetsReceived = 0,
        bytesSent = 0,
        bytesReceived = 0,
        packetsLost = 0;

  final int packetsSent;
  final int packetsReceived;
  final int bytesSent;
  final int bytesReceived;
  final int packetsLost;

  CallPacketStats operator +(CallPacketStats other) {
    return CallPacketStats(
      packetsSent: packetsSent + other.packetsSent,
      packetsReceived: packetsReceived + other.packetsReceived,
      bytesSent: bytesSent + other.bytesSent,
      bytesReceived: bytesReceived + other.bytesReceived,
      packetsLost: packetsLost + other.packetsLost,
    );
  }

  bool get hasTraffic => packetsSent > 0 || packetsReceived > 0;

  String get compactLabel {
    if (!hasTraffic) return 'Packet stream warming up';
    final loss = packetsLost > 0 ? ' - $packetsLost lost' : '';
    return '$packetsSent sent - $packetsReceived received$loss';
  }
}

CallPacketStats _packetStatsFrom(List<dynamic> reports) {
  var packetsSent = 0;
  var packetsReceived = 0;
  var bytesSent = 0;
  var bytesReceived = 0;
  var packetsLost = 0;

  for (final report in reports) {
    final type = _reportType(report);
    final values = _reportValues(report);
    if (type == 'outbound-rtp') {
      packetsSent += _intValue(values, 'packetsSent');
      bytesSent += _intValue(values, 'bytesSent');
    } else if (type == 'inbound-rtp') {
      packetsReceived += _intValue(values, 'packetsReceived');
      bytesReceived += _intValue(values, 'bytesReceived');
      packetsLost += _intValue(values, 'packetsLost');
    }
  }

  return CallPacketStats(
    packetsSent: packetsSent,
    packetsReceived: packetsReceived,
    bytesSent: bytesSent,
    bytesReceived: bytesReceived,
    packetsLost: packetsLost,
  );
}

String _reportType(dynamic report) {
  final type = report.type;
  return type is String ? type : '';
}

Map<dynamic, dynamic> _reportValues(dynamic report) {
  final values = report.values;
  return values is Map ? values : const {};
}

int _intValue(Map<dynamic, dynamic> values, String key) {
  final value = values[key];
  if (value is int) return value;
  if (value is double) return value.round();
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value) ?? 0;
  return 0;
}
