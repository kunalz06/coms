import 'attachment.dart';
import 'message_reaction.dart';

class Message {
  const Message({
    required this.id,
    required this.conversationId,
    required this.senderId,
    required this.kind,
    required this.status,
    required this.retentionExpiresAt,
    required this.archiveStatus,
    required this.createdAt,
    required this.updatedAt,
    this.content,
    this.deletedForEveryoneAt,
    this.deletedBy,
    this.editedAt,
    this.contentRedactedAt,
    this.attachments = const [],
    this.reactions = const [],
  });

  final String id;
  final String conversationId;
  final String senderId;
  final String kind;
  final String? content;
  final String status;
  final DateTime? deletedForEveryoneAt;
  final String? deletedBy;
  final DateTime? editedAt;
  final DateTime retentionExpiresAt;
  final DateTime? contentRedactedAt;
  final String archiveStatus;
  final DateTime createdAt;
  final DateTime updatedAt;
  final List<Attachment> attachments;
  final List<MessageReaction> reactions;

  bool get isRedacted =>
      contentRedactedAt != null || archiveStatus == 'redacted';
  bool get isDeletedForEveryone => deletedForEveryoneAt != null;

  factory Message.fromJson(Map<String, dynamic> json) {
    final rawAttachments = json['attachments'] ?? json['message_attachments'];
    final rawReactions = json['reactions'] ?? json['message_reactions'];
    return Message(
      id: json['id'] as String,
      conversationId: json['conversation_id'] as String,
      senderId: json['sender_id'] as String,
      kind: json['kind'] as String,
      content: json['content'] as String?,
      status: json['status'] as String? ?? 'sent',
      deletedForEveryoneAt: _date(json['deleted_for_everyone_at']),
      deletedBy: json['deleted_by'] as String?,
      editedAt: _date(json['edited_at']),
      retentionExpiresAt: _date(json['retention_expires_at']) ?? DateTime.now(),
      contentRedactedAt: _date(json['content_redacted_at']),
      archiveStatus: json['archive_status'] as String? ?? 'pending',
      createdAt:
          _date(json['created_at']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      updatedAt:
          _date(json['updated_at']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      attachments: rawAttachments is List
          ? rawAttachments
              .whereType<Map<String, dynamic>>()
              .map(Attachment.fromJson)
              .toList(growable: false)
          : const [],
      reactions: rawReactions is List
          ? rawReactions
              .whereType<Map<String, dynamic>>()
              .map(MessageReaction.fromJson)
              .toList(growable: false)
          : const [],
    );
  }

  static DateTime? _date(Object? value) {
    if (value == null) return null;
    return DateTime.tryParse(value.toString());
  }
}
