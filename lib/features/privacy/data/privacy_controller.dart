import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import 'privacy_repository.dart';

final privacyRepositoryProvider = Provider<PrivacyRepository>((ref) {
  return PrivacyRepository(ref.watch(apiClientProvider));
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

  Future<bool> changeChatLockPassword({
    required String oldPassword,
    required String newPassword,
  }) async {
    final ok = await _repository.changeChatLockPassword(
      oldPassword: oldPassword,
      newPassword: newPassword,
    );
    if (ok) state = state.copyWith(chatLockConfigured: true);
    return ok;
  }

  Future<void> setHiddenPassword(String password) async {
    await _repository.setHiddenChatsPassword(password);
    state = state.copyWith(hiddenPasswordConfigured: true);
  }

  Future<bool> changeHiddenPassword({
    required String oldPassword,
    required String newPassword,
  }) async {
    final ok = await _repository.changeHiddenChatsPassword(
      oldPassword: oldPassword,
      newPassword: newPassword,
    );
    if (ok) state = state.copyWith(hiddenPasswordConfigured: true);
    return ok;
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
    if (locked && !state.chatLockConfigured) {
      throw StateError('Set a chat lock password before locking chats.');
    }
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
    if (hidden && !state.hiddenPasswordConfigured) {
      throw StateError('Set a hidden chats password before hiding chats.');
    }
    await _repository.setConversationHidden(conversationId, hidden);
    final next = Set<String>.from(state.hiddenConversationIds);
    if (hidden) {
      next.add(conversationId);
    } else {
      next.remove(conversationId);
    }
    state = state.copyWith(hiddenConversationIds: next);
  }

  Future<void> sendResetOtp({
    required String type,
  }) async {
    if (type == 'lock' && !state.chatLockConfigured) {
      throw StateError('Set a chat lock password before resetting it.');
    }
    if (type == 'hidden' && !state.hiddenPasswordConfigured) {
      throw StateError('Set a hidden chats password before resetting it.');
    }
    await _repository.sendResetOtp(type: type);
  }

  Future<bool> applyResetOtp({
    required String type,
    required String otp,
    required String newPassword,
  }) async {
    final ok = await _repository.applyResetOtp(
      type: type,
      otp: otp,
      newPassword: newPassword,
    );
    if (ok) await refresh();
    return ok;
  }
}
