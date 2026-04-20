enum CommsCallStatus {
  idle,
  outgoingRinging,
  incomingRinging,
  acquiringMedia,
  connecting,
  connected,
  reconnecting,
  ending,
  ended,
  failed,
}

const callTimeout = Duration(seconds: 45);

const allowedCallTransitions = <CommsCallStatus, Set<CommsCallStatus>>{
  CommsCallStatus.idle: {
    CommsCallStatus.incomingRinging,
    CommsCallStatus.outgoingRinging,
    CommsCallStatus.acquiringMedia
  },
  CommsCallStatus.incomingRinging: {
    CommsCallStatus.acquiringMedia,
    CommsCallStatus.ending,
    CommsCallStatus.ended,
    CommsCallStatus.failed
  },
  CommsCallStatus.outgoingRinging: {
    CommsCallStatus.acquiringMedia,
    CommsCallStatus.connecting,
    CommsCallStatus.ending,
    CommsCallStatus.ended,
    CommsCallStatus.failed
  },
  CommsCallStatus.acquiringMedia: {
    CommsCallStatus.outgoingRinging,
    CommsCallStatus.connecting,
    CommsCallStatus.ending,
    CommsCallStatus.failed
  },
  CommsCallStatus.connecting: {
    CommsCallStatus.connected,
    CommsCallStatus.reconnecting,
    CommsCallStatus.ending,
    CommsCallStatus.ended,
    CommsCallStatus.failed
  },
  CommsCallStatus.connected: {
    CommsCallStatus.reconnecting,
    CommsCallStatus.ending,
    CommsCallStatus.ended,
    CommsCallStatus.failed
  },
  CommsCallStatus.reconnecting: {
    CommsCallStatus.acquiringMedia,
    CommsCallStatus.connecting,
    CommsCallStatus.connected,
    CommsCallStatus.ending,
    CommsCallStatus.ended,
    CommsCallStatus.failed
  },
  CommsCallStatus.ending: {CommsCallStatus.ended, CommsCallStatus.failed},
  CommsCallStatus.ended: {CommsCallStatus.idle},
  CommsCallStatus.failed: {CommsCallStatus.idle, CommsCallStatus.ending},
};

bool canTransitionCall(CommsCallStatus from, CommsCallStatus to) {
  return from == to || (allowedCallTransitions[from]?.contains(to) ?? false);
}
