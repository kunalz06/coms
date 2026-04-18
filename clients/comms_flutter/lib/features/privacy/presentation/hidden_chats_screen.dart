import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/app_routes.dart';
import '../../../shared/widgets/state_views.dart';
import '../../chats/data/chat_repository.dart';
import '../data/privacy_controller.dart';

class HiddenChatsScreen extends ConsumerStatefulWidget {
  const HiddenChatsScreen({super.key});

  @override
  ConsumerState<HiddenChatsScreen> createState() => _HiddenChatsScreenState();
}

class _HiddenChatsScreenState extends ConsumerState<HiddenChatsScreen> {
  var _unlocking = false;

  Future<bool> _ensureUnlocked() async {
    final privacy = ref.read(privacyControllerProvider);
    if (!privacy.hiddenPasswordConfigured || privacy.hiddenUnlocked)
      return true;
    if (_unlocking) return false;
    setState(() => _unlocking = true);
    try {
      final controller = TextEditingController();
      final password = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Unlock hidden chats'),
          content: TextField(
            controller: controller,
            obscureText: true,
            decoration: const InputDecoration(
              hintText: 'Enter hidden chats password',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () =>
                  Navigator.of(context).pop(controller.text.trim()),
              child: const Text('Unlock'),
            ),
          ],
        ),
      );
      if (password == null || password.isEmpty) return false;
      final ok = await ref
          .read(privacyControllerProvider.notifier)
          .unlockHidden(password);
      if (!ok && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Wrong hidden chats password.')),
        );
      }
      return ok;
    } finally {
      if (mounted) setState(() => _unlocking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return const LoadingState();

    final privacy = ref.watch(privacyControllerProvider);
    final conversations = ref.watch(_conversationListProvider(user.uid));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Hidden chats'),
        actions: [
          IconButton(
            onPressed: () =>
                ref.read(privacyControllerProvider.notifier).lockSessions(),
            icon: const Icon(Icons.lock_outline),
            tooltip: 'Lock hidden area',
          ),
        ],
      ),
      body: conversations.when(
        data: (items) {
          final hidden = items
              .where((item) => privacy.hiddenConversationIds.contains(item.id))
              .toList(growable: false);

          if (hidden.isEmpty) {
            return const EmptyState(
              title: 'No hidden chats',
              message: 'Chats hidden from the main list appear here.',
            );
          }

          if (privacy.hiddenPasswordConfigured && !privacy.hiddenUnlocked) {
            return Center(
              child: FilledButton.icon(
                onPressed: _unlocking ? null : _ensureUnlocked,
                icon: const Icon(Icons.lock_open_outlined),
                label:
                    Text(_unlocking ? 'Unlocking...' : 'Unlock hidden chats'),
              ),
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.all(12),
            itemCount: hidden.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final conversation = hidden[index];
              return ListTile(
                leading: CircleAvatar(
                  child: Icon(
                    conversation.isGroup ? Icons.groups : Icons.person,
                  ),
                ),
                title: Text(conversation.title ?? 'Hidden conversation'),
                subtitle: Text(
                  conversation.isGroup ? 'Hidden group' : 'Hidden direct chat',
                ),
                trailing: PopupMenuButton<String>(
                  onSelected: (value) async {
                    if (value == 'unhide') {
                      await ref
                          .read(privacyControllerProvider.notifier)
                          .setConversationHidden(
                            conversationId: conversation.id,
                            hidden: false,
                          );
                    }
                  },
                  itemBuilder: (context) => const [
                    PopupMenuItem(value: 'unhide', child: Text('Unhide chat')),
                  ],
                ),
                onTap: () => context.go(
                  AppRoutes.conversation
                      .replaceFirst(':conversationId', conversation.id),
                ),
              );
            },
          );
        },
        loading: () => const LoadingState(),
        error: (error, _) => EmptyState(
          title: 'Could not load hidden chats',
          message: error.toString(),
        ),
      ),
    );
  }
}

final _conversationListProvider = StreamProvider.family((ref, String userId) {
  return ref.watch(chatRepositoryProvider).watchConversations(userId);
});
