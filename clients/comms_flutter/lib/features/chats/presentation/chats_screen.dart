import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/app_routes.dart';
import '../../../core/responsive/breakpoints.dart';
import '../../../shared/widgets/state_views.dart';
import '../../contacts/presentation/add_contact_sheet.dart';
import '../../contacts/data/contact_repository.dart';
import '../../groups/data/group_repository.dart';
import '../../groups/presentation/create_group_sheet.dart';
import '../../privacy/data/privacy_controller.dart';
import '../../search/data/search_repository.dart';
import '../data/chat_list_preferences_controller.dart';
import '../data/chat_repository.dart';

class ChatsScreen extends ConsumerWidget {
  const ChatsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return const LoadingState();
    final conversations = ref.watch(_conversationListProvider(user.uid));
    final privacy = ref.watch(privacyControllerProvider);
    final pinnedIds =
        ref.watch(_pinnedIdsProvider(user.uid)).valueOrNull ?? const <String>{};
    final mutedIds =
        ref.watch(_mutedIdsProvider(user.uid)).valueOrNull ?? const <String>{};
    final unreadIds =
        ref.watch(_unreadIdsProvider(user.uid)).valueOrNull ?? const <String>{};
    final unreadFirst = ref.watch(chatUnreadFirstControllerProvider);

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
                        onPressed: () => _openGlobalSearch(context, ref),
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
                          (conversation) => !privacy.hiddenConversationIds
                              .contains(conversation.id),
                        )
                        .toList()
                      ..sort((a, b) {
                        final aPinned = pinnedIds.contains(a.id);
                        final bPinned = pinnedIds.contains(b.id);
                        if (aPinned != bPinned) return aPinned ? -1 : 1;
                        if (unreadFirst) {
                          final aUnread = unreadIds.contains(a.id);
                          final bUnread = unreadIds.contains(b.id);
                          if (aUnread != bUnread) return aUnread ? -1 : 1;
                        }
                        return (b.lastMessageAt ?? b.updatedAt)
                            .compareTo(a.lastMessageAt ?? a.updatedAt);
                      });

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
                        final muted = mutedIds.contains(conversation.id);
                        final unread = ref.watch(_unreadCountProvider(
                          _UnreadArgs(conversation.id, user.uid),
                        ));
                        final hasUnread = unreadIds.contains(conversation.id);
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
                              if (muted)
                                const Padding(
                                  padding: EdgeInsets.only(right: 8),
                                  child:
                                      Icon(Icons.volume_off_outlined, size: 18),
                                ),
                              unread.when(
                                data: (count) => count > 0 || hasUnread
                                    ? Badge(
                                        label: Text(
                                          count > 0 ? '$count' : '•',
                                        ),
                                      )
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
                                  } else if (value == 'pin') {
                                    await ref
                                        .read(chatRepositoryProvider)
                                        .setConversationPinned(
                                          conversationId: conversation.id,
                                          userId: user.uid,
                                          pinned: true,
                                        );
                                  } else if (value == 'unpin') {
                                    await ref
                                        .read(chatRepositoryProvider)
                                        .setConversationPinned(
                                          conversationId: conversation.id,
                                          userId: user.uid,
                                          pinned: false,
                                        );
                                  } else if (value == 'mute') {
                                    await ref
                                        .read(chatRepositoryProvider)
                                        .setConversationMuted(
                                          conversationId: conversation.id,
                                          userId: user.uid,
                                          muted: true,
                                        );
                                  } else if (value == 'unmute') {
                                    await ref
                                        .read(chatRepositoryProvider)
                                        .setConversationMuted(
                                          conversationId: conversation.id,
                                          userId: user.uid,
                                          muted: false,
                                        );
                                  } else if (value == 'delete_direct') {
                                    final peerId =
                                        conversation.userOneId == user.uid
                                            ? conversation.userTwoId
                                            : conversation.userOneId;
                                    if (peerId != null) {
                                      await ref
                                          .read(contactRepositoryProvider)
                                          .deleteFriend(
                                            currentUserId: user.uid,
                                            otherUserId: peerId,
                                          );
                                    }
                                  } else if (value == 'leave_group') {
                                    await ref
                                        .read(groupRepositoryProvider)
                                        .leaveGroup(
                                          conversationId: conversation.id,
                                          userId: user.uid,
                                        );
                                  } else if (value == 'delete_group') {
                                    await ref
                                        .read(groupRepositoryProvider)
                                        .deleteGroup(
                                          conversationId: conversation.id,
                                        );
                                  }
                                },
                                itemBuilder: (context) => [
                                  const PopupMenuItem(
                                    value: 'hide',
                                    child: _MenuItemLabel(
                                      icon: Icons.visibility_off_outlined,
                                      label: 'Hide chat',
                                    ),
                                  ),
                                  PopupMenuItem(
                                    value: locked ? 'unlock' : 'lock',
                                    child: _MenuItemLabel(
                                      icon: locked
                                          ? Icons.lock_open_outlined
                                          : Icons.lock_outline,
                                      label:
                                          locked ? 'Remove lock' : 'Lock chat',
                                    ),
                                  ),
                                  PopupMenuItem(
                                    value: pinnedIds.contains(conversation.id)
                                        ? 'unpin'
                                        : 'pin',
                                    child: _MenuItemLabel(
                                      icon: pinnedIds.contains(conversation.id)
                                          ? Icons.push_pin_outlined
                                          : Icons.push_pin,
                                      label: pinnedIds.contains(conversation.id)
                                          ? 'Unpin chat'
                                          : 'Pin chat',
                                    ),
                                  ),
                                  PopupMenuItem(
                                    value: muted ? 'unmute' : 'mute',
                                    child: _MenuItemLabel(
                                      icon: muted
                                          ? Icons.volume_up_outlined
                                          : Icons.volume_off_outlined,
                                      label:
                                          muted ? 'Unmute chat' : 'Mute chat',
                                    ),
                                  ),
                                  if (conversation.isDirect)
                                    const PopupMenuItem(
                                      value: 'delete_direct',
                                      child: _MenuItemLabel(
                                        icon: Icons.person_remove_outlined,
                                        label: 'Delete contact',
                                      ),
                                    ),
                                  if (conversation.isGroup &&
                                      conversation.createdBy != user.uid)
                                    const PopupMenuItem(
                                      value: 'leave_group',
                                      child: _MenuItemLabel(
                                        icon: Icons.logout,
                                        label: 'Leave group',
                                      ),
                                    ),
                                  if (conversation.isGroup &&
                                      conversation.createdBy == user.uid)
                                    const PopupMenuItem(
                                      value: 'delete_group',
                                      child: _MenuItemLabel(
                                        icon: Icons.delete_outline,
                                        label: 'Delete group',
                                      ),
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
                              AppRoutes.conversation.replaceFirst(
                                  ':conversationId', conversation.id),
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

Future<void> _openGlobalSearch(BuildContext context, WidgetRef ref) async {
  final queryController = TextEditingController();
  var query = '';
  List<SearchResult> results = const [];
  var loading = false;
  String? error;

  await showDialog<void>(
    context: context,
    builder: (dialogContext) {
      return StatefulBuilder(
        builder: (context, setState) {
          Future<void> runSearch() async {
            final nextQuery = queryController.text.trim();
            if (nextQuery.length < 2) {
              setState(() {
                query = nextQuery;
                results = const [];
                loading = false;
                error = null;
              });
              return;
            }

            setState(() {
              query = nextQuery;
              loading = true;
              error = null;
            });

            try {
              final privacy = ref.read(privacyControllerProvider);
              final rawResults = await ref
                  .read(searchRepositoryProvider)
                  .searchUnlockedMessages(nextQuery);

              final filtered = rawResults.where((item) {
                final conversationId = item.conversationId;
                if (privacy.hiddenConversationIds.contains(conversationId) &&
                    !privacy.hiddenUnlocked) {
                  return false;
                }
                if (privacy.lockedConversationIds.contains(conversationId) &&
                    privacy.chatLockConfigured &&
                    !privacy.chatUnlocked) {
                  return false;
                }
                return true;
              }).toList(growable: false);

              setState(() {
                results = filtered;
                loading = false;
              });
            } catch (e) {
              setState(() {
                loading = false;
                error = e.toString();
              });
            }
          }

          return AlertDialog(
            title: const Text('Search messages'),
            content: SizedBox(
              width: 520,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: queryController,
                    autofocus: true,
                    onSubmitted: (_) => runSearch(),
                    decoration: const InputDecoration(
                      hintText: 'Search across chats',
                      prefixIcon: Icon(Icons.search),
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (loading) const LinearProgressIndicator(),
                  if (!loading && error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                  if (!loading && error == null)
                    SizedBox(
                      height: 280,
                      child: results.isEmpty
                          ? Padding(
                              padding: const EdgeInsets.only(top: 12),
                              child: Text(
                                query.length < 2
                                    ? 'Type at least 2 characters.'
                                    : 'No results found.',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            )
                          : ListView.builder(
                              itemCount: results.length,
                              itemBuilder: (context, index) {
                                final result = results[index];
                                return ListTile(
                                  title: Text(
                                    result.message.content ??
                                        result.message.kind.toUpperCase(),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  subtitle: Text(
                                    '${result.conversationTitle} • ${result.senderLabel} • ${result.message.createdAt.toLocal()}',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  onTap: () {
                                    Navigator.of(dialogContext).pop();
                                    if (context.mounted) {
                                      context.go(
                                        AppRoutes.conversation.replaceFirst(
                                          ':conversationId',
                                          result.conversationId,
                                        ),
                                      );
                                    }
                                  },
                                );
                              },
                            ),
                    ),
                ],
              ),
            ),
            actions: [
              TextButton.icon(
                onPressed: () => Navigator.of(dialogContext).pop(),
                icon: const Icon(Icons.close),
                label: const Text('Close'),
              ),
              FilledButton.icon(
                onPressed: runSearch,
                icon: const Icon(Icons.search),
                label: const Text('Search'),
              ),
            ],
          );
        },
      );
    },
  );
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
        TextButton.icon(
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(Icons.close),
          label: const Text('Cancel'),
        ),
        FilledButton.icon(
          onPressed: () => Navigator.of(context).pop(controller.text.trim()),
          icon: const Icon(Icons.lock_open_outlined),
          label: const Text('Unlock'),
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

final _pinnedIdsProvider = StreamProvider.family((ref, String userId) {
  return ref.watch(chatRepositoryProvider).watchPinnedConversationIds(userId);
});

final _mutedIdsProvider = StreamProvider.family((ref, String userId) {
  return ref.watch(chatRepositoryProvider).watchMutedConversationIds(userId);
});

final _unreadIdsProvider = StreamProvider.family((ref, String userId) {
  return ref.watch(chatRepositoryProvider).watchUnreadConversationIds(userId);
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

class _MenuItemLabel extends StatelessWidget {
  const _MenuItemLabel({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18),
        const SizedBox(width: 8),
        Text(label),
      ],
    );
  }
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
