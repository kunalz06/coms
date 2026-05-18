import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/app_routes.dart';
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
  final _remoteRenderers = <String, RTCVideoRenderer>{};
  var _ready = false;
  String? _pinnedPeerId;

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
    for (final renderer in _remoteRenderers.values) {
      renderer.dispose();
    }
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
    _syncGroupRenderers(call.remoteStreams);
    final primaryRemoteEntry =
        call.isGroupCall ? _primaryRemoteEntry(call.remoteStreams) : null;
    final primaryRemoteStream =
        call.isGroupCall ? primaryRemoteEntry?.value : call.remoteStream;
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
        (myRole == 'owner' ||
            myRole == 'admin' ||
            call.callStarterUserId == user.uid);
    final canShareDirectly = !call.isGroupCall ||
        myRole == 'owner' ||
        myRole == 'admin' ||
        call.callStarterUserId == user.uid;
    final pendingShareRequester = call.pendingScreenShareFromUserId;
    final scheme = Theme.of(context).colorScheme;

    return Material(
      color: scheme.surface,
      child: Column(
        children: [
          if (pendingShareRequester != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: scheme.secondaryContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                            '$pendingShareRequester requested screen share'),
                      ),
                      TextButton(
                        onPressed: () => ref
                            .read(callControllerProvider.notifier)
                            .denyScreenShareRequest(
                              currentUserId: user.uid,
                              requesterUserId: pendingShareRequester,
                            ),
                        child: const Text('Deny'),
                      ),
                      FilledButton(
                        onPressed: () => ref
                            .read(callControllerProvider.notifier)
                            .approveScreenShareRequest(
                              currentUserId: user.uid,
                              requesterUserId: pendingShareRequester,
                            ),
                        child: const Text('Allow'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          Expanded(
            child: hasVideo
                ? Stack(
                    children: [
                      Positioned.fill(
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: [
                                scheme.surface,
                                scheme.surfaceContainerHighest,
                                scheme.primaryContainer.withValues(alpha: 0.28),
                              ],
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                          ),
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
                                      .RTCVideoViewObjectFitContain,
                                ),
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
                          borderRadius: BorderRadius.circular(8),
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: Theme.of(context)
                                  .colorScheme
                                  .surfaceContainerHighest
                                  .withValues(alpha: 0.9),
                            ),
                            child: call.localStream == null ||
                                    (!call.cameraEnabled &&
                                        !call.isScreenSharing)
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
                      if (call.isGroupCall && call.remoteStreams.isNotEmpty)
                        Positioned(
                          left: 12,
                          right: 12,
                          bottom: 12,
                          child: _ParticipantStrip(
                            renderers: _remoteRenderers,
                            streams: call.remoteStreams,
                            pinnedPeerId: primaryRemoteEntry?.key,
                            onPin: (peerId) {
                              setState(() => _pinnedPeerId = peerId);
                            },
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
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Align(
              alignment: Alignment.center,
              child: _CallBadge(
                label:
                    '${call.videoQuality.label} adaptive - ${call.packetStats.compactLabel}',
                icon: Icons.data_usage_outlined,
              ),
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
                  if (hasVideo)
                    _RoundCallButton(
                      icon: call.adaptiveQualityEnabled
                          ? Icons.auto_awesome_motion_outlined
                          : Icons.high_quality_outlined,
                      label: call.adaptiveQualityEnabled
                          ? 'Adaptive ${call.videoQuality.label}'
                          : 'Fixed ${call.videoQuality.label}',
                      onPressed: () => ref
                          .read(callControllerProvider.notifier)
                          .setAdaptiveQualityEnabled(
                            !call.adaptiveQualityEnabled,
                          ),
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
                  if (hasVideo)
                    _RoundCallButton(
                      icon: call.isScreenSharing
                          ? Icons.stop_screen_share_outlined
                          : Icons.screen_share_outlined,
                      label: call.isScreenSharing
                          ? 'Stop share'
                          : call.screenShareRequestPending
                              ? 'Share requested'
                              : canShareDirectly
                                  ? 'Share screen'
                                  : 'Request share',
                      onPressed: call.screenShareRequestPending
                          ? () {}
                          : () => ref
                              .read(callControllerProvider.notifier)
                              .toggleScreenShare(currentUserId: user.uid),
                    ),
                  _RoundCallButton(
                    icon: Icons.picture_in_picture_alt_outlined,
                    label: 'Minimize',
                    onPressed: () {
                      ref
                          .read(callControllerProvider.notifier)
                          .setMinimized(true);
                      final conversationId = call.conversationId;
                      if (conversationId != null && context.mounted) {
                        context.go(
                          AppRoutes.conversation.replaceFirst(
                            ':conversationId',
                            conversationId,
                          ),
                        );
                        return;
                      }
                      if (context.mounted) {
                        context.go(AppRoutes.chats);
                      }
                    },
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

  void _syncGroupRenderers(Map<String, MediaStream> streams) {
    final staleIds =
        _remoteRenderers.keys.where((peerId) => !streams.containsKey(peerId));
    for (final peerId in staleIds.toList()) {
      _remoteRenderers.remove(peerId)?.dispose();
    }
    for (final entry in streams.entries) {
      final renderer = _remoteRenderers.putIfAbsent(entry.key, () {
        final created = RTCVideoRenderer();
        unawaited(created.initialize().then((_) {
          if (mounted) setState(() {});
        }));
        return created;
      });
      renderer.srcObject = entry.value;
    }
    if (_pinnedPeerId != null && !streams.containsKey(_pinnedPeerId)) {
      _pinnedPeerId = null;
    }
  }

  MapEntry<String, MediaStream>? _primaryRemoteEntry(
    Map<String, MediaStream> streams,
  ) {
    if (streams.isEmpty) return null;
    final pinnedPeerId = _pinnedPeerId;
    if (pinnedPeerId != null && streams.containsKey(pinnedPeerId)) {
      return MapEntry(pinnedPeerId, streams[pinnedPeerId]!);
    }
    return streams.entries.first;
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
  const _CallBadge({required this.label, this.icon});

  final String label;
  final IconData? icon;

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
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 16),
              const SizedBox(width: 6),
            ],
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 280),
              child: Text(
                label,
                style: Theme.of(context).textTheme.labelMedium,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ParticipantStrip extends StatelessWidget {
  const _ParticipantStrip({
    required this.renderers,
    required this.streams,
    required this.pinnedPeerId,
    required this.onPin,
  });

  final Map<String, RTCVideoRenderer> renderers;
  final Map<String, MediaStream> streams;
  final String? pinnedPeerId;
  final ValueChanged<String> onPin;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final entries = streams.entries.toList(growable: false);
    return SizedBox(
      height: MediaQuery.sizeOf(context).width < 600 ? 76 : 96,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: entries.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final entry = entries[index];
          final renderer = renderers[entry.key];
          final pinned = pinnedPeerId == entry.key;
          return InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: () => onPin(entry.key),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: MediaQuery.sizeOf(context).width < 600 ? 112 : 148,
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest.withValues(alpha: 0.86),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: pinned ? scheme.primary : scheme.outlineVariant,
                  width: pinned ? 2 : 1,
                ),
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (renderer == null)
                    const Center(child: Icon(Icons.person_outline))
                  else
                    RTCVideoView(
                      renderer,
                      objectFit:
                          RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
                    ),
                  Align(
                    alignment: Alignment.bottomLeft,
                    child: ColoredBox(
                      color: scheme.scrim.withValues(alpha: 0.42),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        child: Text(
                          pinned ? 'Pinned' : 'Tap to pin',
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(color: Colors.white),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
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
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
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
