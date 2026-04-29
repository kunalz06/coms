class FileDecision {
  const FileDecision._({
    required this.allowed,
    required this.shouldCompress,
    required this.shouldChunk,
    required this.message,
  });

  final bool allowed;
  final bool shouldCompress;
  final bool shouldChunk;
  final String message;

  factory FileDecision.allowDirect() => const FileDecision._(
      allowed: true,
      shouldCompress: false,
      shouldChunk: false,
      message: 'Ready to upload.');
  factory FileDecision.compressImage() => const FileDecision._(
      allowed: true,
      shouldCompress: true,
      shouldChunk: false,
      message: 'Image will be compressed before upload.');
  factory FileDecision.chunkDocument() => const FileDecision._(
      allowed: true,
      shouldCompress: false,
      shouldChunk: true,
      message: 'Large file will be uploaded in chunks.');
  factory FileDecision.reject(String message) =>
      FileDecision._(
          allowed: false,
          shouldCompress: false,
          shouldChunk: false,
          message: message);
}

class FileRules {
  static const directImageLimitBytes = 5 * 1024 * 1024;
  static const directDocumentLimitBytes = 10 * 1024 * 1024;
  static const chunkSizeBytes = 5 * 1024 * 1024;
  static const chunkedDocumentLimitBytes = 100 * 1024 * 1024;
  static const compressibleImageLimitBytes = 20 * 1024 * 1024;

  static FileDecision decide({
    required int sizeBytes,
    required String mimeType,
    String? kind,
  }) {
    final isImage = kind == 'image' || mimeType.startsWith('image/');

    if (isImage) {
      if (sizeBytes <= directImageLimitBytes) return FileDecision.allowDirect();
      if (sizeBytes <= compressibleImageLimitBytes) {
        return FileDecision.compressImage();
      }
      return FileDecision.reject(
        'Images above 20 MB are not supported. Choose a smaller image.',
      );
    }

    if (sizeBytes <= directDocumentLimitBytes) {
      return FileDecision.allowDirect();
    }
    if (sizeBytes <= chunkedDocumentLimitBytes) {
      return FileDecision.chunkDocument();
    }
    return FileDecision.reject(
      'Documents and other files must be 100 MB or smaller.',
    );
  }
}
