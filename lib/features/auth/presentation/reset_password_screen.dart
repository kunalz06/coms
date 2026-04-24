import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/app_routes.dart';
import '../../../shared/widgets/auth_hero.dart';
import '../../../shared/widgets/comms_page_background.dart';
import '../data/auth_repository.dart';

class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({super.key});

  @override
  ConsumerState<ResetPasswordScreen> createState() =>
      _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirmPassword = TextEditingController();
  var _sent = false;
  var _done = false;
  var _busy = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _confirmPassword.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    try {
      await ref.read(authRepositoryProvider).sendPasswordReset(_email.text);
      if (mounted) setState(() => _sent = true);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _apply(String token) async {
    if (_password.text.length < 8) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Password must be at least 8 characters.')),
      );
      return;
    }
    if (_password.text != _confirmPassword.text) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Passwords do not match.')),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(authRepositoryProvider).applyPasswordReset(
            token: token,
            password: _password.text,
          );
      if (mounted) setState(() => _done = true);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final token = GoRouterState.of(context).uri.queryParameters['token'];
    final isResetLink = token != null && token.isNotEmpty;
    return Scaffold(
      appBar: AppBar(title: const Text('Reset password')),
      body: CommsPageBackground(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Center(
                        child: AuthHero(
                          title: 'Reset Password',
                          subtitle: 'We will send a secure reset link',
                          logoSize: 64,
                        ),
                      ),
                      const SizedBox(height: 24),
                      Text(isResetLink
                          ? (_done
                              ? 'Password reset complete.'
                              : 'Enter a new password.')
                          : (_sent
                              ? 'Check your inbox. The reset link expires in 10 minutes.'
                              : 'Enter your account email.')),
                      const SizedBox(height: 12),
                      if (isResetLink && !_done) ...[
                        TextField(
                          controller: _password,
                          obscureText: true,
                          decoration: const InputDecoration(
                            labelText: 'New password',
                            prefixIcon: Icon(Icons.lock_outline),
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _confirmPassword,
                          obscureText: true,
                          decoration: const InputDecoration(
                            labelText: 'Confirm password',
                            prefixIcon: Icon(Icons.lock_reset),
                          ),
                        ),
                      ] else if (!isResetLink) ...[
                        TextField(
                          controller: _email,
                          keyboardType: TextInputType.emailAddress,
                          decoration: const InputDecoration(
                            labelText: 'Email',
                            prefixIcon: Icon(Icons.alternate_email_outlined),
                          ),
                        ),
                      ],
                      const SizedBox(height: 20),
                      if (!_done)
                        FilledButton.icon(
                          onPressed: _busy
                              ? null
                              : (isResetLink ? () => _apply(token) : _send),
                          icon: Icon(
                            isResetLink
                                ? Icons.lock_reset
                                : Icons.mark_email_read_outlined,
                            size: 18,
                          ),
                          label: Text(
                            isResetLink ? 'Update password' : 'Send reset link',
                          ),
                        ),
                      TextButton.icon(
                          onPressed: () => context.go(AppRoutes.login),
                          icon: const Icon(Icons.arrow_back, size: 16),
                          label: const Text('Back to sign in')),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
