import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../shared/models/conversation_member.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/models/message.dart';
import '../../../shared/models/user_profile.dart';

final chatRepositoryProvider = Provider<ChatRepository>((ref) {
  return ChatRepository(Supabase.instance.client);
});

class ChatRepository {
  ChatRepository(this._supabase);

  final SupabaseClient _supabase;
  static const _pollInterval = Duration(seconds: 8);
  static const _maxPollInterval = Duration(seconds: 45);
  static const _messageWindowSize = 150;

  Stream<List<Conversation>> watchConversations(String userId) {
    return _resilientStream<List<Conversation>>(
      realtime: () => _supabase
          .from('conversation_members')
          .stream(primaryKey: ['id'])
          .eq('user_id', userId)
          .asyncMap((_) => _fetchConversations(userId)),
      poll: () => _fetchConversations(userId),
      equals: _conversationListEquals,
      seed: const [],
    );
  }

  Future<List<Conversation>> fetchConversationsSnapshot(String userId) {
    return _withTransientRetry(() => _fetchConversations(userId));
  }

  Future<int> unreadCount({
    required String conversationId,
    required String userId,
  }) async {
    final membership = await _supabase
        .from('conversation_members')
        .select('last_read_at')
        .eq('conversation_id', conversationId)
        .eq('user_id', userId)
        .maybeSingle();

    final lastReadAt = membership == null
        ? null
        : DateTime.tryParse(membership['last_read_at']?.toString() ?? '');
    var query = _supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .neq('sender_id', userId)
        .isFilter('deleted_for_everyone_at', null);
    if (lastReadAt != null) {
      query = query.gt('created_at', lastReadAt.toIso8601String());
    }
    final messages = await query;
    return messages.length;
  }

  Stream<Set<String>> watchUnreadConversationIds(String userId) {
    return _resilientStream<Set<String>>(
      realtime: () => _supabase
          .from('conversation_members')
          .stream(primaryKey: ['id'])
          .eq('user_id', userId)
          .asyncMap((_) => _fetchUnreadConversationIds(userId)),
      poll: () => _fetchUnreadConversationIds(userId),
      equals: (a, b) => a.length == b.length && a.containsAll(b),
      seed: const <String>{},
    );
  }

  Future<void> markRead({
    required String conversationId,
    required String userId,
  }) async {
    await _supabase.rpc(
      'mark_conversation_read',
      params: {
        'p_conversation_id': conversationId,
        'p_read_at': DateTime.now().toUtc().toIso8601String(),
      },
    );
  }

  Stream<Conversation?> watchConversation(String conversationId) {
    return _resilientStream<Conversation?>(
      realtime: () => _supabase
          .from('conversations')
          .stream(primaryKey: ['id'])
          .eq('id', conversationId)
          .map((rows) {
            if (rows.isEmpty) return null;
            return Conversation.fromJson(Map<String, dynamic>.from(rows.first));
          }),
      poll: () => _fetchConversation(conversationId),
      equals: (a, b) => a?.id == b?.id && a?.updatedAt == b?.updatedAt,
      seed: null,
    );
  }

  Stream<List<ConversationMember>> watchMembers(String conversationId) {
    return _resilientStream<List<ConversationMember>>(
      realtime: () => _supabase
          .from('conversation_members')
          .stream(primaryKey: ['id'])
          .eq('conversation_id', conversationId)
          .order('joined_at')
          .asyncMap((_) => _fetchMembers(conversationId)),
      poll: () => _fetchMembers(conversationId),
      equals: _memberListEquals,
      seed: const [],
    );
  }

  Future<List<ConversationMember>> _directConversationMembers(
    String conversationId,
  ) async {
    final data = await _supabase
        .from('conversations')
        .select()
        .eq('id', conversationId)
        .maybeSingle();
    if (data == null) return const [];

    final conversation = Conversation.fromJson(Map<String, dynamic>.from(data));
    if (!conversation.isDirect) return const [];

    final userIds = [
      conversation.userOneId,
      conversation.userTwoId,
    ].whereType<String>().toList(growable: false);

    final profilesById = <String, UserProfile>{};
    if (userIds.isNotEmpty) {
      final profileRows = await _supabase
          .from('user_profiles')
          .select()
          .inFilter('id', userIds);
      for (final row in profileRows) {
        final profile = UserProfile.fromJson(Map<String, dynamic>.from(row));
        profilesById[profile.id] = profile;
      }
    }

    final members = userIds
        .map(
          (userId) => ConversationMember(
            id: '$conversationId-$userId',
            conversationId: conversationId,
            userId: userId,
            role: 'member',
            joinedAt: conversation.createdAt,
            profile: profilesById[userId],
          ),
        )
        .toList(growable: false);
    return members;
  }

  Stream<List<Message>> watchMessages(String conversationId) {
    return _resilientStream<List<Message>>(
      realtime: () => _supabase
          .from('messages')
          .stream(primaryKey: ['id'])
          .eq('conversation_id', conversationId)
          .order('created_at', ascending: false)
          .limit(_messageWindowSize)
          .asyncMap((_) => _fetchMessages(conversationId)),
      poll: () => _fetchMessages(conversationId),
      equals: _messageListEquals,
      seed: const [],
    );
  }

  Future<void> sendText({
    required String conversationId,
    required String senderId,
    required String content,
  }) async {
    final trimmed = content.trim();
    if (trimmed.isEmpty) return;
    await _supabase.from('messages').insert({
      'conversation_id': conversationId,
      'sender_id': senderId,
      'kind': 'text',
      'content': trimmed,
      'status': 'sent',
    });
  }

  Future<void> editMessage({
    required String messageId,
    required String content,
  }) async {
    final trimmed = content.trim();
    if (trimmed.isEmpty) return;
    await _supabase
        .from('messages')
        .update({'content': trimmed}).eq('id', messageId);
  }

  Future<void> deleteMessageForEveryone({
    required String messageId,
  }) async {
    await _supabase.from('messages').update({
      'deleted_for_everyone_at': DateTime.now().toUtc().toIso8601String(),
    }).eq('id', messageId);
  }

  Future<void> deleteMessageForMe({
    required String messageId,
    required String userId,
  }) async {
    await _supabase.from('message_deletions').upsert(
      {
        'message_id': messageId,
        'user_id': userId,
      },
      onConflict: 'message_id,user_id',
    );
  }

  Future<void> clearConversationForMe({
    required String conversationId,
    required String userId,
  }) async {
    final rows = await _supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId);
    final ids = rows
        .map((row) => row['id']?.toString())
        .whereType<String>()
        .toList(growable: false);
    if (ids.isEmpty) return;
    await _supabase.from('message_deletions').upsert(
          ids
              .map((id) => {
                    'message_id': id,
                    'user_id': userId,
                  })
              .toList(growable: false),
          onConflict: 'message_id,user_id',
        );
  }

  Future<void> clearConversationForEveryone({
    required String conversationId,
  }) async {
    await _supabase.from('messages').update({
      'deleted_for_everyone_at': DateTime.now().toUtc().toIso8601String(),
    }).eq('conversation_id', conversationId);
  }

  Future<void> setConversationPinned({
    required String conversationId,
    required String userId,
    required bool pinned,
  }) async {
    if (pinned) {
      await _supabase.from('conversation_pins').upsert(
        {
          'conversation_id': conversationId,
          'user_id': userId,
        },
        onConflict: 'conversation_id,user_id',
      );
      return;
    }
    await _supabase
        .from('conversation_pins')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);
  }

  Stream<Set<String>> watchPinnedConversationIds(String userId) {
    return _resilientStream<Set<String>>(
      realtime: () => _supabase
          .from('conversation_pins')
          .stream(primaryKey: ['id'])
          .eq('user_id', userId)
          .map((rows) => rows
              .map((row) => row['conversation_id']?.toString())
              .whereType<String>()
              .toSet()),
      poll: () async {
        final rows = await _supabase
            .from('conversation_pins')
            .select('conversation_id')
            .eq('user_id', userId);
        return rows
            .map((row) => row['conversation_id']?.toString())
            .whereType<String>()
            .toSet();
      },
      equals: (a, b) => a.length == b.length && a.containsAll(b),
      seed: const <String>{},
    );
  }

  Future<void> setConversationMuted({
    required String conversationId,
    required String userId,
    required bool muted,
  }) async {
    if (muted) {
      await _supabase.from('conversation_mutes').upsert(
        {
          'conversation_id': conversationId,
          'user_id': userId,
        },
        onConflict: 'conversation_id,user_id',
      );
      return;
    }
    await _supabase
        .from('conversation_mutes')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);
  }

  Stream<Set<String>> watchMutedConversationIds(String userId) {
    return _resilientStream<Set<String>>(
      realtime: () => _supabase
          .from('conversation_mutes')
          .stream(primaryKey: ['id'])
          .eq('user_id', userId)
          .map((rows) => rows
              .map((row) => row['conversation_id']?.toString())
              .whereType<String>()
              .toSet()),
      poll: () async {
        final rows = await _supabase
            .from('conversation_mutes')
            .select('conversation_id')
            .eq('user_id', userId);
        return rows
            .map((row) => row['conversation_id']?.toString())
            .whereType<String>()
            .toSet();
      },
      equals: (a, b) => a.length == b.length && a.containsAll(b),
      seed: const <String>{},
    );
  }

  Future<void> sendAttachment({
    required String conversationId,
    required String senderId,
    required String kind,
    required AttachmentDraft attachment,
  }) async {
    final message = await _supabase
        .from('messages')
        .insert({
          'conversation_id': conversationId,
          'sender_id': senderId,
          'kind': kind,
          'content': attachment.fileName,
          'status': 'sent',
        })
        .select('id')
        .single();

    await _supabase.from('message_attachments').insert({
      'message_id': message['id'] as String,
      'url': attachment.url,
      'public_id': attachment.publicId,
      'resource_type': attachment.resourceType,
      'file_name': attachment.fileName,
      'mime_type': attachment.mimeType,
      'size_bytes': attachment.sizeBytes,
    });
  }

  Future<void> reactToMessage({
    required String messageId,
    required String userId,
    required String content,
    required String kind,
  }) async {
    final trimmed = content.trim();
    if (trimmed.isEmpty) return;
    await _supabase
        .from('message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', userId)
        .eq('kind', kind)
        .eq('content', trimmed);
    await _supabase.from('message_reactions').insert({
      'message_id': messageId,
      'user_id': userId,
      'kind': kind,
      'content': trimmed.length > 80 ? trimmed.substring(0, 80) : trimmed,
    });
  }

  Future<void> removeReaction({
    required String messageId,
    required String userId,
    required String content,
    required String kind,
  }) async {
    final trimmed = content.trim();
    if (trimmed.isEmpty) return;
    await _supabase
        .from('message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', userId)
        .eq('kind', kind)
        .eq('content', trimmed);
  }

  Future<void> shareMessageToConversation({
    required Message message,
    required String targetConversationId,
    required String senderId,
  }) async {
    if (message.kind == 'text' &&
        (message.content?.trim().isNotEmpty ?? false)) {
      await sendText(
        conversationId: targetConversationId,
        senderId: senderId,
        content: message.content!,
      );
      return;
    }

    if (message.attachments.isEmpty) return;
    for (final attachment in message.attachments) {
      await sendAttachment(
        conversationId: targetConversationId,
        senderId: senderId,
        kind: message.kind,
        attachment: AttachmentDraft(
          url: attachment.url,
          publicId: attachment.publicId ?? '',
          resourceType: attachment.resourceType,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
        ),
      );
    }
  }

  Future<List<Conversation>> _fetchConversations(String userId) async {
    final conversationIds = <String>{};

    final memberRows = await _withTransientRetry(
      () => _supabase
          .from('conversation_members')
          .select('conversation_id')
          .eq('user_id', userId),
    );
    for (final row in memberRows) {
      final id = row['conversation_id']?.toString();
      if (id != null && id.isNotEmpty) conversationIds.add(id);
    }

    final directRows = await _withTransientRetry(
      () => _supabase
          .from('conversations')
          .select('id')
          .eq('type', 'direct')
          .or('user_one_id.eq.$userId,user_two_id.eq.$userId'),
    );
    for (final row in directRows) {
      final id = row['id']?.toString();
      if (id != null && id.isNotEmpty) conversationIds.add(id);
    }

    if (conversationIds.isEmpty) return const [];

    final rows = await _withTransientRetry(
      () => _supabase
          .from('conversations')
          .select()
          .inFilter('id', conversationIds.toList(growable: false)),
    );

    final rawConversations = <Conversation>[];
    for (final row in rows) {
      try {
        rawConversations
            .add(Conversation.fromJson(Map<String, dynamic>.from(row)));
      } catch (_) {
        // Skip malformed rows to keep the list usable.
      }
    }

    final profileNames = <String, String>{};
    final profileAvatars = <String, String?>{};
    final directPeerIds = rawConversations
        .where((conversation) => conversation.isDirect)
        .map((conversation) => conversation.userOneId == userId
            ? conversation.userTwoId
            : conversation.userOneId)
        .whereType<String>()
        .toSet()
        .toList(growable: false);
    if (directPeerIds.isNotEmpty) {
      final profileRows = await _withTransientRetry(
        () => _supabase
            .from('user_profiles')
            .select('id,full_name,avatar_url')
            .inFilter('id', directPeerIds),
      );
      for (final row in profileRows) {
        final id = row['id']?.toString();
        final fullName = row['full_name']?.toString();
        if (id != null && fullName != null && fullName.trim().isNotEmpty) {
          profileNames[id] = fullName.trim();
        }
        if (id != null) {
          final avatar = row['avatar_url']?.toString();
          profileAvatars[id] =
              (avatar == null || avatar.trim().isEmpty) ? null : avatar.trim();
        }
      }
    }

    final conversations = rawConversations.map((conversation) {
      if (conversation.isGroup) return conversation;
      final peerId = conversation.userOneId == userId
          ? conversation.userTwoId
          : conversation.userOneId;
      final resolvedTitle = peerId == null
          ? (conversation.title ?? 'Direct chat')
          : (profileNames[peerId] ?? conversation.title ?? 'Direct chat');
      final resolvedAvatar = peerId == null
          ? conversation.avatarUrl
          : (profileAvatars[peerId] ?? conversation.avatarUrl);
      return Conversation(
        id: conversation.id,
        type: conversation.type,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        title: resolvedTitle,
        avatarUrl: resolvedAvatar,
        createdBy: conversation.createdBy,
        userOneId: conversation.userOneId,
        userTwoId: conversation.userTwoId,
        lastMessageAt: conversation.lastMessageAt,
      );
    }).toList(growable: false);

    conversations.sort((a, b) => (b.lastMessageAt ?? b.updatedAt)
        .compareTo(a.lastMessageAt ?? a.updatedAt));
    return conversations;
  }

  Future<Set<String>> _fetchUnreadConversationIds(String userId) async {
    final conversationIds = await _fetchConversationIdsForUser(userId);
    if (conversationIds.isEmpty) return const {};

    final memberships = await _withTransientRetry(
      () => _supabase
          .from('conversation_members')
          .select('conversation_id,last_read_at')
          .eq('user_id', userId)
          .inFilter('conversation_id', conversationIds),
    );
    final lastReadByConversationId = <String, DateTime?>{};
    for (final conversationId in conversationIds) {
      lastReadByConversationId[conversationId] = null;
    }
    for (final row in memberships) {
      final conversationId = row['conversation_id']?.toString();
      if (conversationId == null || conversationId.isEmpty) continue;
      lastReadByConversationId[conversationId] =
          DateTime.tryParse(row['last_read_at']?.toString() ?? '');
    }

    if (lastReadByConversationId.isEmpty) return const {};
    final trackedIds = conversationIds;

    final messages = await _withTransientRetry(
      () => _supabase
          .from('messages')
          .select('conversation_id,created_at,sender_id')
          .inFilter('conversation_id', trackedIds)
          .neq('sender_id', userId)
          .isFilter('deleted_for_everyone_at', null),
    );

    final unread = <String>{};
    for (final row in messages) {
      final conversationId = row['conversation_id']?.toString();
      if (conversationId == null || conversationId.isEmpty) continue;
      final createdAt = DateTime.tryParse(row['created_at']?.toString() ?? '');
      if (createdAt == null) continue;
      final lastRead = lastReadByConversationId[conversationId];
      if (lastRead == null || createdAt.isAfter(lastRead)) {
        unread.add(conversationId);
      }
    }
    return unread;
  }

  Future<List<String>> _fetchConversationIdsForUser(String userId) async {
    final ids = <String>{};

    final memberRows = await _withTransientRetry(
      () => _supabase
          .from('conversation_members')
          .select('conversation_id')
          .eq('user_id', userId),
    );
    for (final row in memberRows) {
      final id = row['conversation_id']?.toString();
      if (id != null && id.isNotEmpty) ids.add(id);
    }

    final directRows = await _withTransientRetry(
      () => _supabase
          .from('conversations')
          .select('id')
          .eq('type', 'direct')
          .or('user_one_id.eq.$userId,user_two_id.eq.$userId'),
    );
    for (final row in directRows) {
      final id = row['id']?.toString();
      if (id != null && id.isNotEmpty) ids.add(id);
    }

    return ids.toList(growable: false);
  }

  Future<Conversation?> _fetchConversation(String conversationId) async {
    final row = await _withTransientRetry(
      () => _supabase
          .from('conversations')
          .select()
          .eq('id', conversationId)
          .maybeSingle(),
    );
    if (row == null) return null;
    return Conversation.fromJson(Map<String, dynamic>.from(row));
  }

  Future<List<ConversationMember>> _fetchMembers(String conversationId) async {
    final rows = await _withTransientRetry(
      () => _supabase
          .from('conversation_members')
          .select()
          .eq('conversation_id', conversationId)
          .order('joined_at'),
    );
    final members = rows
        .map((row) => Map<String, dynamic>.from(row))
        .toList(growable: false);
    if (members.isEmpty) {
      return _directConversationMembers(conversationId);
    }

    final profiles = <String, UserProfile>{};
    final userIds = members
        .map((member) => member['user_id']?.toString())
        .whereType<String>()
        .toSet()
        .toList(growable: false);
    if (userIds.isNotEmpty) {
      final profileRows = await _withTransientRetry(
        () => _supabase.from('user_profiles').select().inFilter('id', userIds),
      );
      for (final row in profileRows) {
        final profile = UserProfile.fromJson(Map<String, dynamic>.from(row));
        profiles[profile.id] = profile;
      }
    }

    return members
        .map((member) => ConversationMember.fromJson(
              member,
              profile: profiles[member['user_id'] as String?],
            ))
        .toList(growable: false);
  }

  Future<List<Message>> _fetchMessages(String conversationId) async {
    final rows = await _withTransientRetry(
      () => _supabase
          .from('messages')
          .select()
          .eq('conversation_id', conversationId)
          .order('created_at', ascending: false)
          .limit(_messageWindowSize),
    );
    if (rows.isEmpty) return const [];

    final messageRows = rows
        .map((row) => Map<String, dynamic>.from(row))
        .toList(growable: false);
    final messageIds = messageRows
        .map((row) => row['id']?.toString())
        .whereType<String>()
        .toList(growable: false);

    final attachmentsRows = await _withTransientRetry(
      () => _supabase
          .from('message_attachments')
          .select()
          .inFilter('message_id', messageIds)
          .order('created_at'),
    );
    final reactionsRows = await _withTransientRetry(
      () => _supabase
          .from('message_reactions')
          .select()
          .inFilter('message_id', messageIds)
          .order('created_at'),
    );

    final attachmentsByMessage = <String, List<Map<String, dynamic>>>{};
    for (final row in attachmentsRows) {
      final data = Map<String, dynamic>.from(row);
      final messageId = data['message_id']?.toString();
      if (messageId == null) continue;
      (attachmentsByMessage[messageId] ??= []).add(data);
    }

    final reactionsByMessage = <String, List<Map<String, dynamic>>>{};
    for (final row in reactionsRows) {
      final data = Map<String, dynamic>.from(row);
      final messageId = data['message_id']?.toString();
      if (messageId == null) continue;
      (reactionsByMessage[messageId] ??= []).add(data);
    }

    final messages = <Message>[];
    for (final messageRow in messageRows) {
      final messageId = messageRow['id']?.toString();
      messageRow['message_attachments'] = messageId == null
          ? const []
          : (attachmentsByMessage[messageId] ?? const []);
      messageRow['message_reactions'] = messageId == null
          ? const []
          : (reactionsByMessage[messageId] ?? const []);
      messages.add(Message.fromJson(messageRow));
    }
    messages.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    return messages;
  }

  Stream<T> _resilientStream<T>({
    required Stream<T> Function() realtime,
    required Future<T> Function() poll,
    required bool Function(T previous, T next) equals,
    required T seed,
  }) {
    final controller = StreamController<T>();
    StreamSubscription<T>? realtimeSub;
    Timer? pollTimer;
    T lastValue = seed;
    Duration activePollInterval = _pollInterval;
    var realtimeHealthy = false;
    var initialValueEmitted = false;

    Future<void> emitPolled() async {
      final next = await _withTransientRetry(poll);
      if (equals(lastValue, next)) return;
      lastValue = next;
      if (!controller.isClosed) controller.add(next);
      initialValueEmitted = true;
    }

    Future<void> startPolling({bool immediate = false}) async {
      if (pollTimer != null) return;

      if (immediate) {
        try {
          await emitPolled();
          activePollInterval = _pollInterval;
        } catch (_) {}
      }

      pollTimer = Timer.periodic(activePollInterval, (_) async {
        try {
          await emitPolled();
          activePollInterval = _pollInterval;
        } catch (error, stack) {
          if (!controller.isClosed &&
              !initialValueEmitted &&
              !_isTransientNetworkError(error)) {
            controller.addError(error, stack);
          }
          final nextSeconds = (activePollInterval.inSeconds * 2)
              .clamp(_pollInterval.inSeconds, _maxPollInterval.inSeconds)
              .toInt();
          activePollInterval = Duration(seconds: nextSeconds);
          pollTimer?.cancel();
          pollTimer = null;
          if (!controller.isClosed) {
            await startPolling();
          }
        }
      });
    }

    void stopPolling() {
      pollTimer?.cancel();
      pollTimer = null;
      activePollInterval = _pollInterval;
    }

    Future<void> emitInitialValue() async {
      try {
        await emitPolled();
      } catch (error, stack) {
        if (!controller.isClosed && !_isTransientNetworkError(error)) {
          controller.addError(error, stack);
        }
      }
    }

    void onRealtimeError(Object error, StackTrace stack) {
      // Realtime may fail due transient websocket/network issues. Keep chat
      // usable through polling and only surface non-timeout errors when no
      // prior data has been loaded.
      realtimeHealthy = false;
      if (!controller.isClosed &&
          !initialValueEmitted &&
          !_isRealtimeTimeoutError(error)) {
        controller.addError(error, stack);
      }
      startPolling(immediate: true).catchError((pollError, pollStack) {
        if (!controller.isClosed && !initialValueEmitted) {
          controller.addError(pollError, pollStack);
        }
      });
    }

    void startRealtime() {
      try {
        realtimeSub = realtime().listen(
          (event) {
            realtimeHealthy = true;
            stopPolling();
            if (equals(lastValue, event)) return;
            lastValue = event;
            if (!controller.isClosed) controller.add(event);
            initialValueEmitted = true;
          },
          onError: onRealtimeError,
        );
      } catch (error, stack) {
        onRealtimeError(error, stack);
      }
    }

    controller.onListen = () async {
      if (!controller.isClosed) {
        controller.add(seed);
      }
      startRealtime();
      await emitInitialValue();
      if (!realtimeHealthy) {
        await startPolling();
      }
    };

    controller.onCancel = () async {
      await realtimeSub?.cancel();
      stopPolling();
    };

    return controller.stream;
  }

  Future<T> _withTransientRetry<T>(
    Future<T> Function() operation, {
    int maxAttempts = 3,
  }) async {
    Object? lastError;
    StackTrace? lastStack;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error, stack) {
        lastError = error;
        lastStack = stack;
        final shouldRetry =
            _isTransientNetworkError(error) && attempt < maxAttempts;
        if (!shouldRetry) rethrow;
        final delayMs = (250 * attempt * attempt).clamp(250, 2000);
        await Future<void>.delayed(Duration(milliseconds: delayMs));
      }
    }

    Error.throwWithStackTrace(
      lastError ?? StateError('Transient retry failed'),
      lastStack ?? StackTrace.current,
    );
  }
}

bool _isRealtimeTimeoutError(Object error) {
  if (error is RealtimeSubscribeException) {
    return error.status == RealtimeSubscribeStatus.timedOut;
  }
  return error.toString().contains('RealtimeSubscribeStatus.timedOut');
}

bool _isTransientNetworkError(Object error) {
  if (error is PostgrestException) {
    final message = error.message.toLowerCase();
    return message.contains('connection closed') ||
        message.contains('connection terminated') ||
        message.contains('timeout') ||
        message.contains('econnreset');
  }
  final text = error.toString().toLowerCase();
  return text.contains('err_connection_closed') ||
      text.contains('connection closed') ||
      text.contains('connection terminated') ||
      text.contains('network is unreachable') ||
      text.contains('timeout');
}

bool _conversationListEquals(List<Conversation> a, List<Conversation> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i].id != b[i].id ||
        a[i].updatedAt != b[i].updatedAt ||
        a[i].lastMessageAt != b[i].lastMessageAt) {
      return false;
    }
  }
  return true;
}

bool _memberListEquals(List<ConversationMember> a, List<ConversationMember> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i].id != b[i].id ||
        a[i].role != b[i].role ||
        a[i].profile?.updatedAt != b[i].profile?.updatedAt) {
      return false;
    }
  }
  return true;
}

bool _messageListEquals(List<Message> a, List<Message> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i].id != b[i].id ||
        a[i].updatedAt != b[i].updatedAt ||
        a[i].archiveStatus != b[i].archiveStatus ||
        a[i].attachments.length != b[i].attachments.length ||
        a[i].reactions.length != b[i].reactions.length) {
      return false;
    }
  }
  return true;
}

class AttachmentDraft {
  const AttachmentDraft({
    required this.url,
    required this.publicId,
    required this.resourceType,
    required this.fileName,
    required this.mimeType,
    required this.sizeBytes,
  });

  final String url;
  final String publicId;
  final String resourceType;
  final String fileName;
  final String mimeType;
  final int sizeBytes;
}
