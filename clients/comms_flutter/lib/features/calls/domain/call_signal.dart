import 'call_models.dart';

class CallSignal {
  const CallSignal({
    required this.type,
    this.callId,
    this.from,
    this.to,
    this.mode,
    this.conversationId,
    this.reason,
    this.offer,
    this.answer,
    this.candidate,
    this.raw = const {},
  });

  final String type;
  final String? callId;
  final String? from;
  final String? to;
  final CallMode? mode;
  final String? conversationId;
  final String? reason;
  final Object? offer;
  final Object? answer;
  final Object? candidate;
  final Map<String, dynamic> raw;

  bool get isIncomingDirectCall => type == 'call-initiate';
  bool get isAvailableDirectCall => type == 'call-available';
  bool get isDirectCallTerminal =>
      type == 'call-end' ||
      type == 'call-reject' ||
      type == 'call-busy' ||
      type == 'call-unavailable';

  factory CallSignal.fromJson(Map<String, dynamic> json) {
    return CallSignal(
      type: json['type'] as String? ?? 'unknown',
      callId: json['callId'] as String?,
      from: json['from'] as String?,
      to: json['to'] as String?,
      mode: json['mode'] == null
          ? null
          : CallMode.fromWire(json['mode'] as String),
      conversationId: json['conversationId'] as String?,
      reason: json['reason'] as String?,
      offer: json['offer'],
      answer: json['answer'],
      candidate: json['candidate'],
      raw: json,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      ...raw,
      'type': type,
      if (callId != null) 'callId': callId,
      if (from != null) 'from': from,
      if (to != null) 'to': to,
      if (mode != null) 'mode': mode!.wireName,
      if (conversationId != null) 'conversationId': conversationId,
      if (reason != null) 'reason': reason,
      if (offer != null) 'offer': offer,
      if (answer != null) 'answer': answer,
      if (candidate != null) 'candidate': candidate,
    };
  }
}
