import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/models/backup_models.dart';
import '../../../shared/models/message.dart';

final backupRepositoryProvider = Provider<BackupRepository>((ref) {
  return BackupRepository(ref.watch(apiClientProvider));
});

class BackupRepository {
  BackupRepository(this._api);

  final ApiClient _api;

  Future<BackupPreference?> status() async {
    final response = await _api.get<Map<String, dynamic>>('/api/backup/status');
    final preference = response.data?['preference'];
    if (preference is! Map<String, dynamic>) return null;
    return BackupPreference.fromJson(preference);
  }

  Future<String> googleConnectUrl() async {
    final response =
        await _api.post<Map<String, dynamic>>('/api/backup/google/connect');
    return response.data?['authUrl'] as String;
  }

  Future<void> disable() => _api.post('/api/backup/disable').then((_) {});

  Future<void> removeGoogleAccount() =>
      _api.post('/api/backup/google/remove').then((_) {});

  Future<void> runNow() => _api.post('/api/backup/run').then((_) {});

  Future<List<Message>> restore(String conversationId) async {
    final response = await _api.get<Map<String, dynamic>>('/api/backup/restore',
        queryParameters: {'conversationId': conversationId});
    final raw = response.data?['messages'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(Message.fromJson)
        .toList(growable: false);
  }
}
