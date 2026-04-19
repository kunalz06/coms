class FileDecision {
  const FileDecision._({
    required this.allowed,
    required this.shouldCompress,
    required this.message,
  });

  final bool allowed;
  final bool shouldCompress;
  final String message;

  factory FileDecision.allowDirect() => const FileDecision._(
      allowed: true, shouldCompress: false, message: 'Ready to upload.');
  factory FileDecision.compressImage() => const FileDecision._(
      allowed: true,
      shouldCompress: true,
      message: 'Image will be compressed before upload.');
  factory FileDecision.reject(String message) =>
      FileDecision._(allowed: false, shouldCompress: false, message: message);
}

class FileRules {
  static const directImageLimitBytes = 5 * 1024 * 1024;
  static const directDocumentLimitBytes = 10 * 1024 * 1024;
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

    if (sizeBytes <= directDocumentLimitBytes)
      return FileDecision.allowDirect();
    return FileDecision.reject(
      'Documents and other files must be 10 MB or smaller.',
    );
  }
}
