import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/app_routes.dart';
import '../../../shared/widgets/comms_logo.dart';
import '../data/auth_repository.dart';

class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({super.key});

  @override
  ConsumerState<ResetPasswordScreen> createState() =>
      _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final _email = TextEditingController();
  var _sent = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    await ref.read(authRepositoryProvider).sendPasswordReset(_email.text);
    if (mounted) setState(() => _sent = true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reset password')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Center(child: CommsLogo(size: 64, showWordmark: true)),
                const SizedBox(height: 24),
                Text(_sent ? 'Check your inbox.' : 'Enter your account email.'),
                const SizedBox(height: 12),
                TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(labelText: 'Email')),
                const SizedBox(height: 20),
                FilledButton(
                    onPressed: _send, child: const Text('Send reset link')),
                TextButton(
                    onPressed: () => context.go(AppRoutes.login),
                    child: const Text('Back to sign in')),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
