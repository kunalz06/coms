import 'dart:async';
import 'dart:convert';
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
    unawaited(_registerPushWorker());
  }

  Future<bool> requestBrowserPermission() async {
    _permission = await html.Notification.requestPermission();
    return permissionGranted;
  }

  Future<String> permissionStatus() async {
    _permission ??= html.Notification.permission;
    return _permission!;
  }

  bool get permissionGranted => _permission == 'granted';

  WebPushSubscriptionDraft? get lastSubscription => _lastSubscription;

  Future<WebPushSubscriptionDraft> subscribeWebPush({
    required String vapidPublicKey,
  }) async {
    final publicKey = vapidPublicKey.trim();
    if (publicKey.isEmpty) {
      throw const FormatException('VAPID public key is not configured.');
    }

    final registration = await _registerPushWorker();
    final pushManager = registration.pushManager;
    if (pushManager == null) {
      throw const FormatException('Browser push notifications are not supported.');
    }
    final html.PushSubscription? existing = await pushManager.getSubscription();
    final subscription = existing ??
        await pushManager.subscribe({
          'userVisibleOnly': true,
          'applicationServerKey': _urlBase64ToUint8List(publicKey),
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

  Future<void> unsubscribeWebPush() async {
    final registration = _pushWorker ?? await _registerPushWorker();
    final subscription = await registration.pushManager?.getSubscription();
    await subscription?.unsubscribe();
    _lastSubscription = null;
  }

  Future<html.ServiceWorkerRegistration> _registerPushWorker() async {
    final container = html.window.navigator.serviceWorker;
    if (container == null) {
      throw const FormatException('Browser push notifications are not supported.');
    }
    _pushWorker ??= await container.register('/comms-push-sw.js');
    return _pushWorker!;
  }

  Uint8List _urlBase64ToUint8List(String value) {
    final normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    final padded = normalized.padRight(
      normalized.length + ((4 - normalized.length % 4) % 4),
      '=',
    );
    return base64Decode(padded);
  }

  String _base64UrlEncodeBuffer(ByteBuffer buffer) {
    return base64UrlEncode(Uint8List.view(buffer)).replaceAll('=', '');
  }
}
