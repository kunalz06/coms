import 'dart:async';
import 'dart:typed_data';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:just_audio/just_audio.dart';
import 'package:record/record.dart';

import '../../../app/router/app_routes.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/models/conversation_member.dart';
import '../../../shared/models/message.dart';
import '../../../shared/widgets/state_views.dart';
import '../../calls/data/call_controller.dart';
import '../../calls/domain/call_models.dart';
import '../../backup/data/backup_repository.dart';
import '../../contacts/data/contact_repository.dart';
import '../../privacy/data/privacy_controller.dart';
import '../../uploads/data/cloudinary_upload_service.dart';
import '../data/chat_repository.dart';

class ConversationScreen extends ConsumerStatefulWidget {
  const ConversationScreen({required this.conversationId, super.key});

  final String conversationId;

  @override
  ConsumerState<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends ConsumerState<ConversationScreen> {
  final _controller = TextEditingController();
  final _reactionController = TextEditingController();
  final _recorder = AudioRecorder();
  BytesBuilder? _recordingBytes;
  StreamSubscription<Uint8List>? _recordingSubscription;
  var _contactActionRunning = false;
  var _uploadProgress = 0;
  String? _uploadingName;
  var _recording = false;
  String? _lastMarkedReadMessageId;
  var _restoringArchive = false;
  String? _archiveRestoreError;
  final _restoredById = <String, Message>{};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _validatePrivacyAccess();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _reactionController.dispose();
    _recordingSubscription?.cancel();
    _recorder.dispose();
    super.dispose();
  }

  Future<void> _validatePrivacyAccess() async {
    if (!mounted) return;
    final privacy = ref.read(privacyControllerProvider);
    final conversationId = widget.conversationId;

    if (privacy.hiddenConversationIds.contains(conversationId) &&
        !privacy.hiddenUnlocked) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Unlock hidden chats first.')),
      );
      context.go(AppRoutes.hiddenChats);
      return;
    }

    if (privacy.lockedConversationIds.contains(conversationId) &&
        privacy.chatLockConfigured &&
        !privacy.chatUnlocked) {
      final controller = TextEditingController();
      final password = await showDialog<String>(
        context: context,
        barrierDismissible: false,
        builder: (context) => AlertDialog(
          title: const Text('Unlock chat'),
          content: TextField(
            controller: controller,
            obscureText: true,
            decoration:
                const InputDecoration(hintText: 'Enter chat lock password'),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Back'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(controller.text.trim()),
              child: const Text('Unlock'),
            ),
          ],
        ),
      );
      controller.dispose();

      if (!mounted) return;
      if (password == null || password.isEmpty) {
        context.go(AppRoutes.chats);
        return;
      }
      final ok = await ref
          .read(privacyControllerProvider.notifier)
          .unlockChatLock(password);
      if (!mounted) return;
      if (!ok) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Wrong chat lock password.')),
        );
        context.go(AppRoutes.chats);
      }
    }
  }

  Future<void> _send() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;
    final text = _controller.text;
    _controller.clear();
    await ref.read(chatRepositoryProvider).sendText(
          conversationId: widget.conversationId,
          senderId: user.uid,
          content: text,
        );
  }

  Future<void> _startCall({
    required CallMode mode,
    required bool isGroup,
    String? otherUserId,
  }) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    try {
      final controller = ref.read(callControllerProvider.notifier);
      if (isGroup) {
        await controller.startGroupCall(
          currentUserId: user.uid,
          conversationId: widget.conversationId,
          mode: mode,
        );
      } else {
        if (otherUserId == null) return;
        await controller.startDirectCall(
          currentUserId: user.uid,
          peerId: otherUserId,
          conversationId: widget.conversationId,
          mode: mode,
        );
      }
      if (!mounted) return;
      context.go(AppRoutes.calls);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            mode == CallMode.video
                ? 'Video call started.'
                : 'Audio call started.',
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    }
  }

  Future<void> _showAttachmentPicker() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.image_outlined),
              title: const Text('Photo'),
              subtitle: const Text('Images up to 5 MB'),
              onTap: () => Navigator.of(context).pop('image'),
            ),
            ListTile(
              leading: const Icon(Icons.description_outlined),
              title: const Text('Document'),
              subtitle: const Text('PDF, Word, or text files up to 5 MB'),
              onTap: () => Navigator.of(context).pop('document'),
            ),
          ],
        ),
      ),
    );
    if (choice == null) return;
    await _pickAndSend(choice);
  }

  Future<void> _pickAndSend(String kind) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || _uploadingName != null) return;

    final result = await FilePicker.platform.pickFiles(
      type: kind == 'image' ? FileType.image : FileType.custom,
      allowedExtensions:
          kind == 'image' ? null : const ['pdf', 'doc', 'docx', 'txt'],
      allowMultiple: false,
      withData: true,
    );
    final file = result?.files.single;
    if (file == null) return;

    setState(() {
      _uploadingName = file.name;
      _uploadProgress = 0;
    });

    try {
      final attachment = await ref.read(cloudinaryUploadServiceProvider).upload(
            file: file,
            kind: kind,
            onProgress: (progress) {
              if (mounted) setState(() => _uploadProgress = progress);
            },
          );
      await ref.read(chatRepositoryProvider).sendAttachment(
            conversationId: widget.conversationId,
            senderId: user.uid,
            kind: kind,
            attachment: attachment,
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Attachment sent.')),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    } finally {
      if (mounted) {
        setState(() {
          _uploadingName = null;
          _uploadProgress = 0;
        });
      }
    }
  }

  Future<void> _toggleRecording() async {
    if (_recording) {
      await _stopAndSendRecording();
      return;
    }

    final hasPermission = await _recorder.hasPermission();
    if (!hasPermission) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Microphone permission is needed.')),
      );
      return;
    }

    _recordingBytes = BytesBuilder(copy: false);
    final stream = await _recorder.startStream(
      const RecordConfig(
        encoder: AudioEncoder.wav,
        sampleRate: 16000,
        numChannels: 1,
      ),
    );
    _recordingSubscription = stream.listen((chunk) {
      _recordingBytes?.add(chunk);
    });
    if (mounted) setState(() => _recording = true);
  }

  Future<void> _stopAndSendRecording() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    await _recorder.stop();
    await Future<void>.delayed(const Duration(milliseconds: 120));
    await _recordingSubscription?.cancel();
    _recordingSubscription = null;
    final bytes = _recordingBytes?.takeBytes() ?? Uint8List(0);
    _recordingBytes = null;

    if (mounted) setState(() => _recording = false);
    if (bytes.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No voice data was captured.')),
      );
      return;
    }

    setState(() {
      _uploadingName = 'voice message';
      _uploadProgress = 0;
    });

    try {
      final attachment =
          await ref.read(cloudinaryUploadServiceProvider).uploadBytes(
                bytes: bytes,
                fileName:
                    'comms-voice-${DateTime.now().millisecondsSinceEpoch}.wav',
                kind: 'voice',
                mimeType: 'audio/wav',
                onProgress: (progress) {
                  if (mounted) setState(() => _uploadProgress = progress);
                },
              );
      await ref.read(chatRepositoryProvider).sendAttachment(
            conversationId: widget.conversationId,
            senderId: user.uid,
            kind: 'voice',
            attachment: attachment,
          );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    } finally {
      if (mounted) {
        setState(() {
          _uploadingName = null;
          _uploadProgress = 0;
        });
      }
    }
  }

  Future<void> _cancelRecording() async {
    await _recorder.cancel();
    await _recordingSubscription?.cancel();
    _recordingSubscription = null;
    _recordingBytes = null;
    if (mounted) setState(() => _recording = false);
  }

  Future<void> _showReactionSheet(Message message) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;
    _reactionController.clear();

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: EdgeInsets.only(
            left: 16,
            right: 16,
            top: 16,
            bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('React to message',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                children: [
                  for (final emoji in const ['👍', '❤️', '😂', '😮', '😢'])
                    ActionChip(
                      label: Text(emoji),
                      onPressed: () async {
                        await _addReaction(message, emoji, 'emoji');
                        if (context.mounted) Navigator.of(context).pop();
                      },
                    ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _reactionController,
                maxLength: 80,
                decoration: const InputDecoration(
                  labelText: 'Text reaction',
                  hintText: 'Type a short reaction',
                ),
                onSubmitted: (value) async {
                  await _addReaction(message, value, 'text');
                  if (context.mounted) Navigator.of(context).pop();
                },
              ),
              FilledButton(
                onPressed: () async {
                  await _addReaction(message, _reactionController.text, 'text');
                  if (context.mounted) Navigator.of(context).pop();
                },
                child: const Text('Add reaction'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _addReaction(
    Message message,
    String content,
    String kind,
  ) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || content.trim().isEmpty) return;
    await ref.read(chatRepositoryProvider).reactToMessage(
          messageId: message.id,
          userId: user.uid,
          content: content,
          kind: kind,
        );
  }

  Future<void> _deleteFriend(String otherUserId) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || _contactActionRunning) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete friend?'),
        content: const Text(
          'The chat history stays, but this person is removed from your normal chat list.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    await _runContactAction(
      () => ref.read(contactRepositoryProvider).deleteFriend(
            currentUserId: user.uid,
            otherUserId: otherUserId,
          ),
      'Friend removed.',
    );
  }

  Future<void> _blockUser(String otherUserId) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || _contactActionRunning) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Block contact?'),
        content: const Text(
          'Blocked users cannot message or call you directly in COMMS.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Block'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    await _runContactAction(
      () => ref.read(contactRepositoryProvider).blockUser(
            blockerId: user.uid,
            blockedId: otherUserId,
          ),
      'Contact blocked.',
    );
  }

  Future<void> _runContactAction(
    Future<void> Function() action,
    String successMessage,
  ) async {
    setState(() => _contactActionRunning = true);
    try {
      await action();
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(successMessage)));
      context.go(AppRoutes.chats);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    } finally {
      if (mounted) setState(() => _contactActionRunning = false);
    }
  }

  Future<void> _restoreArchivedMessages() async {
    if (_restoringArchive) return;
    setState(() {
      _restoringArchive = true;
      _archiveRestoreError = null;
    });
    try {
      final restored = await ref
          .read(backupRepositoryProvider)
          .restore(widget.conversationId);
      if (!mounted) return;
      setState(() {
        for (final message in restored) {
          _restoredById[message.id] = message;
        }
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Archived messages restored.')),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _archiveRestoreError = error.toString());
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    } finally {
      if (mounted) setState(() => _restoringArchive = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final conversation =
        ref.watch(_conversationProvider(widget.conversationId));
    final members = ref.watch(_membersProvider(widget.conversationId));
    final messages = ref.watch(_messagesProvider(widget.conversationId));
    final userId = FirebaseAuth.instance.currentUser?.uid;
    final memberMap = members.valueOrNull == null
        ? <String, ConversationMember>{}
        : {
            for (final member in members.valueOrNull!) member.userId: member,
          };
    final currentConversation = conversation.valueOrNull;
    ConversationMember? otherMember;
    for (final member in members.valueOrNull ?? const <ConversationMember>[]) {
      if (member.userId != userId) {
        otherMember = member;
        break;
      }
    }
    final otherUserId = otherMember?.userId;
    final canStartCall =
        currentConversation?.isGroup == true || otherUserId != null;

    return Scaffold(
      appBar: AppBar(
        title: conversation.when(
          data: (item) => Text(_conversationTitle(item, members.valueOrNull)),
          loading: () => const Text('Conversation'),
          error: (_, __) => const Text('Conversation'),
        ),
        actions: [
          if (currentConversation?.isGroup == true)
            IconButton(
              onPressed: () => context.go(
                AppRoutes.conversationInfo.replaceFirst(
                  ':conversationId',
                  widget.conversationId,
                ),
              ),
              icon: const Icon(Icons.info_outline),
              tooltip: 'Group info',
            ),
          if (currentConversation?.isDirect == true && otherUserId != null)
            PopupMenuButton<String>(
              enabled: !_contactActionRunning,
              tooltip: 'Contact actions',
              onSelected: (value) {
                switch (value) {
                  case 'delete':
                    _deleteFriend(otherUserId);
                    return;
                  case 'block':
                    _blockUser(otherUserId);
                    return;
                }
              },
              itemBuilder: (context) => const [
                PopupMenuItem(
                  value: 'delete',
                  child: Text('Delete friend'),
                ),
                PopupMenuItem(
                  value: 'block',
                  child: Text('Block contact'),
                ),
              ],
            ),
          PopupMenuButton<String>(
            tooltip: 'Privacy',
            onSelected: (value) async {
              final controller = ref.read(privacyControllerProvider.notifier);
              switch (value) {
                case 'lock':
                  await controller.setConversationLocked(
                    conversationId: widget.conversationId,
                    locked: true,
                  );
                  break;
                case 'unlock':
                  await controller.setConversationLocked(
                    conversationId: widget.conversationId,
                    locked: false,
                  );
                  break;
                case 'hide':
                  await controller.setConversationHidden(
                    conversationId: widget.conversationId,
                    hidden: true,
                  );
                  if (context.mounted) context.go(AppRoutes.hiddenChats);
                  break;
                case 'unhide':
                  await controller.setConversationHidden(
                    conversationId: widget.conversationId,
                    hidden: false,
                  );
                  break;
              }
            },
            itemBuilder: (context) {
              final privacy = ref.watch(privacyControllerProvider);
              final locked =
                  privacy.lockedConversationIds.contains(widget.conversationId);
              final hidden =
                  privacy.hiddenConversationIds.contains(widget.conversationId);
              return [
                PopupMenuItem(
                  value: locked ? 'unlock' : 'lock',
                  child: Text(locked ? 'Remove lock' : 'Lock chat'),
                ),
                PopupMenuItem(
                  value: hidden ? 'unhide' : 'hide',
                  child: Text(hidden ? 'Unhide chat' : 'Hide chat'),
                ),
              ];
            },
          ),
          IconButton(
              onPressed: !canStartCall
                  ? null
                  : () => _startCall(
                        mode: CallMode.audio,
                        isGroup: currentConversation?.isGroup == true,
                        otherUserId: otherUserId,
                      ),
              icon: const Icon(Icons.call_outlined),
              tooltip: 'Audio call'),
          IconButton(
              onPressed: !canStartCall
                  ? null
                  : () => _startCall(
                        mode: CallMode.video,
                        isGroup: currentConversation?.isGroup == true,
                        otherUserId: otherUserId,
                      ),
              icon: const Icon(Icons.videocam_outlined),
              tooltip: 'Video call'),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: messages.when(
              data: (items) {
                final latestMessageId = items.isEmpty ? null : items.last.id;
                if (userId != null &&
                    latestMessageId != null &&
                    _lastMarkedReadMessageId != latestMessageId) {
                  _lastMarkedReadMessageId = latestMessageId;
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    ref.read(chatRepositoryProvider).markRead(
                          conversationId: widget.conversationId,
                          userId: userId,
                        );
                  });
                }
                if (items.isEmpty) {
                  return const EmptyState(
                      title: 'No messages', message: 'Send the first message.');
                }
                final redacted = items.where((item) => item.isRedacted).length;
                return ListView.builder(
                  padding: const EdgeInsets.all(16),
                  reverse: false,
                  itemCount: items.length + 1,
                  itemBuilder: (context, index) {
                    if (index == 0) {
                      if (redacted == 0 && _archiveRestoreError == null) {
                        return const SizedBox.shrink();
                      }
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Card(
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (redacted > 0)
                                  Text(
                                    '$redacted older message${redacted == 1 ? '' : 's'} are archived.',
                                  ),
                                if (_archiveRestoreError != null) ...[
                                  const SizedBox(height: 8),
                                  Text(
                                    _archiveRestoreError!,
                                    style: TextStyle(
                                      color:
                                          Theme.of(context).colorScheme.error,
                                    ),
                                  ),
                                ],
                                const SizedBox(height: 10),
                                FilledButton.icon(
                                  onPressed: _restoringArchive
                                      ? null
                                      : _restoreArchivedMessages,
                                  icon: const Icon(Icons.restore),
                                  label: Text(
                                    _restoringArchive
                                        ? 'Restoring...'
                                        : 'Restore archived messages',
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    }

                    final message = items[index - 1];
                    final resolved = _restoredById[message.id] ?? message;
                    final mine = message.senderId == userId;
                    final sender = memberMap[message.senderId]?.profile;
                    final showSender = currentConversation?.isGroup == true &&
                        !mine &&
                        sender != null;
                    return GestureDetector(
                      onLongPress: () => _showReactionSheet(message),
                      child: Align(
                        alignment:
                            mine ? Alignment.centerRight : Alignment.centerLeft,
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 520),
                          child: Card(
                            color: mine
                                ? Theme.of(context).colorScheme.primaryContainer
                                : null,
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 12, vertical: 8),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  if (showSender) ...[
                                    Text(
                                      sender.fullName,
                                      style: Theme.of(context)
                                          .textTheme
                                          .labelMedium,
                                    ),
                                    const SizedBox(height: 4),
                                  ],
                                  Text(resolved.isDeletedForEveryone
                                      ? 'Message deleted'
                                      : resolved.content ??
                                          (resolved.isRedacted
                                              ? 'Archived message'
                                              : 'Attachment')),
                                  for (final attachment in resolved.attachments)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 8),
                                      child: _AttachmentPreview(
                                        kind: resolved.kind,
                                        fileName: attachment.fileName,
                                        url: attachment.url,
                                      ),
                                    ),
                                  if (resolved.reactions.isNotEmpty) ...[
                                    const SizedBox(height: 8),
                                    _ReactionSummary(message: resolved),
                                  ],
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                );
              },
              loading: () => const LoadingState(),
              error: (error, _) => EmptyState(
                  title: 'Could not load messages', message: error.toString()),
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (_uploadingName != null) ...[
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Uploading $_uploadingName',
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                        Text('$_uploadProgress%'),
                      ],
                    ),
                    const SizedBox(height: 6),
                    LinearProgressIndicator(value: _uploadProgress / 100),
                    const SizedBox(height: 8),
                  ],
                  Row(
                    children: [
                      IconButton(
                          onPressed: _uploadingName == null
                              ? _showAttachmentPicker
                              : null,
                          icon: const Icon(Icons.add),
                          tooltip: 'Attach'),
                      IconButton(
                        onPressed:
                            _uploadingName == null ? _toggleRecording : null,
                        icon: Icon(_recording ? Icons.stop : Icons.mic_none),
                        tooltip: _recording
                            ? 'Stop and send voice note'
                            : 'Record voice note',
                      ),
                      if (_recording)
                        IconButton(
                          onPressed: _cancelRecording,
                          icon: const Icon(Icons.close),
                          tooltip: 'Cancel recording',
                        ),
                      Expanded(
                        child: TextField(
                          controller: _controller,
                          minLines: 1,
                          maxLines: 5,
                          decoration:
                              const InputDecoration(hintText: 'Message'),
                          onSubmitted: (_) => _send(),
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton(
                          onPressed: _send, child: const Icon(Icons.send)),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AttachmentPreview extends StatelessWidget {
  const _AttachmentPreview({
    required this.kind,
    required this.fileName,
    required this.url,
  });

  final String kind;
  final String fileName;
  final String url;

  @override
  Widget build(BuildContext context) {
    if (kind == 'voice') {
      return _VoicePreview(fileName: fileName, url: url);
    }

    if (kind == 'image') {
      return ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Image.network(
          url,
          width: 220,
          height: 160,
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) => _FileChip(
            fileName: fileName,
            icon: Icons.broken_image_outlined,
          ),
        ),
      );
    }

    return _FileChip(fileName: fileName, icon: Icons.description_outlined);
  }
}

class _VoicePreview extends StatefulWidget {
  const _VoicePreview({
    required this.fileName,
    required this.url,
  });

  final String fileName;
  final String url;

  @override
  State<_VoicePreview> createState() => _VoicePreviewState();
}

class _VoicePreviewState extends State<_VoicePreview> {
  late final AudioPlayer _player;
  var _playing = false;

  @override
  void initState() {
    super.initState();
    _player = AudioPlayer();
    _player.playerStateStream.listen((state) {
      if (mounted) setState(() => _playing = state.playing);
    });
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  Future<void> _toggle() async {
    if (_playing) {
      await _player.pause();
      return;
    }
    if (_player.audioSource == null) {
      await _player.setUrl(widget.url);
    }
    await _player.play();
  }

  @override
  Widget build(BuildContext context) {
    return ActionChip(
      avatar: Icon(_playing ? Icons.pause : Icons.play_arrow, size: 18),
      label: Text(widget.fileName, overflow: TextOverflow.ellipsis),
      onPressed: _toggle,
    );
  }
}

class _ReactionSummary extends StatelessWidget {
  const _ReactionSummary({required this.message});

  final Message message;

  @override
  Widget build(BuildContext context) {
    final grouped = <String, int>{};
    for (final reaction in message.reactions) {
      grouped.update(reaction.content, (count) => count + 1, ifAbsent: () => 1);
    }

    return Wrap(
      spacing: 4,
      runSpacing: 4,
      children: grouped.entries
          .map(
            (entry) => Chip(
              visualDensity: VisualDensity.compact,
              label: Text(
                  entry.value > 1 ? '${entry.key} ${entry.value}' : entry.key),
            ),
          )
          .toList(growable: false),
    );
  }
}

class _FileChip extends StatelessWidget {
  const _FileChip({
    required this.fileName,
    required this.icon,
  });

  final String fileName;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Chip(
      avatar: Icon(icon, size: 18),
      label: Text(fileName, overflow: TextOverflow.ellipsis),
    );
  }
}

String _conversationTitle(
  Conversation? conversation,
  List<ConversationMember>? members,
) {
  if (conversation == null) return 'Conversation';
  if (conversation.isGroup) return conversation.title ?? 'Group';
  final userId = FirebaseAuth.instance.currentUser?.uid;
  for (final member in members ?? const <ConversationMember>[]) {
    if (member.userId != userId && member.profile?.fullName != null) {
      return member.profile!.fullName;
    }
  }
  return conversation.title ?? 'Direct chat';
}

final _conversationProvider =
    StreamProvider.family((ref, String conversationId) {
  return ref.watch(chatRepositoryProvider).watchConversation(conversationId);
});

final _membersProvider = StreamProvider.family((ref, String conversationId) {
  return ref.watch(chatRepositoryProvider).watchMembers(conversationId);
});

final _messagesProvider = StreamProvider.family((ref, String conversationId) {
  return ref.watch(chatRepositoryProvider).watchMessages(conversationId);
});
