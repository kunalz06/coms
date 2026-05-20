import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/responsive/breakpoints.dart';
import '../../features/calls/data/call_controller.dart';
import '../../features/calls/domain/call_state.dart';
import '../../shared/widgets/comms_page_background.dart';
import '../../shared/widgets/comms_logo.dart';
import '../router/app_routes.dart';

class AppShell extends ConsumerWidget {
  const AppShell({
    required this.location,
    required this.child,
    super.key,
  });

  final String location;
  final Widget child;

  int get _index {
    if (location.startsWith('/calls')) return 1;
    if (location.startsWith('/meetings')) return 2;
    if (location.startsWith('/settings')) return 3;
    return 0;
  }

  void _go(BuildContext context, int index) {
    switch (index) {
      case 0:
        context.go(AppRoutes.chats);
        return;
      case 1:
        context.go(AppRoutes.calls);
        return;
      case 2:
        context.go(AppRoutes.meetings);
        return;
      case 3:
        context.go(AppRoutes.settings);
        return;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = FirebaseAuth.instance.currentUser;
    final callState = ref.watch(callControllerProvider);
    if (user != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ref.read(callControllerProvider.notifier).connect(user.uid);
      });
    }

    final content = Column(
      children: [
        if (user != null &&
            callState.status != CommsCallStatus.idle &&
            callState.status != CommsCallStatus.ended &&
            callState.status != CommsCallStatus.failed)
          _GlobalCallBanner(state: callState, currentUserId: user.uid),
        Expanded(
          child: GestureDetector(
            behavior: HitTestBehavior.translucent,
            onTap: kIsWeb
                ? null
                : () => FocusManager.instance.primaryFocus?.unfocus(),
            child: child,
          ),
        ),
      ],
    );

    Widget withMiniOverlay(Widget child) {
      if (user == null) return child;
      final showMini = callState.isMinimized &&
          callState.status != CommsCallStatus.idle &&
          callState.status != CommsCallStatus.ended &&
          callState.status != CommsCallStatus.failed;
      if (!showMini) return child;
      final compact = windowClassForWidth(MediaQuery.sizeOf(context).width) ==
          WindowClass.compact;
      return Stack(
        children: [
          child,
          Positioned(
            right: 14,
            top: compact ? 14 : null,
            bottom: compact ? null : 18,
            child: Material(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(14),
              child: InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: () {
                  ref.read(callControllerProvider.notifier).setMinimized(false);
                  context.go(AppRoutes.calls);
                },
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.call, size: 18),
                      const SizedBox(width: 8),
                      Text(
                        callState.isGroupCall ? 'Group call' : 'Call',
                        style: Theme.of(context).textTheme.labelLarge,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      );
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final windowClass = windowClassForWidth(constraints.maxWidth);
        if (windowClass == WindowClass.compact) {
          return Scaffold(
            body: CommsPageBackground(
              child: SafeArea(child: withMiniOverlay(content)),
            ),
            bottomNavigationBar: NavigationBar(
              selectedIndex: _index,
              onDestinationSelected: (index) => _go(context, index),
              destinations: const [
                NavigationDestination(
                    icon: Icon(Icons.chat_bubble_outline),
                    selectedIcon: Icon(Icons.chat_bubble),
                    label: 'Chats'),
                NavigationDestination(
                    icon: Icon(Icons.call_outlined),
                    selectedIcon: Icon(Icons.call),
                    label: 'Calls'),
                NavigationDestination(
                    icon: Icon(Icons.video_call_outlined),
                    selectedIcon: Icon(Icons.video_call),
                    label: 'Meetings'),
                NavigationDestination(
                    icon: Icon(Icons.settings_outlined),
                    selectedIcon: Icon(Icons.settings),
                    label: 'Settings'),
              ],
            ),
          );
        }

        return Scaffold(
          body: CommsPageBackground(
            child: SafeArea(
              child: Row(
                children: [
                  NavigationRail(
                    selectedIndex: _index,
                    onDestinationSelected: (index) => _go(context, index),
                    labelType: NavigationRailLabelType.all,
                    leading: const Padding(
                      padding: EdgeInsets.only(bottom: 18),
                      child: CommsLogo(size: 34),
                    ),
                    destinations: const [
                      NavigationRailDestination(
                          icon: Icon(Icons.chat_bubble_outline),
                          selectedIcon: Icon(Icons.chat_bubble),
                          label: Text('Chats')),
                      NavigationRailDestination(
                          icon: Icon(Icons.call_outlined),
                          selectedIcon: Icon(Icons.call),
                          label: Text('Calls')),
                      NavigationRailDestination(
                          icon: Icon(Icons.video_call_outlined),
                          selectedIcon: Icon(Icons.video_call),
                          label: Text('Meetings')),
                      NavigationRailDestination(
                          icon: Icon(Icons.settings_outlined),
                          selectedIcon: Icon(Icons.settings),
                          label: Text('Settings')),
                    ],
                  ),
                  VerticalDivider(
                      width: 1,
                      color: Theme.of(context).colorScheme.outlineVariant),
                  Expanded(child: withMiniOverlay(content)),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _GlobalCallBanner extends ConsumerWidget {
  const _GlobalCallBanner({
    required this.state,
    required this.currentUserId,
  });

  final CallControllerState state;
  final String currentUserId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final title = switch (state.status) {
      CommsCallStatus.incomingRinging => 'Incoming call',
      CommsCallStatus.outgoingRinging => 'Ringing',
      CommsCallStatus.connecting => 'Connecting',
      CommsCallStatus.connected => 'Connected',
      CommsCallStatus.reconnecting => 'Reconnecting',
      CommsCallStatus.failed => 'Call failed',
      _ => 'Call active',
    };

    return Material(
      color: Theme.of(context).colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: [
            Expanded(
              child: Text(
                '$title${state.peerId == null ? '' : ' - ${state.peerId}'}',
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (state.status == CommsCallStatus.incomingRinging)
              TextButton(
                onPressed: () {
                  final controller = ref.read(callControllerProvider.notifier);
                  if (state.isGroupCall) {
                    controller.joinGroupCall(currentUserId: currentUserId);
                  } else {
                    controller.join(currentUserId: currentUserId);
                  }
                  context.go(AppRoutes.calls);
                },
                child: const Text('Join'),
              ),
            TextButton(
              onPressed: () {
                ref.read(callControllerProvider.notifier).setMinimized(false);
                context.go(AppRoutes.calls);
              },
              child: const Text('Open'),
            ),
            TextButton(
              onPressed: () => ref
                  .read(callControllerProvider.notifier)
                  .end(currentUserId: currentUserId),
              child: const Text('End'),
            ),
          ],
        ),
      ),
    );
  }
}
