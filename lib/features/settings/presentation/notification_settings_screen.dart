import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/notifications/web_fcm_notification_service.dart';
import '../../../shared/widgets/state_views.dart';

final _webNotificationPreferencesProvider =
    FutureProvider<NotificationPreferences>((ref) {
  return ref.watch(webFcmNotificationServiceProvider).loadPreferences();
});

final _webNotificationPermissionProvider =
    FutureProvider<NotificationSettings>((ref) {
  return ref.watch(webFcmNotificationServiceProvider).permissionStatus();
});

class NotificationSettingsScreen extends ConsumerWidget {
  const NotificationSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final preferences = ref.watch(_webNotificationPreferencesProvider);
    final permission = ref.watch(_webNotificationPermissionProvider);

    Future<void> update(NotificationPreferences next) async {
      await ref.read(webFcmNotificationServiceProvider).savePreferences(next);
      ref.invalidate(_webNotificationPreferencesProvider);
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: preferences.when(
        loading: () => const LoadingState(),
        error: (error, _) => EmptyState(
          title: 'Notifications unavailable',
          message: error.toString(),
        ),
        data: (prefs) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Browser permission',
                        style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Text(permission.when(
                      data: (value) => value.authorizationStatus.name,
                      loading: () => 'Checking',
                      error: (error, _) => error.toString(),
                    )),
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: () async {
                        final ok = await ref
                            .read(webFcmNotificationServiceProvider)
                            .requestPermissionAndRegister();
                        ref.invalidate(_webNotificationPermissionProvider);
                        if (!context.mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(ok
                                ? 'Notifications enabled on this browser.'
                                : 'Enable notifications from browser site settings.'),
                          ),
                        );
                      },
                      icon: const Icon(Icons.notifications_active_outlined),
                      label: const Text('Enable notifications'),
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: () async {
                        await ref
                            .read(webFcmNotificationServiceProvider)
                            .sendTestNotification();
                        if (!context.mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                              content: Text('Test notification requested.')),
                        );
                      },
                      icon: const Icon(Icons.send_outlined),
                      label: const Text('Send test notification'),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Column(
                children: [
                  SwitchListTile(
                    secondary: const Icon(Icons.chat_bubble_outline),
                    value: prefs.messagesEnabled,
                    onChanged: (value) =>
                        update(NotificationPreferences(
                      messagesEnabled: value,
                      callsEnabled: prefs.callsEnabled,
                      missedCallsEnabled: prefs.missedCallsEnabled,
                      showMessagePreview: prefs.showMessagePreview,
                      soundEnabled: prefs.soundEnabled,
                    )),
                    title: const Text('Message notifications'),
                  ),
                  SwitchListTile(
                    secondary: const Icon(Icons.call_outlined),
                    value: prefs.callsEnabled,
                    onChanged: (value) =>
                        update(NotificationPreferences(
                      messagesEnabled: prefs.messagesEnabled,
                      callsEnabled: value,
                      missedCallsEnabled: prefs.missedCallsEnabled,
                      showMessagePreview: prefs.showMessagePreview,
                      soundEnabled: prefs.soundEnabled,
                    )),
                    title: const Text('Call notifications'),
                  ),
                  SwitchListTile(
                    secondary: const Icon(Icons.call_missed_outlined),
                    value: prefs.missedCallsEnabled,
                    onChanged: (value) =>
                        update(NotificationPreferences(
                      messagesEnabled: prefs.messagesEnabled,
                      callsEnabled: prefs.callsEnabled,
                      missedCallsEnabled: value,
                      showMessagePreview: prefs.showMessagePreview,
                      soundEnabled: prefs.soundEnabled,
                    )),
                    title: const Text('Missed call notifications'),
                  ),
                  SwitchListTile(
                    secondary: const Icon(Icons.visibility_outlined),
                    value: prefs.showMessagePreview,
                    onChanged: (value) =>
                        update(NotificationPreferences(
                      messagesEnabled: prefs.messagesEnabled,
                      callsEnabled: prefs.callsEnabled,
                      missedCallsEnabled: prefs.missedCallsEnabled,
                      showMessagePreview: value,
                      soundEnabled: prefs.soundEnabled,
                    )),
                    title: const Text('Show message previews'),
                  ),
                  SwitchListTile(
                    secondary: const Icon(Icons.volume_up_outlined),
                    value: prefs.soundEnabled,
                    onChanged: (value) =>
                        update(NotificationPreferences(
                      messagesEnabled: prefs.messagesEnabled,
                      callsEnabled: prefs.callsEnabled,
                      missedCallsEnabled: prefs.missedCallsEnabled,
                      showMessagePreview: prefs.showMessagePreview,
                      soundEnabled: value,
                    )),
                    title: const Text('Sound while app is open'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
