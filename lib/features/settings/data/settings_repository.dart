import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../shared/models/notification_settings.dart';
import '../../../shared/models/user_profile.dart';

final settingsRepositoryProvider = Provider<SettingsRepository>((ref) {
  return SettingsRepository(Supabase.instance.client);
});

class BlockedContact {
  const BlockedContact({
    required this.blockedId,
    required this.createdAt,
    required this.profile,
  });

  final String blockedId;
  final DateTime createdAt;
  final UserProfile? profile;
}

class SettingsRepository {
  SettingsRepository(this._supabase);

  final SupabaseClient _supabase;

  Future<NotificationSettingsModel> loadNotificationSettings(
      String userId) async {
    final data = await _supabase
        .from('notification_settings')
        .select()
        .eq('user_id', userId)
        .maybeSingle();

    if (data == null) {
      final settings = NotificationSettingsModel(
        userId: userId,
        browserNotificationsEnabled: false,
        ringtoneEnabled: true,
      );
      await saveNotificationSettings(settings);
      return settings;
    }

    return NotificationSettingsModel.fromJson(Map<String, dynamic>.from(data));
  }

  Future<void> saveNotificationSettings(
      NotificationSettingsModel settings) async {
    await _supabase.from('notification_settings').upsert(
          settings.toJson(),
          onConflict: 'user_id',
        );
  }

  Future<List<BlockedContact>> blockedContacts(String blockerId) async {
    final rows = await _supabase
        .from('blocks')
        .select('blocked_id,created_at')
        .eq('blocker_id', blockerId)
        .order('created_at', ascending: false);

    if (rows.isEmpty) return const [];

    final blockedRows = rows
        .whereType<Map<String, dynamic>>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList(growable: false);

    final blockedIds = blockedRows
        .map((row) => row['blocked_id'] as String?)
        .whereType<String>()
        .toList(growable: false);

    final profilesById = <String, UserProfile>{};
    if (blockedIds.isNotEmpty) {
      final profileRows = await _supabase
          .from('user_profiles')
          .select()
          .inFilter('id', blockedIds);
      for (final row in profileRows) {
        final profile = UserProfile.fromJson(Map<String, dynamic>.from(row));
        profilesById[profile.id] = profile;
      }
    }

    return blockedRows.map((row) {
      final blockedId = row['blocked_id'] as String;
      return BlockedContact(
        blockedId: blockedId,
        createdAt: DateTime.tryParse(row['created_at']?.toString() ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
        profile: profilesById[blockedId],
      );
    }).toList(growable: false);
  }

  Future<void> unblock({
    required String blockerId,
    required String blockedId,
  }) async {
    await _supabase
        .from('blocks')
        .delete()
        .eq('blocker_id', blockerId)
        .eq('blocked_id', blockedId);
  }
}
