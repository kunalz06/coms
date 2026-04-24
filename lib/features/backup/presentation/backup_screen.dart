import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../shared/models/backup_models.dart';
import '../../../shared/widgets/magnify_button_wrapper.dart';
import '../../../shared/widgets/state_views.dart';
import '../data/backup_repository.dart';

class BackupScreen extends ConsumerStatefulWidget {
  const BackupScreen({super.key});

  @override
  ConsumerState<BackupScreen> createState() => _BackupScreenState();
}

class _BackupScreenState extends ConsumerState<BackupScreen> {
  Future<void> _refresh() async {
    ref.invalidate(_backupStatusProvider);
    await ref.read(_backupStatusProvider.future);
  }

  Future<void> _connectDrive() async {
    try {
      final url = await ref.read(backupRepositoryProvider).googleConnectUrl();
      final launched = await launchUrl(
        Uri.parse(url),
        mode: LaunchMode.externalApplication,
      );
      if (!launched && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open Google Drive sign-in.')),
        );
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    }
  }

  Future<void> _runBackupNow() async {
    try {
      await ref.read(backupRepositoryProvider).runNow();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Backup started.')),
      );
      await _refresh();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    }
  }

  Future<void> _disableBackup() async {
    final shouldDisable = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Disable backup?'),
        content: const Text(
          'COMMS keeps active content for 3 days. After that, old messages may not be restorable until backup is reconnected.',
        ),
        actions: [
          TextButton.icon(
            onPressed: () => Navigator.of(context).pop(false),
            icon: const Icon(Icons.close),
            label: const Text('Cancel'),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.of(context).pop(true),
            icon: const Icon(Icons.block),
            label: const Text('Disable'),
          ),
        ],
      ),
    );
    if (shouldDisable != true) return;

    try {
      await ref.read(backupRepositoryProvider).disable();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Backup disabled.')),
      );
      await _refresh();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    }
  }

  Future<void> _removeGoogleAccount() async {
    final shouldRemove = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove Google account?'),
        content: const Text(
          'This clears the connected Drive account from COMMS. Existing archive files in Google Drive are not deleted.',
        ),
        actions: [
          TextButton.icon(
            onPressed: () => Navigator.of(context).pop(false),
            icon: const Icon(Icons.close),
            label: const Text('Cancel'),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.of(context).pop(true),
            icon: const Icon(Icons.link_off),
            label: const Text('Remove'),
          ),
        ],
      ),
    );
    if (shouldRemove != true) return;

    try {
      await ref.read(backupRepositoryProvider).removeGoogleAccount();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Google account removed.')),
      );
      await _refresh();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(_backupStatusProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Backup'),
        actions: [
          MagnifyButtonWrapper(
            child: IconButton(
              onPressed: _refresh,
              icon: const Icon(Icons.refresh),
              tooltip: 'Refresh',
            ),
          ),
        ],
      ),
      body: status.when(
        data: (preference) => RefreshIndicator(
          onRefresh: _refresh,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Google Drive backup',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 12),
                      _StatusLine(
                        title: 'Provider',
                        value: preference?.provider ?? 'Not connected',
                      ),
                      _StatusLine(
                        title: 'Status',
                        value: _statusLabel(preference),
                      ),
                      _StatusLine(
                        title: 'Drive account',
                        value: preference?.googleDriveEmail ?? 'Not linked',
                      ),
                      _StatusLine(
                        title: 'Last successful backup',
                        value: preference?.lastSuccessfulBackupAt == null
                            ? 'Not backed up yet'
                            : preference!.lastSuccessfulBackupAt!
                                .toLocal()
                                .toString(),
                      ),
                      if (preference?.lastBackupError != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(
                            preference!.lastBackupError!,
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                        ),
                      const SizedBox(height: 14),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          MagnifyButtonWrapper(
                            child: FilledButton.icon(
                              onPressed: _runBackupNow,
                              icon: const Icon(Icons.backup_outlined),
                              label: const Text('Backup now'),
                            ),
                          ),
                          MagnifyButtonWrapper(
                            child: OutlinedButton.icon(
                              onPressed: _connectDrive,
                              icon: Icon(
                                preference?.reconnectRequired == true
                                    ? Icons.link_off
                                    : Icons.link,
                              ),
                              label: Text(
                                preference?.reconnectRequired == true
                                    ? 'Reconnect Drive'
                                    : 'Connect Drive',
                              ),
                            ),
                          ),
                          if (preference?.enabled == true)
                            MagnifyButtonWrapper(
                              child: OutlinedButton.icon(
                                onPressed: _disableBackup,
                                icon: const Icon(Icons.block),
                                label: const Text('Disable backup'),
                              ),
                            ),
                          if (preference?.googleDriveEmail != null)
                            MagnifyButtonWrapper(
                              child: OutlinedButton.icon(
                                onPressed: _removeGoogleAccount,
                                icon: const Icon(Icons.link_off),
                                label: const Text('Remove Google account'),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Retention policy',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Active message bodies are retained for 3 days in primary storage. Older content restores from your connected archive on demand.',
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
        loading: () => const LoadingState(),
        error: (error, _) =>
            EmptyState(title: 'Backup unavailable', message: error.toString()),
      ),
    );
  }

  String _statusLabel(BackupPreference? preference) {
    if (preference == null) return 'Disabled';
    if (preference.reconnectRequired) return 'Reconnect required';
    return switch (preference.status) {
      'disabled' => 'Disabled',
      'connecting' => 'Connecting',
      'enabled' => 'Enabled',
      'syncing' => 'Syncing',
      'success' => 'Healthy',
      'failed' => 'Failed',
      'reconnect_required' => 'Reconnect required',
      _ => preference.status,
    };
  }
}

class _StatusLine extends StatelessWidget {
  const _StatusLine({
    required this.title,
    required this.value,
  });

  final String title;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          SizedBox(
            width: 170,
            child: Text(
              title,
              style: Theme.of(context).textTheme.labelLarge,
            ),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }
}

final _backupStatusProvider =
    FutureProvider((ref) => ref.watch(backupRepositoryProvider).status());
