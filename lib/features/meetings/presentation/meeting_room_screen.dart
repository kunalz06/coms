import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../../app/router/app_routes.dart';
import '../../../features/calls/data/call_controller.dart';
import '../../../features/calls/domain/call_models.dart';
import '../../../features/calls/domain/call_state.dart';
import '../../../features/calls/presentation/active_call_panel.dart';
import '../../../shared/widgets/state_views.dart';
import '../data/meeting_models.dart';
import '../data/meeting_repository.dart';

final _meetingProvider = StreamProvider.family((ref, String meetingId) {
  return ref.watch(meetingRepositoryProvider).watchMeeting(meetingId);
});

final _meetingParticipantsProvider =
    StreamProvider.family((ref, String meetingId) {
  return ref.watch(meetingRepositoryProvider).watchParticipants(meetingId);
});

final _meetingChatProvider = StreamProvider.family((ref, String meetingId) {
  return ref.watch(meetingRepositoryProvider).watchChat(meetingId);
});

final _whiteboardProvider = StreamProvider.family((ref, String meetingId) {
  return ref.watch(meetingRepositoryProvider).watchStrokes(meetingId);
});

class MeetingRoomScreen extends ConsumerStatefulWidget {
  const MeetingRoomScreen({required this.meetingId, super.key});

  final String meetingId;

  @override
  ConsumerState<MeetingRoomScreen> createState() => _MeetingRoomScreenState();
}

class _MeetingRoomScreenState extends ConsumerState<MeetingRoomScreen> {
  var _joined = false;

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return const LoadingState();
    final meeting = ref.watch(_meetingProvider(widget.meetingId));
    final participants = ref.watch(_meetingParticipantsProvider(widget.meetingId));
    final callState = ref.watch(callControllerProvider);
    final callActive = callState.isGroupCall &&
        callState.conversationId == widget.meetingId &&
        callState.status != CommsCallStatus.idle &&
        callState.status != CommsCallStatus.ended &&
        callState.status != CommsCallStatus.failed;

    return meeting.when(
      data: (meeting) {
        if (meeting == null) {
          return const Scaffold(
            body: EmptyState(
              title: 'Meeting not found',
              message: 'Check the link and try again.',
            ),
          );
        }
        return participants.when(
          data: (items) {
            final me = items
                .where((participant) => participant.userId == user.uid)
                .firstOrNull;
            final isCreator = me?.isCreator == true;
            final link = _meetingLink(widget.meetingId);
            return DefaultTabController(
              length: 4,
              child: Scaffold(
                appBar: AppBar(
                  title: Text(meeting.title),
                  leading: IconButton(
                    onPressed: () => context.go(AppRoutes.meetings),
                    icon: const Icon(Icons.arrow_back),
                  ),
                  actions: [
                    IconButton(
                      tooltip: 'Copy meeting link',
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: link));
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Meeting link copied.')),
                        );
                      },
                      icon: const Icon(Icons.copy_outlined),
                    ),
                    IconButton(
                      tooltip: 'Share meeting link',
                      onPressed: () => Share.share(link),
                      icon: const Icon(Icons.ios_share_outlined),
                    ),
                  ],
                  bottom: const TabBar(
                    isScrollable: true,
                    tabs: [
                      Tab(icon: Icon(Icons.video_call_outlined), text: 'Room'),
                      Tab(icon: Icon(Icons.chat_outlined), text: 'Chat'),
                      Tab(icon: Icon(Icons.draw_outlined), text: 'Whiteboard'),
                      Tab(icon: Icon(Icons.people_outline), text: 'People'),
                    ],
                  ),
                ),
                body: TabBarView(
                  children: [
                    callActive
                        ? const ActiveCallPanel()
                        : _MeetingLobby(
                            meeting: meeting,
                            me: me,
                            currentUserId: user.uid,
                            participantCount: items
                                .where((participant) => participant.isActive)
                                .length,
                            onJoin: () => _joinMeeting(user.uid, CallMode.video),
                            onAudioJoin: () =>
                                _joinMeeting(user.uid, CallMode.audio),
                            onEnd: isCreator
                                ? () => _endMeeting(user.uid)
                                : null,
                          ),
                    _MeetingChat(
                      meetingId: widget.meetingId,
                      currentUserId: user.uid,
                      disabled: meeting.isEnded,
                    ),
                    _MeetingWhiteboard(
                      meetingId: widget.meetingId,
                      currentUserId: user.uid,
                      me: me,
                      isCreator: isCreator,
                    ),
                    _ParticipantsPanel(
                      meetingId: widget.meetingId,
                      currentUserId: user.uid,
                      participants: items,
                      isCreator: isCreator,
                    ),
                  ],
                ),
              ),
            );
          },
          loading: () => const Scaffold(body: LoadingState()),
          error: (error, _) => Scaffold(
            body: EmptyState(title: 'Could not load meeting', message: '$error'),
          ),
        );
      },
      loading: () => const Scaffold(body: LoadingState()),
      error: (error, _) => Scaffold(
        body: EmptyState(title: 'Could not load meeting', message: '$error'),
      ),
    );
  }

  Future<void> _joinMeeting(String userId, CallMode mode) async {
    try {
      await ref.read(meetingRepositoryProvider).joinMeeting(
            meetingId: widget.meetingId,
            userId: userId,
          );
      _joined = true;
      await ref.read(callControllerProvider.notifier).startGroupCall(
            currentUserId: userId,
            conversationId: widget.meetingId,
            mode: mode,
          );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _endMeeting(String userId) async {
    try {
      await ref.read(callControllerProvider.notifier).end(
            currentUserId: userId,
            endForEveryone: true,
          );
      await ref.read(meetingRepositoryProvider).endMeeting(
            meetingId: widget.meetingId,
            userId: userId,
          );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  @override
  void dispose() {
    final user = FirebaseAuth.instance.currentUser;
    if (_joined && user != null) {
      ref.read(meetingRepositoryProvider).leaveMeeting(
            meetingId: widget.meetingId,
            userId: user.uid,
          );
      ref.read(callControllerProvider.notifier).end(currentUserId: user.uid);
    }
    super.dispose();
  }
}

class _MeetingLobby extends StatelessWidget {
  const _MeetingLobby({
    required this.meeting,
    required this.currentUserId,
    required this.participantCount,
    required this.onJoin,
    required this.onAudioJoin,
    this.me,
    this.onEnd,
  });

  final Meeting meeting;
  final MeetingParticipant? me;
  final String currentUserId;
  final int participantCount;
  final VoidCallback onJoin;
  final VoidCallback onAudioJoin;
  final VoidCallback? onEnd;

  @override
  Widget build(BuildContext context) {
    final isFull = me == null && participantCount >= MeetingRepository.maxParticipants;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(22),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  meeting.isEnded ? Icons.event_busy : Icons.video_call,
                  size: 58,
                ),
                const SizedBox(height: 12),
                Text(meeting.title,
                    style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 8),
                Text(
                  meeting.isEnded
                      ? 'This meeting has ended.'
                      : '$participantCount / ${MeetingRepository.maxParticipants} people in room',
                ),
                const SizedBox(height: 20),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  alignment: WrapAlignment.center,
                  children: [
                    FilledButton.icon(
                      onPressed: meeting.isEnded || isFull ? null : onJoin,
                      icon: const Icon(Icons.videocam_outlined),
                      label: const Text('Join video'),
                    ),
                    OutlinedButton.icon(
                      onPressed: meeting.isEnded || isFull ? null : onAudioJoin,
                      icon: const Icon(Icons.call_outlined),
                      label: const Text('Join audio'),
                    ),
                    if (onEnd != null)
                      OutlinedButton.icon(
                        onPressed: meeting.isEnded ? null : onEnd,
                        icon: const Icon(Icons.stop_circle_outlined),
                        label: const Text('End meeting'),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MeetingChat extends ConsumerStatefulWidget {
  const _MeetingChat({
    required this.meetingId,
    required this.currentUserId,
    required this.disabled,
  });

  final String meetingId;
  final String currentUserId;
  final bool disabled;

  @override
  ConsumerState<_MeetingChat> createState() => _MeetingChatState();
}

class _MeetingChatState extends ConsumerState<_MeetingChat> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final messages = ref.watch(_meetingChatProvider(widget.meetingId));
    return Column(
      children: [
        Expanded(
          child: messages.when(
            data: (items) {
              if (items.isEmpty) {
                return const EmptyState(
                  title: 'No in-meeting messages',
                  message: 'Messages disappear when the meeting ends.',
                );
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: items.length,
                itemBuilder: (context, index) {
                  final message = items[index];
                  final mine = message.senderId == widget.currentUserId;
                  return Align(
                    alignment:
                        mine ? Alignment.centerRight : Alignment.centerLeft,
                    child: Card(
                      color: mine
                          ? Theme.of(context).colorScheme.primaryContainer
                          : null,
                      child: Padding(
                        padding: const EdgeInsets.all(10),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(message.senderName ?? 'COMMS user',
                                style: Theme.of(context).textTheme.labelSmall),
                            Text(message.content),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              );
            },
            loading: () => const LoadingState(),
            error: (error, _) => EmptyState(
              title: 'Could not load chat',
              message: error.toString(),
            ),
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    enabled: !widget.disabled,
                    decoration: const InputDecoration(
                      hintText: 'Message everyone in this meeting',
                      prefixIcon: Icon(Icons.chat_outlined),
                    ),
                    onSubmitted: (_) => _send(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  onPressed: widget.disabled ? null : _send,
                  icon: const Icon(Icons.send_outlined),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _send() async {
    final text = _controller.text;
    _controller.clear();
    await ref.read(meetingRepositoryProvider).sendChat(
          meetingId: widget.meetingId,
          senderId: widget.currentUserId,
          content: text,
        );
  }
}

class _ParticipantsPanel extends ConsumerWidget {
  const _ParticipantsPanel({
    required this.meetingId,
    required this.currentUserId,
    required this.participants,
    required this.isCreator,
  });

  final String meetingId;
  final String currentUserId;
  final List<MeetingParticipant> participants;
  final bool isCreator;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: participants.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final participant = participants[index];
        final isMe = participant.userId == currentUserId;
        return ListTile(
          leading: CircleAvatar(
            backgroundImage: participant.avatarUrl == null
                ? null
                : NetworkImage(participant.avatarUrl!),
            child: participant.avatarUrl == null
                ? Text(_initial(participant.displayName))
                : null,
          ),
          title: Text('${participant.displayName ?? 'COMMS user'}${isMe ? ' (you)' : ''}'),
          subtitle: Text(
            '${participant.role}${participant.isActive ? '' : ' • left'}${participant.handRaised ? ' • hand raised' : ''}',
          ),
          trailing: Wrap(
            spacing: 4,
            children: [
              if (isMe)
                IconButton(
                  tooltip: participant.handRaised ? 'Lower hand' : 'Raise hand',
                  onPressed: () => ref.read(meetingRepositoryProvider).setHandRaised(
                        meetingId: meetingId,
                        userId: currentUserId,
                        raised: !participant.handRaised,
                      ),
                  icon: Icon(participant.handRaised
                      ? Icons.back_hand
                      : Icons.back_hand_outlined),
                ),
              if (isCreator && !isMe)
                PopupMenuButton<String>(
                  onSelected: (value) async {
                    final repo = ref.read(meetingRepositoryProvider);
                    if (value == 'co') {
                      await repo.assignCoCreator(
                        meetingId: meetingId,
                        actorId: currentUserId,
                        userId: participant.userId,
                        enabled: participant.role != 'co_creator',
                      );
                    } else if (value == 'draw') {
                      await repo.setDrawingAllowed(
                        meetingId: meetingId,
                        actorId: currentUserId,
                        userId: participant.userId,
                        canDraw: !participant.canDraw,
                      );
                    }
                  },
                  itemBuilder: (context) => [
                    PopupMenuItem(
                      value: 'co',
                      child: Text(participant.role == 'co_creator'
                          ? 'Remove co-creator'
                          : 'Make co-creator'),
                    ),
                    PopupMenuItem(
                      value: 'draw',
                      child: Text(participant.canDraw
                          ? 'Disable whiteboard'
                          : 'Allow whiteboard'),
                    ),
                  ],
                ),
            ],
          ),
        );
      },
    );
  }
}

class _MeetingWhiteboard extends ConsumerStatefulWidget {
  const _MeetingWhiteboard({
    required this.meetingId,
    required this.currentUserId,
    required this.me,
    required this.isCreator,
  });

  final String meetingId;
  final String currentUserId;
  final MeetingParticipant? me;
  final bool isCreator;

  @override
  ConsumerState<_MeetingWhiteboard> createState() => _MeetingWhiteboardState();
}

class _MeetingWhiteboardState extends ConsumerState<_MeetingWhiteboard> {
  final _draft = <WhiteboardPoint>[];

  @override
  Widget build(BuildContext context) {
    final strokes = ref.watch(_whiteboardProvider(widget.meetingId));
    final canDraw = widget.isCreator || (widget.me?.canDraw == true);
    return Column(
      children: [
        if (!canDraw)
          const MaterialBanner(
            content: Text('A creator has disabled whiteboard drawing for you.'),
            actions: [SizedBox.shrink()],
          ),
        Expanded(
          child: strokes.when(
            data: (items) => GestureDetector(
              onPanStart: canDraw
                  ? (details) => setState(() {
                        _draft
                          ..clear()
                          ..add(_pointFromLocal(context, details.localPosition));
                      })
                  : null,
              onPanUpdate: canDraw
                  ? (details) => setState(() {
                        _draft.add(_pointFromLocal(context, details.localPosition));
                      })
                  : null,
              onPanEnd: canDraw ? (_) => _commitStroke() : null,
              child: CustomPaint(
                painter: _WhiteboardPainter(
                  strokes: items,
                  draft: _draft,
                  colorScheme: Theme.of(context).colorScheme,
                ),
                child: const SizedBox.expand(),
              ),
            ),
            loading: () => const LoadingState(),
            error: (error, _) =>
                EmptyState(title: 'Could not load whiteboard', message: '$error'),
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                const Icon(Icons.draw_outlined),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text('Draw with mouse or touch. Whiteboard clears when the meeting ends.'),
                ),
                if (widget.isCreator)
                  TextButton.icon(
                    onPressed: () => ref.read(meetingRepositoryProvider).clearWhiteboard(
                          meetingId: widget.meetingId,
                          actorId: widget.currentUserId,
                        ),
                    icon: const Icon(Icons.delete_sweep_outlined),
                    label: const Text('Clear'),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  WhiteboardPoint _pointFromLocal(BuildContext context, Offset offset) {
    final size = context.size ?? Size.zero;
    return WhiteboardPoint(
      size.width <= 0
          ? 0
          : (offset.dx / size.width).clamp(0, 1).toDouble(),
      size.height <= 0
          ? 0
          : (offset.dy / size.height).clamp(0, 1).toDouble(),
    );
  }

  Future<void> _commitStroke() async {
    final points = List<WhiteboardPoint>.from(_draft);
    setState(_draft.clear);
    await ref.read(meetingRepositoryProvider).addStroke(
          meetingId: widget.meetingId,
          userId: widget.currentUserId,
          points: points,
          color: Theme.of(context).colorScheme.primary.value,
          width: 3,
        );
  }
}

class _WhiteboardPainter extends CustomPainter {
  const _WhiteboardPainter({
    required this.strokes,
    required this.draft,
    required this.colorScheme,
  });

  final List<WhiteboardStroke> strokes;
  final List<WhiteboardPoint> draft;
  final ColorScheme colorScheme;

  @override
  void paint(Canvas canvas, Size size) {
    final background = Paint()..color = colorScheme.surfaceContainerLow;
    canvas.drawRect(Offset.zero & size, background);
    for (final stroke in strokes) {
      _drawStroke(canvas, size, stroke.points, Color(stroke.color), stroke.width);
    }
    _drawStroke(canvas, size, draft, colorScheme.primary, 3);
  }

  void _drawStroke(
    Canvas canvas,
    Size size,
    List<WhiteboardPoint> points,
    Color color,
    double width,
  ) {
    if (points.length < 2) return;
    final paint = Paint()
      ..color = color
      ..strokeWidth = width
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    final path = Path()
      ..moveTo(points.first.x * size.width, points.first.y * size.height);
    for (final point in points.skip(1)) {
      path.lineTo(point.x * size.width, point.y * size.height);
    }
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _WhiteboardPainter oldDelegate) {
    return oldDelegate.strokes != strokes || oldDelegate.draft != draft;
  }
}

String _meetingLink(String meetingId) {
  return '${Uri.base.origin}${AppRoutes.meetingRoom.replaceFirst(':meetingId', meetingId)}';
}

String _initial(String? value) {
  final trimmed = value?.trim();
  if (trimmed == null || trimmed.isEmpty) return 'C';
  return trimmed.substring(0, 1).toUpperCase();
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull {
    final iterator = this.iterator;
    if (!iterator.moveNext()) return null;
    return iterator.current;
  }
}
