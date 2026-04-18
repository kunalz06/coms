import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../shared/models/conversation.dart';
import '../../../shared/models/user_profile.dart';

final contactRepositoryProvider = Provider<ContactRepository>((ref) {
  return ContactRepository(Supabase.instance.client);
});

class ContactRepository {
  ContactRepository(this._supabase);

  final SupabaseClient _supabase;

  Future<UserProfile?> searchByEmail(String email) async {
    final data = await _supabase
        .from('user_profiles')
        .select()
        .ilike('email', email.trim())
        .maybeSingle();
    if (data == null) return null;
    return UserProfile.fromJson(Map<String, dynamic>.from(data));
  }

  Future<void> addFriend({
    required String requesterId,
    required String addresseeId,
  }) async {
    if (requesterId == addresseeId) {
      throw const FormatException('Choose another COMMS user.');
    }

    final existing = await _supabase
        .from('friendships')
        .select('id')
        .or(
          'and(requester_id.eq.$requesterId,addressee_id.eq.$addresseeId),'
          'and(requester_id.eq.$addresseeId,addressee_id.eq.$requesterId)',
        )
        .maybeSingle();

    if (existing != null) {
      await _supabase
          .from('friendships')
          .update({'status': 'accepted'}).eq('id', existing['id'] as String);
      return;
    }

    await _supabase.from('friendships').insert({
      'requester_id': requesterId,
      'addressee_id': addresseeId,
      'status': 'accepted',
    });
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
