import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/app_routes.dart';
import '../../../app/theme/theme_mode_controller.dart';
import '../../../features/auth/data/auth_repository.dart';
import '../../../features/chats/data/chat_list_preferences_controller.dart';
import '../../../shared/widgets/state_views.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userId = FirebaseAuth.instance.currentUser?.uid;
    if (userId == null) return const LoadingState();

    final themeMode = ref.watch(themeModeControllerProvider);
    final unreadFirst = ref.watch(chatUnreadFirstControllerProvider);

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
                  leading: const Icon(Icons.notifications_active_outlined),
                  title: const Text('Notifications'),
                  subtitle: const Text('Web push, previews, sounds'),
                  onTap: () => context.go(AppRoutes.notificationSettings),
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
