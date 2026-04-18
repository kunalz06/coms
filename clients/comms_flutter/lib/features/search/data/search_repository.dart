import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../shared/models/message.dart';

final searchRepositoryProvider = Provider<SearchRepository>((ref) {
  return SearchRepository(Supabase.instance.client);
});

class SearchResult {
  const SearchResult({
    required this.conversationId,
    required this.message,
  });

  final String conversationId;
  final Message message;
}

class SearchRepository {
  SearchRepository(this._supabase);

  final SupabaseClient _supabase;

  Future<List<SearchResult>> searchUnlockedMessages(String query) async {
    final trimmed = query.trim();
    if (trimmed.length < 2) return const [];
    final rows = await _supabase
        .from('messages')
        .select()
        .ilike('content', '%$trimmed%')
        .isFilter('deleted_for_everyone_at', null)
        .order('created_at', ascending: false)
        .limit(50);

    return rows
        .whereType<Map<String, dynamic>>()
        .map(Message.fromJson)
        .map((message) => SearchResult(
            conversationId: message.conversationId, message: message))
        .toList(growable: false);
  }
}
