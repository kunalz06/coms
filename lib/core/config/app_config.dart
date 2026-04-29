import 'package:flutter_riverpod/flutter_riverpod.dart';

final appConfigProvider = Provider<AppConfig>((ref) {
  throw StateError('AppConfig has not been initialized.');
});

class AppConfig {
  const AppConfig({
    required this.apiBaseUrl,
    required this.signalingUrl,
    required this.supabaseUrl,
    required this.supabaseAnonKey,
    required this.firebaseApiKey,
    required this.firebaseAuthDomain,
    required this.firebaseProjectId,
    required this.firebaseStorageBucket,
    required this.firebaseMessagingSenderId,
    required this.firebaseAppId,
    required this.vapidPublicKey,
    required this.cloudinaryCloudName,
    required this.stunUrls,
    required this.turnUrls,
    this.turnUsername,
    this.turnCredential,
  });

  final String apiBaseUrl;
  final String signalingUrl;
  final String supabaseUrl;
  final String supabaseAnonKey;
  final String firebaseApiKey;
  final String firebaseAuthDomain;
  final String firebaseProjectId;
  final String firebaseStorageBucket;
  final String firebaseMessagingSenderId;
  final String firebaseAppId;
  final String vapidPublicKey;
  final String cloudinaryCloudName;
  final List<String> stunUrls;
  final List<String> turnUrls;
  final String? turnUsername;
  final String? turnCredential;

  factory AppConfig.fromEnvironment() {
    return AppConfig(
      apiBaseUrl: const String.fromEnvironment('COMMS_API_BASE_URL',
          defaultValue: 'http://localhost:3000'),
      signalingUrl: const String.fromEnvironment('COMMS_SIGNALING_URL',
          defaultValue: 'ws://localhost:3000/ws'),
      supabaseUrl: const String.fromEnvironment('SUPABASE_URL'),
      supabaseAnonKey: const String.fromEnvironment('SUPABASE_ANON_KEY'),
      firebaseApiKey: const String.fromEnvironment('FIREBASE_API_KEY'),
      firebaseAuthDomain: const String.fromEnvironment('FIREBASE_AUTH_DOMAIN'),
      firebaseProjectId: const String.fromEnvironment('FIREBASE_PROJECT_ID'),
      firebaseStorageBucket:
          const String.fromEnvironment('FIREBASE_STORAGE_BUCKET'),
      firebaseMessagingSenderId:
          const String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID'),
      firebaseAppId: const String.fromEnvironment('FIREBASE_APP_ID'),
      vapidPublicKey: const String.fromEnvironment('VAPID_PUBLIC_KEY'),
      cloudinaryCloudName:
          const String.fromEnvironment('CLOUDINARY_CLOUD_NAME'),
      stunUrls: _split(const String.fromEnvironment('STUN_URLS')),
      turnUrls: _split(const String.fromEnvironment('TURN_URLS')),
      turnUsername: _nullable(const String.fromEnvironment('TURN_USERNAME')),
      turnCredential:
          _nullable(const String.fromEnvironment('TURN_CREDENTIAL')),
    );
  }

  static List<String> _split(String value) {
    return value
        .split(',')
        .map((item) => item.trim())
        .where((item) => item.isNotEmpty)
        .toList(growable: false);
  }

  static String? _nullable(String value) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }
}
