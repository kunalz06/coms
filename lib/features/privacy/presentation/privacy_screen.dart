import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/app_routes.dart';
import '../../../shared/widgets/state_views.dart';
import '../data/privacy_controller.dart';

class PrivacyScreen extends ConsumerStatefulWidget {
  const PrivacyScreen({super.key});

  @override
  ConsumerState<PrivacyScreen> createState() => _PrivacyScreenState();
}

class _PrivacyScreenState extends ConsumerState<PrivacyScreen> {
  String? _handledResetToken;

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    final privacy = ref.watch(privacyControllerProvider);
    if (user == null || privacy.loading) return const LoadingState();

    final uri = GoRouterState.of(context).uri;
    final resetType = uri.queryParameters['privacyReset'];
    final resetToken = uri.queryParameters['token'];
    if ((resetType == 'lock' || resetType == 'hidden') &&
        resetToken != null &&
        resetToken.isNotEmpty &&
        resetToken != _handledResetToken) {
      _handledResetToken = resetToken;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _showApplyResetLink(
          context: context,
          ref: ref,
          type: resetType!,
          token: resetToken,
        );
      });
    }

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
                    onPressed: () => _showPasswordDialog(
                      context: context,
                      title: privacy.chatLockConfigured
                          ? 'Change chat lock password'
                          : 'Set chat lock password',
                      oldPasswordRequired: privacy.chatLockConfigured,
                      onSubmit: ({
                        required String newPassword,
                        required String oldPassword,
                      }) async {
                        if (privacy.chatLockConfigured) {
                          return ref
                              .read(privacyControllerProvider.notifier)
                              .changeChatLockPassword(
                                oldPassword: oldPassword,
                                newPassword: newPassword,
                              );
                        }
                        await ref
                            .read(privacyControllerProvider.notifier)
                            .setChatLockPassword(newPassword);
                        return true;
                      },
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
                    onPressed: () => _showPasswordDialog(
                      context: context,
                      title: privacy.hiddenPasswordConfigured
                          ? 'Change hidden chats password'
                          : 'Set hidden chats password',
                      oldPasswordRequired: privacy.hiddenPasswordConfigured,
                      onSubmit: ({
                        required String newPassword,
                        required String oldPassword,
                      }) async {
                        if (privacy.hiddenPasswordConfigured) {
                          return ref
                              .read(privacyControllerProvider.notifier)
                              .changeHiddenPassword(
                                oldPassword: oldPassword,
                                newPassword: newPassword,
                              );
                        }
                        await ref
                            .read(privacyControllerProvider.notifier)
                            .setHiddenPassword(newPassword);
                        return true;
                      },
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
                  subtitle: const Text('Email link valid for 10 minutes'),
                  onTap: () => _sendResetEmail(
                    context: context,
                    ref: ref,
                    type: 'lock',
                  ),
                ),
                ListTile(
                  leading: const Icon(Icons.restart_alt_outlined),
                  title: const Text('Reset hidden chats password'),
                  subtitle: const Text('Email link valid for 10 minutes'),
                  onTap: () => _sendResetEmail(
                    context: context,
                    ref: ref,
                    type: 'hidden',
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

typedef PrivacyPasswordSubmit = Future<bool> Function({
  required String newPassword,
  required String oldPassword,
});

Future<void> _showPasswordDialog({
  required BuildContext context,
  required String title,
  required bool oldPasswordRequired,
  required PrivacyPasswordSubmit onSubmit,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  final oldController = TextEditingController();
  final newController = TextEditingController();
  final confirmController = TextEditingController();
  final submitted = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (oldPasswordRequired) ...[
            TextField(
              controller: oldController,
              obscureText: true,
              decoration: const InputDecoration(
                hintText: 'Old password',
              ),
            ),
            const SizedBox(height: 8),
          ],
          TextField(
            controller: newController,
            obscureText: true,
            decoration: const InputDecoration(
              hintText: 'New password',
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: confirmController,
            obscureText: true,
            decoration: const InputDecoration(
              hintText: 'Confirm new password',
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
          child: const Text('Save'),
        ),
      ],
    ),
  );
  if (submitted != true) return;
  if (!context.mounted) return;

  final oldPassword = oldController.text.trim();
  final newPassword = newController.text.trim();
  final confirmPassword = confirmController.text.trim();
  if (oldPasswordRequired && oldPassword.isEmpty) {
    _showSnack(messenger, 'Enter your old password.');
    return;
  }
  if (newPassword.length < 4) {
    _showSnack(messenger, 'Use a password with at least 4 characters.');
    return;
  }
  if (newPassword != confirmPassword) {
    _showSnack(messenger, 'Passwords do not match.');
    return;
  }

  try {
    final ok = await onSubmit(
      oldPassword: oldPassword,
      newPassword: newPassword,
    );
    if (!context.mounted) return;
    _showSnack(
      messenger,
      ok
          ? 'Privacy password updated.'
          : 'Old password did not match. Use reset password to recover it.',
    );
  } catch (error) {
    if (!context.mounted) return;
    _showSnack(messenger, error.toString());
  }
}

Future<void> _sendResetEmail({
  required BuildContext context,
  required WidgetRef ref,
  required String type,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    await ref.read(privacyControllerProvider.notifier).sendResetEmail(
          type: type,
        );
    if (!context.mounted) return;
    _showSnack(messenger, 'Reset link sent to your COMMS account email.');
  } catch (error) {
    if (!context.mounted) return;
    _showSnack(messenger, error.toString());
  }
}

Future<void> _showApplyResetLink({
  required BuildContext context,
  required WidgetRef ref,
  required String type,
  required String token,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  final router = GoRouter.of(context);
  final passwordController = TextEditingController();
  final confirmController = TextEditingController();
  final submitted = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(
        type == 'lock'
            ? 'Reset chat lock password'
            : 'Reset hidden chats password',
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: passwordController,
            obscureText: true,
            decoration: const InputDecoration(
              hintText: 'New privacy password',
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: confirmController,
            obscureText: true,
            decoration: const InputDecoration(
              hintText: 'Confirm new password',
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
          child: const Text('Reset'),
        ),
      ],
    ),
  );
  if (submitted != true) return;
  if (!context.mounted) return;

  final password = passwordController.text.trim();
  final confirmPassword = confirmController.text.trim();
  if (password.length < 4) {
    _showSnack(messenger, 'Use a password with at least 4 characters.');
    return;
  }
  if (password != confirmPassword) {
    _showSnack(messenger, 'Passwords do not match.');
    return;
  }

  try {
    final ok = await ref.read(privacyControllerProvider.notifier).applyResetLink(
          type: type,
          token: token,
          newPassword: password,
        );
    if (!context.mounted) return;
    _showSnack(
      messenger,
      ok ? 'Privacy password reset complete.' : 'Invalid or expired reset link.',
    );
    router.go(AppRoutes.privacy);
  } catch (error) {
    if (!context.mounted) return;
    _showSnack(messenger, error.toString());
  }
}

void _showSnack(ScaffoldMessengerState messenger, String message) {
  messenger.showSnackBar(
    SnackBar(content: Text(message)),
  );
}
