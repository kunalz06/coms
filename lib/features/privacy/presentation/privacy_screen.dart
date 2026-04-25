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
  @override
  Widget build(BuildContext context) {
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
                  subtitle: const Text('Email OTP valid for 5 minutes'),
                  onTap: () => _sendResetOtp(
                    context: context,
                    ref: ref,
                    type: 'lock',
                  ),
                ),
                ListTile(
                  leading: const Icon(Icons.restart_alt_outlined),
                  title: const Text('Reset hidden chats password'),
                  subtitle: const Text('Email OTP valid for 5 minutes'),
                  onTap: () => _sendResetOtp(
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
    await _showPopup(context, 'Enter your old password.');
    return;
  }
  if (newPassword.length < 4) {
    await _showPopup(context, 'Use a password with at least 4 characters.');
    return;
  }
  if (newPassword != confirmPassword) {
    await _showPopup(context, 'Passwords do not match.');
    return;
  }

  try {
    final ok = await onSubmit(
      oldPassword: oldPassword,
      newPassword: newPassword,
    );
    if (!context.mounted) return;
    await _showPopup(
      context,
      ok
          ? 'Privacy password updated.'
          : 'Old password did not match. Use reset password to recover it.',
    );
  } catch (error) {
    if (!context.mounted) return;
    await _showPopup(context, error.toString());
  }
}

Future<void> _sendResetOtp({
  required BuildContext context,
  required WidgetRef ref,
  required String type,
}) async {
  final privacy = ref.read(privacyControllerProvider);
  if (type == 'lock' && !privacy.chatLockConfigured) {
    await _showPopup(context, 'Set a chat lock password before resetting it.');
    return;
  }
  if (type == 'hidden' && !privacy.hiddenPasswordConfigured) {
    await _showPopup(context, 'Set a hidden chats password before resetting it.');
    return;
  }
  try {
    await ref.read(privacyControllerProvider.notifier).sendResetOtp(
          type: type,
        );
    if (!context.mounted) return;
    await _showApplyResetOtp(
      context: context,
      ref: ref,
      type: type,
    );
  } catch (error) {
    if (!context.mounted) return;
    await _showPopup(context, error.toString());
  }
}

Future<void> _showApplyResetOtp({
  required BuildContext context,
  required WidgetRef ref,
  required String type,
}) async {
  final otpController = TextEditingController();
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
          const Text('Enter the OTP sent to your COMMS account email.'),
          const SizedBox(height: 8),
          TextField(
            controller: otpController,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(
              hintText: '6 character OTP',
            ),
          ),
          const SizedBox(height: 8),
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

  final otp = otpController.text.trim();
  final password = passwordController.text.trim();
  final confirmPassword = confirmController.text.trim();
  if (otp.length != 6) {
    await _showPopup(context, 'Enter the 6 character OTP from your email.');
    return;
  }
  if (password.length < 4) {
    await _showPopup(context, 'Use a password with at least 4 characters.');
    return;
  }
  if (password != confirmPassword) {
    await _showPopup(context, 'Passwords do not match.');
    return;
  }

  try {
    final ok = await ref.read(privacyControllerProvider.notifier).applyResetOtp(
          type: type,
          otp: otp,
          newPassword: password,
        );
    if (!context.mounted) return;
    await _showPopup(
      context,
      ok ? 'Privacy password reset complete.' : 'Invalid or expired OTP.',
    );
  } catch (error) {
    if (!context.mounted) return;
    await _showPopup(context, error.toString());
  }
}

Future<void> _showPopup(BuildContext context, String message) {
  if (!context.mounted) return Future.value();
  return showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('COMMS'),
      content: Text(message.replaceFirst('FormatException: ', '')),
      actions: [
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('OK'),
        ),
      ],
    ),
  );
}
