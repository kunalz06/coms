class Attachment {
  const Attachment({
    required this.id,
    required this.messageId,
    required this.url,
    required this.resourceType,
    required this.fileName,
    required this.mimeType,
    required this.sizeBytes,
    required this.createdAt,
    this.publicId,
  });

  final String id;
  final String messageId;
  final String url;
  final String? publicId;
  final String resourceType;
  final String fileName;
  final String mimeType;
  final int sizeBytes;
  final DateTime createdAt;

  factory Attachment.fromJson(Map<String, dynamic> json) {
    return Attachment(
      id: json['id'] as String,
      messageId: json['message_id'] as String,
      url: json['url'] as String,
      publicId: json['public_id'] as String?,
      resourceType: json['resource_type'] as String,
      fileName: json['file_name'] as String,
      mimeType: json['mime_type'] as String,
      sizeBytes: (json['size_bytes'] as num).toInt(),
      createdAt: DateTime.tryParse(json['created_at'].toString()) ??
          DateTime.fromMillisecondsSinceEpoch(0),
    );
  }
}
