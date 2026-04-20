import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'privacy_repository.dart';

final privacyRepositoryProvider = Provider<PrivacyRepository>((ref) {
  return PrivacyRepository();
});

final privacyControllerProvider =
    StateNotifierProvider<PrivacyController, PrivacyState>((ref) {
  return PrivacyController(ref.watch(privacyRepositoryProvider));
});

class PrivacyState {
  const PrivacyState({
    this.loading = true,
    this.chatLockConfigured = false,
    this.hiddenPasswordConfigured = false,
    this.lockedConversationIds = const {},
    this.hiddenConversationIds = const {},
    this.chatUnlockUntil,
    this.hiddenUnlockUntil,
    this.error,
  });

  final bool loading;
  final bool chatLockConfigured;
  final bool hiddenPasswordConfigured;
  final Set<String> lockedConversationIds;
  final Set<String> hiddenConversationIds;
  final DateTime? chatUnlockUntil;
  final DateTime? hiddenUnlockUntil;
  final String? error;

  bool get chatUnlocked =>
      chatUnlockUntil != null && DateTime.now().isBefore(chatUnlockUntil!);
  bool get hiddenUnlocked =>
      hiddenUnlockUntil != null && DateTime.now().isBefore(hiddenUnlockUntil!);

  PrivacyState copyWith({
    bool? loading,
    bool? chatLockConfigured,
    bool? hiddenPasswordConfigured,
    Set<String>? lockedConversationIds,
    Set<String>? hiddenConversationIds,
    DateTime? chatUnlockUntil,
    DateTime? hiddenUnlockUntil,
    String? error,
    bool clearError = false,
  }) {
    return PrivacyState(
      loading: loading ?? this.loading,
      chatLockConfigured: chatLockConfigured ?? this.chatLockConfigured,
      hiddenPasswordConfigured:
          hiddenPasswordConfigured ?? this.hiddenPasswordConfigured,
      lockedConversationIds:
          lockedConversationIds ?? this.lockedConversationIds,
      hiddenConversationIds:
          hiddenConversationIds ?? this.hiddenConversationIds,
      chatUnlockUntil: chatUnlockUntil ?? this.chatUnlockUntil,
      hiddenUnlockUntil: hiddenUnlockUntil ?? this.hiddenUnlockUntil,
      error: clearError ? null : error ?? this.error,
    );
  }
}

class PrivacyController extends StateNotifier<PrivacyState> {
  PrivacyController(this._repository) : super(const PrivacyState()) {
    unawaited(refresh());
  }

  final PrivacyRepository _repository;

  Future<void> refresh() async {
    try {
      final lockConfigured = await _repository.hasChatLockPassword();
      final hiddenConfigured = await _repository.hasHiddenChatsPassword();
      final lockedIds = await _repository.lockedConversationIds();
      final hiddenIds = await _repository.hiddenConversationIds();
      state = state.copyWith(
        loading: false,
        chatLockConfigured: lockConfigured,
        hiddenPasswordConfigured: hiddenConfigured,
        lockedConversationIds: lockedIds,
        hiddenConversationIds: hiddenIds,
        clearError: true,
      );
    } catch (error) {
      state = state.copyWith(loading: false, error: error.toString());
    }
  }

  Future<void> setChatLockPassword(String password) async {
    await _repository.setChatLockPassword(password);
    state = state.copyWith(chatLockConfigured: true);
  }

  Future<void> setHiddenPassword(String password) async {
    await _repository.setHiddenChatsPassword(password);
    state = state.copyWith(hiddenPasswordConfigured: true);
  }

  Future<bool> unlockChatLock(String password) async {
    final ok = await _repository.verifyChatLockPassword(password);
    if (!ok) return false;
    state = state.copyWith(
      chatUnlockUntil: DateTime.now().add(const Duration(minutes: 10)),
    );
    return true;
  }

  Future<bool> unlockHidden(String password) async {
    final ok = await _repository.verifyHiddenChatsPassword(password);
    if (!ok) return false;
    state = state.copyWith(
      hiddenUnlockUntil: DateTime.now().add(const Duration(minutes: 10)),
    );
    return true;
  }

  void lockSessions() {
    state = state.copyWith(
      chatUnlockUntil: DateTime.fromMillisecondsSinceEpoch(0),
      hiddenUnlockUntil: DateTime.fromMillisecondsSinceEpoch(0),
    );
  }

  Future<void> setConversationLocked({
    required String conversationId,
    required bool locked,
  }) async {
    await _repository.setConversationLocked(conversationId, locked);
    final next = Set<String>.from(state.lockedConversationIds);
    if (locked) {
      next.add(conversationId);
    } else {
      next.remove(conversationId);
    }
    state = state.copyWith(lockedConversationIds: next);
  }

  Future<void> setConversationHidden({
    required String conversationId,
    required bool hidden,
  }) async {
    await _repository.setConversationHidden(conversationId, hidden);
    final next = Set<String>.from(state.hiddenConversationIds);
    if (hidden) {
      next.add(conversationId);
    } else {
      next.remove(conversationId);
    }
    state = state.copyWith(hiddenConversationIds: next);
  }

  Future<String> issueResetToken({
    required String type,
    required String email,
  }) async {
    return _repository.issueResetToken(type: type, email: email);
  }

  Future<bool> applyResetToken({
    required String type,
    required String email,
    required String token,
    required String newPassword,
  }) async {
    final ok = await _repository.applyResetToken(
      type: type,
      email: email,
      token: token,
      newPassword: newPassword,
    );
    if (ok) await refresh();
    return ok;
  }
}
