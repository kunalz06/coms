import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/models/user_profile.dart';

final contactRepositoryProvider = Provider<ContactRepository>((ref) {
  return ContactRepository(
    Supabase.instance.client,
    ref.watch(apiClientProvider),
  );
});

class ContactRepository {
  ContactRepository(this._supabase, this._api);

  final SupabaseClient _supabase;
  final ApiClient _api;
  final _searchCache = <String, UserProfile?>{};

  Future<UserProfile?> searchByEmail(String email) async {
    final normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.contains('@')) return null;
    if (_searchCache.containsKey(normalizedEmail)) {
      return _searchCache[normalizedEmail];
    }
    final response = await _api.get<Map<String, dynamic>>(
      '/api/contacts/search',
      queryParameters: {'email': normalizedEmail},
    );
    final profile = response.data?['profile'];
    final result =
        profile is Map<String, dynamic> ? UserProfile.fromJson(profile) : null;
    _searchCache[normalizedEmail] = result;
    return result;
  }

  Future<void> addFriend({required String addresseeId}) async {
    await _api.post('/api/contacts/add', data: {'addresseeId': addresseeId});
  }

  Future<Conversation> getOrCreateDirectConversation(String otherUserId) async {
    final data = await _supabase.rpc('get_or_create_direct_conversation',
        params: {'other_user_id': otherUserId}).single();
    return Conversation.fromJson(Map<String, dynamic>.from(data));
  }

  Future<void> deleteFriend({
    required String currentUserId,
    required String otherUserId,
  }) async {
    final existing = await _friendshipBetween(currentUserId, otherUserId);
    if (existing == null) return;

    await _supabase
        .from('friendships')
        .update({'status': 'removed'}).eq('id', existing['id'] as String);
  }

  Future<void> blockUser({
    required String blockerId,
    required String blockedId,
  }) async {
    if (blockerId == blockedId) {
      throw const FormatException('You cannot block yourself.');
    }

    final existing = await _supabase
        .from('blocks')
        .select('id')
        .eq('blocker_id', blockerId)
        .eq('blocked_id', blockedId)
        .maybeSingle();

    if (existing == null) {
      await _supabase.from('blocks').insert({
        'blocker_id': blockerId,
        'blocked_id': blockedId,
      });
    }
    await deleteFriend(currentUserId: blockerId, otherUserId: blockedId);
  }

  Future<Map<String, dynamic>?> _friendshipBetween(
    String userOneId,
    String userTwoId,
  ) {
    return _supabase
        .from('friendships')
        .select('id')
        .or(
          'and(requester_id.eq.$userOneId,addressee_id.eq.$userTwoId),'
          'and(requester_id.eq.$userTwoId,addressee_id.eq.$userOneId)',
        )
        .maybeSingle();
  }
}
