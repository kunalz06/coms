import 'package:firebase_auth/firebase_auth.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/app_routes.dart';
import '../../../features/chats/data/chat_repository.dart';
import '../../../features/uploads/data/cloudinary_upload_service.dart';
import '../../../shared/models/conversation_member.dart';
import '../../../shared/widgets/comms_avatar.dart';
import '../../../shared/widgets/state_views.dart';
import '../data/group_repository.dart';

class GroupInfoScreen extends ConsumerStatefulWidget {
  const GroupInfoScreen({required this.conversationId, super.key});

  final String conversationId;

  @override
  ConsumerState<GroupInfoScreen> createState() => _GroupInfoScreenState();
}

class _GroupInfoScreenState extends ConsumerState<GroupInfoScreen> {
  var _busy = false;

  Future<void> _run(Future<void> Function() fn, {String? message}) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await fn();
      if (!mounted) return;
      if (message != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(message)),
        );
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _clearMessagesByRange() async {
    final now = DateTime.now();
    final startDate = await showDatePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: now,
      initialDate: now.subtract(const Duration(days: 7)),
      helpText: 'Select start date',
    );
    if (!mounted || startDate == null) return;

    final endDate = await showDatePicker(
      context: context,
      firstDate: startDate,
      lastDate: now,
      initialDate: now,
      helpText: 'Select end date',
    );
    if (!mounted || endDate == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Clear messages in date range?'),
        content: Text(
          'All group messages from ${startDate.toLocal().toString().split(' ').first} to ${endDate.toLocal().toString().split(' ').first} will be cleared for everyone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Clear'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    await _run(() async {
      final deleted =
          await ref.read(groupRepositoryProvider).clearGroupMessagesInRange(
                conversationId: widget.conversationId,
                startInclusive: startDate,
                endInclusive: endDate,
              );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$deleted messages deleted.')),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final me = FirebaseAuth.instance.currentUser?.uid;
    if (me == null) return const LoadingState();
    final conversation =
        ref.watch(_conversationProvider(widget.conversationId));
    final members = ref.watch(_membersProvider(widget.conversationId));

    return Scaffold(
      appBar: AppBar(title: const Text('Group info')),
      body: conversation.when(
        data: (conversation) {
          if (conversation == null || !conversation.isGroup) {
            return const EmptyState(
              title: 'Group unavailable',
              message: 'This conversation is not a group or is no longer open.',
            );
          }

          final List<ConversationMember> memberItems =
              members.valueOrNull ?? const <ConversationMember>[];
          String myRole = 'member';
          for (final member in memberItems) {
            if (member.userId == me) {
              myRole = member.role;
              break;
            }
          }
          final canManage = myRole == 'owner' || myRole == 'admin';
          final isOwner = myRole == 'owner';

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Center(
                child: Column(
                  children: [
                    CommsAvatar(
                      name: conversation.title ?? 'Group',
                      imageUrl: conversation.avatarUrl,
                      radius: 42,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      conversation.title ?? 'Group',
                      style: Theme.of(context).textTheme.headlineSmall,
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (canManage)
                    OutlinedButton.icon(
                      onPressed: _busy
                          ? null
                          : () async {
                              final titleController = TextEditingController(
                                text: conversation.title ?? '',
                              );
                              final ok = await showDialog<bool>(
                                context: context,
                                builder: (context) => AlertDialog(
                                  title: const Text('Edit group'),
                                  content: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      TextField(
                                        controller: titleController,
                                        decoration: const InputDecoration(
                                          labelText: 'Group name',
                                        ),
                                      ),
                                    ],
                                  ),
                                  actions: [
                                    TextButton(
                                      onPressed: () =>
                                          Navigator.of(context).pop(false),
                                      child: const Text('Cancel'),
                                    ),
                                    FilledButton(
                                      onPressed: () =>
                                          Navigator.of(context).pop(true),
                                      child: const Text('Save'),
                                    ),
                                  ],
                                ),
                              );
                              if (ok != true) return;
                              await _run(
                                () => ref
                                    .read(groupRepositoryProvider)
                                    .updateGroupProfile(
                                      conversationId: widget.conversationId,
                                      title: titleController.text,
                                    ),
                                message: 'Group updated.',
                              );
                              titleController.dispose();
                            },
                      icon: const Icon(Icons.edit_outlined),
                      label: const Text('Edit group'),
                    ),
                  if (canManage)
                    OutlinedButton.icon(
                      onPressed: _busy
                          ? null
                          : () async {
                              final fileResult =
                                  await FilePicker.platform.pickFiles(
                                type: FileType.image,
                                allowMultiple: false,
                                withData: true,
                              );
                              final file = fileResult?.files.single;
                              if (file == null) return;

                              await _run(() async {
                                final uploaded = await ref
                                    .read(cloudinaryUploadServiceProvider)
                                    .upload(
                                      file: file,
                                      kind: 'image',
                                      onProgress: (_) {},
                                    );
                                await ref
                                    .read(groupRepositoryProvider)
                                    .updateGroupProfile(
                                      conversationId: widget.conversationId,
                                      avatarUrl: uploaded.url,
                                    );
                              }, message: 'Group image updated.');
                            },
                      icon: const Icon(Icons.photo_camera_outlined),
                      label: const Text('Update group image'),
                    ),
                  if (canManage)
                    OutlinedButton.icon(
                      onPressed: _busy
                          ? null
                          : () async {
                              final emailsController = TextEditingController();
                              final ok = await showDialog<bool>(
                                context: context,
                                builder: (context) => AlertDialog(
                                  title: const Text('Add members'),
                                  content: TextField(
                                    controller: emailsController,
                                    maxLines: 3,
                                    decoration: const InputDecoration(
                                      hintText:
                                          'Enter emails separated by commas',
                                    ),
                                  ),
                                  actions: [
                                    TextButton(
                                      onPressed: () =>
                                          Navigator.of(context).pop(false),
                                      child: const Text('Cancel'),
                                    ),
                                    FilledButton(
                                      onPressed: () =>
                                          Navigator.of(context).pop(true),
                                      child: const Text('Add'),
                                    ),
                                  ],
                                ),
                              );
                              if (ok != true) return;
                              final emails = emailsController.text
                                  .split(',')
                                  .map((email) => email.trim())
                                  .where((email) => email.isNotEmpty)
                                  .toList(growable: false);
                              if (emails.isEmpty) return;
                              final profiles = await ref
                                  .read(groupRepositoryProvider)
                                  .findProfilesByEmails(emails);
                              await _run(
                                () => ref
                                    .read(groupRepositoryProvider)
                                    .addMembers(
                                      conversationId: widget.conversationId,
                                      userIds: profiles
                                          .map((profile) => profile.id)
                                          .toList(),
                                    ),
                                message: 'Members added.',
                              );
                              emailsController.dispose();
                            },
                      icon: const Icon(Icons.person_add_alt_outlined),
                      label: const Text('Add members'),
                    ),
                  if (canManage)
                    OutlinedButton.icon(
                      onPressed: _busy
                          ? null
                          : () => _run(
                                () => ref
                                    .read(groupRepositoryProvider)
                                    .clearGroupMessages(
                                      conversationId: widget.conversationId,
                                    ),
                                message: 'Group messages cleared.',
                              ),
                      icon: const Icon(Icons.delete_sweep_outlined),
                      label: const Text('Clear all messages'),
                    ),
                  if (canManage)
                    OutlinedButton.icon(
                      onPressed: _busy ? null : _clearMessagesByRange,
                      icon: const Icon(Icons.date_range_outlined),
                      label: const Text('Clear by date range'),
                    ),
                  OutlinedButton.icon(
                    onPressed: _busy
                        ? null
                        : () async {
                            await _run(
                              () =>
                                  ref.read(groupRepositoryProvider).leaveGroup(
                                        conversationId: widget.conversationId,
                                        userId: me,
                                      ),
                              message: 'You left the group.',
                            );
                            if (!mounted) return;
                            context.go(AppRoutes.chats);
                          },
                    icon: const Icon(Icons.logout),
                    label: const Text('Leave group'),
                  ),
                  if (isOwner)
                    OutlinedButton.icon(
                      onPressed: _busy
                          ? null
                          : () async {
                              await _run(
                                () => ref
                                    .read(groupRepositoryProvider)
                                    .deleteGroup(
                                      conversationId: widget.conversationId,
                                    ),
                                message: 'Group deleted.',
                              );
                              if (!mounted) return;
                              context.go(AppRoutes.chats);
                            },
                      icon: const Icon(Icons.delete_forever_outlined),
                      label: const Text('Delete group'),
                    ),
                ],
              ),
              const SizedBox(height: 24),
              Text('Members', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              members.when(
                data: (items) => Card(
                  child: Column(
                    children: [
                      for (final member in items)
                        ListTile(
                          leading: CommsAvatar(
                            name: member.profile?.fullName ?? 'COMMS user',
                            imageUrl: member.profile?.avatarUrl,
                          ),
                          title:
                              Text(member.profile?.fullName ?? member.userId),
                          subtitle:
                              Text(member.profile?.email ?? member.userId),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              _RoleChip(role: member.role),
                              if (canManage && member.userId != me) ...[
                                PopupMenuButton<String>(
                                  onSelected: (value) {
                                    final canManageTarget =
                                        member.role != 'owner';
                                    if (!canManageTarget) return;
                                    if (value == 'make_admin') {
                                      _run(
                                        () => ref
                                            .read(groupRepositoryProvider)
                                            .updateMemberRole(
                                              conversationId:
                                                  widget.conversationId,
                                              userId: member.userId,
                                              role: 'admin',
                                            ),
                                        message: 'Member promoted to admin.',
                                      );
                                    } else if (value == 'make_member') {
                                      _run(
                                        () => ref
                                            .read(groupRepositoryProvider)
                                            .updateMemberRole(
                                              conversationId:
                                                  widget.conversationId,
                                              userId: member.userId,
                                              role: 'member',
                                            ),
                                        message: 'Admin changed to member.',
                                      );
                                    } else if (value == 'remove') {
                                      _run(
                                        () => ref
                                            .read(groupRepositoryProvider)
                                            .removeMember(
                                              conversationId:
                                                  widget.conversationId,
                                              userId: member.userId,
                                            ),
                                        message: 'Member removed.',
                                      );
                                    }
                                  },
                                  itemBuilder: (context) => [
                                    if (member.role != 'owner' &&
                                        member.role != 'admin')
                                      const PopupMenuItem(
                                        value: 'make_admin',
                                        child: Text('Make admin'),
                                      ),
                                    if (member.role == 'admin')
                                      const PopupMenuItem(
                                        value: 'make_member',
                                        child: Text('Make member'),
                                      ),
                                    if (member.role != 'owner')
                                      const PopupMenuItem(
                                        value: 'remove',
                                        child: Text('Remove member'),
                                      ),
                                  ],
                                ),
                              ],
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
                loading: () => const Padding(
                  padding: EdgeInsets.all(24),
                  child: LoadingState(),
                ),
                error: (error, _) => EmptyState(
                  title: 'Could not load members',
                  message: error.toString(),
                ),
              ),
            ],
          );
        },
        loading: () => const LoadingState(),
        error: (error, _) => EmptyState(
          title: 'Could not load group',
          message: error.toString(),
        ),
      ),
    );
  }
}

class _RoleChip extends StatelessWidget {
  const _RoleChip({required this.role});

  final String role;

  @override
  Widget build(BuildContext context) {
    return Chip(
      label: Text(role),
      visualDensity: VisualDensity.compact,
      padding: EdgeInsets.zero,
    );
  }
}

final _conversationProvider =
    StreamProvider.family((ref, String conversationId) {
  return ref.watch(chatRepositoryProvider).watchConversation(conversationId);
});

final _membersProvider = StreamProvider.family((ref, String conversationId) {
  return ref.watch(chatRepositoryProvider).watchMembers(conversationId);
});
