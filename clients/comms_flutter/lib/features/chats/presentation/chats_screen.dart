import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/app_routes.dart';
import '../../../core/responsive/breakpoints.dart';
import '../../../shared/widgets/state_views.dart';
import '../../contacts/presentation/add_contact_sheet.dart';
import '../../groups/presentation/create_group_sheet.dart';
import '../../privacy/data/privacy_controller.dart';
import '../data/chat_repository.dart';

class ChatsScreen extends ConsumerWidget {
  const ChatsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return const LoadingState();
    final conversations = ref.watch(_conversationListProvider(user.uid));
    final privacy = ref.watch(privacyControllerProvider);

    return LayoutBuilder(
      builder: (context, constraints) {
        final wide =
            windowClassForWidth(constraints.maxWidth) != WindowClass.compact;
        return Row(
          children: [
            SizedBox(
              width: wide ? 380 : constraints.maxWidth,
              child: Scaffold(
                appBar: AppBar(
                  title: const Text('Chats'),
                  actions: [
                    IconButton(
                        onPressed: () {},
                        icon: const Icon(Icons.search),
                        tooltip: 'Search'),
                  ],
                ),
                floatingActionButton: FloatingActionButton.extended(
                  onPressed: () {
                    showModalBottomSheet<void>(
                      context: context,
                      isScrollControlled: true,
                      builder: (sheetContext) => _StartChatSheet(
                        onAddFriend: () {
                          Navigator.of(sheetContext).pop();
                          showModalBottomSheet<void>(
                            context: context,
                            isScrollControlled: true,
                            builder: (context) => const AddContactSheet(),
                          );
                        },
                        onCreateGroup: () {
                          Navigator.of(sheetContext).pop();
                          showModalBottomSheet<void>(
                            context: context,
                            isScrollControlled: true,
                            builder: (context) => const CreateGroupSheet(),
                          );
                        },
                      ),
                    );
                  },
                  icon: const Icon(Icons.add),
                  label: const Text('New'),
                ),
                body: conversations.when(
                  data: (items) {
                    final visible = items
                        .where(
                          (conversation) =>
                              !privacy.hiddenConversationIds
                                  .contains(conversation.id),
                        )
                        .toList(growable: false);

                    if (visible.isEmpty) {
                      return const EmptyState(
                          title: 'No chats yet',
                          message:
                              'Search by email or start a group when contacts are ready.');
                    }
                    return ListView.separated(
                      itemCount: visible.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final conversation = visible[index];
                        final locked = privacy.lockedConversationIds
                            .contains(conversation.id);
                        final unread = ref.watch(_unreadCountProvider(
                          _UnreadArgs(conversation.id, user.uid),
                        ));
                        return ListTile(
                          leading: CircleAvatar(
                              child: Icon(conversation.isGroup
                                  ? Icons.groups
                                  : Icons.person)),
                          title: Text(conversation.title ?? 'Direct chat'),
                          subtitle: Text(conversation.isGroup
                                  ? 'Group conversation'
                                  : 'Direct conversation'),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (locked)
                                const Padding(
                                  padding: EdgeInsets.only(right: 8),
                                  child: Icon(Icons.lock_outline, size: 18),
                                ),
                              unread.when(
                                data: (count) => count > 0
                                    ? Badge(label: Text('$count'))
                                    : const SizedBox.shrink(),
                                loading: () => const SizedBox.shrink(),
                                error: (_, __) => const SizedBox.shrink(),
                              ),
                              const SizedBox(width: 8),
                              PopupMenuButton<String>(
                                icon: const Icon(Icons.more_vert),
                                onSelected: (value) async {
                                  final controller = ref
                                      .read(privacyControllerProvider.notifier);
                                  if (value == 'hide') {
                                    await controller.setConversationHidden(
                                      conversationId: conversation.id,
                                      hidden: true,
                                    );
                                  } else if (value == 'lock') {
                                    await controller.setConversationLocked(
                                      conversationId: conversation.id,
                                      locked: true,
                                    );
                                  } else if (value == 'unlock') {
                                    await controller.setConversationLocked(
                                      conversationId: conversation.id,
                                      locked: false,
                                    );
                                  }
                                },
                                itemBuilder: (context) => [
                                  const PopupMenuItem(
                                    value: 'hide',
                                    child: Text('Hide chat'),
                                  ),
                                  PopupMenuItem(
                                    value: locked ? 'unlock' : 'lock',
                                    child: Text(
                                        locked ? 'Remove lock' : 'Lock chat'),
                                  ),
                                ],
                              ),
                              const Icon(Icons.chevron_right),
                            ],
                          ),
                          onTap: () async {
                            final canOpen = await _canOpenConversation(
                              context: context,
                              ref: ref,
                              conversationId: conversation.id,
                            );
                            if (!canOpen || !context.mounted) return;
                            context.go(
                              AppRoutes.conversation
                                  .replaceFirst(':conversationId', conversation.id),
                            );
                          },
                        );
                      },
                    );
                  },
                  loading: () => const LoadingState(),
                  error: (error, _) => EmptyState(
                      title: 'Could not load chats', message: error.toString()),
                ),
              ),
            ),
            if (wide) ...[
              VerticalDivider(
                  width: 1,
                  color: Theme.of(context).colorScheme.outlineVariant),
              const Expanded(
                child: EmptyState(
                  title: 'Choose a conversation',
                  message:
                      'Messages, files, calls, and restored archives will open here.',
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}

Future<bool> _canOpenConversation({
  required BuildContext context,
  required WidgetRef ref,
  required String conversationId,
}) async {
  final privacy = ref.read(privacyControllerProvider);
  if (!privacy.lockedConversationIds.contains(conversationId)) return true;
  if (!privacy.chatLockConfigured || privacy.chatUnlocked) return true;

  final controller = TextEditingController();
  final password = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Unlock chat'),
      content: TextField(
        controller: controller,
        obscureText: true,
        decoration: const InputDecoration(hintText: 'Enter chat lock password'),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(controller.text.trim()),
          child: const Text('Unlock'),
        ),
      ],
    ),
  );
  if (password == null || password.isEmpty) return false;
  final ok = await ref
      .read(privacyControllerProvider.notifier)
      .unlockChatLock(password);
  if (!ok && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Wrong chat lock password.')),
    );
  }
  return ok;
}

final _conversationListProvider = StreamProvider.family((ref, String userId) {
  return ref.watch(chatRepositoryProvider).watchConversations(userId);
});

final _unreadCountProvider =
    FutureProvider.family<int, _UnreadArgs>((ref, args) {
  return ref.watch(chatRepositoryProvider).unreadCount(
        conversationId: args.conversationId,
        userId: args.userId,
      );
});

class _UnreadArgs {
  const _UnreadArgs(this.conversationId, this.userId);

  final String conversationId;
  final String userId;

  @override
  bool operator ==(Object other) {
    return other is _UnreadArgs &&
        other.conversationId == conversationId &&
        other.userId == userId;
  }

  @override
  int get hashCode => Object.hash(conversationId, userId);
}

class _StartChatSheet extends StatelessWidget {
  const _StartChatSheet({
    required this.onAddFriend,
    required this.onCreateGroup,
  });

  final VoidCallback onAddFriend;
  final VoidCallback onCreateGroup;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.person_add_alt_outlined),
              title: const Text('Add friend'),
              subtitle: const Text('Search by registered email address'),
              onTap: onAddFriend,
            ),
            ListTile(
              leading: const Icon(Icons.groups_2_outlined),
              title: const Text('Create group'),
              subtitle: const Text('Start a group with up to 10 members'),
              onTap: onCreateGroup,
            ),
          ],
        ),
      ),
    );
  }
}
