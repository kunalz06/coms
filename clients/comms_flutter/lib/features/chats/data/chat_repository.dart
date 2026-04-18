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
  static const _pollInterval = Duration(seconds: 4);

  Stream<List<Conversation>> watchConversations(String userId) {
    return _resilientStream<List<Conversation>>(
      realtime: () => _supabase
          .from('conversations')
          .stream(primaryKey: ['id'])
          .order('last_message_at')
          .map((rows) => rows
              .where((row) =>
                  row['type'] == 'group' ||
                  row['user_one_id'] == userId ||
                  row['user_two_id'] == userId)
              .map((row) => Conversation.fromJson(Map<String, dynamic>.from(row)))
              .toList(growable: false)
            ..sort((a, b) => (b.lastMessageAt ?? b.updatedAt)
                .compareTo(a.lastMessageAt ?? a.updatedAt))),
      poll: () => _fetchConversations(userId),
      equals: _conversationListEquals,
    );
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
    if (lastReadAt == null) return 0;

    final messages = await _supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .neq('sender_id', userId)
        .gt('created_at', lastReadAt.toIso8601String());
    return messages.length;
  }

  Future<void> markRead({
    required String conversationId,
    required String userId,
  }) async {
    await _supabase.from('conversation_members').upsert(
      {
        'conversation_id': conversationId,
        'user_id': userId,
        'role': 'member',
        'last_read_at': DateTime.now().toUtc().toIso8601String(),
      },
      onConflict: 'conversation_id,user_id',
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

    final members = <ConversationMember>[];
    for (final userId in userIds) {
      final profileData = await _supabase
          .from('user_profiles')
          .select()
          .eq('id', userId)
          .maybeSingle();
      final profile = profileData == null
          ? null
          : UserProfile.fromJson(Map<String, dynamic>.from(profileData));
      members.add(
        ConversationMember(
          id: '$conversationId-$userId',
          conversationId: conversationId,
          userId: userId,
          role: 'member',
          joinedAt: conversation.createdAt,
          profile: profile,
        ),
      );
    }
    return members;
  }

  Stream<List<Message>> watchMessages(String conversationId) {
    return _resilientStream<List<Message>>(
      realtime: () => _supabase
          .from('messages')
          .stream(primaryKey: ['id'])
          .eq('conversation_id', conversationId)
          .order('created_at')
          .asyncMap((_) => _fetchMessages(conversationId)),
      poll: () => _fetchMessages(conversationId),
      equals: _messageListEquals,
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

  Future<List<Conversation>> _fetchConversations(String userId) async {
    final rows =
        await _supabase.from('conversations').select().order('last_message_at');
    final conversations = rows
        .where((row) =>
            row['type'] == 'group' ||
            row['user_one_id'] == userId ||
            row['user_two_id'] == userId)
        .map((row) => Conversation.fromJson(Map<String, dynamic>.from(row)))
        .toList(growable: false)
      ..sort((a, b) => (b.lastMessageAt ?? b.updatedAt)
          .compareTo(a.lastMessageAt ?? a.updatedAt));
    return conversations;
  }

  Future<Conversation?> _fetchConversation(String conversationId) async {
    final row = await _supabase
        .from('conversations')
        .select()
        .eq('id', conversationId)
        .maybeSingle();
    if (row == null) return null;
    return Conversation.fromJson(Map<String, dynamic>.from(row));
  }

  Future<List<ConversationMember>> _fetchMembers(String conversationId) async {
    final rows = await _supabase
        .from('conversation_members')
        .select()
        .eq('conversation_id', conversationId)
        .order('joined_at');
    final members = rows
        .map((row) => Map<String, dynamic>.from(row))
        .toList(growable: false);
    if (members.isEmpty) {
      return _directConversationMembers(conversationId);
    }

    final profiles = <String, UserProfile>{};
    for (final member in members) {
      final userId = member['user_id'] as String?;
      if (userId == null || profiles.containsKey(userId)) continue;
      final data =
          await _supabase.from('user_profiles').select().eq('id', userId).maybeSingle();
      if (data != null) {
        profiles[userId] = UserProfile.fromJson(Map<String, dynamic>.from(data));
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
    final rows = await _supabase
        .from('messages')
        .select()
        .eq('conversation_id', conversationId)
        .order('created_at');
    final messages = <Message>[];
    for (final row in rows) {
      final messageRow = Map<String, dynamic>.from(row);
      final attachments = await _supabase
          .from('message_attachments')
          .select()
          .eq('message_id', messageRow['id'] as String)
          .order('created_at');
      final reactions = await _supabase
          .from('message_reactions')
          .select()
          .eq('message_id', messageRow['id'] as String)
          .order('created_at');
      messageRow['message_attachments'] = attachments;
      messageRow['message_reactions'] = reactions;
      messages.add(Message.fromJson(messageRow));
    }
    return messages;
  }

  Stream<T> _resilientStream<T>({
    required Stream<T> Function() realtime,
    required Future<T> Function() poll,
    required bool Function(T previous, T next) equals,
  }) {
    final controller = StreamController<T>();
    StreamSubscription<T>? realtimeSub;
    Timer? pollTimer;
    T? lastValue;

    Future<void> emitPolled() async {
      final next = await poll();
      if (lastValue != null && equals(lastValue as T, next)) return;
      lastValue = next;
      if (!controller.isClosed) controller.add(next);
    }

    Future<void> startPolling() async {
      try {
        await emitPolled();
      } catch (error, stack) {
        if (!controller.isClosed && lastValue == null) {
          controller.addError(error, stack);
        }
      }

      pollTimer ??= Timer.periodic(_pollInterval, (_) {
        emitPolled().catchError((error, stack) {
          if (!controller.isClosed && lastValue == null) {
            controller.addError(error, stack);
          }
        });
      });
    }

    void onRealtimeError(Object error, StackTrace stack) {
      // Realtime may fail due transient websocket/network issues. Keep chat
      // usable through polling and only surface non-timeout errors when no
      // prior data has been loaded.
      if (!controller.isClosed &&
          lastValue == null &&
          !_isRealtimeTimeoutError(error)) {
        controller.addError(error, stack);
      }
      startPolling().catchError((pollError, pollStack) {
        if (!controller.isClosed && lastValue == null) {
          controller.addError(pollError, pollStack);
        }
      });
    }

    void startRealtime() {
      try {
        realtimeSub = realtime().listen(
          (event) {
            if (lastValue != null && equals(lastValue as T, event)) return;
            lastValue = event;
            if (!controller.isClosed) controller.add(event);
          },
          onError: onRealtimeError,
        );
      } catch (error, stack) {
        onRealtimeError(error, stack);
      }
    }

    controller.onListen = () async {
      startRealtime();
      await startPolling();
    };

    controller.onCancel = () async {
      await realtimeSub?.cancel();
      pollTimer?.cancel();
    };

    return controller.stream;
  }
}

bool _isRealtimeTimeoutError(Object error) {
  if (error is RealtimeSubscribeException) {
    return error.status == RealtimeSubscribeStatus.timedOut;
  }
  return error.toString().contains('RealtimeSubscribeStatus.timedOut');
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
