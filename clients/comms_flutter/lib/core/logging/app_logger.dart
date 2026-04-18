class AppLogger {
  AppLogger._();

  static final instance = AppLogger._();

  void info(String message, [Object? details]) {
    assert(() {
      // ignore: avoid_print
      print('[COMMS] $message ${details ?? ''}');
      return true;
    }());
  }

  void error(String message, Object error, [StackTrace? stackTrace]) {
    assert(() {
      // ignore: avoid_print
      print('[COMMS][error] $message $error ${stackTrace ?? ''}');
      return true;
    }());
  }
}
