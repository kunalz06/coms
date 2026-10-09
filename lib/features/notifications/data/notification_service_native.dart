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

/// Browser Push API subscriptions are not available on iOS/Android.
/// Mobile FCM is handled by WebFcmNotificationService's native implementation.
class NotificationService {
  NotificationService._();
  static final instance = NotificationService._();

  Future<void> initialize() async {}
  Future<bool> requestBrowserPermission() async => false;
  Future<String> permissionStatus() async => 'unsupported';
  bool get permissionGranted => false;
  WebPushSubscriptionDraft? get lastSubscription => null;
  Future<WebPushSubscriptionDraft> subscribeWebPush({
    required String vapidPublicKey,
  }) async {
    throw const FormatException('Browser push is available only on the web.');
  }
  Future<String?> unsubscribeWebPush() async => null;
}
