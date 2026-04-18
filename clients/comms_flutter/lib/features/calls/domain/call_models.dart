enum CallMode {
  audio,
  video;

  String get wireName => name;

  static CallMode fromWire(String value) {
    return value == 'video' ? CallMode.video : CallMode.audio;
  }
}

class DirectCallSession {
  const DirectCallSession({
    required this.id,
    required this.callerId,
    required this.calleeId,
    required this.mode,
    required this.status,
    required this.startedAt,
    this.conversationId,
    this.endedAt,
    this.failureReason,
  });

  final String id;
  final String? conversationId;
  final String callerId;
  final String calleeId;
  final CallMode mode;
  final String status;
  final DateTime startedAt;
  final DateTime? endedAt;
  final String? failureReason;

  bool involves(String userId) => callerId == userId || calleeId == userId;

  String peerId(String userId) => callerId == userId ? calleeId : callerId;

  factory DirectCallSession.fromJson(Map<String, dynamic> json) {
    return DirectCallSession(
      id: json['id'] as String,
      conversationId: json['conversation_id'] as String?,
      callerId: json['caller_id'] as String,
      calleeId: json['callee_id'] as String,
      mode: CallMode.fromWire(json['mode'] as String? ?? 'audio'),
      status: json['status'] as String? ?? 'ringing',
      startedAt:
          _date(json['started_at']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      endedAt: _date(json['ended_at']),
      failureReason: json['failure_reason'] as String?,
    );
  }

  static DateTime? _date(Object? value) {
    if (value == null) return null;
    return DateTime.tryParse(value.toString());
  }
}
