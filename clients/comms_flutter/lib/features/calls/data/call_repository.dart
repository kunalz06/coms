import 'dart:async';
import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../domain/call_models.dart';

final callRepositoryProvider = Provider<CallRepository>((ref) {
  return CallRepository(Supabase.instance.client);
});

class RecentCallItem {
  const RecentCallItem({
    required this.id,
    required this.isGroup,
    required this.mode,
    required this.status,
    required this.startedAt,
    this.endedAt,
    this.peerId,
    this.peerName,
    this.conversationId,
    this.conversationTitle,
  });

  final String id;
  final bool isGroup;
  final CallMode mode;
  final String status;
  final DateTime startedAt;
  final DateTime? endedAt;
  final String? peerId;
  final String? peerName;
  final String? conversationId;
  final String? conversationTitle;
}

class CallRepository {
  CallRepository(this._supabase);

  final SupabaseClient _supabase;
  static const _pollInterval = Duration(seconds: 4);

  Stream<List<DirectCallSession>> watchRecentDirectCalls(String userId) {
    return _resilientStream<List<DirectCallSession>>(
      realtime: () => _supabase
          .from('call_sessions')
          .stream(primaryKey: ['id'])
          .order('started_at')
          .map((rows) => _toDirectSessions(rows)),
      poll: () => _fetchRecentDirectCalls(userId),
      equals: _directCallListEquals,
    );
  }

  Stream<List<RecentCallItem>> watchRecentCalls(String userId) {
    return _resilientStream<List<RecentCallItem>>(
      realtime: () => _supabase
          .from('call_sessions')
          .stream(primaryKey: ['id'])
          .order('started_at')
          .asyncMap((_) => _fetchRecentCalls(userId)),
      poll: () => _fetchRecentCalls(userId),
      equals: _recentCallListEquals,
    );
  }

  String newCallId() {
    final random = Random.secure();
    final timestamp = DateTime.now().millisecondsSinceEpoch.toRadixString(16);
    final suffix =
        List.generate(12, (_) => random.nextInt(16).toRadixString(16)).join();
    return 'call-$timestamp-$suffix';
  }

  Future<List<DirectCallSession>> _fetchRecentDirectCalls(String userId) async {
    final rows = await _supabase
        .from('call_sessions')
        .select()
        .or('caller_id.eq.$userId,callee_id.eq.$userId')
        .order('started_at', ascending: false)
        .limit(100);
    return _toDirectSessions(rows);
  }

  Future<List<RecentCallItem>> _fetchRecentCalls(String userId) async {
    final directRows = await _supabase
        .from('call_sessions')
        .select()
        .or('caller_id.eq.$userId,callee_id.eq.$userId')
        .order('started_at', ascending: false)
        .limit(60);

    final groupMemberRows = await _supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', userId);
    final groupConversationIds = groupMemberRows
        .map((row) => row['conversation_id']?.toString())
        .whereType<String>()
        .toSet()
        .toList(growable: false);

    List<dynamic> groupRows = const [];
    if (groupConversationIds.isNotEmpty) {
      groupRows = await _supabase
          .from('group_call_sessions')
          .select()
          .inFilter('conversation_id', groupConversationIds)
          .order('started_at', ascending: false)
          .limit(60);
    }

    final items = <RecentCallItem>[];
    final directPeerIds = <String>{};
    final groupConversationIdsForLookup = <String>{};

    for (final row in directRows) {
      try {
        final session = DirectCallSession.fromJson(Map<String, dynamic>.from(row));
        final peerId = session.peerId(userId);
        directPeerIds.add(peerId);
        items.add(
          RecentCallItem(
            id: session.id,
            isGroup: false,
            mode: session.mode,
            status: session.status,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            peerId: peerId,
            conversationId: session.conversationId,
          ),
        );
      } catch (_) {}
    }

    for (final row in groupRows) {
      final data = Map<String, dynamic>.from(row);
      final mode = (data['mode']?.toString() ?? 'audio') == 'video'
          ? CallMode.video
          : CallMode.audio;
      items.add(
        RecentCallItem(
          id: data['id'].toString(),
          isGroup: true,
          mode: mode,
          status: data['status']?.toString() ?? 'active',
          startedAt: DateTime.tryParse(data['started_at']?.toString() ?? '') ??
              DateTime.fromMillisecondsSinceEpoch(0),
          endedAt: DateTime.tryParse(data['ended_at']?.toString() ?? ''),
          conversationId: data['conversation_id']?.toString(),
        ),
      );
      final conversationId = data['conversation_id']?.toString();
      if (conversationId != null && conversationId.isNotEmpty) {
        groupConversationIdsForLookup.add(conversationId);
      }
    }

    final peerNameById = <String, String>{};
    if (directPeerIds.isNotEmpty) {
      final rows = await _supabase
          .from('user_profiles')
          .select('id,full_name,email')
          .inFilter('id', directPeerIds.toList(growable: false));
      for (final row in rows) {
        final id = row['id']?.toString();
        if (id == null || id.isEmpty) continue;
        final name = row['full_name']?.toString().trim();
        final email = row['email']?.toString().trim();
        peerNameById[id] =
            (name != null && name.isNotEmpty) ? name : (email ?? id);
      }
    }

    final groupTitleByConversationId = <String, String>{};
    if (groupConversationIdsForLookup.isNotEmpty) {
      final rows = await _supabase
          .from('conversations')
          .select('id,title')
          .inFilter('id', groupConversationIdsForLookup.toList(growable: false));
      for (final row in rows) {
        final id = row['id']?.toString();
        if (id == null || id.isEmpty) continue;
        final title = row['title']?.toString().trim();
        if (title != null && title.isNotEmpty) {
          groupTitleByConversationId[id] = title;
        }
      }
    }

    final resolvedItems = items
        .map((item) => RecentCallItem(
              id: item.id,
              isGroup: item.isGroup,
              mode: item.mode,
              status: item.status,
              startedAt: item.startedAt,
              endedAt: item.endedAt,
              peerId: item.peerId,
              peerName:
                  item.peerId == null ? null : peerNameById[item.peerId!],
              conversationId: item.conversationId,
              conversationTitle: item.conversationId == null
                  ? null
                  : groupTitleByConversationId[item.conversationId!],
            ))
        .toList(growable: false);

    resolvedItems.sort((a, b) => b.startedAt.compareTo(a.startedAt));
    if (resolvedItems.length > 100) {
      return resolvedItems.sublist(0, 100);
    }
    return resolvedItems;
  }

  List<DirectCallSession> _toDirectSessions(List<dynamic> rows) {
    final sessions = <DirectCallSession>[];
    for (final row in rows) {
      try {
        sessions.add(DirectCallSession.fromJson(Map<String, dynamic>.from(row)));
      } catch (_) {
        // Skip malformed rows.
      }
    }
    sessions.sort((a, b) => b.startedAt.compareTo(a.startedAt));
    return sessions;
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

bool _directCallListEquals(List<DirectCallSession> a, List<DirectCallSession> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i].id != b[i].id ||
        a[i].status != b[i].status ||
        a[i].endedAt != b[i].endedAt ||
        a[i].startedAt != b[i].startedAt) {
      return false;
    }
  }
  return true;
}

bool _isRealtimeTimeoutError(Object error) {
  if (error is RealtimeSubscribeException) {
    return error.status == RealtimeSubscribeStatus.timedOut;
  }
  return error.toString().contains('RealtimeSubscribeStatus.timedOut');
}

bool _recentCallListEquals(List<RecentCallItem> a, List<RecentCallItem> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i].id != b[i].id ||
        a[i].status != b[i].status ||
        a[i].startedAt != b[i].startedAt ||
        a[i].endedAt != b[i].endedAt) {
      return false;
    }
  }
  return true;
}
