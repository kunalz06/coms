import 'dart:async';

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
  final _otp = TextEditingController();
  final _password = TextEditingController();
  final _confirmPassword = TextEditingController();
  var _sent = false;
  var _done = false;
  var _busy = false;
  var _resendSeconds = 0;
  Timer? _resendTimer;

  @override
  void dispose() {
    _email.dispose();
    _otp.dispose();
    _password.dispose();
    _confirmPassword.dispose();
    _resendTimer?.cancel();
    super.dispose();
  }

  Future<void> _send() async {
    if (_resendSeconds > 0) return;
    setState(() => _busy = true);
    try {
      await ref.read(authRepositoryProvider).sendPasswordReset(_email.text);
      if (!mounted) return;
      setState(() => _sent = true);
      _startResendCooldown();
      await _showInfo(
        context,
        'OTP sent. Check your email. You can request another OTP after the cooldown.',
      );
    } catch (error) {
      if (!mounted) return;
      await _showError(context, error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _startResendCooldown() {
    _resendTimer?.cancel();
    setState(() => _resendSeconds = 60);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_resendSeconds <= 1) {
        timer.cancel();
        setState(() => _resendSeconds = 0);
        return;
      }
      setState(() => _resendSeconds -= 1);
    });
  }

  Future<void> _apply() async {
    if (_otp.text.trim().length != 6) {
      await _showError(context, 'Enter the 6 character OTP from your email.');
      return;
    }
    if (_password.text.length < 8) {
      await _showError(context, 'Password must be at least 8 characters.');
      return;
    }
    if (_password.text != _confirmPassword.text) {
      await _showError(context, 'Passwords do not match.');
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(authRepositoryProvider).applyPasswordReset(
            email: _email.text,
            otp: _otp.text,
            password: _password.text,
          );
      if (mounted) setState(() => _done = true);
    } catch (error) {
      if (!mounted) return;
      await _showError(context, error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
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
                          subtitle: 'We will send a 6 character OTP',
                          logoSize: 64,
                        ),
                      ),
                      const SizedBox(height: 24),
                      Text(_done
                          ? 'Password reset complete.'
                          : (_sent
                              ? 'Enter the OTP sent to your account email. It expires in 5 minutes.'
                              : 'Enter your account email.')),
                      const SizedBox(height: 12),
                      if (!_done) ...[
                        TextField(
                          controller: _email,
                          enabled: !_sent,
                          keyboardType: TextInputType.emailAddress,
                          decoration: const InputDecoration(
                            labelText: 'Email',
                            prefixIcon: Icon(Icons.alternate_email_outlined),
                          ),
                        ),
                        if (_sent) ...[
                          const SizedBox(height: 12),
                          TextField(
                            controller: _otp,
                            textCapitalization: TextCapitalization.characters,
                            decoration: const InputDecoration(
                              labelText: 'OTP',
                              prefixIcon: Icon(Icons.password_outlined),
                            ),
                          ),
                          const SizedBox(height: 12),
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
                        ],
                      ],
                      const SizedBox(height: 20),
                      if (!_done)
                        FilledButton.icon(
                          onPressed: _busy || (!_sent && _resendSeconds > 0)
                              ? null
                              : (_sent ? _apply : _send),
                          icon: Icon(
                            _sent
                                ? Icons.lock_reset
                                : Icons.mark_email_read_outlined,
                            size: 18,
                          ),
                          label: Text(
                            _sent ? 'Update password' : 'Send OTP',
                          ),
                        ),
                      if (_sent && !_done)
                        TextButton(
                          onPressed:
                              _busy || _resendSeconds > 0 ? null : _send,
                          child: Text(
                            _resendSeconds > 0
                                ? 'Send another OTP in ${_resendSeconds}s'
                                : 'Send another OTP',
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

Future<void> _showInfo(BuildContext context, String message) {
  if (!context.mounted) return Future.value();
  return showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('OTP sent'),
      content: Text(message),
      actions: [
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('OK'),
        ),
      ],
    ),
  );
}

Future<void> _showError(BuildContext context, String message) {
  if (!context.mounted) return Future.value();
  return showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Something went wrong'),
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
