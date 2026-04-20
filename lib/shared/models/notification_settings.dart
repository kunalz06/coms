class NotificationSettingsModel {
  const NotificationSettingsModel({
    required this.userId,
    required this.browserNotificationsEnabled,
    required this.ringtoneEnabled,
    this.notificationsPromptedAt,
  });

  final String userId;
  final bool browserNotificationsEnabled;
  final bool ringtoneEnabled;
  final DateTime? notificationsPromptedAt;

  NotificationSettingsModel copyWith({
    bool? browserNotificationsEnabled,
    bool? ringtoneEnabled,
    DateTime? notificationsPromptedAt,
  }) {
    return NotificationSettingsModel(
      userId: userId,
      browserNotificationsEnabled:
          browserNotificationsEnabled ?? this.browserNotificationsEnabled,
      ringtoneEnabled: ringtoneEnabled ?? this.ringtoneEnabled,
      notificationsPromptedAt:
          notificationsPromptedAt ?? this.notificationsPromptedAt,
    );
  }

  factory NotificationSettingsModel.fromJson(Map<String, dynamic> json) {
    return NotificationSettingsModel(
      userId: json['user_id'] as String,
      browserNotificationsEnabled:
          json['browser_notifications_enabled'] as bool? ?? false,
      ringtoneEnabled: json['ringtone_enabled'] as bool? ?? true,
      notificationsPromptedAt: DateTime.tryParse(
        json['notifications_prompted_at']?.toString() ?? '',
      ),
    );
  }

  Map<String, dynamic> toJson() => {
        'user_id': userId,
        'browser_notifications_enabled': browserNotificationsEnabled,
        'ringtone_enabled': ringtoneEnabled,
        'notifications_prompted_at':
            notificationsPromptedAt?.toUtc().toIso8601String(),
      };
}
