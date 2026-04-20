import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';

const _boxName = 'app_settings';
const _themeModeKey = 'theme_mode';

final themeModeControllerProvider =
    StateNotifierProvider<ThemeModeController, ThemeMode>((ref) {
  return ThemeModeController();
});

class ThemeModeController extends StateNotifier<ThemeMode> {
  ThemeModeController() : super(_readInitial()) {
    _box = Hive.box(_boxName);
  }

  late final Box<dynamic> _box;

  static ThemeMode _readInitial() {
    if (!Hive.isBoxOpen(_boxName)) return ThemeMode.system;
    final box = Hive.box(_boxName);
    final raw = box.get(_themeModeKey);
    return switch (raw) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = mode;
    final value = switch (mode) {
      ThemeMode.light => 'light',
      ThemeMode.dark => 'dark',
      ThemeMode.system => 'system',
    };
    await _box.put(_themeModeKey, value);
  }
}
