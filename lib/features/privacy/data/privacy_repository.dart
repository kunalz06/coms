import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../../core/network/api_client.dart';

class PrivacyRepository {
  PrivacyRepository(this._api, {FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final ApiClient _api;
  final FlutterSecureStorage _storage;

  static const _lockHashKey = 'comms.privacy.lock_hash';
  static const _hiddenHashKey = 'comms.privacy.hidden_hash';
  static const _lockedConversationsKey = 'comms.privacy.locked_conversations';
  static const _hiddenConversationsKey = 'comms.privacy.hidden_conversations';

  Future<bool> hasChatLockPassword() async =>
      (await _storage.read(key: _lockHashKey)) != null;

  Future<bool> hasHiddenChatsPassword() async =>
      (await _storage.read(key: _hiddenHashKey)) != null;

  Future<void> setChatLockPassword(String password) async {
    await _storage.write(key: _lockHashKey, value: _createStoredHash(password));
  }

  Future<bool> changeChatLockPassword({
    required String oldPassword,
    required String newPassword,
  }) async {
    final ok = await verifyChatLockPassword(oldPassword);
    if (!ok) return false;
    await setChatLockPassword(newPassword);
    return true;
  }

  Future<bool> verifyChatLockPassword(String password) async {
    final saved = await _storage.read(key: _lockHashKey);
    return saved != null && _verifyStoredHash(saved, password);
  }

  Future<void> setHiddenChatsPassword(String password) async {
    await _storage.write(
        key: _hiddenHashKey, value: _createStoredHash(password));
  }

  Future<bool> changeHiddenChatsPassword({
    required String oldPassword,
    required String newPassword,
  }) async {
    final ok = await verifyHiddenChatsPassword(oldPassword);
    if (!ok) return false;
    await setHiddenChatsPassword(newPassword);
    return true;
  }

  Future<bool> verifyHiddenChatsPassword(String password) async {
    final saved = await _storage.read(key: _hiddenHashKey);
    return saved != null && _verifyStoredHash(saved, password);
  }

  Future<void> clearChatLockPassword() => _storage.delete(key: _lockHashKey);

  Future<void> clearHiddenChatsPassword() =>
      _storage.delete(key: _hiddenHashKey);

  Future<Set<String>> lockedConversationIds() async {
    return _loadStringSet(_lockedConversationsKey);
  }

  Future<Set<String>> hiddenConversationIds() async {
    return _loadStringSet(_hiddenConversationsKey);
  }

  Future<void> setConversationLocked(String conversationId, bool locked) async {
    final values = await _loadStringSet(_lockedConversationsKey);
    if (locked) {
      values.add(conversationId);
    } else {
      values.remove(conversationId);
    }
    await _saveStringSet(_lockedConversationsKey, values);
  }

  Future<void> setConversationHidden(String conversationId, bool hidden) async {
    final values = await _loadStringSet(_hiddenConversationsKey);
    if (hidden) {
      values.add(conversationId);
    } else {
      values.remove(conversationId);
    }
    await _saveStringSet(_hiddenConversationsKey, values);
  }

  Future<void> sendResetOtp({
    required String type,
  }) async {
    await _api.post('/api/privacy/password-reset', data: {
      'type': type,
    });
  }

  Future<bool> applyResetOtp({
    required String type,
    required String otp,
    required String newPassword,
  }) async {
    await _api.post('/api/privacy/password-reset', data: {
      'type': type,
      'otp': otp,
    });

    if (type == 'lock') {
      await setChatLockPassword(newPassword);
    } else {
      await setHiddenChatsPassword(newPassword);
    }
    return true;
  }

  Future<void> removeConversationPrivacy(String conversationId) async {
    final locked = await _loadStringSet(_lockedConversationsKey);
    final hidden = await _loadStringSet(_hiddenConversationsKey);
    locked.remove(conversationId);
    hidden.remove(conversationId);
    await _saveStringSet(_lockedConversationsKey, locked);
    await _saveStringSet(_hiddenConversationsKey, hidden);
  }

  Future<Set<String>> _loadStringSet(String key) async {
    final raw = await _storage.read(key: key);
    if (raw == null || raw.isEmpty) return <String>{};
    final list = (jsonDecode(raw) as List).whereType<String>();
    return list.toSet();
  }

  Future<void> _saveStringSet(String key, Set<String> values) {
    return _storage.write(key: key, value: jsonEncode(values.toList()..sort()));
  }

  String _createStoredHash(String value) {
    final salt = _salt();
    return '$salt:${_hash(value, salt)}';
  }

  bool _verifyStoredHash(String stored, String value) {
    final parts = stored.split(':');
    if (parts.length != 2) return false;
    return parts[1] == _hash(value, parts[0]);
  }

  String _hash(String value, String salt) {
    final normalized = value.trim();
    return sha256.convert(utf8.encode('$salt:$normalized')).toString();
  }

  String _salt() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    return base64UrlEncode(bytes);
  }
}
