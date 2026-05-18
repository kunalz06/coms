import 'dart:async';

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
  Timer? _debounce;
  Timer? _searchCooldownTimer;
  var _loading = false;
  var _adding = false;
  var _searchCooldown = false;
  var _searchSerial = 0;
  String? _lastSearchQuery;

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCooldownTimer?.cancel();
    _email.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final query = _email.text.trim();
    final normalizedQuery = query.toLowerCase();
    if (!query.contains('@')) {
      setState(() {
        _result = null;
        _error = null;
      });
      return;
    }
    if (_searchCooldown && normalizedQuery == _lastSearchQuery) return;
    final serial = ++_searchSerial;
    _lastSearchQuery = normalizedQuery;
    _startSearchCooldown();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result =
          await ref.read(contactRepositoryProvider).searchByEmail(query);
      if (mounted && serial == _searchSerial) {
        setState(() {
          _result = result;
          _error =
              result == null ? 'No COMMS user found for that email.' : null;
        });
      }
    } catch (error) {
      if (mounted && serial == _searchSerial) await _showError(error.toString());
    } finally {
      if (mounted && serial == _searchSerial) {
        setState(() => _loading = false);
      }
    }
  }

  void _startSearchCooldown() {
    _searchCooldownTimer?.cancel();
    setState(() => _searchCooldown = true);
    _searchCooldownTimer = Timer(const Duration(milliseconds: 800), () {
      if (mounted) setState(() => _searchCooldown = false);
    });
  }

  Future<void> _addAndOpen(UserProfile profile) async {
    final me = FirebaseAuth.instance.currentUser;
    if (me == null) return;
    setState(() {
      _adding = true;
      _error = null;
    });
    final repository = ref.read(contactRepositoryProvider);
    try {
      await repository.addFriend(addresseeId: profile.id);
      final conversation =
          await repository.getOrCreateDirectConversation(profile.id);
      if (!mounted) return;
      Navigator.of(context).pop();
      context.go(AppRoutes.conversation
          .replaceFirst(':conversationId', conversation.id));
    } catch (error) {
      if (mounted) await _showError(error.toString());
    } finally {
      if (mounted) setState(() => _adding = false);
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
            Text('Add friend', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Email address'),
              onChanged: (_) {
                _debounce?.cancel();
                _debounce = Timer(
                  const Duration(milliseconds: 350),
                  _search,
                );
              },
              onSubmitted: (_) => _search(),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _loading || _searchCooldown ? null : _search,
              child: Text(
                _loading
                    ? 'Searching...'
                    : _searchCooldown
                        ? 'Please wait...'
                        : 'Search',
              ),
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
                    onPressed: _adding ? null : () => _addAndOpen(_result!),
                    child: Text(_adding ? 'Adding...' : 'Add'),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _showError(String message) {
    setState(() => _error = message);
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
}
