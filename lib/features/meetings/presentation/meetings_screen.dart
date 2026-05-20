import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../../app/router/app_routes.dart';
import '../../../shared/widgets/state_views.dart';
import '../data/meeting_models.dart';
import '../data/meeting_repository.dart';

final _meetingsProvider = StreamProvider.family((ref, String userId) {
  return ref.watch(meetingRepositoryProvider).watchMeetings(userId);
});

class MeetingsScreen extends ConsumerWidget {
  const MeetingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return const LoadingState();
    final meetings = ref.watch(_meetingsProvider(user.uid));
    return Scaffold(
      appBar: AppBar(
        title: const Text('Meetings'),
        actions: [
          IconButton(
            tooltip: 'Create meeting link',
            onPressed: () => _showCreateMeetingSheet(context, ref, user.uid),
            icon: const Icon(Icons.add_link_outlined),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showCreateMeetingSheet(context, ref, user.uid),
        icon: const Icon(Icons.video_call_outlined),
        label: const Text('New meeting'),
      ),
      body: meetings.when(
        data: (items) {
          if (items.isEmpty) {
            return const EmptyState(
              title: 'No meetings yet',
              message: 'Create a meeting link and share it with anyone.',
            );
          }
          final live = items.where((meeting) => !meeting.isEnded).toList();
          final past = items.where((meeting) => meeting.isEnded).toList();
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (live.isNotEmpty) ...[
                Text('Live and upcoming',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                ...live.map((meeting) => _MeetingTile(meeting: meeting)),
                const SizedBox(height: 20),
              ],
              if (past.isNotEmpty) ...[
                Text('Past meetings',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                ...past.map((meeting) => _MeetingTile(meeting: meeting)),
              ],
            ],
          );
        },
        loading: () => const LoadingState(),
        error: (error, _) => EmptyState(
          title: 'Could not load meetings',
          message: error.toString(),
        ),
      ),
    );
  }
}

class _MeetingTile extends StatelessWidget {
  const _MeetingTile({required this.meeting});

  final Meeting meeting;

  @override
  Widget build(BuildContext context) {
    final link = _meetingLink(context, meeting.id);
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        leading: CircleAvatar(
          child: Icon(meeting.isLive ? Icons.sensors : Icons.video_call),
        ),
        title: Text(meeting.title),
        subtitle: Text('${meeting.status} • ${meeting.id}'),
        trailing: Wrap(
          spacing: 6,
          children: [
            IconButton(
              tooltip: 'Copy link',
              onPressed: () {
                Clipboard.setData(ClipboardData(text: link));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Meeting link copied.')),
                );
              },
              icon: const Icon(Icons.copy_outlined),
            ),
            IconButton(
              tooltip: 'Share link',
              onPressed: () => Share.share(link),
              icon: const Icon(Icons.ios_share_outlined),
            ),
          ],
        ),
        onTap: () => context.go(
          AppRoutes.meetingRoom.replaceFirst(':meetingId', meeting.id),
        ),
      ),
    );
  }
}

Future<void> _showCreateMeetingSheet(
  BuildContext context,
  WidgetRef ref,
  String userId,
) async {
  final controller = TextEditingController(text: 'COMMS meeting');
  final result = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    builder: (context) => Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.viewInsetsOf(context).bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Create meeting link',
              style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          TextField(
            controller: controller,
            decoration: const InputDecoration(
              labelText: 'Meeting title',
              prefixIcon: Icon(Icons.title_outlined),
            ),
            autofocus: true,
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: () => Navigator.of(context).pop(controller.text),
            icon: const Icon(Icons.add_link_outlined),
            label: const Text('Create link'),
          ),
        ],
      ),
    ),
  );
  controller.dispose();
  if (result == null || !context.mounted) return;
  try {
    final meeting = await ref.read(meetingRepositoryProvider).createMeeting(
          creatorId: userId,
          title: result,
        );
    if (!context.mounted) return;
    final link = _meetingLink(context, meeting.id);
    await Clipboard.setData(ClipboardData(text: link));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Meeting link created and copied.')),
    );
    context.go(AppRoutes.meetingRoom.replaceFirst(':meetingId', meeting.id));
  } catch (error) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(error.toString())));
  }
}

String _meetingLink(BuildContext context, String meetingId) {
  final origin = Uri.base.origin;
  return '$origin${AppRoutes.meetingRoom.replaceFirst(':meetingId', meetingId)}';
}
