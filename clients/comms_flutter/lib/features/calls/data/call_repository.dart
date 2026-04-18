import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../domain/call_models.dart';

final callRepositoryProvider = Provider<CallRepository>((ref) {
  return CallRepository(Supabase.instance.client);
});

class CallRepository {
  CallRepository(this._supabase);

  final SupabaseClient _supabase;

  Stream<List<DirectCallSession>> watchRecentDirectCalls(String userId) {
    return _supabase
        .from('call_sessions')
        .stream(primaryKey: ['id'])
        .order('started_at')
        .map((rows) {
          return rows
              .map((row) =>
                  DirectCallSession.fromJson(Map<String, dynamic>.from(row)))
              .where((session) => session.involves(userId))
              .toList()
            ..sort((a, b) => b.startedAt.compareTo(a.startedAt));
        });
  }

  String newCallId() {
    final random = Random.secure();
    final timestamp = DateTime.now().millisecondsSinceEpoch.toRadixString(16);
    final suffix =
        List.generate(12, (_) => random.nextInt(16).toRadixString(16)).join();
    return 'call-$timestamp-$suffix';
  }
}
