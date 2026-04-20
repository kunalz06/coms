import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/app_routes.dart';
import '../../../shared/widgets/state_views.dart';
import '../data/privacy_controller.dart';

class PrivacyScreen extends ConsumerWidget {
  const PrivacyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = FirebaseAuth.instance.currentUser;
    final privacy = ref.watch(privacyControllerProvider);
    if (user == null || privacy.loading) return const LoadingState();

    return Scaffold(
      appBar: AppBar(title: const Text('Privacy')),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.lock_outline),
                  title: const Text('Chat lock password'),
                  subtitle: Text(
                    privacy.chatLockConfigured
                        ? 'Configured'
                        : 'Not configured',
                  ),
                  trailing: TextButton(
                    onPressed: () => _showSetPasswordDialog(
                      context: context,
                      title: privacy.chatLockConfigured
                          ? 'Change chat lock password'
                          : 'Set chat lock password',
                      onSubmit: (value) => ref
                          .read(privacyControllerProvider.notifier)
                          .setChatLockPassword(value),
                    ),
                    child: Text(privacy.chatLockConfigured ? 'Change' : 'Set'),
                  ),
                ),
                ListTile(
                  leading: const Icon(Icons.visibility_off_outlined),
                  title: const Text('Hidden chats password'),
                  subtitle: Text(
                    privacy.hiddenPasswordConfigured
                        ? 'Configured'
                        : 'Not configured',
                  ),
                  trailing: TextButton(
                    onPressed: () => _showSetPasswordDialog(
                      context: context,
                      title: privacy.hiddenPasswordConfigured
                          ? 'Change hidden chats password'
                          : 'Set hidden chats password',
                      onSubmit: (value) => ref
                          .read(privacyControllerProvider.notifier)
                          .setHiddenPassword(value),
                    ),
                    child: Text(
                        privacy.hiddenPasswordConfigured ? 'Change' : 'Set'),
                  ),
                ),
                ListTile(
                  leading: const Icon(Icons.visibility_off),
                  title: const Text('Hidden chats area'),
                  subtitle: const Text('Open and manage hidden conversations'),
                  onTap: () => context.go(AppRoutes.hiddenChats),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.password_outlined),
                  title: const Text('Reset chat lock password'),
                  subtitle: const Text('Token valid for 15 minutes'),
                  onTap: () => _showResetFlow(
                    context: context,
                    ref: ref,
                    type: 'lock',
                    email: user.email ?? '',
                  ),
                ),
                ListTile(
                  leading: const Icon(Icons.restart_alt_outlined),
                  title: const Text('Reset hidden chats password'),
                  subtitle: const Text('Token valid for 15 minutes'),
                  onTap: () => _showResetFlow(
                    context: context,
                    ref: ref,
                    type: 'hidden',
                    email: user.email ?? '',
                  ),
                ),
              ],
            ),
          ),
          if (privacy.error != null) ...[
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  privacy.error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

Future<void> _showSetPasswordDialog({
  required BuildContext context,
  required String title,
  required Future<void> Function(String password) onSubmit,
}) async {
  final controller = TextEditingController();
  final value = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: controller,
        obscureText: true,
        decoration: const InputDecoration(
          hintText: 'At least 4 characters',
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(controller.text.trim()),
          child: const Text('Save'),
        ),
      ],
    ),
  );
  if (value == null || value.length < 4) {
    if (!context.mounted || value == null) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
          content: Text('Use a password with at least 4 characters.')),
    );
    return;
  }

  try {
    await onSubmit(value);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Privacy password updated.')),
    );
  } catch (error) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(error.toString())),
    );
  }
}

Future<void> _showResetFlow({
  required BuildContext context,
  required WidgetRef ref,
  required String type,
  required String email,
}) async {
  if (email.trim().isEmpty) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('No account email is available.')),
    );
    return;
  }

  try {
    final token =
        await ref.read(privacyControllerProvider.notifier).issueResetToken(
              type: type,
              email: email,
            );

    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Privacy reset token'),
        content: SelectableText(
          'Email: $email\nToken: $token\n\nThis token expires in 15 minutes and can be used once.',
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Continue'),
          ),
        ],
      ),
    );

    if (!context.mounted) return;
    final tokenController = TextEditingController();
    final passwordController = TextEditingController();
    final submitted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Apply reset token'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: tokenController,
              decoration: const InputDecoration(hintText: 'Enter token'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: passwordController,
              obscureText: true,
              decoration: const InputDecoration(
                hintText: 'New privacy password',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Apply'),
          ),
        ],
      ),
    );
    if (submitted != true) return;

    final ok =
        await ref.read(privacyControllerProvider.notifier).applyResetToken(
              type: type,
              email: email,
              token: tokenController.text.trim(),
              newPassword: passwordController.text.trim(),
            );
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          ok ? 'Privacy password reset complete.' : 'Invalid or expired token.',
        ),
      ),
    );
  } catch (error) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(error.toString())),
    );
  }
}
