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
  static const directUploadLimitBytes = 5 * 1024 * 1024;
  static const compressibleImageLimitBytes = 20 * 1024 * 1024;

  static FileDecision decide({
    required int sizeBytes,
    required String mimeType,
  }) {
    if (sizeBytes <= directUploadLimitBytes) return FileDecision.allowDirect();
    if (mimeType.startsWith('image/') &&
        sizeBytes <= compressibleImageLimitBytes) {
      return FileDecision.compressImage();
    }
    return FileDecision.reject(
        'Only images between 5 MB and 20 MB can be compressed. Choose a smaller document.');
  }
}
