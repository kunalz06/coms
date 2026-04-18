import 'user_profile.dart';

class ConversationMember {
  const ConversationMember({
    required this.id,
    required this.conversationId,
    required this.userId,
    required this.role,
    required this.joinedAt,
    this.lastReadAt,
    this.profile,
  });

  final String id;
  final String conversationId;
  final String userId;
  final String role;
  final DateTime joinedAt;
  final DateTime? lastReadAt;
  final UserProfile? profile;

  factory ConversationMember.fromJson(
    Map<String, dynamic> json, {
    UserProfile? profile,
  }) {
    return ConversationMember(
      id: json['id'] as String,
      conversationId: json['conversation_id'] as String,
      userId: json['user_id'] as String,
      role: json['role'] as String? ?? 'member',
      joinedAt:
          _date(json['joined_at']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      lastReadAt: _date(json['last_read_at']),
      profile: profile,
    );
  }

  static DateTime? _date(Object? value) {
    if (value == null) return null;
    return DateTime.tryParse(value.toString());
  }
}
