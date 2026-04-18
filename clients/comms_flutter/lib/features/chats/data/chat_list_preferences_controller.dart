import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';

const _boxName = 'app_settings';
const _unreadFirstKey = 'chat_unread_first';

final chatUnreadFirstControllerProvider =
    StateNotifierProvider<ChatUnreadFirstController, bool>((ref) {
  return ChatUnreadFirstController();
});

class ChatUnreadFirstController extends StateNotifier<bool> {
  ChatUnreadFirstController() : super(_readInitial()) {
    _box = Hive.box(_boxName);
  }

  late final Box<dynamic> _box;

  static bool _readInitial() {
    if (!Hive.isBoxOpen(_boxName)) return true;
    final box = Hive.box(_boxName);
    final raw = box.get(_unreadFirstKey);
    if (raw is bool) return raw;
    return true;
  }

  Future<void> setUnreadFirst(bool enabled) async {
    state = enabled;
    await _box.put(_unreadFirstKey, enabled);
  }
}
