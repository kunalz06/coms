import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class PrivacyRepository {
  PrivacyRepository({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _lockHashKey = 'comms.privacy.lock_hash';
  static const _hiddenHashKey = 'comms.privacy.hidden_hash';
  static const _lockedConversationsKey = 'comms.privacy.locked_conversations';
  static const _hiddenConversationsKey = 'comms.privacy.hidden_conversations';
  static const _lockResetKey = 'comms.privacy.lock_reset';
  static const _hiddenResetKey = 'comms.privacy.hidden_reset';

  Future<bool> hasChatLockPassword() async =>
      (await _storage.read(key: _lockHashKey)) != null;

  Future<bool> hasHiddenChatsPassword() async =>
      (await _storage.read(key: _hiddenHashKey)) != null;

  Future<void> setChatLockPassword(String password) async {
    await _storage.write(key: _lockHashKey, value: _createStoredHash(password));
  }

  Future<bool> verifyChatLockPassword(String password) async {
    final saved = await _storage.read(key: _lockHashKey);
    return saved != null && _verifyStoredHash(saved, password);
  }

  Future<void> setHiddenChatsPassword(String password) async {
    await _storage.write(
        key: _hiddenHashKey, value: _createStoredHash(password));
  }

  Future<bool> verifyHiddenChatsPassword(String password) async {
    final saved = await _storage.read(key: _hiddenHashKey);
    return saved != null && _verifyStoredHash(saved, password);
  }

  Future<void> clearChatLockPassword() => _storage.delete(key: _lockHashKey);

  Future<void> clearHiddenChatsPassword() => _storage.delete(key: _hiddenHashKey);

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

  Future<String> issueResetToken({
    required String type,
    required String email,
  }) async {
    final key = _resetKeyFor(type);
    final token = _token();
    final salt = _salt();
    final payload = {
      'email': email.trim().toLowerCase(),
      'salt': salt,
      'token_hash': _hash(token, salt),
      'expires_at': DateTime.now().toUtc().add(const Duration(minutes: 15)).toIso8601String(),
      'used': false,
    };
    await _storage.write(key: key, value: jsonEncode(payload));
    return token;
  }

  Future<bool> applyResetToken({
    required String type,
    required String email,
    required String token,
    required String newPassword,
  }) async {
    final key = _resetKeyFor(type);
    final raw = await _storage.read(key: key);
    if (raw == null) return false;
    final json = Map<String, dynamic>.from(jsonDecode(raw) as Map);
    final expectedEmail = (json['email'] as String?) ?? '';
    final used = json['used'] as bool? ?? false;
    final expiresAt = DateTime.tryParse((json['expires_at'] as String?) ?? '');
    final salt = json['salt'] as String?;
    final tokenHash = json['token_hash'] as String?;

    if (used ||
        expiresAt == null ||
        DateTime.now().toUtc().isAfter(expiresAt) ||
        salt == null ||
        tokenHash == null ||
        expectedEmail != email.trim().toLowerCase() ||
        _hash(token, salt) != tokenHash) {
      return false;
    }

    if (type == 'lock') {
      await setChatLockPassword(newPassword);
    } else {
      await setHiddenChatsPassword(newPassword);
    }

    json['used'] = true;
    await _storage.write(key: key, value: jsonEncode(json));
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

  String _resetKeyFor(String type) {
    if (type == 'lock') return _lockResetKey;
    if (type == 'hidden') return _hiddenResetKey;
    throw ArgumentError('Unknown reset type: $type');
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

  String _token() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    final random = Random.secure();
    return List.generate(8, (_) => chars[random.nextInt(chars.length)]).join();
  }
}
