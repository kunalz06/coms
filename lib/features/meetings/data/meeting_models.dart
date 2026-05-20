class Meeting {
  const Meeting({
    required this.id,
    required this.title,
    required this.creatorId,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.startedAt,
    this.endedAt,
    this.emptySince,
  });

  final String id;
  final String title;
  final String creatorId;
  final String status;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? startedAt;
  final DateTime? endedAt;
  final DateTime? emptySince;

  bool get isLive => status == 'live';
  bool get isEnded => status == 'ended';

  factory Meeting.fromJson(Map<String, dynamic> json) {
    return Meeting(
      id: json['id'] as String,
      title: json['title'] as String? ?? 'COMMS meeting',
      creatorId: json['creator_id'] as String,
      status: json['status'] as String? ?? 'created',
      startedAt: _date(json['started_at']),
      endedAt: _date(json['ended_at']),
      emptySince: _date(json['empty_since']),
      createdAt:
          _date(json['created_at']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      updatedAt:
          _date(json['updated_at']) ?? DateTime.fromMillisecondsSinceEpoch(0),
    );
  }
}

class MeetingParticipant {
  const MeetingParticipant({
    required this.meetingId,
    required this.userId,
    required this.role,
    required this.joinedAt,
    required this.canDraw,
    required this.handRaised,
    this.displayName,
    this.avatarUrl,
    this.leftAt,
  });

  final String meetingId;
  final String userId;
  final String role;
  final String? displayName;
  final String? avatarUrl;
  final DateTime joinedAt;
  final DateTime? leftAt;
  final bool canDraw;
  final bool handRaised;

  bool get isActive => leftAt == null;
  bool get isCreator => role == 'creator' || role == 'co_creator';

  factory MeetingParticipant.fromJson(Map<String, dynamic> json) {
    final profile = json['user_profiles'];
    final profileMap = profile is Map ? Map<String, dynamic>.from(profile) : null;
    return MeetingParticipant(
      meetingId: json['meeting_id'] as String,
      userId: json['user_id'] as String,
      role: json['role'] as String? ?? 'participant',
      displayName: profileMap?['full_name'] as String?,
      avatarUrl: profileMap?['avatar_url'] as String?,
      joinedAt:
          _date(json['joined_at']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      leftAt: _date(json['left_at']),
      canDraw: json['can_draw'] as bool? ?? true,
      handRaised: json['hand_raised'] as bool? ?? false,
    );
  }
}

class MeetingChatMessage {
  const MeetingChatMessage({
    required this.id,
    required this.meetingId,
    required this.senderId,
    required this.content,
    required this.createdAt,
    this.senderName,
  });

  final String id;
  final String meetingId;
  final String senderId;
  final String content;
  final String? senderName;
  final DateTime createdAt;

  factory MeetingChatMessage.fromJson(Map<String, dynamic> json) {
    final profile = json['user_profiles'];
    final profileMap = profile is Map ? Map<String, dynamic>.from(profile) : null;
    return MeetingChatMessage(
      id: json['id'] as String,
      meetingId: json['meeting_id'] as String,
      senderId: json['sender_id'] as String,
      content: json['content'] as String? ?? '',
      senderName: profileMap?['full_name'] as String?,
      createdAt:
          _date(json['created_at']) ?? DateTime.fromMillisecondsSinceEpoch(0),
    );
  }
}

class WhiteboardStroke {
  const WhiteboardStroke({
    required this.id,
    required this.meetingId,
    required this.userId,
    required this.points,
    required this.color,
    required this.width,
    required this.createdAt,
  });

  final String id;
  final String meetingId;
  final String userId;
  final List<WhiteboardPoint> points;
  final int color;
  final double width;
  final DateTime createdAt;

  factory WhiteboardStroke.fromJson(Map<String, dynamic> json) {
    final rawPoints = json['points'];
    final pointList = rawPoints is List
        ? rawPoints
            .whereType<Map>()
            .map((point) => WhiteboardPoint.fromJson(Map<String, dynamic>.from(point)))
            .toList(growable: false)
        : const <WhiteboardPoint>[];
    return WhiteboardStroke(
      id: json['id'] as String,
      meetingId: json['meeting_id'] as String,
      userId: json['user_id'] as String,
      points: pointList,
      color: json['color'] as int? ?? 0xFF1A73E8,
      width: (json['width'] as num?)?.toDouble() ?? 3,
      createdAt:
          _date(json['created_at']) ?? DateTime.fromMillisecondsSinceEpoch(0),
    );
  }
}

class WhiteboardPoint {
  const WhiteboardPoint(this.x, this.y);

  final double x;
  final double y;

  Map<String, dynamic> toJson() => {'x': x, 'y': y};

  factory WhiteboardPoint.fromJson(Map<String, dynamic> json) {
    return WhiteboardPoint(
      (json['x'] as num?)?.toDouble() ?? 0,
      (json['y'] as num?)?.toDouble() ?? 0,
    );
  }
}

DateTime? _date(Object? value) {
  if (value == null) return null;
  return DateTime.tryParse(value.toString());
}
