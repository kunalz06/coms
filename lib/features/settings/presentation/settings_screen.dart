import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/app_routes.dart';
import '../../../app/theme/theme_mode_controller.dart';
import '../../../core/config/app_config.dart';
import '../../../features/auth/data/auth_repository.dart';
import '../../../features/chats/data/chat_list_preferences_controller.dart';
import '../../../features/notifications/data/notification_service.dart';
import '../../../shared/models/notification_settings.dart';
import '../../../shared/widgets/state_views.dart';
import '../data/settings_repository.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userId = FirebaseAuth.instance.currentUser?.uid;
    if (userId == null) return const LoadingState();

    final themeMode = ref.watch(themeModeControllerProvider);
    final notificationSettings =
        ref.watch(_notificationSettingsProvider(userId));
    final unreadFirst = ref.watch(chatUnreadFirstControllerProvider);
    final config = ref.watch(appConfigProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.person_outline),
                  title: const Text('Account settings'),
                  subtitle: const Text('Email, password, profile picture'),
                  onTap: () => context.go(AppRoutes.accountSettings),
                ),
                ListTile(
                  leading: const Icon(Icons.backup_outlined),
                  title: const Text('Backup'),
                  subtitle: const Text('Google Drive, restore, retention'),
                  onTap: () => context.go(AppRoutes.backup),
                ),
                ListTile(
                  leading: const Icon(Icons.block_outlined),
                  title: const Text('Blocked contacts'),
                  subtitle: const Text('Review and unblock contacts'),
                  onTap: () => context.go(AppRoutes.blockedContacts),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.palette_outlined),
                  title: const Text('Theme'),
                  subtitle: Text(
                    switch (themeMode) {
                      ThemeMode.light => 'Light',
                      ThemeMode.dark => 'Dark',
                      ThemeMode.system => 'System',
                    },
                  ),
                  trailing: DropdownButton<ThemeMode>(
                    value: themeMode,
                    underline: const SizedBox.shrink(),
                    onChanged: (value) {
                      if (value == null) return;
                      ref
                          .read(themeModeControllerProvider.notifier)
                          .setThemeMode(value);
                    },
                    items: const [
                      DropdownMenuItem(
                        value: ThemeMode.system,
                        child: Text('System'),
                      ),
                      DropdownMenuItem(
                        value: ThemeMode.light,
                        child: Text('Light'),
                      ),
                      DropdownMenuItem(
                        value: ThemeMode.dark,
                        child: Text('Dark'),
                      ),
                    ],
                  ),
                ),
                SwitchListTile(
                  secondary: const Icon(Icons.mark_unread_chat_alt_outlined),
                  value: unreadFirst,
                  onChanged: (value) {
                    ref
                        .read(chatUnreadFirstControllerProvider.notifier)
                        .setUnreadFirst(value);
                  },
                  title: const Text('Unread chats first'),
                  subtitle: const Text(
                      'Move conversations with unread messages to top'),
                ),
                notificationSettings.when(
                  data: (settings) => Column(
                    children: [
                      SwitchListTile(
                        secondary:
                            const Icon(Icons.notifications_active_outlined),
                        value: settings.browserNotificationsEnabled,
                        onChanged: (value) async {
                          var next = settings;
                          if (value) {
                            try {
                              final granted = await NotificationService
                                  .instance
                                  .requestBrowserPermission();
                              if (!granted) {
                                if (context.mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                        'Notification permission denied on this device.',
                                      ),
                                    ),
                                  );
                                }
                                return;
                              }
                              final subscription = await NotificationService
                                  .instance
                                  .subscribeWebPush(
                                vapidPublicKey: config.vapidPublicKey,
                              );
                              await ref
                                  .read(settingsRepositoryProvider)
                                  .savePushSubscription(
                                    userId: userId,
                                    subscription: subscription,
                                  );
                            } catch (error) {
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text(
                                      error
                                          .toString()
                                          .replaceFirst('FormatException: ', ''),
                                    ),
                                  ),
                                );
                              }
                              return;
                            }
                            next = next.copyWith(
                              browserNotificationsEnabled: true,
                              notificationsPromptedAt: DateTime.now(),
                            );
                          } else {
                            final cachedSubscription =
                                NotificationService.instance.lastSubscription;
                            if (cachedSubscription != null) {
                              await ref
                                  .read(settingsRepositoryProvider)
                                  .removePushSubscription(
                                    endpoint: cachedSubscription.endpoint,
                                  );
                            }
                            final activeEndpoint = await NotificationService
                                .instance
                                .unsubscribeWebPush();
                            if (activeEndpoint != null &&
                                activeEndpoint !=
                                    cachedSubscription?.endpoint) {
                              await ref
                                  .read(settingsRepositoryProvider)
                                  .removePushSubscription(
                                    endpoint: activeEndpoint,
                                  );
                            }
                            next = next.copyWith(
                              browserNotificationsEnabled: false,
                            );
                          }

                          await ref
                              .read(settingsRepositoryProvider)
                              .saveNotificationSettings(next);
                          ref.invalidate(_notificationSettingsProvider(userId));
                        },
                        title: const Text('Notifications'),
                        subtitle: const Text(
                          'Enable in-app and browser push notifications',
                        ),
                      ),
                      SwitchListTile(
                        secondary: const Icon(Icons.music_note_outlined),
                        value: settings.ringtoneEnabled,
                        onChanged: (value) async {
                          final next =
                              settings.copyWith(ringtoneEnabled: value);
                          await ref
                              .read(settingsRepositoryProvider)
                              .saveNotificationSettings(next);
                          ref.invalidate(_notificationSettingsProvider(userId));
                        },
                        title: const Text('Call ringtone'),
                        subtitle: const Text('Play ringtone on incoming call'),
                      ),
                    ],
                  ),
                  loading: () => const Padding(
                    padding: EdgeInsets.all(16),
                    child: LinearProgressIndicator(),
                  ),
                  error: (error, _) => ListTile(
                    leading: const Icon(Icons.error_outline),
                    title: const Text('Notifications unavailable'),
                    subtitle: Text(error.toString()),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.lock_outline),
                  title: const Text('Privacy'),
                  subtitle: const Text('Chat lock, hidden chats, reset flows'),
                  onTap: () => context.go(AppRoutes.privacy),
                ),
                ListTile(
                  leading: const Icon(Icons.info_outline),
                  title: const Text('COMMS'),
                  subtitle: const Text('Flutter-first messaging and calling'),
                  trailing: TextButton.icon(
                    onPressed: () => ref.read(authRepositoryProvider).signOut(),
                    icon: const Icon(Icons.logout),
                    label: const Text('Sign out'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

final _notificationSettingsProvider =
    FutureProvider.family<NotificationSettingsModel, String>((ref, userId) {
  return ref.watch(settingsRepositoryProvider).loadNotificationSettings(userId);
});
