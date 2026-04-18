import 'package:firebase_auth/firebase_auth.dart' as firebase_auth;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../shared/models/user_profile.dart';

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
      firebase_auth.FirebaseAuth.instance, Supabase.instance.client);
});

final authStateProvider = StreamProvider<firebase_auth.User?>((ref) {
  return ref.watch(authRepositoryProvider).authStateChanges();
});

class AuthRepository {
  AuthRepository(this._firebaseAuth, this._supabase);

  final firebase_auth.FirebaseAuth _firebaseAuth;
  final SupabaseClient _supabase;

  Stream<firebase_auth.User?> authStateChanges() =>
      _firebaseAuth.authStateChanges();

  firebase_auth.User? get currentUser => _firebaseAuth.currentUser;

  Future<firebase_auth.UserCredential> signIn(
      {required String email, required String password}) {
    return _firebaseAuth.signInWithEmailAndPassword(
        email: email.trim(), password: password);
  }

  Future<firebase_auth.UserCredential> register({
    required String fullName,
    required String email,
    required String password,
  }) async {
    final credential = await _firebaseAuth.createUserWithEmailAndPassword(
        email: email.trim(), password: password);
    await credential.user?.updateDisplayName(fullName.trim());
    await syncProfile(fullName: fullName.trim(), email: email.trim());
    return credential;
  }

  Future<void> sendPasswordReset(String email) {
    return _firebaseAuth.sendPasswordResetEmail(email: email.trim());
  }

  Future<void> changeEmail(String email) async {
    final user = currentUser;
    if (user == null) throw StateError('Sign in again before updating email.');
    await user.verifyBeforeUpdateEmail(email.trim());
  }

  Future<void> changePassword(String password) async {
    final user = currentUser;
    if (user == null) {
      throw StateError('Sign in again before updating password.');
    }
    await user.updatePassword(password);
  }

  Future<void> updateAvatar(String avatarUrl) async {
    final user = currentUser;
    if (user == null) throw StateError('Sign in again before updating avatar.');
    await user.updatePhotoURL(avatarUrl);
    await syncProfile(avatarUrl: avatarUrl);
  }

  Future<void> signOut() => _firebaseAuth.signOut();

  Future<UserProfile?> loadProfile() async {
    final user = currentUser;
    if (user == null) return null;
    final data = await _supabase
        .from('user_profiles')
        .select()
        .eq('id', user.uid)
        .maybeSingle();
    if (data == null) return null;
    return UserProfile.fromJson(Map<String, dynamic>.from(data));
  }

  Future<void> syncProfile(
      {String? fullName, String? email, String? avatarUrl}) async {
    final user = currentUser;
    if (user == null) return;
    await _supabase.from('user_profiles').upsert({
      'id': user.uid,
      'email': email ?? user.email,
      'full_name': fullName ?? user.displayName ?? 'COMMS user',
      'avatar_url': avatarUrl ?? user.photoURL,
      'status': 'online',
      'last_seen': DateTime.now().toIso8601String(),
    });
  }
}
