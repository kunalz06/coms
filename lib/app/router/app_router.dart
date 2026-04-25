import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/data/auth_repository.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/register_screen.dart';
import '../../features/auth/presentation/reset_password_screen.dart';
import '../../features/backup/presentation/backup_screen.dart';
import '../../features/calls/presentation/calls_screen.dart';
import '../../features/chats/presentation/chats_screen.dart';
import '../../features/chats/presentation/conversation_screen.dart';
import '../../features/groups/presentation/group_info_screen.dart';
import '../../features/privacy/presentation/hidden_chats_screen.dart';
import '../../features/privacy/presentation/privacy_screen.dart';
import '../../features/settings/presentation/settings_screen.dart';
import '../../features/settings/presentation/account_settings_screen.dart';
import '../../features/settings/presentation/blocked_contacts_screen.dart';
import '../shell/app_shell.dart';
import 'app_routes.dart';

final _rootNavigatorKey = GlobalKey<NavigatorState>();
final _shellNavigatorKey = GlobalKey<NavigatorState>();

final appRouterProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authStateProvider);
  return GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: AppRoutes.chats,
    refreshListenable: _AuthRefreshListenable(FirebaseAuth.instance),
    redirect: (context, state) {
      final user = authState.valueOrNull ?? FirebaseAuth.instance.currentUser;
      final authPath = state.matchedLocation == AppRoutes.login ||
          state.matchedLocation == AppRoutes.register ||
          state.matchedLocation == AppRoutes.resetPassword;

      if (authState.isLoading) return null;
      if (user == null && !authPath) return AppRoutes.login;
      if (user != null && authPath) {
        return AppRoutes.chats;
      }
      return null;
    },
    routes: [
      GoRoute(
          path: AppRoutes.login,
          builder: (context, state) => const LoginScreen()),
      GoRoute(
          path: AppRoutes.register,
          builder: (context, state) => const RegisterScreen()),
      GoRoute(
          path: AppRoutes.resetPassword,
          builder: (context, state) => const ResetPasswordScreen()),
      GoRoute(
        path: AppRoutes.legacyApp,
        redirect: (context, state) {
          final backup = state.uri.queryParameters['backup'];
          final message = state.uri.queryParameters['message'];
          if (backup != null && backup.isNotEmpty) {
            final next = Uri(
              path: AppRoutes.backup,
              queryParameters: {
                'backup': backup,
                if (message != null && message.isNotEmpty) 'message': message,
              },
            );
            return next.toString();
          }
          return AppRoutes.chats;
        },
      ),
      ShellRoute(
        navigatorKey: _shellNavigatorKey,
        builder: (context, state, child) =>
            AppShell(location: state.uri.path, child: child),
        routes: [
          GoRoute(
              path: AppRoutes.chats,
              builder: (context, state) => const ChatsScreen()),
          GoRoute(
            path: AppRoutes.conversation,
            builder: (context, state) => ConversationScreen(
                conversationId: state.pathParameters['conversationId']!),
          ),
          GoRoute(
            path: AppRoutes.conversationInfo,
            builder: (context, state) => GroupInfoScreen(
                conversationId: state.pathParameters['conversationId']!),
          ),
          GoRoute(
              path: AppRoutes.calls,
              builder: (context, state) => const CallsScreen()),
          GoRoute(
              path: AppRoutes.settings,
              builder: (context, state) => const SettingsScreen()),
          GoRoute(
              path: AppRoutes.accountSettings,
              builder: (context, state) => const AccountSettingsScreen()),
          GoRoute(
              path: AppRoutes.blockedContacts,
              builder: (context, state) => const BlockedContactsScreen()),
          GoRoute(
              path: AppRoutes.backup,
              builder: (context, state) => const BackupScreen()),
          GoRoute(
              path: AppRoutes.privacy,
              builder: (context, state) => const PrivacyScreen()),
          GoRoute(
              path: AppRoutes.hiddenChats,
              builder: (context, state) => const HiddenChatsScreen()),
        ],
      ),
    ],
  );
});

class _AuthRefreshListenable extends ChangeNotifier {
  _AuthRefreshListenable(FirebaseAuth auth) {
    _subscription = auth.authStateChanges().listen((_) => notifyListeners());
  }

  late final StreamSubscription<User?> _subscription;

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }
}
