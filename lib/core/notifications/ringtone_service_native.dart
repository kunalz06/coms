import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final ringtoneServiceProvider = Provider<RingtoneService>((ref) {
  final service = RingtoneService();
  ref.onDispose(service.stopRingtone);
  return service;
});

/// Low-overhead native audio feedback. The OS may suppress system sounds when
/// silent or DND is enabled; actual incoming-call push needs native setup.
class RingtoneService {
  Timer? _ringTimer;

  void startRingtone() {
    if (_ringTimer != null) return;
    SystemSound.play(SystemSoundType.alert);
    _ringTimer = Timer.periodic(
      const Duration(seconds: 2),
      (_) => SystemSound.play(SystemSoundType.alert),
    );
  }

  void stopRingtone() {
    _ringTimer?.cancel();
    _ringTimer = null;
  }

  void playMessageSound() {
    SystemSound.play(SystemSoundType.click);
  }
}
