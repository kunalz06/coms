class MessageReaction {
  const MessageReaction({
    required this.id,
    required this.messageId,
    required this.userId,
    required this.kind,
    required this.content,
    required this.createdAt,
  });

  final String id;
  final String messageId;
  final String userId;
  final String kind;
  final String content;
  final DateTime createdAt;

  factory MessageReaction.fromJson(Map<String, dynamic> json) {
    return MessageReaction(
      id: json['id'] as String,
      messageId: json['message_id'] as String,
      userId: json['user_id'] as String,
      kind: json['kind'] as String? ?? 'emoji',
      content: json['content'] as String,
      createdAt: DateTime.tryParse(json['created_at'].toString()) ??
          DateTime.fromMillisecondsSinceEpoch(0),
    );
  }
}
