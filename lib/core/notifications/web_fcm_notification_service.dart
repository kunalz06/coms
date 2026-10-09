// Select native code on Android/iOS and browser code on Flutter web.
export 'web_fcm_notification_service_native.dart'
    if (dart.library.html) 'web_fcm_notification_service_web.dart';
