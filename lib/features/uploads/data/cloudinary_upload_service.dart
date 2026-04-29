import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:image/image.dart' as img;

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

  static const _resumeBoxName = 'app_settings';
  static const _resumeKeyPrefix = 'chunk_upload_session_';
  static const _chunkUploadConcurrency = 3;

  Future<AttachmentDraft> upload({
    required PlatformFile file,
    required String kind,
    required void Function(int progress) onProgress,
    void Function(int uploadedChunks, int totalChunks)? onChunkProgress,
  }) async {
    final bytes = await _readFileBytes(file);
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
      onChunkProgress: onChunkProgress,
    );
  }

  Future<Uint8List?> _readFileBytes(PlatformFile file) async {
    final directBytes = file.bytes;
    if (directBytes != null && directBytes.isNotEmpty) {
      return directBytes;
    }

    final stream = file.readStream;
    if (stream != null) {
      final builder = BytesBuilder(copy: false);
      await for (final chunk in stream) {
        if (chunk.isNotEmpty) builder.add(chunk);
      }
      final streamedBytes = builder.takeBytes();
      if (streamedBytes.isNotEmpty) {
        return streamedBytes;
      }
    }

    return directBytes;
  }

  Future<AttachmentDraft> uploadBytes({
    required List<int> bytes,
    required String fileName,
    required String kind,
    required String mimeType,
    required void Function(int progress) onProgress,
    void Function(int uploadedChunks, int totalChunks)? onChunkProgress,
  }) async {
    final decision = FileRules.decide(
      sizeBytes: bytes.length,
      mimeType: mimeType,
      kind: kind,
    );
    if (!decision.allowed) throw FormatException(decision.message);

    var uploadBytesData = Uint8List.fromList(bytes);
    var uploadMimeType = mimeType;
    var uploadFileName = fileName;

    if (decision.shouldCompress && mimeType.startsWith('image/')) {
      final compressed = await _compressImageToTarget(
        uploadBytesData,
        targetBytes: FileRules.directImageLimitBytes,
      );
      if (compressed == null) {
        throw const FormatException(
          'Could not compress this image under 5 MB. Choose a smaller image.',
        );
      }
      uploadBytesData = compressed;
      uploadMimeType = 'image/jpeg';
      uploadFileName = _compressedImageFileName(fileName);
    }

    if (decision.shouldChunk && kind == 'document') {
      return _uploadChunkedDocument(
        bytes: uploadBytesData,
        fileName: uploadFileName,
        mimeType: uploadMimeType,
        onProgress: onProgress,
        onChunkProgress: onChunkProgress,
      );
    }

    if (_config.cloudinaryCloudName.isEmpty) {
      throw const FormatException('Cloudinary cloud name is not configured.');
    }

    final signed = await _signature(kind);
    final resource = _resourceType(kind);
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        uploadBytesData,
        filename: _safeFileName(uploadFileName),
      ),
      'api_key': signed.apiKey,
      'timestamp': signed.timestamp.toString(),
      'signature': signed.signature,
      'folder': signed.folder,
    });

    Response<Map<String, dynamic>> response;
    try {
      response = await _dio.post<Map<String, dynamic>>(
        'https://api.cloudinary.com/v1_1/${_config.cloudinaryCloudName}/$resource/upload',
        data: form,
        onSendProgress: (sent, total) {
          if (total > 0) onProgress(((sent / total) * 100).round());
        },
      );
    } on DioException catch (error) {
      // If Cloudinary rejects a specific resource endpoint, retry once using
      // auto detection to keep uploads working across browser/device variants.
      if (error.response?.statusCode == 400 && resource != 'auto') {
        try {
          response = await _dio.post<Map<String, dynamic>>(
            'https://api.cloudinary.com/v1_1/${_config.cloudinaryCloudName}/auto/upload',
            data: form,
            onSendProgress: (sent, total) {
              if (total > 0) onProgress(((sent / total) * 100).round());
            },
          );
        } on DioException catch (retryError) {
          throw FormatException(_cloudinaryErrorMessage(retryError));
        }
      } else {
        throw FormatException(_cloudinaryErrorMessage(error));
      }
    }

    final data = response.data;
    if (data == null || data['secure_url'] == null) {
      throw const FormatException('Cloudinary did not return an upload URL.');
    }

    onProgress(100);
    return AttachmentDraft(
      url: data['secure_url'] as String,
      publicId: data['public_id'] as String? ?? '',
      resourceType: data['resource_type'] as String? ?? resource,
      fileName: _safeFileName(uploadFileName),
      mimeType: uploadMimeType,
      sizeBytes: uploadBytesData.length,
    );
  }

  Future<Uint8List?> _compressImageToTarget(
    Uint8List source, {
    required int targetBytes,
  }) async {
    final decoded = img.decodeImage(source);
    if (decoded == null) return null;

    final baseImage = _resizeIfNeeded(decoded, maxDimension: 1920);
    final scaleSteps = <double>[1.0, 0.9, 0.8, 0.7, 0.6, 0.5];
    final qualitySteps = <int>[88, 82, 76, 70, 64, 58, 52, 46, 40, 34, 28];

    Uint8List? best;
    for (final scale in scaleSteps) {
      final candidate = scale == 1.0
          ? baseImage
          : img.copyResize(
              baseImage,
              width: (baseImage.width * scale).round(),
            );
      for (final quality in qualitySteps) {
        final encoded = Uint8List.fromList(
          img.encodeJpg(candidate, quality: quality),
        );
        best = encoded;
        if (encoded.length <= targetBytes) {
          return encoded;
        }
      }
    }
    if (best != null && best.length <= targetBytes) return best;
    return null;
  }

  img.Image _resizeIfNeeded(
    img.Image source, {
    required int maxDimension,
  }) {
    final width = source.width;
    final height = source.height;
    final maxSide = width > height ? width : height;
    if (maxSide <= maxDimension) return source;
    if (width >= height) {
      return img.copyResize(source, width: maxDimension);
    }
    return img.copyResize(source, height: maxDimension);
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

  Future<AttachmentDraft> _uploadChunkedDocument({
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
    required void Function(int progress) onProgress,
    void Function(int uploadedChunks, int totalChunks)? onChunkProgress,
  }) async {
    if (_config.cloudinaryCloudName.isEmpty) {
      throw const FormatException('Cloudinary cloud name is not configured.');
    }

    final safeName = _safeFileName(fileName);
    final fileSha = sha256.convert(bytes).toString();
    final totalChunks =
        (bytes.length / FileRules.chunkSizeBytes).ceil().clamp(1, 999999).toInt();
    final chunks = <_PendingChunk>[];
    for (var index = 0; index < totalChunks; index++) {
      final start = index * FileRules.chunkSizeBytes;
      final end = (start + FileRules.chunkSizeBytes) > bytes.length
          ? bytes.length
          : start + FileRules.chunkSizeBytes;
      final chunkBytes = Uint8List.sublistView(bytes, start, end);
      chunks.add(
        _PendingChunk(
          index: index,
          bytes: chunkBytes,
          sha256Hex: sha256.convert(chunkBytes).toString(),
        ),
      );
    }

    final sessionKey = '$_resumeKeyPrefix${_sessionFingerprint(
      fileName: safeName,
      sizeBytes: bytes.length,
      fileSha256: fileSha,
    )}';
    final resumed = _readChunkSession(sessionKey, chunks);
    final uploadedByIndex = <int, AttachmentChunkDraft>{
      for (final chunk in resumed) chunk.chunkIndex: chunk,
    };
    var uploadedCount = uploadedByIndex.length;
    void emitProgress() {
      onProgress(
        ((uploadedCount / totalChunks) * 100).floor().clamp(0, 100).toInt(),
      );
      onChunkProgress?.call(uploadedCount, totalChunks);
    }

    emitProgress();
    await _writeChunkSession(
      sessionKey: sessionKey,
      fileName: safeName,
      mimeType: mimeType,
      sizeBytes: bytes.length,
      fileSha256: fileSha,
      chunks: chunks,
      uploaded: uploadedByIndex.values.toList(growable: false),
      originalBytes: bytes,
    );

    final signed = await _signature('document');
    var nextIndex = 0;
    final failures = <Object>[];

    Future<void> worker() async {
      while (true) {
        final current = nextIndex++;
        if (current >= chunks.length) return;
        final pending = chunks[current];
        if (uploadedByIndex.containsKey(pending.index)) continue;
        try {
          final uploaded = await _uploadRawChunk(
            chunk: pending,
            signed: signed,
            fileName: safeName,
          );
          uploadedByIndex[pending.index] = uploaded;
          uploadedCount = uploadedByIndex.length;
          await _writeChunkSession(
            sessionKey: sessionKey,
            fileName: safeName,
            mimeType: mimeType,
            sizeBytes: bytes.length,
            fileSha256: fileSha,
            chunks: chunks,
            uploaded: uploadedByIndex.values.toList(growable: false),
            originalBytes: bytes,
          );
          emitProgress();
        } catch (error) {
          failures.add(error);
        }
      }
    }

    await Future.wait(
      List.generate(_chunkUploadConcurrency, (_) => worker()),
    );

    if (failures.isNotEmpty || uploadedByIndex.length != totalChunks) {
      throw FormatException(
        'Upload paused after $uploadedCount of $totalChunks chunks. Try sending the same file again to resume.',
      );
    }

    final uploadedChunks = uploadedByIndex.values.toList(growable: false)
      ..sort((a, b) => a.chunkIndex.compareTo(b.chunkIndex));
    await _clearChunkSession(sessionKey);
    onProgress(100);
    return AttachmentDraft(
      url: uploadedChunks.first.chunkUrl,
      publicId: uploadedChunks.first.chunkPublicId ?? '',
      resourceType: 'raw',
      fileName: safeName,
      mimeType: mimeType,
      sizeBytes: bytes.length,
      uploadMode: 'chunked',
      originalSizeBytes: bytes.length,
      chunkSizeBytes: FileRules.chunkSizeBytes,
      chunkCount: totalChunks,
      fileSha256: fileSha,
      assemblyStatus: 'ready',
      chunks: uploadedChunks,
    );
  }

  Future<AttachmentChunkDraft> _uploadRawChunk({
    required _PendingChunk chunk,
    required _CloudinarySignature signed,
    required String fileName,
  }) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(
        chunk.bytes,
        filename:
            '${_safeFileName(fileName)}.part${chunk.index.toString().padLeft(5, '0')}',
      ),
      'api_key': signed.apiKey,
      'timestamp': signed.timestamp.toString(),
      'signature': signed.signature,
      'folder': signed.folder,
    });

    Response<Map<String, dynamic>> response;
    try {
      response = await _dio.post<Map<String, dynamic>>(
        'https://api.cloudinary.com/v1_1/${_config.cloudinaryCloudName}/raw/upload',
        data: form,
      );
    } on DioException catch (error) {
      throw FormatException(_cloudinaryErrorMessage(error));
    }

    final data = response.data;
    if (data == null || data['secure_url'] == null) {
      throw const FormatException('Cloudinary did not return a chunk URL.');
    }

    return AttachmentChunkDraft(
      chunkIndex: chunk.index,
      chunkUrl: data['secure_url'] as String,
      chunkPublicId: data['public_id'] as String?,
      chunkSizeBytes: chunk.bytes.length,
      chunkSha256: chunk.sha256Hex,
    );
  }

  String _sessionFingerprint({
    required String fileName,
    required int sizeBytes,
    required String fileSha256,
  }) {
    return sha256.convert(utf8.encode('$fileName:$sizeBytes:$fileSha256')).toString();
  }

  List<AttachmentChunkDraft> _readChunkSession(
    String sessionKey,
    List<_PendingChunk> chunks,
  ) {
    if (!Hive.isBoxOpen(_resumeBoxName)) return const [];
    final raw = Hive.box(_resumeBoxName).get(sessionKey);
    if (raw is! Map) return const [];
    final rawChunks = raw['uploaded_chunks'];
    if (rawChunks is! List) return const [];
    final expectedHashes = {
      for (final chunk in chunks) chunk.index: chunk.sha256Hex,
    };
    final restored = <AttachmentChunkDraft>[];
    for (final rawChunk in rawChunks) {
      if (rawChunk is! Map) continue;
      final index = (rawChunk['chunk_index'] as num?)?.toInt();
      final url = rawChunk['chunk_url']?.toString();
      final size = (rawChunk['chunk_size_bytes'] as num?)?.toInt();
      final chunkSha = rawChunk['chunk_sha256']?.toString();
      if (index == null ||
          url == null ||
          url.isEmpty ||
          size == null ||
          chunkSha == null ||
          expectedHashes[index] != chunkSha) {
        continue;
      }
      restored.add(
        AttachmentChunkDraft(
          chunkIndex: index,
          chunkUrl: url,
          chunkPublicId: rawChunk['chunk_public_id']?.toString(),
          chunkSizeBytes: size,
          chunkSha256: chunkSha,
        ),
      );
    }
    return restored;
  }

  Future<void> _writeChunkSession({
    required String sessionKey,
    required String fileName,
    required String mimeType,
    required int sizeBytes,
    required String fileSha256,
    required List<_PendingChunk> chunks,
    required List<AttachmentChunkDraft> uploaded,
    required Uint8List originalBytes,
  }) async {
    if (!Hive.isBoxOpen(_resumeBoxName)) return;
    try {
      await Hive.box(_resumeBoxName).put(sessionKey, {
        'file_name': fileName,
        'mime_type': mimeType,
        'size_bytes': sizeBytes,
        'file_sha256': fileSha256,
        'chunk_size_bytes': FileRules.chunkSizeBytes,
        'chunk_count': chunks.length,
        'original_bytes_base64': base64Encode(originalBytes),
        'uploaded_chunks': uploaded
            .map(
              (chunk) => {
                'chunk_index': chunk.chunkIndex,
                'chunk_url': chunk.chunkUrl,
                'chunk_public_id': chunk.chunkPublicId,
                'chunk_size_bytes': chunk.chunkSizeBytes,
                'chunk_sha256': chunk.chunkSha256,
              },
            )
            .toList(growable: false),
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      });
    } catch (_) {
      // Browser storage quota can be tight. Upload resume is best-effort; the
      // active upload should continue even when caching the session fails.
    }
  }

  Future<void> _clearChunkSession(String sessionKey) async {
    if (!Hive.isBoxOpen(_resumeBoxName)) return;
    await Hive.box(_resumeBoxName).delete(sessionKey);
  }
}

class _PendingChunk {
  const _PendingChunk({
    required this.index,
    required this.bytes,
    required this.sha256Hex,
  });

  final int index;
  final Uint8List bytes;
  final String sha256Hex;
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

String _resourceType(String kind) {
  if (kind == 'document') return 'raw';
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

String _compressedImageFileName(String fileName) {
  final normalized = fileName.trim();
  if (normalized.isEmpty) return 'comms-image.jpg';
  final dot = normalized.lastIndexOf('.');
  if (dot <= 0) return '$normalized.jpg';
  return '${normalized.substring(0, dot)}.jpg';
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

String _cloudinaryErrorMessage(DioException error) {
  final data = error.response?.data;
  if (data is Map<String, dynamic>) {
    final nested = data['error'];
    if (nested is Map<String, dynamic>) {
      final message = nested['message']?.toString().trim();
      if (message != null && message.isNotEmpty) {
        return 'Upload failed: $message';
      }
    }
    final message = data['message']?.toString().trim();
    if (message != null && message.isNotEmpty) {
      return 'Upload failed: $message';
    }
  }
  final plain = error.message?.trim();
  if (plain != null && plain.isNotEmpty) {
    return 'Upload failed: $plain';
  }
  return 'Upload failed due to a network or server issue.';
}
