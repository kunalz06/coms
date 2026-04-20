import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import 'call_repository.dart';
import 'group_webrtc_call_service.dart';
import 'signaling_client.dart';
import 'webrtc_call_service.dart';
import '../domain/call_models.dart';
import '../domain/call_signal.dart';
import '../domain/call_state.dart';

final callControllerProvider =
    StateNotifierProvider<CallController, CallControllerState>((ref) {
  return CallController(
    ref.watch(signalingClientProvider),
    ref.watch(callRepositoryProvider),
    ref.watch(webRtcCallServiceProvider),
    ref.watch(groupWebRtcCallServiceProvider),
  );
});

class CallControllerState {
  const CallControllerState({
    this.status = CommsCallStatus.idle,
    this.activeCallId,
    this.peerId,
    this.conversationId,
    this.mode = CallMode.audio,
    this.localStream,
    this.remoteStream,
    this.remoteStreams = const {},
    this.isGroupCall = false,
    this.microphoneEnabled = true,
    this.cameraEnabled = true,
    this.isMinimized = false,
    this.isScreenSharing = false,
    this.screenShareRequestPending = false,
    this.pendingScreenShareFromUserId,
    this.callStarterUserId,
    this.error,
  });

  final CommsCallStatus status;
  final String? activeCallId;
  final String? peerId;
  final String? conversationId;
  final CallMode mode;
  final MediaStream? localStream;
  final MediaStream? remoteStream;
  final Map<String, MediaStream> remoteStreams;
  final bool isGroupCall;
  final bool microphoneEnabled;
  final bool cameraEnabled;
  final bool isMinimized;
  final bool isScreenSharing;
  final bool screenShareRequestPending;
  final String? pendingScreenShareFromUserId;
  final String? callStarterUserId;
  final String? error;

  CallControllerState copyWith({
    CommsCallStatus? status,
    String? activeCallId,
    String? peerId,
    String? conversationId,
    CallMode? mode,
    MediaStream? localStream,
    MediaStream? remoteStream,
    Map<String, MediaStream>? remoteStreams,
    bool? isGroupCall,
    bool? microphoneEnabled,
    bool? cameraEnabled,
    bool? isMinimized,
    bool? isScreenSharing,
    bool? screenShareRequestPending,
    String? pendingScreenShareFromUserId,
    bool clearPendingScreenShareRequester = false,
    String? callStarterUserId,
    String? error,
    bool clearCall = false,
  }) {
    return CallControllerState(
      status: status ?? this.status,
      activeCallId: clearCall ? null : activeCallId ?? this.activeCallId,
      peerId: clearCall ? null : peerId ?? this.peerId,
      conversationId: clearCall ? null : conversationId ?? this.conversationId,
      mode: mode ?? this.mode,
      localStream: clearCall ? null : localStream ?? this.localStream,
      remoteStream: clearCall ? null : remoteStream ?? this.remoteStream,
      remoteStreams: clearCall ? const {} : remoteStreams ?? this.remoteStreams,
      isGroupCall: clearCall ? false : isGroupCall ?? this.isGroupCall,
      microphoneEnabled: microphoneEnabled ?? this.microphoneEnabled,
      cameraEnabled: cameraEnabled ?? this.cameraEnabled,
      isMinimized: clearCall ? false : isMinimized ?? this.isMinimized,
      isScreenSharing:
          clearCall ? false : isScreenSharing ?? this.isScreenSharing,
      screenShareRequestPending: clearCall
          ? false
          : screenShareRequestPending ?? this.screenShareRequestPending,
      pendingScreenShareFromUserId: clearCall
          ? null
          : clearPendingScreenShareRequester
              ? null
              : pendingScreenShareFromUserId ??
                  this.pendingScreenShareFromUserId,
      callStarterUserId:
          clearCall ? null : callStarterUserId ?? this.callStarterUserId,
      error: error,
    );
  }
}

class CallController extends StateNotifier<CallControllerState> {
  CallController(
    this._signaling,
    this._repository,
    this._webRtc,
    this._groupWebRtc,
  ) : super(const CallControllerState()) {
    _subscription = _signaling.messages.listen(
      (signal) => unawaited(_handleSignalSafely(signal)),
    );
  }

  final SignalingClient _signaling;
  final CallRepository _repository;
  final WebRtcCallService _webRtc;
  final GroupWebRtcCallService _groupWebRtc;
  late final StreamSubscription<CallSignal> _subscription;
  final _pendingCandidates = <Object>[];
  final _pendingGroupCandidates = <String, List<Object>>{};
  Timer? _ringTimer;
  Timer? _connectionTimer;
  String? _currentUserId;

  Future<void> connect(String userId) {
    _currentUserId = userId;
    return _signaling.connect(userId);
  }

  Future<void> startDirectCall({
    required String currentUserId,
    required String peerId,
    required String conversationId,
    required CallMode mode,
  }) async {
    await connect(currentUserId);
    await _groupWebRtc.disposeCall();
    _resetIfTerminal();
    final callId = _repository.newCallId();
    _transition(
      CommsCallStatus.outgoingRinging,
      activeCallId: callId,
      peerId: peerId,
      conversationId: conversationId,
      mode: mode,
      isMinimized: false,
      callStarterUserId: currentUserId,
    );
    final sent = _signaling.send(
      CallSignal(
        type: 'call-initiate',
        callId: callId,
        from: currentUserId,
        to: peerId,
        conversationId: conversationId,
        mode: mode,
      ),
    );
    if (!sent) {
      _transition(
        CommsCallStatus.failed,
        error: 'Calling server is unavailable.',
        clearCall: true,
      );
      throw StateError('Calling server is unavailable.');
    }
    _startRingTimeout(currentUserId: currentUserId, peerId: peerId);
  }

  Future<void> startGroupCall({
    required String currentUserId,
    required String conversationId,
    required CallMode mode,
  }) async {
    try {
      await connect(currentUserId);
      await _safeDisposeCall(_webRtc.disposeCall);
      await _safeDisposeCall(_groupWebRtc.disposeCall);
      _resetIfTerminal();
      _transition(
        CommsCallStatus.acquiringMedia,
        activeCallId: conversationId,
        conversationId: conversationId,
        peerId: 'Group call',
        mode: mode,
        isGroupCall: true,
        isMinimized: false,
        callStarterUserId: currentUserId,
      );
      final stream = await _acquireGroupMediaResilient(mode);
      final effectiveMode = mode == CallMode.video &&
              stream.getVideoTracks().isEmpty
          ? CallMode.audio
          : mode;
      state = state.copyWith(
        localStream: _groupWebRtc.previewStream ?? stream,
        cameraEnabled: stream.getVideoTracks().isNotEmpty,
        microphoneEnabled: true,
        isGroupCall: true,
        isMinimized: false,
        mode: effectiveMode,
      );
      _transition(CommsCallStatus.connecting);
      final sent = _signaling.send(
        CallSignal(
          type: 'group-call-start',
          from: currentUserId,
          conversationId: conversationId,
          mode: effectiveMode,
          raw: {'requestId': _repository.newCallId()},
        ),
      );
      if (sent) return;
      await _disposeActiveCall();
      _transition(
        CommsCallStatus.failed,
        error: 'Calling server is unavailable.',
        clearCall: true,
      );
      throw StateError('Calling server is unavailable.');
    } catch (error) {
      await _groupWebRtc.disposeCall();
      final existingError = state.error;
      _transition(
        CommsCallStatus.failed,
        error: existingError ?? _friendlyCallError(error),
        clearCall: true,
      );
      rethrow;
    }
  }

  Future<void> joinGroupCall({
    required String currentUserId,
  }) async {
    try {
      final conversationId = state.conversationId;
      if (conversationId == null) return;
      await connect(currentUserId);
      await _safeDisposeCall(_webRtc.disposeCall);
      _ringTimer?.cancel();
      _transition(CommsCallStatus.acquiringMedia);
      final stream = await _acquireGroupMediaResilient(state.mode);
      final effectiveMode = state.mode == CallMode.video &&
              stream.getVideoTracks().isEmpty
          ? CallMode.audio
          : state.mode;
      state = state.copyWith(
        localStream: _groupWebRtc.previewStream ?? stream,
        cameraEnabled: stream.getVideoTracks().isNotEmpty,
        microphoneEnabled: true,
        isGroupCall: true,
        isMinimized: false,
        mode: effectiveMode,
      );
      _transition(CommsCallStatus.connecting);
      final sent = _signaling.send(
        CallSignal(
          type: 'group-call-join',
          from: currentUserId,
          conversationId: conversationId,
          mode: effectiveMode,
          raw: {'requestId': _repository.newCallId()},
        ),
      );
      if (sent) return;
      await _disposeActiveCall();
      _transition(
        CommsCallStatus.failed,
        error: 'Calling server is unavailable.',
        clearCall: true,
      );
    } catch (error) {
      await _disposeActiveCall();
      final existingError = state.error;
      _transition(
        CommsCallStatus.failed,
        error: existingError ?? _friendlyCallError(error),
        clearCall: true,
      );
    }
  }

  Future<void> reject({
    required String currentUserId,
    String reason = 'rejected',
  }) async {
    final callId = state.activeCallId;
    final peerId = state.peerId;
    if (callId == null || peerId == null) return;
    _signaling.send(
      state.isGroupCall
          ? CallSignal(
              type: 'group-call-leave',
              from: currentUserId,
              conversationId: state.conversationId,
            )
          : CallSignal(
              type: 'call-reject',
              callId: callId,
              from: currentUserId,
              to: peerId,
              reason: reason,
            ),
    );
    await _disposeActiveCall();
    _ringTimer?.cancel();
    _connectionTimer?.cancel();
    _transition(CommsCallStatus.ended, clearCall: true);
  }

  Future<void> end({
    required String currentUserId,
    String reason = 'ended',
    bool endForEveryone = false,
  }) async {
    final callId = state.activeCallId;
    final peerId = state.peerId;
    if (!state.isGroupCall && (callId == null || peerId == null)) return;
    _signaling.send(
      state.isGroupCall
          ? (endForEveryone
              ? CallSignal(
                  type: 'group-call-end',
                  from: currentUserId,
                  conversationId: state.conversationId,
                )
              : CallSignal(
                  type: 'group-call-leave',
                  from: currentUserId,
                  conversationId: state.conversationId,
                ))
          : CallSignal(
              type: 'call-end',
              callId: callId,
              from: currentUserId,
              to: peerId,
              reason: reason,
            ),
    );
    if (!state.isGroupCall || !endForEveryone) {
      await _disposeActiveCall();
      _ringTimer?.cancel();
      _connectionTimer?.cancel();
      _transition(CommsCallStatus.ended, clearCall: true);
    }
  }

  void toggleMicrophone() {
    final next = !state.microphoneEnabled;
    state.isGroupCall
        ? _groupWebRtc.setMicrophoneEnabled(next)
        : _webRtc.setMicrophoneEnabled(next);
    state = state.copyWith(microphoneEnabled: next);
  }

  void toggleCamera() {
    final next = !state.cameraEnabled;
    state.isGroupCall
        ? _groupWebRtc.setCameraEnabled(next)
        : _webRtc.setCameraEnabled(next);
    state = state.copyWith(cameraEnabled: next);
  }

  void setMinimized(bool minimized) {
    state = state.copyWith(isMinimized: minimized);
  }

  Future<void> toggleScreenShare({
    required String currentUserId,
  }) async {
    if (state.mode != CallMode.video) {
      state = state.copyWith(
        error: 'Screen sharing is available only in video calls.',
      );
      return;
    }
    if (state.status != CommsCallStatus.connected) {
      state = state.copyWith(
        error: 'Connect the call first, then start screen sharing.',
      );
      return;
    }

    if (state.isScreenSharing) {
      await _stopScreenShare(currentUserId: currentUserId);
      return;
    }

    if (state.isGroupCall) {
      final canShareDirectly =
          await _canShareScreenWithoutApproval(currentUserId: currentUserId);
      if (!canShareDirectly) {
        final sent = _signaling.send(
          CallSignal(
            type: 'group-call-share-request',
            from: currentUserId,
            conversationId: state.conversationId,
            raw: {'requestId': _repository.newCallId()},
          ),
        );
        if (!sent) {
          state = state.copyWith(
            error: 'Could not send screen-share request.',
          );
          return;
        }
        state = state.copyWith(
          screenShareRequestPending: true,
          error: 'Screen-share request sent. Waiting for approval.',
        );
        return;
      }
    }

    await _startScreenShare(currentUserId: currentUserId);
  }

  Future<void> approveScreenShareRequest({
    required String currentUserId,
    required String requesterUserId,
  }) async {
    final sent = _signaling.send(
      CallSignal(
        type: 'group-call-share-decision',
        from: currentUserId,
        to: requesterUserId,
        conversationId: state.conversationId,
        raw: {'approved': true},
      ),
    );
    if (sent) {
      state = state.copyWith(
        clearPendingScreenShareRequester: true,
        error: 'Screen-share request approved.',
      );
    }
  }

  Future<void> denyScreenShareRequest({
    required String currentUserId,
    required String requesterUserId,
  }) async {
    final sent = _signaling.send(
      CallSignal(
        type: 'group-call-share-decision',
        from: currentUserId,
        to: requesterUserId,
        conversationId: state.conversationId,
        raw: {'approved': false},
      ),
    );
    if (sent) {
      state = state.copyWith(
        clearPendingScreenShareRequester: true,
        error: 'Screen-share request declined.',
      );
    }
  }

  Future<void> join({
    required String currentUserId,
  }) async {
    try {
      final callId = state.activeCallId;
      final peerId = state.peerId;
      final conversationId = state.conversationId;
      if (callId == null || peerId == null || conversationId == null) return;
      await _safeDisposeCall(_groupWebRtc.disposeCall);
      _ringTimer?.cancel();
      _transition(CommsCallStatus.acquiringMedia);
      final stream = await _webRtc.acquireMedia(state.mode);
      state = state.copyWith(
        localStream: _webRtc.previewStream ?? stream,
        cameraEnabled: stream.getVideoTracks().isNotEmpty,
        microphoneEnabled: true,
        isMinimized: false,
      );
      _transition(CommsCallStatus.connecting);
      final sent = _signaling.send(
        CallSignal(
          type: 'call-join',
          callId: callId,
          from: currentUserId,
          to: peerId,
          conversationId: conversationId,
          mode: state.mode,
        ),
      );
      if (sent) return;
      await _disposeActiveCall();
      _transition(
        CommsCallStatus.failed,
        error: 'Calling server is unavailable.',
        clearCall: true,
      );
    } catch (error) {
      await _disposeActiveCall();
      final existingError = state.error;
      _transition(
        CommsCallStatus.failed,
        error: existingError ?? _friendlyCallError(error),
        clearCall: true,
      );
    }
  }

  Future<void> _handleSignal(CallSignal signal) async {
    if (signal.type.startsWith('group-call-')) {
      await _handleGroupSignal(signal);
      return;
    }

    if (signal.isIncomingDirectCall || signal.isAvailableDirectCall) {
      _resetIfTerminal();
      final callId = signal.callId;
      final from = signal.from;
      final conversationId = signal.conversationId;
      final mode = signal.mode;
      if (callId == null ||
          from == null ||
          conversationId == null ||
          mode == null) {
        return;
      }
      _transition(
        CommsCallStatus.incomingRinging,
        activeCallId: callId,
        peerId: from,
        conversationId: conversationId,
        mode: mode,
        isMinimized: false,
        callStarterUserId: from,
      );
      _startRingTimeout(currentUserId: _currentUserId, peerId: from);
      return;
    }

    if (signal.type == 'call-join') {
      await _beginOfferForJoin(signal);
      return;
    }

    if (signal.type == 'call-answer') {
      if (signal.answer != null) await _webRtc.acceptAnswer(signal.answer!);
      _ringTimer?.cancel();
      _connectionTimer?.cancel();
      _transition(CommsCallStatus.connected);
      return;
    }

    if (signal.type == 'call-offer') {
      await _answerOffer(signal);
      return;
    }

    if (signal.type == 'ice-candidate') {
      final candidate = signal.candidate;
      if (candidate == null) return;
      try {
        await _webRtc.addCandidate(candidate);
      } catch (_) {
        _pendingCandidates.add(candidate);
      }
      return;
    }

    if (signal.type == 'call-left') {
      _transition(CommsCallStatus.reconnecting);
      return;
    }

    if (signal.isDirectCallTerminal) {
      await _webRtc.disposeCall();
      _ringTimer?.cancel();
      _connectionTimer?.cancel();
      _transition(
        signal.type == 'call-unavailable'
            ? CommsCallStatus.failed
            : CommsCallStatus.ended,
        error: signal.reason,
        clearCall: true,
      );
    }
  }

  Future<void> _handleSignalSafely(CallSignal signal) async {
    try {
      await _handleSignal(signal);
    } catch (error) {
      final wasGroupCall = state.isGroupCall;
      _transition(
        CommsCallStatus.failed,
        error: _friendlyCallError(error),
        clearCall: true,
      );
      if (wasGroupCall) {
        await _groupWebRtc.disposeCall();
      } else {
        await _webRtc.disposeCall();
      }
    }
  }

  Future<void> _handleGroupSignal(CallSignal signal) async {
    final userId = _currentUserId;
    if (userId == null) return;

    if (signal.type == 'group-call-invite' ||
        signal.type == 'group-call-available') {
      _resetIfTerminal();
      final conversationId = signal.conversationId;
      final from = signal.from;
      final mode = signal.mode;
      if (conversationId == null || mode == null) return;
      _transition(
        CommsCallStatus.incomingRinging,
        activeCallId: conversationId,
        conversationId: conversationId,
        peerId: from ?? 'Group call',
        mode: mode,
        isGroupCall: true,
        isMinimized: false,
        callStarterUserId: from,
      );
      return;
    }

    if (signal.type == 'group-call-response') {
      if (signal.raw['ok'] != true) {
        final canFailCall = state.status == CommsCallStatus.connecting ||
            state.status == CommsCallStatus.acquiringMedia ||
            state.status == CommsCallStatus.incomingRinging ||
            state.status == CommsCallStatus.outgoingRinging;
        if (canFailCall) {
          _transition(
            CommsCallStatus.failed,
            error: signal.raw['error']?.toString(),
            clearCall: true,
          );
        } else {
          state = state.copyWith(
            screenShareRequestPending: false,
            error: signal.raw['error']?.toString(),
          );
        }
        return;
      }
      final data = signal.raw['data'];
      String? hostId;
      if (data is Map) {
        final rawHost = data['hostId'];
        if (rawHost is String && rawHost.trim().isNotEmpty) {
          hostId = rawHost;
        }
      }
      final participantIds = data is Map ? data['participantIds'] : null;
      if (participantIds is List) {
        for (final participantId in participantIds.whereType<String>()) {
          await _sendGroupOffer(userId, participantId);
        }
      }
      _transition(
        CommsCallStatus.connected,
        peerId: hostId ?? state.peerId,
        callStarterUserId: hostId ?? state.callStarterUserId,
      );
      _connectionTimer?.cancel();
      return;
    }

    if (signal.type == 'group-call-peer-joined') {
      final peerId = signal.raw['userId'] as String?;
      if (peerId != null && peerId != userId) {
        await _sendGroupOffer(userId, peerId);
      }
      return;
    }

    if (signal.type == 'group-call-offer') {
      final peerId = signal.from;
      final offer = signal.offer;
      if (peerId == null || offer == null) return;
      await _ensureGroupMedia();
      await _prepareGroupPeer(userId, peerId);
      final answer = await _groupWebRtc.acceptOffer(peerId, offer);
      final pending =
          _pendingGroupCandidates.remove(peerId) ?? const <Object>[];
      for (final candidate in pending) {
        await _groupWebRtc.addCandidate(peerId, candidate).catchError((_) {});
      }
      _signaling.send(
        CallSignal(
          type: 'group-call-answer',
          from: userId,
          to: peerId,
          conversationId: state.conversationId,
          answer: answer,
        ),
      );
      _transition(CommsCallStatus.connected);
      _connectionTimer?.cancel();
      return;
    }

    if (signal.type == 'group-call-answer') {
      final peerId = signal.from;
      final answer = signal.answer;
      if (peerId != null && answer != null) {
        await _groupWebRtc.acceptAnswer(peerId, answer);
        _transition(CommsCallStatus.connected);
        _connectionTimer?.cancel();
      }
      return;
    }

    if (signal.type == 'group-call-ice-candidate') {
      final peerId = signal.from;
      final candidate = signal.candidate;
      if (peerId == null || candidate == null) return;
      try {
        await _groupWebRtc.addCandidate(peerId, candidate);
      } catch (_) {
        (_pendingGroupCandidates[peerId] ??= []).add(candidate);
      }
      return;
    }

    if (signal.type == 'group-call-peer-left') {
      final peerId = signal.raw['userId'] as String?;
      if (peerId != null) {
        await _groupWebRtc.removePeer(peerId);
        state = state.copyWith(remoteStreams: _groupWebRtc.remoteStreams);
      }
      return;
    }

    if (signal.type == 'group-call-share-request') {
      final requesterId = signal.from;
      if (requesterId == null || requesterId == userId) return;
      final canApprove =
          await _canShareScreenWithoutApproval(currentUserId: userId);
      if (!canApprove) return;
      state = state.copyWith(
        pendingScreenShareFromUserId: requesterId,
        error: '$requesterId requested permission to share screen.',
      );
      return;
    }

    if (signal.type == 'group-call-share-decision') {
      final approved = signal.raw['approved'] == true;
      if (!approved) {
        state = state.copyWith(
          screenShareRequestPending: false,
          error: 'Screen-share request was declined.',
        );
        return;
      }
      state = state.copyWith(
        screenShareRequestPending: false,
        error: 'Screen-share request approved.',
      );
      await _startScreenShare(currentUserId: userId);
      return;
    }

    if (signal.type == 'group-call-share-status') {
      final from = signal.from;
      final enabled = signal.raw['enabled'] == true;
      if (from != null && from != userId) {
        state = state.copyWith(
          error: enabled
              ? '$from started screen sharing.'
              : '$from stopped screen sharing.',
        );
      }
      return;
    }

    if (signal.type == 'group-call-ended') {
      await _groupWebRtc.disposeCall();
      _transition(CommsCallStatus.ended, clearCall: true);
    }
  }

  Future<void> _sendGroupOffer(String currentUserId, String peerId) async {
    await _ensureGroupMedia();
    await _prepareGroupPeer(currentUserId, peerId);
    final offer = await _groupWebRtc.createOffer(peerId);
    _signaling.send(
      CallSignal(
        type: 'group-call-offer',
        from: currentUserId,
        to: peerId,
        conversationId: state.conversationId,
        offer: offer,
      ),
    );
  }

  Future<void> _safeDisposeCall(Future<void> Function() dispose) async {
    try {
      await dispose();
    } catch (_) {
      // Best-effort cleanup before starting another call flow.
    }
  }

  Future<MediaStream> _acquireGroupMediaResilient(CallMode mode) async {
    try {
      return await _groupWebRtc.acquireMedia(mode);
    } catch (_) {
      await _safeDisposeCall(_groupWebRtc.disposeCall);
      await Future<void>.delayed(const Duration(milliseconds: 200));
      try {
        return await _groupWebRtc.acquireMedia(mode);
      } catch (secondError) {
        final text = secondError.toString().toLowerCase();
        if (mode == CallMode.video &&
            (text.contains('permission') ||
                text.contains('notallowed') ||
                text.contains('notreadable') ||
                text.contains('overconstrained') ||
                text.contains('operationerror'))) {
          return _groupWebRtc.acquireMedia(CallMode.audio);
        }
        rethrow;
      }
    }
  }

  Future<bool> _canShareScreenWithoutApproval({
    required String currentUserId,
  }) async {
    if (!state.isGroupCall) return true;
    if (currentUserId == state.callStarterUserId) return true;
    final conversationId = state.conversationId;
    if (conversationId == null) return false;
    final role = await _repository.conversationRole(
      conversationId: conversationId,
      userId: currentUserId,
    );
    return role == 'owner' || role == 'admin';
  }

  Future<void> _startScreenShare({
    required String currentUserId,
  }) async {
    try {
      if (state.isGroupCall) {
        final stream = await _groupWebRtc.startScreenShare();
        state = state.copyWith(
          localStream: stream,
          isScreenSharing: true,
          cameraEnabled: true,
          screenShareRequestPending: false,
          error: 'You are sharing your screen.',
        );
        _signaling.send(
          CallSignal(
            type: 'group-call-share-status',
            from: currentUserId,
            conversationId: state.conversationId,
            raw: {'enabled': true},
          ),
        );
      } else {
        final stream = await _webRtc.startScreenShare();
        state = state.copyWith(
          localStream: stream,
          isScreenSharing: true,
          cameraEnabled: true,
          error: 'You are sharing your screen.',
        );
      }
    } catch (error) {
      state = state.copyWith(
        screenShareRequestPending: false,
        error: _friendlyCallError(error),
      );
    }
  }

  Future<void> _stopScreenShare({
    required String currentUserId,
  }) async {
    if (state.isGroupCall) {
      final stream = await _groupWebRtc.stopScreenShare();
      state = state.copyWith(
        localStream: stream,
        isScreenSharing: false,
        cameraEnabled: stream?.getVideoTracks().isNotEmpty == true,
        error: 'Screen sharing stopped.',
      );
      _signaling.send(
        CallSignal(
          type: 'group-call-share-status',
          from: currentUserId,
          conversationId: state.conversationId,
          raw: {'enabled': false},
        ),
      );
      return;
    }
    final stream = await _webRtc.stopScreenShare();
    state = state.copyWith(
      localStream: stream,
      isScreenSharing: false,
      cameraEnabled: stream?.getVideoTracks().isNotEmpty == true,
      error: 'Screen sharing stopped.',
    );
  }

  Future<void> _ensureGroupMedia() async {
    if (state.localStream != null) return;
    final stream = await _groupWebRtc.acquireMedia(state.mode);
    state = state.copyWith(
      localStream: _groupWebRtc.previewStream ?? stream,
      cameraEnabled: stream.getVideoTracks().isNotEmpty,
      microphoneEnabled: true,
      isGroupCall: true,
    );
  }

  Future<void> _prepareGroupPeer(String currentUserId, String peerId) async {
    await _groupWebRtc.ensurePeer(
      peerId: peerId,
      onIceCandidate: (targetPeerId, candidate) {
        _signaling.send(
          CallSignal(
            type: 'group-call-ice-candidate',
            from: currentUserId,
            to: targetPeerId,
            conversationId: state.conversationId,
            candidate: candidate,
          ),
        );
      },
      onRemoteStream: (_, __) {
        state = state.copyWith(remoteStreams: _groupWebRtc.remoteStreams);
        _connectionTimer?.cancel();
        _transition(CommsCallStatus.connected);
      },
    );
  }

  Future<void> _beginOfferForJoin(CallSignal signal) async {
    final currentCallId = state.activeCallId;
    final peerId = signal.from;
    if (currentCallId == null || peerId == null || signal.to == null) return;
    _ringTimer?.cancel();
    _transition(CommsCallStatus.acquiringMedia);
    final stream = await _webRtc.acquireMedia(state.mode);
    state = state.copyWith(
      localStream: _webRtc.previewStream ?? stream,
      cameraEnabled: stream.getVideoTracks().isNotEmpty,
      microphoneEnabled: true,
    );
    await _preparePeer(currentUserId: signal.to!, peerId: peerId);
    final offer = await _webRtc.createOffer();
    _transition(CommsCallStatus.connecting);
    _signaling.send(
      CallSignal(
        type: 'call-offer',
        callId: currentCallId,
        from: signal.to,
        to: peerId,
        offer: offer,
      ),
    );
  }

  Future<void> _answerOffer(CallSignal signal) async {
    final callId = signal.callId ?? state.activeCallId;
    final peerId = signal.from;
    final to = signal.to;
    final offer = signal.offer;
    if (callId == null || peerId == null || to == null || offer == null) return;
    _ringTimer?.cancel();
    _transition(CommsCallStatus.acquiringMedia);
    if (state.localStream == null) {
      final stream = await _webRtc.acquireMedia(state.mode);
      state = state.copyWith(
        localStream: _webRtc.previewStream ?? stream,
        cameraEnabled: stream.getVideoTracks().isNotEmpty,
        microphoneEnabled: true,
      );
    }
    await _preparePeer(currentUserId: to, peerId: peerId);
    final answer = await _webRtc.acceptOffer(offer);
    for (final candidate in List<Object>.from(_pendingCandidates)) {
      await _webRtc.addCandidate(candidate).catchError((_) {});
    }
    _pendingCandidates.clear();
    _transition(CommsCallStatus.connected);
    _connectionTimer?.cancel();
    _signaling.send(
      CallSignal(
        type: 'call-answer',
        callId: callId,
        from: to,
        to: peerId,
        answer: answer,
      ),
    );
  }

  Future<void> _preparePeer({
    required String currentUserId,
    required String peerId,
  }) async {
    await _webRtc.ensurePeer(
      onIceCandidate: (candidate) {
        final callId = state.activeCallId;
        if (callId == null) return;
        _signaling.send(
          CallSignal(
            type: 'ice-candidate',
            callId: callId,
            from: currentUserId,
            to: peerId,
            candidate: candidate,
          ),
        );
      },
      onRemoteStream: (stream) {
        state = state.copyWith(remoteStream: stream);
        _connectionTimer?.cancel();
        _transition(CommsCallStatus.connected);
      },
    );
  }

  void _transition(
    CommsCallStatus status, {
    String? activeCallId,
    String? peerId,
    String? conversationId,
    CallMode? mode,
    String? error,
    bool? isGroupCall,
    bool? isMinimized,
    String? callStarterUserId,
    bool clearPendingScreenShareRequester = false,
    bool clearCall = false,
  }) {
    if (!canTransitionCall(state.status, status)) return;
    final nextIsGroupCall =
        clearCall ? false : (isGroupCall ?? state.isGroupCall);
    if (status == CommsCallStatus.connecting && !nextIsGroupCall) {
      _startConnectionTimeout();
    }
    if (status == CommsCallStatus.connected ||
        status == CommsCallStatus.ended ||
        status == CommsCallStatus.failed ||
        nextIsGroupCall) {
      _connectionTimer?.cancel();
    }
    state = state.copyWith(
      status: status,
      activeCallId: activeCallId,
      peerId: peerId,
      conversationId: conversationId,
      mode: mode,
      error: error,
      isGroupCall: nextIsGroupCall,
      isMinimized: isMinimized,
      callStarterUserId: callStarterUserId,
      clearPendingScreenShareRequester: clearPendingScreenShareRequester,
      clearCall: clearCall,
    );
  }

  Future<void> _disposeActiveCall() {
    return state.isGroupCall
        ? _groupWebRtc.disposeCall()
        : _webRtc.disposeCall();
  }

  void _startRingTimeout({String? currentUserId, String? peerId}) {
    _ringTimer?.cancel();
    _ringTimer = Timer(callTimeout, () {
      if (!mounted) return;
      final status = state.status;
      final stillRinging = status == CommsCallStatus.incomingRinging ||
          status == CommsCallStatus.outgoingRinging;
      if (!stillRinging || state.isGroupCall) return;
      if (currentUserId != null && peerId != null) {
        _signaling.send(
          CallSignal(
            type: 'call-end',
            callId: state.activeCallId,
            from: currentUserId,
            to: peerId,
            reason: 'missed',
          ),
        );
      }
      unawaited(_webRtc.disposeCall());
      _transition(
        CommsCallStatus.failed,
        error: 'Call timed out.',
        clearCall: true,
      );
    });
  }

  void _startConnectionTimeout() {
    _connectionTimer?.cancel();
    _connectionTimer = Timer(const Duration(seconds: 25), () {
      if (!mounted) return;
      if (state.status != CommsCallStatus.connecting) return;
      final wasGroupCall = state.isGroupCall;
      _transition(
        CommsCallStatus.failed,
        error: state.mode == CallMode.video
            ? 'Video could not connect. Try an audio call if the network is weak.'
            : 'Call could not connect. Check your connection and try again.',
        clearCall: true,
      );
      unawaited(
        wasGroupCall ? _groupWebRtc.disposeCall() : _webRtc.disposeCall(),
      );
    });
  }

  void _resetIfTerminal() {
    if (state.status == CommsCallStatus.ended ||
        state.status == CommsCallStatus.failed) {
      state = const CallControllerState();
    }
  }

  String _friendlyCallError(Object error) {
    final text = error.toString().toLowerCase();
    if (text.contains('calling server is unavailable') ||
        text.contains('websocket') ||
        text.contains('ws') ||
        text.contains('connection refused') ||
        text.contains('network')) {
      return 'Calling server is unavailable right now. Please retry in a moment.';
    }
    if (text.contains('permission') ||
        text.contains('notallowed') ||
        text.contains('denied')) {
      return state.mode == CallMode.video
          ? 'Camera or microphone permission was denied.'
          : 'Microphone permission was denied.';
    }
    if (text.contains('notfound') || text.contains('device')) {
      return state.mode == CallMode.video
          ? 'Camera or microphone was not found on this device.'
          : 'Microphone was not found on this device.';
    }
    if (text.contains('notreadable') ||
        text.contains('track') ||
        text.contains('hardware')) {
      return 'Media device is busy or unavailable. Close other apps using camera/mic and retry.';
    }
    return 'Call could not start. Please check network and media access, then try again.';
  }

  @override
  void dispose() {
    _ringTimer?.cancel();
    _connectionTimer?.cancel();
    _subscription.cancel();
    unawaited(_webRtc.disposeCall());
    unawaited(_groupWebRtc.disposeCall());
    super.dispose();
  }
}
