import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/widgets/state_views.dart';
import '../data/settings_repository.dart';

class BlockedContactsScreen extends ConsumerWidget {
  const BlockedContactsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userId = FirebaseAuth.instance.currentUser?.uid;
    if (userId == null) return const LoadingState();
    final blocked = ref.watch(_blockedContactsProvider(userId));

    return Scaffold(
      appBar: AppBar(title: const Text('Blocked contacts')),
      body: blocked.when(
        data: (items) {
          if (items.isEmpty) {
            return const EmptyState(
              title: 'No blocked contacts',
              message: 'Blocked users will appear here.',
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.all(12),
            itemCount: items.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final item = items[index];
              final profile = item.profile;
              return ListTile(
                leading: CircleAvatar(
                  child: Text(
                    profile?.fullName.substring(0, 1).toUpperCase() ??
                        item.blockedId.substring(0, 1).toUpperCase(),
                  ),
                ),
                title: Text(profile?.fullName ?? item.blockedId),
                subtitle: Text(profile?.email ?? item.blockedId),
                trailing: TextButton(
                  onPressed: () async {
                    await ref.read(settingsRepositoryProvider).unblock(
                          blockerId: userId,
                          blockedId: item.blockedId,
                        );
                    ref.invalidate(_blockedContactsProvider(userId));
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Contact unblocked.')),
                      );
                    }
                  },
                  child: const Text('Unblock'),
                ),
              );
            },
          );
        },
        loading: () => const LoadingState(),
        error: (error, _) => EmptyState(
          title: 'Could not load blocked contacts',
          message: error.toString(),
        ),
      ),
    );
  }
}

final _blockedContactsProvider =
    FutureProvider.family((ref, String userId) async {
  return ref.watch(settingsRepositoryProvider).blockedContacts(userId);
});
