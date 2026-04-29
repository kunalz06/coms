import 'dart:async';
import 'dart:convert';
// ignore: avoid_web_libraries_in_flutter
import 'dart:html' as html;
import 'dart:typed_data';

import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class WebPushSubscriptionDraft {
  const WebPushSubscriptionDraft({
    required this.endpoint,
    required this.p256dh,
    required this.auth,
    this.userAgent,
  });

  final String endpoint;
  final String p256dh;
  final String auth;
  final String? userAgent;
}

class NotificationService {
  NotificationService._();

  static final instance = NotificationService._();

  final _local = FlutterLocalNotificationsPlugin();
  String? _permission;
  html.ServiceWorkerRegistration? _pushWorker;
  WebPushSubscriptionDraft? _lastSubscription;

  Future<void> initialize() async {
    await _local.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      ),
    );
    _permission = html.Notification.permission;
    unawaited(() async {
      try {
        await _registerPushWorker();
      } catch (_) {}
    }());
  }

  Future<bool> requestBrowserPermission() async {
    if (!_notificationsSupported) return false;
    _permission = await html.Notification.requestPermission();
    return permissionGranted;
  }

  Future<String> permissionStatus() async {
    _permission ??= html.Notification.permission;
    return _permission!;
  }

  bool get permissionGranted => _permission == 'granted';

  WebPushSubscriptionDraft? get lastSubscription => _lastSubscription;

  bool get _notificationsSupported =>
      html.Notification.supported &&
      html.window.navigator.serviceWorker != null;

  Future<WebPushSubscriptionDraft> subscribeWebPush({
    required String vapidPublicKey,
  }) async {
    final publicKey = vapidPublicKey.trim();
    if (publicKey.isEmpty) {
      throw const FormatException('VAPID public key is not configured.');
    }
    _validateVapidPublicKey(publicKey);

    final registration = await _registerPushWorker();
    final pushManager = registration.pushManager;
    if (pushManager == null) {
      throw const FormatException('Browser push notifications are not supported.');
    }
    final existing = await pushManager.getSubscription();
    final subscription = existing ??
        await pushManager.subscribe({
          'userVisibleOnly': true,
          'applicationServerKey': publicKey,
        });

    final p256dh = subscription.getKey('p256dh');
    final auth = subscription.getKey('auth');
    final endpoint = subscription.endpoint;
    if (endpoint == null || p256dh == null || auth == null) {
      throw const FormatException('Browser did not provide push keys.');
    }

    _lastSubscription = WebPushSubscriptionDraft(
      endpoint: endpoint,
      p256dh: _base64UrlEncodeBuffer(p256dh),
      auth: _base64UrlEncodeBuffer(auth),
      userAgent: html.window.navigator.userAgent,
    );
    return _lastSubscription!;
  }

  Future<String?> unsubscribeWebPush() async {
    final registration = _pushWorker ?? await _registerPushWorker();
    final subscription = await registration.pushManager?.getSubscription();
    final endpoint = subscription?.endpoint;
    await subscription?.unsubscribe();
    _lastSubscription = null;
    return endpoint;
  }

  Future<html.ServiceWorkerRegistration> _registerPushWorker() async {
    final container = html.window.navigator.serviceWorker;
    if (!html.Notification.supported || container == null) {
      throw const FormatException(
          'Browser push notifications are not supported.');
    }
    _pushWorker ??= await container.register('/comms-push-sw.js');
    return _pushWorker!;
  }

  void _validateVapidPublicKey(String value) {
    final isBase64Url = RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(value);
    if (!isBase64Url || value.contains('=')) {
      throw const FormatException(
        'VAPID public key must be base64url without padding.',
      );
    }
    final normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    final padded = normalized.padRight(
      normalized.length + ((4 - normalized.length % 4) % 4),
      '=',
    );
    final decoded = base64Decode(padded);
    if (decoded.length != 65 || decoded.first != 4) {
      throw const FormatException(
        'VAPID public key is not a valid uncompressed P-256 public key.',
      );
    }
  }

  String _base64UrlEncodeBuffer(ByteBuffer buffer) {
    return base64UrlEncode(Uint8List.view(buffer)).replaceAll('=', '');
  }
}
