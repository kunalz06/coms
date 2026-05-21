import 'dart:async';
// ignore: avoid_web_libraries_in_flutter
import 'dart:html' as html;

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/app_config.dart';
import '../network/api_client.dart';
import 'ringtone_service.dart';

final webFcmNotificationServiceProvider =
    Provider<WebFcmNotificationService>((ref) {
  return WebFcmNotificationService(
    config: ref.watch(appConfigProvider),
    api: ref.watch(apiClientProvider),
    auth: FirebaseAuth.instance,
    messaging: FirebaseMessaging.instance,
    ringtone: ref.watch(ringtoneServiceProvider),
  );
});

class NotificationPreferences {
  const NotificationPreferences({
    required this.messagesEnabled,
    required this.callsEnabled,
    required this.missedCallsEnabled,
    required this.showMessagePreview,
    required this.soundEnabled,
  });

  final bool messagesEnabled;
  final bool callsEnabled;
  final bool missedCallsEnabled;
  final bool showMessagePreview;
  final bool soundEnabled;

  factory NotificationPreferences.fromJson(Map<String, dynamic> json) {
    return NotificationPreferences(
      messagesEnabled: json['messagesEnabled'] as bool? ?? true,
      callsEnabled: json['callsEnabled'] as bool? ?? true,
      missedCallsEnabled: json['missedCallsEnabled'] as bool? ?? true,
      showMessagePreview: json['showMessagePreview'] as bool? ?? true,
      soundEnabled: json['soundEnabled'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() => {
        'messagesEnabled': messagesEnabled,
        'callsEnabled': callsEnabled,
        'missedCallsEnabled': missedCallsEnabled,
        'showMessagePreview': showMessagePreview,
        'soundEnabled': soundEnabled,
      };
}

class WebFcmNotificationService {
  WebFcmNotificationService({
    required AppConfig config,
    required ApiClient api,
    required FirebaseAuth auth,
    required FirebaseMessaging messaging,
    required RingtoneService ringtone,
  })  : _config = config,
        _api = api,
        _auth = auth,
        _messaging = messaging,
        _ringtone = ringtone;

  final AppConfig _config;
  final ApiClient _api;
  final FirebaseAuth _auth;
  final FirebaseMessaging _messaging;
  final RingtoneService _ringtone;
  StreamSubscription<String>? _tokenRefreshSub;
  StreamSubscription<RemoteMessage>? _foregroundSub;
  final _foregroundMessages = StreamController<RemoteMessage>.broadcast();

  Stream<RemoteMessage> get foregroundMessages => _foregroundMessages.stream;

  static const _defaultPreferences = NotificationPreferences(
    messagesEnabled: false,
    callsEnabled: false,
    missedCallsEnabled: false,
    showMessagePreview: true,
    soundEnabled: true,
  );

  Future<NotificationSettings> permissionStatus() {
    return _messaging.getNotificationSettings();
  }

  Future<bool> requestPermissionAndRegister() async {
    final settings = await _messaging.requestPermission();
    final allowed = settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
    if (!allowed) return false;
    await registerCurrentToken();
    _tokenRefreshSub ??= _messaging.onTokenRefresh.listen(_registerToken);
    _foregroundSub ??= FirebaseMessaging.onMessage.listen(_handleForeground);
    return true;
  }

  Future<void> registerCurrentToken() async {
    final token = await _messaging.getToken(vapidKey: _config.fcmWebVapidKey);
    if (token == null || token.isEmpty) {
      throw const FormatException('Could not create this browser notification token.');
    }
    await _registerToken(token);
  }

  Future<void> unregisterCurrentToken() async {
    final token = await _messaging.getToken(vapidKey: _config.fcmWebVapidKey);
    if (token == null || token.isEmpty) return;
    try {
      await _api.post('/api/notifications/unregister', data: {'token': token});
    } on FormatException {
      // Older backend deployments may not have the notification endpoint yet.
    }
  }

  Future<NotificationPreferences> loadPreferences() async {
    try {
      final response = await _api.get<Map<String, dynamic>>(
        '/api/notifications/preferences',
      );
      return NotificationPreferences.fromJson(response.data ?? const {});
    } on FormatException {
      return _defaultPreferences;
    }
  }

  Future<NotificationPreferences> savePreferences(
    NotificationPreferences preferences,
  ) async {
    try {
      final response = await _api.patch<Map<String, dynamic>>(
        '/api/notifications/preferences',
        data: preferences.toJson(),
      );
      return NotificationPreferences.fromJson(response.data ?? const {});
    } on FormatException {
      return preferences;
    }
  }

  Future<void> sendTestNotification() async {
    try {
      await _api.post('/api/notifications/test');
    } on FormatException {
      // Keep the settings screen usable even before the backend is redeployed.
    }
  }

  Future<void> dispose() async {
    await _tokenRefreshSub?.cancel();
    await _foregroundSub?.cancel();
    await _foregroundMessages.close();
  }

  Future<void> _registerToken(String token) async {
    if (_auth.currentUser == null) return;
    try {
      await _api.post('/api/notifications/register', data: {
        'platform': 'web_pwa',
        'provider': 'fcm',
        'token': token,
        'userAgent': html.window.navigator.userAgent,
      });
    } on FormatException {
      // Token generation succeeded; server registration can retry after deploy.
    }
  }

  void _handleForeground(RemoteMessage message) {
    unawaited(_handleForegroundAsync(message));
  }

  Future<void> _handleForegroundAsync(RemoteMessage message) async {
    final data = message.data;
    final preferences = await loadPreferences();
    final type = data['type'];
    if (preferences.soundEnabled) {
      if (type == 'call') {
        _ringtone.startRingtone();
      } else if (type == 'message' || type == 'missed_call') {
        _ringtone.playMessageSound();
      }
    }
    if (type == 'call_missed' || type == 'call_ended') {
      _ringtone.stopRingtone();
    }
    if (!_foregroundMessages.isClosed) {
      _foregroundMessages.add(message);
    }
  }
}
