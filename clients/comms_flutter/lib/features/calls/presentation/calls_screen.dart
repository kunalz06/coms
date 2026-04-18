import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/widgets/state_views.dart';
import '../data/call_controller.dart';
import '../data/call_repository.dart';
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

    if (callActive) {
      return Scaffold(
        appBar: AppBar(
          title: Text(controller.isGroupCall ? 'Group call' : 'Direct call'),
        ),
        body: const ActiveCallPanel(),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Calls')),
      body: Column(
        children: [
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
                            color:
                                Theme.of(context).colorScheme.onErrorContainer,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          Expanded(
            child: calls.when(
              data: (items) {
                if (items.isEmpty) {
                  return const EmptyState(
                    title: 'No calls yet',
                    message:
                        'Start an audio or video call from a direct conversation.',
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
                                ? 'Group ${call.mode.name} call'
                                : '${call.mode.name == 'video' ? 'Video' : 'Audio'} call',
                          ),
                          subtitle: Text(
                            call.isGroup
                                ? '${call.status} • ${call.conversationId ?? 'group'}'
                                : '${call.status} • ${call.peerId ?? 'direct'}',
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
          ),
        ],
      ),
    );
  }
}

final _recentCallsProvider = StreamProvider.family((ref, String userId) {
  return ref.watch(callRepositoryProvider).watchRecentCalls(userId);
});
