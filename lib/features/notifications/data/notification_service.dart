// Select native code on Android/iOS and browser code on Flutter web.
export 'notification_service_native.dart'
    if (dart.library.html) 'notification_service_web.dart';
