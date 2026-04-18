import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/config/app_config.dart';
import '../core/logging/app_logger.dart';
import '../features/notifications/data/notification_service.dart';
import '../firebase_options.dart';
import 'app.dart';

Future<void> bootstrap() async {
  WidgetsFlutterBinding.ensureInitialized();

  final config = AppConfig.fromEnvironment();
  AppLogger.instance.info('Bootstrapping COMMS Flutter client.');

  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  await Supabase.initialize(
    url: config.supabaseUrl,
    anonKey: config.supabaseAnonKey,
    accessToken: () async => FirebaseAuth.instance.currentUser?.getIdToken(),
  );

  await Hive.initFlutter('comms_cache');
  await Hive.openBox('app_settings');
  await NotificationService.instance.initialize();

  runApp(
    ProviderScope(
      overrides: [appConfigProvider.overrideWithValue(config)],
      child: const CommsApp(),
    ),
  );
}
