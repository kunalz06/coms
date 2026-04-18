import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../chats/data/chat_repository.dart';
import '../domain/file_rules.dart';

final cloudinaryUploadServiceProvider =
    Provider<CloudinaryUploadService>((ref) {
  return CloudinaryUploadService(
    config: ref.watch(appConfigProvider),
    dio: Dio(),
  );
});

class CloudinaryUploadService {
  CloudinaryUploadService({
    required AppConfig config,
    required Dio dio,
  })  : _config = config,
        _dio = dio;

  final AppConfig _config;
  final Dio _dio;

  Future<AttachmentDraft> upload({
    required PlatformFile file,
    required String kind,
    required void Function(int progress) onProgress,
  }) async {
    final bytes = file.bytes;
    if (bytes == null) {
      throw const FormatException('Could not read this file on this platform.');
    }
    if (bytes.isEmpty) {
      throw const FormatException('This file is empty.');
    }

    return uploadBytes(
      bytes: bytes,
      fileName: file.name,
      kind: kind,
      mimeType: _mimeTypeFor(file.name, kind),
      onProgress: onProgress,
    );
  }

  Future<AttachmentDraft> uploadBytes({
    required List<int> bytes,
    required String fileName,
    required String kind,
    required String mimeType,
    required void Function(int progress) onProgress,
  }) async {
    final decision = FileRules.decide(
      sizeBytes: bytes.length,
      mimeType: mimeType,
    );
    if (!decision.allowed) throw FormatException(decision.message);
    if (decision.shouldCompress) {
      throw const FormatException(
        'Image compression is scheduled for the file-polish phase. Choose an image under 5 MB for now.',
      );
    }

    if (_config.cloudinaryCloudName.isEmpty) {
      throw const FormatException('Cloudinary cloud name is not configured.');
    }

    final signed = await _signature(kind);
    final resource = _resourceType(kind, mimeType, fileName);
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        bytes,
        filename: _safeFileName(fileName),
      ),
      'api_key': signed.apiKey,
      'timestamp': signed.timestamp.toString(),
      'signature': signed.signature,
      'folder': signed.folder,
    });

    final response = await _dio.post<Map<String, dynamic>>(
      'https://api.cloudinary.com/v1_1/${_config.cloudinaryCloudName}/$resource/upload',
      data: form,
      onSendProgress: (sent, total) {
        if (total > 0) onProgress(((sent / total) * 100).round());
      },
    );

    final data = response.data;
    if (data == null || data['secure_url'] == null) {
      throw const FormatException('Cloudinary did not return an upload URL.');
    }

    onProgress(100);
    return AttachmentDraft(
      url: data['secure_url'] as String,
      publicId: data['public_id'] as String? ?? '',
      resourceType: data['resource_type'] as String? ?? resource,
      fileName: _safeFileName(fileName),
      mimeType: mimeType,
      sizeBytes: bytes.length,
    );
  }

  Future<_CloudinarySignature> _signature(String kind) async {
    final token = await FirebaseAuth.instance.currentUser?.getIdToken();
    if (token == null) {
      throw const FormatException('Sign in again before uploading files.');
    }

    final response = await _dio.post<Map<String, dynamic>>(
      '${_config.apiBaseUrl}/api/cloudinary/sign',
      data: {'kind': kind},
      options: Options(headers: {'Authorization': 'Bearer $token'}),
    );
    final data = response.data;
    if (data == null) {
      throw const FormatException('Upload signing failed.');
    }

    return _CloudinarySignature(
      signature: data['signature'] as String,
      timestamp: (data['timestamp'] as num).toInt(),
      apiKey: data['apiKey'] as String,
      folder: data['folder'] as String,
    );
  }
}

class _CloudinarySignature {
  const _CloudinarySignature({
    required this.signature,
    required this.timestamp,
    required this.apiKey,
    required this.folder,
  });

  final String signature;
  final int timestamp;
  final String apiKey;
  final String folder;
}

String _resourceType(String kind, String mimeType, String fileName) {
  final isPdf =
      mimeType == 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
  if (kind == 'document') return isPdf ? 'image' : 'raw';
  if (kind == 'voice') return 'video';
  return 'image';
}

String _safeFileName(String value) {
  final sanitized = value
      .replaceAll(RegExp(r'[^a-zA-Z0-9._ -]'), '_')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  return sanitized.isEmpty ? 'comms-file' : sanitized;
}

String _mimeTypeFor(String fileName, String kind) {
  final lower = fileName.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.webm')) return 'audio/webm';
  return kind == 'image' ? 'image/jpeg' : 'application/octet-stream';
}
