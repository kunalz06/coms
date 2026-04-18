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
}
