import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../features/chats/data/chat_repository.dart';
import '../../../shared/widgets/comms_avatar.dart';
import '../../../shared/widgets/state_views.dart';

class GroupInfoScreen extends ConsumerWidget {
  const GroupInfoScreen({required this.conversationId, super.key});

  final String conversationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final conversation = ref.watch(_conversationProvider(conversationId));
    final members = ref.watch(_membersProvider(conversationId));

    return Scaffold(
      appBar: AppBar(title: const Text('Group info')),
      body: conversation.when(
        data: (conversation) {
          if (conversation == null || !conversation.isGroup) {
            return const EmptyState(
              title: 'Group unavailable',
              message: 'This conversation is not a group or is no longer open.',
            );
          }

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Center(
                child: Column(
                  children: [
                    CommsAvatar(
                      name: conversation.title ?? 'Group',
                      imageUrl: conversation.avatarUrl,
                      radius: 42,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      conversation.title ?? 'Group',
                      style: Theme.of(context).textTheme.headlineSmall,
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              Text('Members', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              members.when(
                data: (items) => Card(
                  child: Column(
                    children: [
                      for (final member in items)
                        ListTile(
                          leading: CommsAvatar(
                            name: member.profile?.fullName ?? 'COMMS user',
                            imageUrl: member.profile?.avatarUrl,
                          ),
                          title:
                              Text(member.profile?.fullName ?? member.userId),
                          subtitle:
                              Text(member.profile?.email ?? member.userId),
                          trailing: _RoleChip(role: member.role),
                        ),
                    ],
                  ),
                ),
                loading: () => const Padding(
                  padding: EdgeInsets.all(24),
                  child: LoadingState(),
                ),
                error: (error, _) => EmptyState(
                  title: 'Could not load members',
                  message: error.toString(),
                ),
              ),
            ],
          );
        },
        loading: () => const LoadingState(),
        error: (error, _) => EmptyState(
          title: 'Could not load group',
          message: error.toString(),
        ),
      ),
    );
  }
}

class _RoleChip extends StatelessWidget {
  const _RoleChip({required this.role});

  final String role;

  @override
  Widget build(BuildContext context) {
    return Chip(
      label: Text(role),
      visualDensity: VisualDensity.compact,
      padding: EdgeInsets.zero,
    );
  }
}

final _conversationProvider =
    StreamProvider.family((ref, String conversationId) {
  return ref.watch(chatRepositoryProvider).watchConversation(conversationId);
});

final _membersProvider = StreamProvider.family((ref, String conversationId) {
  return ref.watch(chatRepositoryProvider).watchMembers(conversationId);
});
