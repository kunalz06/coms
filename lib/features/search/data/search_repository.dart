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
    required this.conversationTitle,
    required this.senderLabel,
  });

  final String conversationId;
  final Message message;
  final String conversationTitle;
  final String senderLabel;
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

    final messages = rows
        .whereType<Map<String, dynamic>>()
        .map(Message.fromJson)
        .toList(growable: false);
    if (messages.isEmpty) return const [];

    final conversationIds = messages
        .map((message) => message.conversationId)
        .toSet()
        .toList(growable: false);
    final senderIds = messages
        .map((message) => message.senderId)
        .toSet()
        .toList(growable: false);

    final conversationRows = await _supabase
        .from('conversations')
        .select('id,type,title,user_one_id,user_two_id')
        .inFilter('id', conversationIds);
    final profileRows = await _supabase
        .from('user_profiles')
        .select('id,full_name,email')
        .inFilter('id', senderIds);

    final profileById = <String, String>{};
    for (final row in profileRows) {
      final id = row['id']?.toString();
      if (id == null || id.isEmpty) continue;
      final fullName = row['full_name']?.toString().trim();
      final email = row['email']?.toString().trim();
      profileById[id] =
          (fullName != null && fullName.isNotEmpty) ? fullName : (email ?? id);
    }

    final conversationTitleById = <String, String>{};
    for (final row in conversationRows) {
      final id = row['id']?.toString();
      if (id == null || id.isEmpty) continue;
      final type = row['type']?.toString() ?? 'direct';
      final title = row['title']?.toString().trim();
      conversationTitleById[id] = (title != null && title.isNotEmpty)
          ? title
          : (type == 'group' ? 'Group chat' : 'Direct chat');
    }

    return messages
        .map((message) => SearchResult(
              conversationId: message.conversationId,
              message: message,
              conversationTitle:
                  conversationTitleById[message.conversationId] ??
                      'Conversation',
              senderLabel: profileById[message.senderId] ?? message.senderId,
            ))
        .toList(growable: false);
  }
}
