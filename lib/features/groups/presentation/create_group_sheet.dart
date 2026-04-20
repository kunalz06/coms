import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/app_routes.dart';
import '../data/group_repository.dart';

class CreateGroupSheet extends ConsumerStatefulWidget {
  const CreateGroupSheet({super.key});

  @override
  ConsumerState<CreateGroupSheet> createState() => _CreateGroupSheetState();
}

class _CreateGroupSheetState extends ConsumerState<CreateGroupSheet> {
  final _name = TextEditingController();
  final _emails = TextEditingController();
  String? _error;
  var _loading = false;

  @override
  void dispose() {
    _name.dispose();
    _emails.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final requestedEmails = _emails.text
          .split(RegExp(r'[\s,;]+'))
          .map((email) => email.trim().toLowerCase())
          .where((email) => email.isNotEmpty)
          .toSet()
          .toList();

      final repository = ref.read(groupRepositoryProvider);
      final profiles = await repository.findProfilesByEmails(requestedEmails);
      final foundEmails =
          profiles.map((profile) => profile.email.toLowerCase()).toSet();
      final missing = requestedEmails
          .where((email) => !foundEmails.contains(email))
          .toList();

      if (missing.isNotEmpty) {
        throw FormatException(
          'No COMMS account found for: ${missing.join(', ')}',
        );
      }

      final conversation = await repository.createGroup(
        creatorId: user.uid,
        title: _name.text,
        memberIds: profiles.map((profile) => profile.id).toList(),
      );

      if (!mounted) return;
      Navigator.of(context).pop();
      context.go(
        AppRoutes.conversation.replaceFirst(':conversationId', conversation.id),
      );
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
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
            Text('Create group', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            TextField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Group name'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _emails,
              minLines: 2,
              maxLines: 4,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                labelText: 'Member emails',
                helperText: 'Separate emails with commas or new lines.',
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _loading ? null : _create,
              icon: const Icon(Icons.groups_2_outlined),
              label: Text(_loading ? 'Creating...' : 'Create group'),
            ),
          ],
        ),
      ),
    );
  }
}
