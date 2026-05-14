import 'dart:math' as math;
import 'dart:typed_data';

// ignore: avoid_web_libraries_in_flutter
import 'dart:html' as html;

import 'package:flutter_riverpod/flutter_riverpod.dart';

final ringtoneServiceProvider = Provider<RingtoneService>((ref) {
  return RingtoneService();
});

class RingtoneService {
  html.AudioElement? _ringtone;

  void startRingtone() {
    _ringtone ??= _audioElement(frequencyHz: 740, durationMs: 900)
      ..loop = true
      ..volume = 0.35;
    _ringtone!.currentTime = 0;
    _ringtone!.play().catchError((_) {});
  }

  void stopRingtone() {
    final ringtone = _ringtone;
    if (ringtone == null) return;
    ringtone.pause();
    ringtone.currentTime = 0;
  }

  void playMessageSound() {
    final audio = _audioElement(frequencyHz: 880, durationMs: 180)
      ..volume = 0.2;
    audio.play().catchError((_) {});
  }

  html.AudioElement _audioElement({
    required int frequencyHz,
    required int durationMs,
  }) {
    final bytes = _wavTone(
      frequencyHz: frequencyHz,
      durationMs: durationMs,
    );
    final blob = html.Blob([bytes], 'audio/wav');
    return html.AudioElement(html.Url.createObjectUrlFromBlob(blob));
  }

  Uint8List _wavTone({
    required int frequencyHz,
    required int durationMs,
  }) {
    const sampleRate = 22050;
    final sampleCount = (sampleRate * durationMs / 1000).round();
    final dataSize = sampleCount * 2;
    final bytes = ByteData(44 + dataSize);

    void writeAscii(int offset, String value) {
      for (var i = 0; i < value.length; i++) {
        bytes.setUint8(offset + i, value.codeUnitAt(i));
      }
    }

    writeAscii(0, 'RIFF');
    bytes.setUint32(4, 36 + dataSize, Endian.little);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    bytes.setUint32(16, 16, Endian.little);
    bytes.setUint16(20, 1, Endian.little);
    bytes.setUint16(22, 1, Endian.little);
    bytes.setUint32(24, sampleRate, Endian.little);
    bytes.setUint32(28, sampleRate * 2, Endian.little);
    bytes.setUint16(32, 2, Endian.little);
    bytes.setUint16(34, 16, Endian.little);
    writeAscii(36, 'data');
    bytes.setUint32(40, dataSize, Endian.little);

    for (var i = 0; i < sampleCount; i++) {
      final fade = math.min(i / 800, (sampleCount - i) / 800).clamp(0.0, 1.0);
      final sample = math.sin((2 * math.pi * frequencyHz * i) / sampleRate);
      bytes.setInt16(44 + i * 2, (sample * fade * 9000).round(), Endian.little);
    }
    return bytes.buffer.asUint8List();
  }
}
