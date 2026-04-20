import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class NotificationService {
  NotificationService._();

  static final instance = NotificationService._();

  final _local = FlutterLocalNotificationsPlugin();
  NotificationSettings? _permission;

  Future<void> initialize() async {
    await _local.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      ),
    );
    _permission = await FirebaseMessaging.instance.requestPermission();
  }

  Future<NotificationSettings> requestPermission() async {
    _permission = await FirebaseMessaging.instance.requestPermission();
    return _permission!;
  }

  Future<NotificationSettings> permissionStatus() async {
    _permission ??= await FirebaseMessaging.instance.getNotificationSettings();
    return _permission!;
  }

  bool get permissionGranted =>
      _permission?.authorizationStatus == AuthorizationStatus.authorized ||
      _permission?.authorizationStatus == AuthorizationStatus.provisional;
}
