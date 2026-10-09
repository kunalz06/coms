// Select native code on Android/iOS and browser code on Flutter web.
export 'ringtone_service_native.dart'
    if (dart.library.html) 'ringtone_service_web.dart';
