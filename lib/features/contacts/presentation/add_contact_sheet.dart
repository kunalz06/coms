import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/app_routes.dart';
import '../../../shared/models/user_profile.dart';
import '../../../shared/widgets/comms_avatar.dart';
import '../data/contact_repository.dart';

class AddContactSheet extends ConsumerStatefulWidget {
  const AddContactSheet({super.key});

  @override
  ConsumerState<AddContactSheet> createState() => _AddContactSheetState();
}

class _AddContactSheetState extends ConsumerState<AddContactSheet> {
  final _email = TextEditingController();
  UserProfile? _result;
  String? _error;
  var _loading = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result =
          await ref.read(contactRepositoryProvider).searchByEmail(_email.text);
      if (mounted) {
        setState(() {
          _result = result;
          _error =
              result == null ? 'No COMMS user found for that email.' : null;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _addAndOpen(UserProfile profile) async {
    final me = FirebaseAuth.instance.currentUser;
    if (me == null) return;
    final repository = ref.read(contactRepositoryProvider);
    await repository.addFriend(requesterId: me.uid, addresseeId: profile.id);
    final conversation =
        await repository.getOrCreateDirectConversation(profile.id);
    if (!mounted) return;
    Navigator.of(context).pop();
    context.go(AppRoutes.conversation
        .replaceFirst(':conversationId', conversation.id));
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 16,
          bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Add friend', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Email address'),
              onSubmitted: (_) => _search(),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _loading ? null : _search,
              child: Text(_loading ? 'Searching...' : 'Search'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
            if (_result != null) ...[
              const SizedBox(height: 16),
              Card(
                child: ListTile(
                  leading: CommsAvatar(
                    name: _result!.fullName,
                    imageUrl: _result!.avatarUrl,
                  ),
                  title: Text(_result!.fullName),
                  subtitle: Text(_result!.email),
                  trailing: FilledButton(
                    onPressed: () => _addAndOpen(_result!),
                    child: const Text('Add'),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
