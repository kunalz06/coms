import 'dart:async';
// ignore: avoid_web_libraries_in_flutter
import 'dart:html' as html;
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/models/attachment.dart';

final chunkedAttachmentDownloadServiceProvider =
    Provider<ChunkedAttachmentDownloadService>((ref) {
  return ChunkedAttachmentDownloadService(dio: Dio());
});

class ChunkedAttachmentDownloadService {
  const ChunkedAttachmentDownloadService({required Dio dio}) : _dio = dio;

  final Dio _dio;

  Future<void> open(Attachment attachment) async {
    if (!attachment.isChunked) {
      throw const FormatException('This attachment is not chunked.');
    }
    final expectedCount = attachment.chunkCount;
    final expectedFileSha = attachment.fileSha256;
    if (expectedCount == null ||
        expectedCount <= 1 ||
        expectedFileSha == null ||
        expectedFileSha.isEmpty) {
      throw const FormatException('Large file metadata is incomplete.');
    }
    if (attachment.chunks.length != expectedCount) {
      throw FormatException(
        'Large file is missing chunks (${attachment.chunks.length}/$expectedCount).',
      );
    }

    final ordered = attachment.chunks.toList(growable: false)
      ..sort((a, b) => a.chunkIndex.compareTo(b.chunkIndex));
    for (var i = 0; i < ordered.length; i++) {
      if (ordered[i].chunkIndex != i) {
        throw const FormatException('Large file chunks are out of order.');
      }
    }

    final builder = BytesBuilder(copy: false);
    for (final chunk in ordered) {
      final response = await _dio.get<List<int>>(
        chunk.chunkUrl,
        options: Options(responseType: ResponseType.bytes),
      );
      final data = response.data;
      if (data == null || data.isEmpty) {
        throw FormatException('Chunk ${chunk.chunkIndex + 1} could not be downloaded.');
      }
      final bytes = Uint8List.fromList(data);
      final chunkSha = sha256.convert(bytes).toString();
      if (chunkSha != chunk.chunkSha256) {
        throw FormatException('Chunk ${chunk.chunkIndex + 1} failed integrity check.');
      }
      builder.add(bytes);
    }

    final merged = builder.takeBytes();
    final mergedSha = sha256.convert(merged).toString();
    if (mergedSha != expectedFileSha) {
      throw const FormatException('Large file failed final integrity check.');
    }

    final blob = html.Blob([merged], attachment.mimeType);
    final url = html.Url.createObjectUrlFromBlob(blob);
    final anchor = html.AnchorElement(href: url)
      ..download = attachment.fileName
      ..target = '_blank';
    html.document.body?.append(anchor);
    anchor.click();
    anchor.remove();
    Timer(const Duration(seconds: 30), () => html.Url.revokeObjectUrl(url));
  }
}
