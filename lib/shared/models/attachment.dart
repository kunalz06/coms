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
    this.uploadMode = 'direct',
    this.originalSizeBytes,
    this.chunkSizeBytes,
    this.chunkCount,
    this.fileSha256,
    this.assemblyStatus = 'ready',
    this.chunks = const [],
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
  final String uploadMode;
  final int? originalSizeBytes;
  final int? chunkSizeBytes;
  final int? chunkCount;
  final String? fileSha256;
  final String assemblyStatus;
  final List<AttachmentChunk> chunks;

  bool get isChunked => uploadMode == 'chunked';

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
      uploadMode: json['upload_mode'] as String? ?? 'direct',
      originalSizeBytes: (json['original_size_bytes'] as num?)?.toInt(),
      chunkSizeBytes: (json['chunk_size_bytes'] as num?)?.toInt(),
      chunkCount: (json['chunk_count'] as num?)?.toInt(),
      fileSha256: json['file_sha256'] as String?,
      assemblyStatus: json['assembly_status'] as String? ?? 'ready',
      chunks: json['message_attachment_chunks'] is List
          ? (json['message_attachment_chunks'] as List)
              .whereType<Map<String, dynamic>>()
              .map(AttachmentChunk.fromJson)
              .toList(growable: false)
          : const [],
    );
  }
}

class AttachmentChunk {
  const AttachmentChunk({
    required this.id,
    required this.attachmentId,
    required this.chunkIndex,
    required this.chunkUrl,
    required this.chunkSizeBytes,
    required this.chunkSha256,
    required this.createdAt,
    this.chunkPublicId,
  });

  final String id;
  final String attachmentId;
  final int chunkIndex;
  final String chunkUrl;
  final String? chunkPublicId;
  final int chunkSizeBytes;
  final String chunkSha256;
  final DateTime createdAt;

  factory AttachmentChunk.fromJson(Map<String, dynamic> json) {
    return AttachmentChunk(
      id: json['id'] as String,
      attachmentId: json['attachment_id'] as String,
      chunkIndex: (json['chunk_index'] as num).toInt(),
      chunkUrl: json['chunk_url'] as String,
      chunkPublicId: json['chunk_public_id'] as String?,
      chunkSizeBytes: (json['chunk_size_bytes'] as num).toInt(),
      chunkSha256: json['chunk_sha256'] as String,
      createdAt: DateTime.tryParse(json['created_at'].toString()) ??
          DateTime.fromMillisecondsSinceEpoch(0),
    );
  }
}
