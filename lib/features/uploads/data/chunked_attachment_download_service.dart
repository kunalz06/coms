// Select native code on Android/iOS and browser code on Flutter web.
export 'chunked_attachment_download_service_native.dart'
    if (dart.library.html) 'chunked_attachment_download_service_web.dart';
