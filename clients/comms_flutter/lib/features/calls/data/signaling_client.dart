import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../../../core/config/app_config.dart';
import '../domain/call_signal.dart';

final signalingClientProvider = Provider<SignalingClient>((ref) {
  return SignalingClient(ref.watch(appConfigProvider));
});

class SignalingClient {
  SignalingClient(this._config);

  final AppConfig _config;
  WebSocketChannel? _channel;
  Future<void>? _connecting;
  DateTime? _retryAfter;
  String? _registeredUserId;
  final _messages = StreamController<CallSignal>.broadcast();

  Stream<CallSignal> get messages => _messages.stream;

  Future<void> connect(String userId) async {
    if (_channel != null && _registeredUserId == userId) return;

    final retryAfter = _retryAfter;
    if (retryAfter != null && DateTime.now().isBefore(retryAfter)) return;

    final activeConnect = _connecting;
    if (activeConnect != null) return activeConnect;

    final task = _connect(userId);
    _connecting = task;
    await task.whenComplete(() => _connecting = null);
  }

  bool send(CallSignal payload) {
    try {
      final channel = _channel;
      if (channel == null) return false;
      channel.sink.add(jsonEncode(payload.toJson()));
      return true;
    } catch (_) {
      _channel = null;
      _registeredUserId = null;
      return false;
    }
  }

  Future<void> close() async {
    await _channel?.sink.close();
    _channel = null;
    _registeredUserId = null;
  }

  Future<void> _connect(String userId) async {
    WebSocketChannel? channel;
    try {
      channel = WebSocketChannel.connect(Uri.parse(_config.signalingUrl));
      _channel = channel;

      channel.stream.listen(
        (event) {
          final decoded = jsonDecode(event as String);
          if (decoded is Map) {
            _messages
                .add(CallSignal.fromJson(Map<String, dynamic>.from(decoded)));
          }
        },
        onDone: () {
          if (_channel == channel) {
            _channel = null;
            _registeredUserId = null;
            _retryAfter = DateTime.now().add(const Duration(seconds: 5));
          }
        },
        onError: (_) {
          if (_channel == channel) {
            _channel = null;
            _registeredUserId = null;
            _retryAfter = DateTime.now().add(const Duration(seconds: 5));
          }
        },
      );

      await channel.ready.timeout(const Duration(seconds: 6));
      if (_channel != channel) return;
      channel.sink.add(jsonEncode({'type': 'register', 'userId': userId}));
      _registeredUserId = userId;
      _retryAfter = null;
    } catch (_) {
      if (_channel == channel) {
        _channel = null;
        _registeredUserId = null;
      }
      _retryAfter = DateTime.now().add(const Duration(seconds: 5));
      await channel?.sink.close().catchError((_) {});
    }
  }
}
