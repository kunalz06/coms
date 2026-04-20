class BackupPreference {
  const BackupPreference({
    required this.userId,
    required this.enabled,
    required this.status,
    required this.reconnectRequired,
    this.provider,
    this.googleDriveEmail,
    this.driveScope,
    this.lastSuccessfulBackupAt,
    this.lastBackupError,
  });

  final String userId;
  final String? provider;
  final bool enabled;
  final String status;
  final String? googleDriveEmail;
  final String? driveScope;
  final DateTime? lastSuccessfulBackupAt;
  final String? lastBackupError;
  final bool reconnectRequired;

  BackupPreference copyWith({
    String? provider,
    bool? enabled,
    String? status,
    String? googleDriveEmail,
    String? driveScope,
    DateTime? lastSuccessfulBackupAt,
    String? lastBackupError,
    bool? reconnectRequired,
  }) {
    return BackupPreference(
      userId: userId,
      provider: provider ?? this.provider,
      enabled: enabled ?? this.enabled,
      status: status ?? this.status,
      googleDriveEmail: googleDriveEmail ?? this.googleDriveEmail,
      driveScope: driveScope ?? this.driveScope,
      lastSuccessfulBackupAt:
          lastSuccessfulBackupAt ?? this.lastSuccessfulBackupAt,
      lastBackupError: lastBackupError ?? this.lastBackupError,
      reconnectRequired: reconnectRequired ?? this.reconnectRequired,
    );
  }

  factory BackupPreference.fromJson(Map<String, dynamic> json) {
    return BackupPreference(
      userId: json['user_id'] as String,
      provider: json['provider'] as String?,
      enabled: json['enabled'] as bool? ?? false,
      status: json['status'] as String? ?? 'disabled',
      googleDriveEmail: json['google_drive_email'] as String?,
      driveScope: json['drive_scope'] as String?,
      lastSuccessfulBackupAt: DateTime.tryParse(
          json['last_successful_backup_at']?.toString() ?? ''),
      lastBackupError: json['last_backup_error'] as String?,
      reconnectRequired: json['reconnect_required'] as bool? ?? false,
    );
  }
}
