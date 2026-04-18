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

  Stream<List<Conversation>> watchConversations(String userId) {
    final stream = _supabase
        .from('conversations')
        .stream(primaryKey: ['id']).order('last_message_at');
    return stream.map((rows) {
      return rows
          .where((row) =>
              row['type'] == 'group' ||
              row['user_one_id'] == userId ||
              row['user_two_id'] == userId)
          .map((row) => Conversation.fromJson(Map<String, dynamic>.from(row)))
          .toList()
        ..sort((a, b) => (b.lastMessageAt ?? b.updatedAt)
            .compareTo(a.lastMessageAt ?? a.updatedAt));
    });
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
    return _supabase
        .from('conversations')
        .stream(primaryKey: ['id'])
        .eq('id', conversationId)
        .map((rows) {
          if (rows.isEmpty) return null;
          return Conversation.fromJson(Map<String, dynamic>.from(rows.first));
        });
  }

  Stream<List<ConversationMember>> watchMembers(String conversationId) {
    return _supabase
        .from('conversation_members')
        .stream(primaryKey: ['id'])
        .eq('conversation_id', conversationId)
        .order('joined_at')
        .asyncMap((rows) async {
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
            final data = await _supabase
                .from('user_profiles')
                .select()
                .eq('id', userId)
                .maybeSingle();
            if (data != null) {
              profiles[userId] =
                  UserProfile.fromJson(Map<String, dynamic>.from(data));
            }
          }

          return members
              .map(
                (member) => ConversationMember.fromJson(
                  member,
                  profile: profiles[member['user_id'] as String?],
                ),
              )
              .toList(growable: false);
        });
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
    return _supabase
        .from('messages')
        .stream(primaryKey: ['id'])
        .eq('conversation_id', conversationId)
        .order('created_at')
        .asyncMap((rows) async {
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
        });
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
