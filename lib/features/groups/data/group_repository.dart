import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../shared/models/conversation.dart';
import '../../../shared/models/user_profile.dart';

final groupRepositoryProvider = Provider<GroupRepository>((ref) {
  return GroupRepository(Supabase.instance.client);
});

class GroupRepository {
  GroupRepository(this._supabase);

  static const maxMembers = 10;

  final SupabaseClient _supabase;

  Future<List<UserProfile>> findProfilesByEmails(List<String> emails) async {
    final normalized = emails
        .map((email) => email.trim().toLowerCase())
        .where((email) => email.isNotEmpty)
        .toSet()
        .toList();

    if (normalized.isEmpty) return const [];

    final profiles = <UserProfile>[];
    for (final email in normalized) {
      final data = await _supabase
          .from('user_profiles')
          .select()
          .ilike('email', email)
          .maybeSingle();
      if (data != null) {
        profiles.add(UserProfile.fromJson(Map<String, dynamic>.from(data)));
      }
    }
    return profiles;
  }

  Future<Conversation> createGroup({
    required String creatorId,
    required String title,
    required List<String> memberIds,
  }) async {
    final cleanTitle = title.trim();
    if (cleanTitle.length < 2) {
      throw const FormatException('Group name must be at least 2 characters.');
    }

    final users = <String>{creatorId, ...memberIds};
    if (users.length < 2) {
      throw const FormatException('Add at least one other COMMS user.');
    }
    if (users.length > maxMembers) {
      throw const FormatException('Groups are limited to 10 members for now.');
    }

    final conversationData = await _supabase
        .from('conversations')
        .insert({
          'type': 'group',
          'title': cleanTitle,
          'created_by': creatorId,
        })
        .select()
        .single();

    final conversation =
        Conversation.fromJson(Map<String, dynamic>.from(conversationData));

    await _supabase.from('conversation_members').insert(
          users
              .map(
                (userId) => {
                  'conversation_id': conversation.id,
                  'user_id': userId,
                  'role': userId == creatorId ? 'owner' : 'member',
                },
              )
              .toList(),
        );

    return conversation;
  }

  Future<void> updateGroupProfile({
    required String conversationId,
    String? title,
    String? avatarUrl,
  }) async {
    final payload = <String, dynamic>{};
    if (title != null && title.trim().isNotEmpty) {
      payload['title'] = title.trim();
    }
    if (avatarUrl != null) {
      payload['avatar_url'] =
          avatarUrl.trim().isEmpty ? null : avatarUrl.trim();
    }
    if (payload.isEmpty) return;
    await _supabase
        .from('conversations')
        .update(payload)
        .eq('id', conversationId);
  }

  Future<void> updateMemberRole({
    required String conversationId,
    required String userId,
    required String role,
  }) async {
    await _supabase
        .from('conversation_members')
        .update({'role': role})
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);
  }

  Future<void> addMembers({
    required String conversationId,
    required List<String> userIds,
  }) async {
    if (userIds.isEmpty) return;
    await _supabase.from('conversation_members').upsert(
          userIds
              .map((userId) => {
                    'conversation_id': conversationId,
                    'user_id': userId,
                    'role': 'member',
                  })
              .toList(growable: false),
          onConflict: 'conversation_id,user_id',
        );
  }

  Future<void> removeMember({
    required String conversationId,
    required String userId,
  }) async {
    await _supabase
        .from('conversation_members')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);
  }

  Future<void> leaveGroup({
    required String conversationId,
    required String userId,
  }) async {
    await removeMember(conversationId: conversationId, userId: userId);
  }

  Future<int> clearGroupMessages({
    required String conversationId,
  }) async {
    final result = await _supabase.rpc(
      'clear_group_messages_for_everyone',
      params: {
        'p_conversation_id': conversationId,
      },
    );
    return (result as num?)?.toInt() ?? 0;
  }

  Future<int> clearGroupMessagesInRange({
    required String conversationId,
    required DateTime startInclusive,
    required DateTime endInclusive,
  }) async {
    final start = DateTime(
      startInclusive.year,
      startInclusive.month,
      startInclusive.day,
    ).toUtc();
    final end = DateTime(
      endInclusive.year,
      endInclusive.month,
      endInclusive.day,
      23,
      59,
      59,
      999,
    ).toUtc();
    if (end.isBefore(start)) {
      throw const FormatException('End date cannot be before start date.');
    }

    final result = await _supabase.rpc(
      'clear_group_messages_for_everyone',
      params: {
        'p_conversation_id': conversationId,
        'p_start': start.toIso8601String(),
        'p_end': end.toIso8601String(),
      },
    );
    return (result as num?)?.toInt() ?? 0;
  }

  Future<void> deleteGroup({
    required String conversationId,
  }) async {
    await _supabase.from('conversations').delete().eq('id', conversationId);
  }
}
