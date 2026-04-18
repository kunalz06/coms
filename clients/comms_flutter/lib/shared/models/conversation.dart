class Conversation {
  const Conversation({
    required this.id,
    required this.type,
    required this.createdAt,
    required this.updatedAt,
    this.title,
    this.avatarUrl,
    this.createdBy,
    this.userOneId,
    this.userTwoId,
    this.lastMessageAt,
  });

  final String id;
  final String type;
  final String? title;
  final String? avatarUrl;
  final String? createdBy;
  final String? userOneId;
  final String? userTwoId;
  final DateTime? lastMessageAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isGroup => type == 'group';
  bool get isDirect => type == 'direct';

  factory Conversation.fromJson(Map<String, dynamic> json) {
    return Conversation(
      id: json['id'] as String,
      type: json['type'] as String? ?? 'direct',
      title: json['title'] as String?,
      avatarUrl: json['avatar_url'] as String?,
      createdBy: json['created_by'] as String?,
      userOneId: json['user_one_id'] as String?,
      userTwoId: json['user_two_id'] as String?,
      lastMessageAt: _date(json['last_message_at']),
      createdAt:
          _date(json['created_at']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      updatedAt:
          _date(json['updated_at']) ?? DateTime.fromMillisecondsSinceEpoch(0),
    );
  }

  static DateTime? _date(Object? value) {
    if (value == null) return null;
    return DateTime.tryParse(value.toString());
  }
}
