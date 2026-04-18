import 'package:file_picker/file_picker.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../features/auth/data/auth_repository.dart';
import '../../../features/uploads/data/cloudinary_upload_service.dart';
import '../../../shared/widgets/state_views.dart';

class AccountSettingsScreen extends ConsumerStatefulWidget {
  const AccountSettingsScreen({super.key});

  @override
  ConsumerState<AccountSettingsScreen> createState() =>
      _AccountSettingsScreenState();
}

class _AccountSettingsScreenState extends ConsumerState<AccountSettingsScreen> {
  var _busy = false;

  Future<void> _changeEmail() async {
    final controller = TextEditingController();
    final next = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Change email'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(hintText: 'new@email.com'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text.trim()),
            child: const Text('Update'),
          ),
        ],
      ),
    );
    if (next == null || next.isEmpty) return;

    await _run(() async {
      await ref.read(authRepositoryProvider).changeEmail(next);
      await ref.read(authRepositoryProvider).syncProfile(email: next);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Verification email sent for address update.'),
        ),
      );
    });
  }

  Future<void> _changePassword() async {
    final controller = TextEditingController();
    final next = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Change password'),
        content: TextField(
          controller: controller,
          obscureText: true,
          decoration: const InputDecoration(hintText: 'Minimum 8 characters'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text.trim()),
            child: const Text('Update'),
          ),
        ],
      ),
    );
    if (next == null || next.length < 8) {
      if (!mounted || next == null) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Password must be at least 8 characters.')),
      );
      return;
    }

    await _run(() async {
      await ref.read(authRepositoryProvider).changePassword(next);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Password updated.')),
      );
    });
  }

  Future<void> _changeProfilePicture() async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.image,
      allowMultiple: false,
      withData: true,
    );
    final file = picked?.files.single;
    if (file == null) return;

    await _run(() async {
      final attachment = await ref.read(cloudinaryUploadServiceProvider).upload(
            file: file,
            kind: 'image',
            onProgress: (_) {},
          );
      await ref.read(authRepositoryProvider).updateAvatar(attachment.url);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Profile picture updated.')),
      );
    });
  }

  Future<void> _run(Future<void> Function() task) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await task();
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
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return const LoadingState();

    return Scaffold(
      appBar: AppBar(title: const Text('Account settings')),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          ListTile(
            leading: const Icon(Icons.alternate_email),
            title: const Text('Email'),
            subtitle: Text(user.email ?? 'Unknown'),
            trailing: TextButton(
              onPressed: _busy ? null : _changeEmail,
              child: const Text('Change'),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.lock_outline),
            title: const Text('Password'),
            subtitle: const Text('Update your account password'),
            trailing: TextButton(
              onPressed: _busy ? null : _changePassword,
              child: const Text('Change'),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.photo_camera_outlined),
            title: const Text('Profile picture'),
            subtitle: const Text('Upload a new profile image'),
            trailing: TextButton(
              onPressed: _busy ? null : _changeProfilePicture,
              child: const Text('Update'),
            ),
          ),
        ],
      ),
    );
  }
}
