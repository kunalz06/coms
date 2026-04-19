import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../chats/data/chat_repository.dart';
import '../../../shared/models/conversation_member.dart';
import '../data/call_controller.dart';
import '../domain/call_models.dart';
import '../domain/call_state.dart';

class ActiveCallPanel extends ConsumerStatefulWidget {
  const ActiveCallPanel({super.key});

  @override
  ConsumerState<ActiveCallPanel> createState() => _ActiveCallPanelState();
}

class _ActiveCallPanelState extends ConsumerState<ActiveCallPanel> {
  final _localRenderer = RTCVideoRenderer();
  final _remoteRenderer = RTCVideoRenderer();
  var _ready = false;

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    await Future.wait(
        [_localRenderer.initialize(), _remoteRenderer.initialize()]);
    if (mounted) setState(() => _ready = true);
  }

  @override
  void dispose() {
    _localRenderer.dispose();
    _remoteRenderer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final call = ref.watch(callControllerProvider);
    final user = FirebaseAuth.instance.currentUser;
    if (!_ready || user == null) return const SizedBox.shrink();
    final memberItems = call.conversationId == null
        ? const <ConversationMember>[]
        : (ref.watch(_groupMembersProvider(call.conversationId!)).valueOrNull ??
            const <ConversationMember>[]);

    _localRenderer.srcObject = call.localStream;
    final primaryRemoteStream = call.isGroupCall
        ? (call.remoteStreams.isEmpty ? null : call.remoteStreams.values.first)
        : call.remoteStream;
    _remoteRenderer.srcObject = primaryRemoteStream;

    final hasVideo = call.mode == CallMode.video;
    final connected = call.status == CommsCallStatus.connected ||
        call.status == CommsCallStatus.reconnecting ||
        call.status == CommsCallStatus.connecting;
    final peerLabel =
        call.isGroupCall ? 'Group call' : call.peerId ?? 'Waiting for peer';
    final participantCount = 1 +
        (call.isGroupCall
            ? call.remoteStreams.length
            : call.remoteStream == null
                ? 0
                : 1);
    final myRole = memberItems
        .firstWhere(
          (member) => member.userId == user.uid,
          orElse: () => ConversationMember(
            id: 'unknown',
            conversationId: call.conversationId ?? '',
            userId: user.uid,
            role: 'member',
            joinedAt: DateTime.fromMillisecondsSinceEpoch(0),
          ),
        )
        .role;
    final canEndGroupCall = call.isGroupCall &&
        (myRole == 'owner' || myRole == 'admin' || call.peerId == user.uid);

    return Material(
      color: Theme.of(context).colorScheme.surface,
      child: Column(
        children: [
          Expanded(
            child: hasVideo
                ? Stack(
                    children: [
                      Positioned.fill(
                        child: primaryRemoteStream == null
                            ? _AvatarFallback(
                                title: _statusText(call.status),
                                subtitle: call.isGroupCall
                                    ? '$participantCount participant online'
                                    : peerLabel,
                              )
                            : RTCVideoView(
                                _remoteRenderer,
                                objectFit: RTCVideoViewObjectFit
                                    .RTCVideoViewObjectFitCover,
                              ),
                      ),
                      if (call.isGroupCall)
                        Positioned(
                          left: 16,
                          top: 16,
                          child: _CallBadge(
                            label: '$participantCount in call',
                          ),
                        ),
                      Positioned(
                        right: 16,
                        top: 16,
                        width:
                            MediaQuery.sizeOf(context).width < 600 ? 96 : 132,
                        height:
                            MediaQuery.sizeOf(context).width < 600 ? 132 : 178,
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(12),
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: Theme.of(context)
                                  .colorScheme
                                  .surfaceContainerHighest,
                            ),
                            child:
                                call.localStream == null || !call.cameraEnabled
                                    ? const Icon(Icons.videocam_off_outlined)
                                    : RTCVideoView(
                                        _localRenderer,
                                        mirror: true,
                                        objectFit: RTCVideoViewObjectFit
                                            .RTCVideoViewObjectFitCover,
                                      ),
                          ),
                        ),
                      ),
                    ],
                  )
                : _AvatarFallback(
                    title: _statusText(call.status),
                    subtitle: connected
                        ? call.isGroupCall
                            ? '$participantCount participant online'
                            : peerLabel
                        : 'Preparing audio call',
                  ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Wrap(
                alignment: WrapAlignment.center,
                spacing: 12,
                runSpacing: 12,
                children: [
                  _RoundCallButton(
                    icon: call.microphoneEnabled ? Icons.mic : Icons.mic_off,
                    label: call.microphoneEnabled ? 'Mute' : 'Unmute',
                    onPressed: () => ref
                        .read(callControllerProvider.notifier)
                        .toggleMicrophone(),
                  ),
                  if (hasVideo)
                    _RoundCallButton(
                      icon: call.cameraEnabled
                          ? Icons.videocam
                          : Icons.videocam_off,
                      label: call.cameraEnabled ? 'Camera off' : 'Camera on',
                      onPressed: () => ref
                          .read(callControllerProvider.notifier)
                          .toggleCamera(),
                    ),
                  if (call.status == CommsCallStatus.incomingRinging ||
                      call.status == CommsCallStatus.reconnecting)
                    _RoundCallButton(
                      icon: call.status == CommsCallStatus.reconnecting
                          ? Icons.refresh
                          : Icons.call,
                      label: call.status == CommsCallStatus.reconnecting
                          ? 'Rejoin'
                          : 'Join',
                      color: Colors.green,
                      onPressed: () {
                        final controller =
                            ref.read(callControllerProvider.notifier);
                        if (call.isGroupCall) {
                          controller.joinGroupCall(currentUserId: user.uid);
                        } else {
                          controller.join(currentUserId: user.uid);
                        }
                      },
                    ),
                  _RoundCallButton(
                    icon: Icons.call_end,
                    label: call.isGroupCall ? 'Leave' : 'End',
                    color: Theme.of(context).colorScheme.error,
                    onPressed: () => ref
                        .read(callControllerProvider.notifier)
                        .end(currentUserId: user.uid),
                  ),
                  if (canEndGroupCall)
                    _RoundCallButton(
                      icon: Icons.stop_circle_outlined,
                      label: 'End for all',
                      color: Theme.of(context).colorScheme.error,
                      onPressed: () =>
                          ref.read(callControllerProvider.notifier).end(
                                currentUserId: user.uid,
                                endForEveryone: true,
                              ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _statusText(CommsCallStatus status) {
    return switch (status) {
      CommsCallStatus.incomingRinging => 'Incoming call',
      CommsCallStatus.outgoingRinging => 'Ringing',
      CommsCallStatus.acquiringMedia => 'Opening microphone and camera',
      CommsCallStatus.connecting => 'Connecting',
      CommsCallStatus.connected => 'Connected',
      CommsCallStatus.reconnecting => 'Reconnecting',
      CommsCallStatus.failed => 'Call failed',
      _ => 'Call',
    };
  }
}

class _CallBadge extends StatelessWidget {
  const _CallBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.84),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Text(label, style: Theme.of(context).textTheme.labelMedium),
      ),
    );
  }
}

class _AvatarFallback extends StatelessWidget {
  const _AvatarFallback({
    required this.title,
    required this.subtitle,
  });

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircleAvatar(radius: 46, child: Icon(Icons.person, size: 42)),
          const SizedBox(height: 16),
          Text(title, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 8),
          Text(subtitle, style: Theme.of(context).textTheme.bodyMedium),
        ],
      ),
    );
  }
}

class _RoundCallButton extends StatelessWidget {
  const _RoundCallButton({
    required this.icon,
    required this.label,
    required this.onPressed,
    this.color,
  });

  final IconData icon;
  final String label;
  final VoidCallback onPressed;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final background =
        color ?? Theme.of(context).colorScheme.surfaceContainerHighest;
    final foreground = color == null
        ? Theme.of(context).colorScheme.onSurface
        : Theme.of(context).colorScheme.onError;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        FilledButton(
          style: FilledButton.styleFrom(
            shape: const CircleBorder(),
            padding: const EdgeInsets.all(18),
            backgroundColor: background,
            foregroundColor: foreground,
          ),
          onPressed: onPressed,
          child: Icon(icon),
        ),
        const SizedBox(height: 6),
        Text(label, style: Theme.of(context).textTheme.labelSmall),
      ],
    );
  }
}

final _groupMembersProvider =
    StreamProvider.family((ref, String conversationId) {
  return ref.watch(chatRepositoryProvider).watchMembers(conversationId);
});
