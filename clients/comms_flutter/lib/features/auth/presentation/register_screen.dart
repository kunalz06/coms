import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/app_routes.dart';
import '../../../shared/widgets/comms_logo.dart';
import '../data/auth_repository.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  var _loading = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      await ref.read(authRepositoryProvider).register(
          fullName: _name.text, email: _email.text, password: _password.text);
      if (mounted) context.go(AppRoutes.chats);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Create account')),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const CommsLogo(size: 64, showWordmark: true),
                  const SizedBox(height: 28),
                  TextFormField(
                    controller: _name,
                    decoration: const InputDecoration(labelText: 'Full name'),
                    validator: (value) =>
                        value == null || value.trim().length < 2
                            ? 'Enter your name.'
                            : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(labelText: 'Email'),
                    validator: (value) => value == null || !value.contains('@')
                        ? 'Enter a valid email.'
                        : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _password,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: 'Password'),
                    validator: (value) => value == null || value.length < 8
                        ? 'Use at least 8 characters.'
                        : null,
                  ),
                  const SizedBox(height: 20),
                  FilledButton(
                      onPressed: _loading ? null : _submit,
                      child: const Text('Create account')),
                  TextButton(
                      onPressed: () => context.go(AppRoutes.login),
                      child: const Text('I already have an account')),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
