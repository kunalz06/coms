import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/app_routes.dart';
import '../../../shared/models/conversation.dart';
import '../../chats/data/chat_repository.dart';
import '../../../shared/widgets/state_views.dart';
import '../data/call_controller.dart';
import '../data/call_repository.dart';
import '../domain/call_models.dart';
import '../domain/call_state.dart';
import 'active_call_panel.dart';

class CallsScreen extends ConsumerWidget {
  const CallsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return const LoadingState();
    final controller = ref.watch(callControllerProvider);
    final calls = ref.watch(_recentCallsProvider(user.uid));
    final callActive = controller.status != CommsCallStatus.idle &&
        controller.status != CommsCallStatus.ended &&
        controller.status != CommsCallStatus.failed;

    if (callActive && !controller.isMinimized) {
      return Scaffold(
        appBar: AppBar(
          title: Text(controller.isGroupCall ? 'Group call' : 'Direct call'),
        ),
        body: const ActiveCallPanel(),
      );
    }

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Calls'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Make Call'),
              Tab(text: 'Recent'),
            ],
          ),
        ),
        body: Column(
          children: [
            if (callActive && controller.isMinimized)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 10),
                    child: Row(
                      children: [
                        const Icon(Icons.call_outlined),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            controller.isGroupCall
                                ? 'Group call active'
                                : 'Direct call active',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        TextButton(
                          onPressed: () => ref
                              .read(callControllerProvider.notifier)
                              .setMinimized(false),
                          child: const Text('Resume'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            if (controller.status == CommsCallStatus.failed &&
                controller.error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.errorContainer,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        Icon(
                          Icons.info_outline,
                          color: Theme.of(context).colorScheme.onErrorContainer,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            controller.error!,
                            style: TextStyle(
                              color: Theme.of(context)
                                  .colorScheme
                                  .onErrorContainer,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            Expanded(
              child: TabBarView(
                children: [
                  _MakeCallTab(currentUserId: user.uid),
                  calls.when(
                    data: (items) {
                      if (items.isEmpty) {
                        return const EmptyState(
                          title: 'No calls yet',
                          message:
                              'Start an audio or video call from a direct or group chat.',
                        );
                      }
                      return ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: items.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (context, index) {
                          final call = items[index];
                          return ListTile(
                            leading: Icon(
                              call.mode.name == 'video'
                                  ? Icons.videocam_outlined
                                  : Icons.call_outlined,
                            ),
                            title: Text(
                              call.isGroup
                                  ? (call.conversationTitle ?? 'Group call')
                                  : (call.peerName ??
                                      call.peerId ??
                                      'Direct call'),
                            ),
                            subtitle: Text(
                              '${call.mode.name == 'video' ? 'Video' : 'Audio'} • ${call.status}',
                            ),
                            trailing: Text(
                              TimeOfDay.fromDateTime(call.startedAt.toLocal())
                                  .format(context),
                            ),
                          );
                        },
                      );
                    },
                    loading: () => const LoadingState(),
                    error: (error, _) => EmptyState(
                      title: 'Could not load calls',
                      message: error.toString(),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

final _recentCallsProvider = StreamProvider.family((ref, String userId) {
  return ref.watch(callRepositoryProvider).watchRecentCalls(userId);
});

final _callConversationsProvider = StreamProvider.family((ref, String userId) {
  return ref.watch(chatRepositoryProvider).watchConversations(userId);
});

class _MakeCallTab extends ConsumerWidget {
  const _MakeCallTab({required this.currentUserId});

  final String currentUserId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final conversations = ref.watch(_callConversationsProvider(currentUserId));
    return conversations.when(
      data: (items) {
        if (items.isEmpty) {
          return const EmptyState(
            title: 'No chats available',
            message: 'Start or join a chat first to place calls.',
          );
        }

        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: items.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final conversation = items[index];
            final peerId = _peerIdForDirect(conversation, currentUserId);
            final callTarget = conversation.isGroup
                ? (conversation.title ?? 'Group call')
                : (conversation.title ?? 'Direct call');
            return ListTile(
              leading: CircleAvatar(
                child: Icon(
                  conversation.isGroup ? Icons.groups : Icons.person,
                ),
              ),
              title: Text(callTarget),
              subtitle: Text(
                conversation.isGroup ? 'Group call' : 'Direct call',
              ),
              trailing: Wrap(
                spacing: 8,
                children: [
                  IconButton(
                    tooltip: 'Audio call',
                    onPressed: () => _startCall(
                      context: context,
                      ref: ref,
                      currentUserId: currentUserId,
                      conversation: conversation,
                      peerId: peerId,
                      mode: CallMode.audio,
                    ),
                    icon: const Icon(Icons.call_outlined),
                  ),
                  IconButton(
                    tooltip: 'Video call',
                    onPressed: () => _startCall(
                      context: context,
                      ref: ref,
                      currentUserId: currentUserId,
                      conversation: conversation,
                      peerId: peerId,
                      mode: CallMode.video,
                    ),
                    icon: const Icon(Icons.videocam_outlined),
                  ),
                ],
              ),
              onTap: () {
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
        title: 'Could not load chats',
        message: error.toString(),
      ),
    );
  }
}

Future<void> _startCall({
  required BuildContext context,
  required WidgetRef ref,
  required String currentUserId,
  required Conversation conversation,
  required String? peerId,
  required CallMode mode,
}) async {
  try {
    final controller = ref.read(callControllerProvider.notifier);
    if (conversation.isGroup == true) {
      await controller.startGroupCall(
        currentUserId: currentUserId,
        conversationId: conversation.id,
        mode: mode,
      );
    } else {
      if (peerId == null || peerId.isEmpty) {
        throw StateError('Direct call target is unavailable.');
      }
      await controller.startDirectCall(
        currentUserId: currentUserId,
        peerId: peerId,
        conversationId: conversation.id,
        mode: mode,
      );
    }
    if (!context.mounted) return;
    context.go(AppRoutes.calls);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(mode == CallMode.video
            ? 'Video call started.'
            : 'Audio call started.'),
      ),
    );
  } catch (error) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(error.toString())),
    );
  }
}

String? _peerIdForDirect(dynamic conversation, String currentUserId) {
  final userOne = conversation.userOneId;
  final userTwo = conversation.userTwoId;
  if (userOne == null && userTwo == null) return null;
  if (userOne == currentUserId) return userTwo;
  if (userTwo == currentUserId) return userOne;
  return userOne ?? userTwo;
}
