import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'meeting_models.dart';

final meetingRepositoryProvider = Provider<MeetingRepository>((ref) {
  return MeetingRepository(Supabase.instance.client);
});

class MeetingRepository {
  MeetingRepository(this._supabase);

  final SupabaseClient _supabase;
  static const maxParticipants = 10;

  Stream<List<Meeting>> watchMeetings(String userId) {
    return _supabase
        .from('meeting_participants')
        .stream(primaryKey: ['meeting_id', 'user_id'])
        .eq('user_id', userId)
        .asyncMap((_) => fetchMeetings(userId))
        .handleError((_) {});
  }

  Future<List<Meeting>> fetchMeetings(String userId) async {
    await _closeExpiredEmptyMeetings();
    final memberships = await _supabase
        .from('meeting_participants')
        .select('meeting_id')
        .eq('user_id', userId)
        .order('joined_at', ascending: false);
    final ids = memberships
        .map((row) => row['meeting_id']?.toString())
        .whereType<String>()
        .toSet()
        .toList(growable: false);
    if (ids.isEmpty) return const [];
    final rows = await _supabase
        .from('meetings')
        .select()
        .inFilter('id', ids)
        .order('updated_at', ascending: false);
    return rows
        .map((row) => Meeting.fromJson(Map<String, dynamic>.from(row)))
        .toList(growable: false);
  }

  Stream<Meeting?> watchMeeting(String meetingId) {
    return _supabase
        .from('meetings')
        .stream(primaryKey: ['id'])
        .eq('id', meetingId)
        .map((rows) => rows.isEmpty
            ? null
            : Meeting.fromJson(Map<String, dynamic>.from(rows.first)));
  }

  Future<Meeting?> fetchMeeting(String meetingId) async {
    final row =
        await _supabase.from('meetings').select().eq('id', meetingId).maybeSingle();
    return row == null ? null : Meeting.fromJson(Map<String, dynamic>.from(row));
  }

  Stream<List<MeetingParticipant>> watchParticipants(String meetingId) {
    return _supabase
        .from('meeting_participants')
        .stream(primaryKey: ['meeting_id', 'user_id'])
        .eq('meeting_id', meetingId)
        .asyncMap((_) => fetchParticipants(meetingId));
  }

  Future<List<MeetingParticipant>> fetchParticipants(String meetingId) async {
    final rows = await _supabase
        .from('meeting_participants')
        .select('*, user_profiles(full_name, avatar_url)')
        .eq('meeting_id', meetingId)
        .order('joined_at');
    return rows
        .map((row) => MeetingParticipant.fromJson(Map<String, dynamic>.from(row)))
        .toList(growable: false);
  }

  Stream<List<MeetingChatMessage>> watchChat(String meetingId) {
    return _supabase
        .from('meeting_chat_messages')
        .stream(primaryKey: ['id'])
        .eq('meeting_id', meetingId)
        .order('created_at')
        .asyncMap((_) => fetchChat(meetingId));
  }

  Future<List<MeetingChatMessage>> fetchChat(String meetingId) async {
    final rows = await _supabase
        .from('meeting_chat_messages')
        .select('*, user_profiles(full_name)')
        .eq('meeting_id', meetingId)
        .order('created_at');
    return rows
        .map((row) => MeetingChatMessage.fromJson(Map<String, dynamic>.from(row)))
        .toList(growable: false);
  }

  Stream<List<WhiteboardStroke>> watchStrokes(String meetingId) {
    return _supabase
        .from('meeting_whiteboard_strokes')
        .stream(primaryKey: ['id'])
        .eq('meeting_id', meetingId)
        .order('created_at')
        .asyncMap((_) => fetchStrokes(meetingId));
  }

  Future<List<WhiteboardStroke>> fetchStrokes(String meetingId) async {
    final rows = await _supabase
        .from('meeting_whiteboard_strokes')
        .select()
        .eq('meeting_id', meetingId)
        .order('created_at');
    return rows
        .map((row) => WhiteboardStroke.fromJson(Map<String, dynamic>.from(row)))
        .toList(growable: false);
  }

  Future<Meeting> createMeeting({
    required String creatorId,
    required String title,
  }) async {
    final row = await _supabase
        .from('meetings')
        .insert({
          'creator_id': creatorId,
          'title': title.trim().isEmpty ? 'COMMS meeting' : title.trim(),
          'status': 'created',
        })
        .select()
        .single();
    final meeting = Meeting.fromJson(Map<String, dynamic>.from(row));
    await _supabase.from('meeting_participants').upsert({
      'meeting_id': meeting.id,
      'user_id': creatorId,
      'role': 'creator',
      'left_at': null,
      'can_draw': true,
    });
    return meeting;
  }

  Future<void> joinMeeting({
    required String meetingId,
    required String userId,
  }) async {
    final meeting = await fetchMeeting(meetingId);
    if (meeting == null || meeting.isEnded) {
      throw StateError('This meeting is no longer available.');
    }
    final participants = await fetchParticipants(meetingId);
    final activeCount = participants.where((participant) => participant.isActive).length;
    final alreadyJoined = participants.any((participant) => participant.userId == userId);
    if (!alreadyJoined && activeCount >= maxParticipants) {
      throw StateError('This meeting is full. Meetings are limited to 10 people.');
    }
    await _supabase.from('meeting_participants').upsert({
      'meeting_id': meetingId,
      'user_id': userId,
      'role': alreadyJoined
          ? participants.firstWhere((participant) => participant.userId == userId).role
          : 'participant',
      'joined_at': DateTime.now().toUtc().toIso8601String(),
      'left_at': null,
      'hand_raised': false,
      'can_draw': alreadyJoined
          ? participants
              .firstWhere((participant) => participant.userId == userId)
              .canDraw
          : true,
    });
    await _supabase.from('meetings').update({
      'status': 'live',
      'started_at': DateTime.now().toUtc().toIso8601String(),
      'empty_since': null,
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    }).eq('id', meetingId).neq('status', 'ended');
  }

  Future<void> leaveMeeting({
    required String meetingId,
    required String userId,
  }) async {
    await _supabase
        .from('meeting_participants')
        .update({
          'left_at': DateTime.now().toUtc().toIso8601String(),
          'hand_raised': false,
        })
        .eq('meeting_id', meetingId)
        .eq('user_id', userId);
    final participants = await fetchParticipants(meetingId);
    if (participants.where((participant) => participant.isActive).isEmpty) {
      await _supabase.from('meetings').update({
        'empty_since': DateTime.now().toUtc().toIso8601String(),
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      }).eq('id', meetingId).neq('status', 'ended');
      unawaited(_closeEmptyMeetingAfterDelay(meetingId));
    }
  }

  Future<void> endMeeting({
    required String meetingId,
    required String userId,
  }) async {
    final participants = await fetchParticipants(meetingId);
    final me = participants.where((participant) => participant.userId == userId).firstOrNull;
    if (me == null || !me.isCreator) {
      throw StateError('Only the meeting creator or co-creators can end it.');
    }
    await _supabase.from('meetings').update({
      'status': 'ended',
      'ended_at': DateTime.now().toUtc().toIso8601String(),
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    }).eq('id', meetingId);
    await _supabase.from('meeting_chat_messages').delete().eq('meeting_id', meetingId);
    await _supabase.from('meeting_whiteboard_strokes').delete().eq('meeting_id', meetingId);
  }

  Future<void> assignCoCreator({
    required String meetingId,
    required String actorId,
    required String userId,
    required bool enabled,
  }) async {
    final participants = await fetchParticipants(meetingId);
    final actor = participants.where((participant) => participant.userId == actorId).firstOrNull;
    if (actor == null || !actor.isCreator) {
      throw StateError('Only creators can assign co-creators.');
    }
    final coCreatorCount = participants
        .where((participant) => participant.role == 'co_creator' && participant.userId != userId)
        .length;
    if (enabled && coCreatorCount >= 2) {
      throw StateError('A meeting can have only two co-creators.');
    }
    await _supabase
        .from('meeting_participants')
        .update({'role': enabled ? 'co_creator' : 'participant'})
        .eq('meeting_id', meetingId)
        .eq('user_id', userId);
  }

  Future<void> setDrawingAllowed({
    required String meetingId,
    required String actorId,
    required String userId,
    required bool canDraw,
  }) async {
    final actor = (await fetchParticipants(meetingId))
        .where((participant) => participant.userId == actorId)
        .firstOrNull;
    if (actor == null || !actor.isCreator) {
      throw StateError('Only creators can manage whiteboard permissions.');
    }
    await _supabase
        .from('meeting_participants')
        .update({'can_draw': canDraw})
        .eq('meeting_id', meetingId)
        .eq('user_id', userId);
  }

  Future<void> removeParticipant({
    required String meetingId,
    required String actorId,
    required String userId,
  }) async {
    final participants = await fetchParticipants(meetingId);
    final actor = participants
        .where((participant) => participant.userId == actorId)
        .firstOrNull;
    final target = participants
        .where((participant) => participant.userId == userId)
        .firstOrNull;
    if (actor == null || !actor.isCreator) {
      throw StateError('Only creators can remove people from a meeting.');
    }
    if (target == null) return;
    if (target.role == 'creator') {
      throw StateError('The meeting creator cannot be removed.');
    }
    await _supabase
        .from('meeting_participants')
        .update({
          'left_at': DateTime.now().toUtc().toIso8601String(),
          'hand_raised': false,
        })
        .eq('meeting_id', meetingId)
        .eq('user_id', userId);
  }

  Future<void> setHandRaised({
    required String meetingId,
    required String userId,
    required bool raised,
  }) async {
    await _supabase
        .from('meeting_participants')
        .update({'hand_raised': raised})
        .eq('meeting_id', meetingId)
        .eq('user_id', userId);
  }

  Future<void> sendChat({
    required String meetingId,
    required String senderId,
    required String content,
  }) async {
    final trimmed = content.trim();
    if (trimmed.isEmpty) return;
    final meeting = await fetchMeeting(meetingId);
    if (meeting == null || !meeting.isLive) return;
    await _supabase.from('meeting_chat_messages').insert({
      'meeting_id': meetingId,
      'sender_id': senderId,
      'content': trimmed,
    });
  }

  Future<void> addStroke({
    required String meetingId,
    required String userId,
    required List<WhiteboardPoint> points,
    required int color,
    required double width,
  }) async {
    if (points.length < 2) return;
    final meeting = await fetchMeeting(meetingId);
    if (meeting == null || !meeting.isLive) return;
    final participants = await fetchParticipants(meetingId);
    final me = participants.where((participant) => participant.userId == userId).firstOrNull;
    if (me == null || (!me.canDraw && !me.isCreator)) {
      throw StateError('Whiteboard drawing is disabled for you.');
    }
    await _supabase.from('meeting_whiteboard_strokes').insert({
      'meeting_id': meetingId,
      'user_id': userId,
      'points': points.map((point) => point.toJson()).toList(growable: false),
      'color': color,
      'width': width,
    });
  }

  Future<void> clearWhiteboard({
    required String meetingId,
    required String actorId,
  }) async {
    final actor = (await fetchParticipants(meetingId))
        .where((participant) => participant.userId == actorId)
        .firstOrNull;
    if (actor == null || !actor.isCreator) {
      throw StateError('Only creators can clear the whiteboard.');
    }
    await _supabase.from('meeting_whiteboard_strokes').delete().eq('meeting_id', meetingId);
  }

  Future<void> _closeExpiredEmptyMeetings() async {
    final cutoff = DateTime.now().toUtc().subtract(const Duration(minutes: 2));
    final rows = await _supabase
        .from('meetings')
        .select('id')
        .eq('status', 'live')
        .lt('empty_since', cutoff.toIso8601String());
    for (final row in rows) {
      final meetingId = row['id']?.toString();
      if (meetingId == null) continue;
      await _supabase.from('meetings').update({
        'status': 'ended',
        'ended_at': DateTime.now().toUtc().toIso8601String(),
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      }).eq('id', meetingId);
      await _supabase.from('meeting_chat_messages').delete().eq('meeting_id', meetingId);
      await _supabase.from('meeting_whiteboard_strokes').delete().eq('meeting_id', meetingId);
    }
  }

  Future<void> _closeEmptyMeetingAfterDelay(String meetingId) async {
    await Future<void>.delayed(const Duration(minutes: 2));
    final meeting = await fetchMeeting(meetingId);
    if (meeting == null || meeting.emptySince == null || meeting.isEnded) return;
    final participants = await fetchParticipants(meetingId);
    if (participants.any((participant) => participant.isActive)) return;
    await _supabase.from('meetings').update({
      'status': 'ended',
      'ended_at': DateTime.now().toUtc().toIso8601String(),
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    }).eq('id', meetingId);
    await _supabase.from('meeting_chat_messages').delete().eq('meeting_id', meetingId);
    await _supabase.from('meeting_whiteboard_strokes').delete().eq('meeting_id', meetingId);
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull {
    final iterator = this.iterator;
    if (!iterator.moveNext()) return null;
    return iterator.current;
  }
}
