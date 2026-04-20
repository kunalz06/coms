import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/app_config.dart';

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(ref.watch(appConfigProvider), FirebaseAuth.instance);
});

class ApiClient {
  ApiClient(AppConfig config, this._auth)
      : _dio = Dio(
          BaseOptions(
            baseUrl: config.apiBaseUrl,
            connectTimeout: const Duration(seconds: 15),
            receiveTimeout: const Duration(seconds: 30),
            headers: {'content-type': 'application/json'},
          ),
        );

  final FirebaseAuth _auth;
  final Dio _dio;

  Future<Response<T>> get<T>(String path,
      {Map<String, dynamic>? queryParameters}) async {
    return _dio.get<T>(path,
        queryParameters: queryParameters, options: await _authOptions());
  }

  Future<Response<T>> post<T>(String path, {Object? data}) async {
    return _dio.post<T>(path,
        data: data ?? const {}, options: await _authOptions());
  }

  Future<Options> _authOptions() async {
    final token = await _auth.currentUser?.getIdToken();
    return Options(
        headers: token == null ? null : {'authorization': 'Bearer $token'});
  }
}
