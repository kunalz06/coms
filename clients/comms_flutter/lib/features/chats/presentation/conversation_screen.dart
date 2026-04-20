import 'dart:async';
import 'dart:typed_data';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:just_audio/just_audio.dart';
import 'package:record/record.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../app/router/app_routes.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/models/conversation_member.dart';
import '../../../shared/models/message.dart';
import '../../../shared/widgets/state_views.dart';
import '../../backup/data/backup_repository.dart';
import '../../calls/data/call_controller.dart';
import '../../calls/domain/call_models.dart';
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
            TextButton.icon(
              onPressed: () => Navigator.of(context).pop(),
              icon: const Icon(Icons.arrow_back),
              label: const Text('Back'),
            ),
            FilledButton.icon(
              onPressed: () =>
                  Navigator.of(context).pop(controller.text.trim()),
              icon: const Icon(Icons.lock_open_outlined),
              label: const Text('Unlock'),
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
              subtitle: const Text('Images are compressed to 5 MB max'),
              onTap: () => Navigator.of(context).pop('image'),
            ),
            ListTile(
              leading: const Icon(Icons.description_outlined),
              title: const Text('Document'),
              subtitle: const Text('PDF, Word, or text files up to 10 MB'),
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
      withReadStream: true,
    );
    final file = result?.files.single;
    if (file == null) return;
    final caption = await _showAttachmentCaptionDialog(
      kind: kind,
      fileName: file.name,
    );
    if (caption == null) return;

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
            caption: caption,
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

  Future<String?> _showAttachmentCaptionDialog({
    required String kind,
    required String fileName,
  }) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(kind == 'image' ? 'Send photo' : 'Send document'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              fileName,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              maxLength: 220,
              minLines: 1,
              maxLines: 4,
              decoration: const InputDecoration(
                hintText: 'Add a caption (optional)',
              ),
            ),
          ],
        ),
        actions: [
          TextButton.icon(
            onPressed: () => Navigator.of(context).pop(null),
            icon: const Icon(Icons.close),
            label: const Text('Cancel'),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.of(context).pop(controller.text.trim()),
            icon: const Icon(Icons.send_outlined),
            label: const Text('Send'),
          ),
        ],
      ),
    );
    controller.dispose();
    return result;
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
              FilledButton.icon(
                onPressed: () async {
                  await _addReaction(message, _reactionController.text, 'text');
                  if (context.mounted) Navigator.of(context).pop();
                },
                icon: const Icon(Icons.emoji_emotions_outlined),
                label: const Text('Add reaction'),
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

  Future<void> _removeReaction(
    Message message,
    String content,
    String kind,
  ) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || content.trim().isEmpty) return;
    await ref.read(chatRepositoryProvider).removeReaction(
          messageId: message.id,
          userId: user.uid,
          content: content,
          kind: kind,
        );
  }

  Future<void> _showEditMessageDialog(Message message) async {
    final editor = TextEditingController(text: message.content ?? '');
    final value = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Edit message'),
        content: TextField(
          controller: editor,
          minLines: 1,
          maxLines: 5,
          decoration: const InputDecoration(hintText: 'Edit message'),
        ),
        actions: [
          TextButton.icon(
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.close),
            label: const Text('Cancel'),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.of(context).pop(editor.text.trim()),
            icon: const Icon(Icons.save_outlined),
            label: const Text('Save'),
          ),
        ],
      ),
    );
    editor.dispose();
    if (value == null || value.isEmpty) return;
    await ref.read(chatRepositoryProvider).editMessage(
          messageId: message.id,
          content: value,
        );
  }

  Future<void> _shareMessage(Message message) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    final conversations = await ref
        .read(chatRepositoryProvider)
        .fetchConversationsSnapshot(user.uid);
    final candidates = conversations
        .where((conversation) => conversation.id != widget.conversationId)
        .toList(growable: false);
    if (candidates.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No other chats available.')),
      );
      return;
    }

    if (!mounted) return;
    final targetConversationId = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const ListTile(title: Text('Share to')),
            for (final conversation in candidates)
              ListTile(
                leading: CircleAvatar(
                  child: Icon(
                    conversation.isGroup ? Icons.groups : Icons.person,
                  ),
                ),
                title: Text(conversation.title ??
                    (conversation.isGroup ? 'Group' : 'Direct chat')),
                onTap: () => Navigator.of(context).pop(conversation.id),
              ),
          ],
        ),
      ),
    );
    if (targetConversationId == null) return;

    await ref.read(chatRepositoryProvider).shareMessageToConversation(
          message: message,
          targetConversationId: targetConversationId,
          senderId: user.uid,
        );
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Message shared.')),
    );
  }

  Future<void> _handleMessageAction({
    required Message message,
    required bool mine,
    required String action,
  }) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;
    try {
      switch (action) {
        case 'react':
          await _showReactionSheet(message);
          return;
        case 'copy':
          if ((message.content ?? '').trim().isEmpty) return;
          await Clipboard.setData(ClipboardData(text: message.content!.trim()));
          if (!mounted) return;
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Message copied.')),
          );
          return;
        case 'share':
          await _shareMessage(message);
          return;
        case 'share_external':
          final text = message.content?.trim();
          final attachmentUrl = message.attachments.isEmpty
              ? null
              : message.attachments.first.url;
          final payload = [text, attachmentUrl]
              .whereType<String>()
              .where((item) => item.isNotEmpty)
              .join('\n');
          if (payload.isEmpty) return;
          await Share.share(payload);
          return;
        case 'edit':
          if (!mine || message.kind != 'text') return;
          await _showEditMessageDialog(message);
          return;
        case 'delete_me':
          await ref.read(chatRepositoryProvider).deleteMessageForMe(
                messageId: message.id,
                userId: user.uid,
              );
          return;
        case 'delete_everyone':
          if (!mine) return;
          if (!_canDeleteForEveryone(message)) {
            if (!mounted) return;
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text(
                  'Delete for everyone is available for 1 minute after sending.',
                ),
              ),
            );
            return;
          }
          await ref.read(chatRepositoryProvider).deleteMessageForEveryone(
                messageId: message.id,
              );
          return;
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    }
  }

  bool _canDeleteForEveryone(Message message) {
    if (message.isDeletedForEveryone) return false;
    final age = DateTime.now().toUtc().difference(message.createdAt.toUtc());
    return age <= const Duration(minutes: 1);
  }

  Future<void> _showImagePreviewDialog({
    required String imageUrl,
    required String title,
  }) async {
    final trimmed = imageUrl.trim();
    if (trimmed.isEmpty) return;
    await showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (context) {
        final size = MediaQuery.sizeOf(context);
        final width = size.width < 600 ? size.width * 0.84 : 360.0;
        return Dialog(
          backgroundColor: Colors.transparent,
          insetPadding: const EdgeInsets.all(20),
          child: Stack(
            children: [
              Container(
                width: width,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surface,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: AspectRatio(
                    aspectRatio: 1,
                    child: Image.network(
                      trimmed,
                      fit: BoxFit.cover,
                      errorBuilder: (context, error, stackTrace) => Center(
                        child: Text('Could not load $title image'),
                      ),
                    ),
                  ),
                ),
              ),
              Positioned(
                top: 8,
                right: 8,
                child: Material(
                  color: Colors.black54,
                  shape: const CircleBorder(),
                  child: IconButton(
                    icon: const Icon(Icons.close, color: Colors.white),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ),
              ),
            ],
          ),
        );
      },
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
          TextButton.icon(
            onPressed: () => Navigator.of(context).pop(false),
            icon: const Icon(Icons.close),
            label: const Text('Cancel'),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.of(context).pop(true),
            icon: const Icon(Icons.delete_outline),
            label: const Text('Delete'),
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
          TextButton.icon(
            onPressed: () => Navigator.of(context).pop(false),
            icon: const Icon(Icons.close),
            label: const Text('Cancel'),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.of(context).pop(true),
            icon: const Icon(Icons.block_outlined),
            label: const Text('Block'),
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
    final pinnedIds = userId == null
        ? const <String>{}
        : (ref.watch(_pinnedIdsProvider(userId)).valueOrNull ??
            const <String>{});
    final mutedIds = userId == null
        ? const <String>{}
        : (ref.watch(_mutedIdsProvider(userId)).valueOrNull ??
            const <String>{});
    final isPinned = pinnedIds.contains(widget.conversationId);
    final isMuted = mutedIds.contains(widget.conversationId);
    final memberMap = members.valueOrNull == null
        ? <String, ConversationMember>{}
        : {
            for (final member in members.valueOrNull!) member.userId: member,
          };
    final memberItems = members.valueOrNull ?? const <ConversationMember>[];
    final currentConversation = conversation.valueOrNull;
    ConversationMember? otherMember;
    for (final member in memberItems) {
      if (member.userId != userId) {
        otherMember = member;
        break;
      }
    }

    final fallbackPeerId = currentConversation?.userOneId == userId
        ? currentConversation?.userTwoId
        : currentConversation?.userOneId;
    final otherUserId = otherMember?.userId ?? fallbackPeerId;
    final canStartCall =
        currentConversation?.isGroup == true || otherUserId != null;
    final avatarUrl = currentConversation?.isGroup == true
        ? currentConversation?.avatarUrl
        : otherMember?.profile?.avatarUrl;
    final titleText = _conversationTitle(currentConversation, members.valueOrNull);
    final myRole = memberItems
        .firstWhere(
          (member) => member.userId == userId,
          orElse: () => ConversationMember(
            id: 'unknown',
            conversationId: 'unknown',
            userId: 'unknown',
            role: 'member',
            joinedAt: DateTime.fromMillisecondsSinceEpoch(0),
          ),
        )
        .role;
    final canManageGroup = myRole == 'owner' || myRole == 'admin';

    return Scaffold(
      appBar: AppBar(
        title: conversation.when(
          data: (item) => _ConversationHeaderTitle(
            title: titleText,
            avatarUrl: avatarUrl,
            isGroup: item?.isGroup == true,
            onAvatarTap: (avatarUrl == null || avatarUrl.trim().isEmpty)
                ? null
                : () => _showImagePreviewDialog(
                      imageUrl: avatarUrl,
                      title: item?.isGroup == true ? 'Group' : 'Profile',
                    ),
          ),
          loading: () => const Text('Conversation'),
          error: (_, __) => const Text('Conversation'),
        ),
        actions: [
          PopupMenuButton<String>(
            enabled: !_contactActionRunning,
            tooltip: 'Conversation options',
            onSelected: (value) async {
              final controller = ref.read(privacyControllerProvider.notifier);
              switch (value) {
                case 'group_info':
                  if (!context.mounted) break;
                  context.go(
                    AppRoutes.conversationInfo.replaceFirst(
                      ':conversationId',
                      widget.conversationId,
                    ),
                  );
                  break;
                case 'delete':
                  if (otherUserId == null) break;
                  _deleteFriend(otherUserId);
                  break;
                case 'block':
                  if (otherUserId == null) break;
                  _blockUser(otherUserId);
                  break;
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
                case 'pin':
                  if (userId == null) break;
                  await ref.read(chatRepositoryProvider).setConversationPinned(
                        conversationId: widget.conversationId,
                        userId: userId,
                        pinned: true,
                      );
                  break;
                case 'unpin':
                  if (userId == null) break;
                  await ref.read(chatRepositoryProvider).setConversationPinned(
                        conversationId: widget.conversationId,
                        userId: userId,
                        pinned: false,
                      );
                  break;
                case 'mute':
                  if (userId == null) break;
                  await ref.read(chatRepositoryProvider).setConversationMuted(
                        conversationId: widget.conversationId,
                        userId: userId,
                        muted: true,
                      );
                  break;
                case 'unmute':
                  if (userId == null) break;
                  await ref.read(chatRepositoryProvider).setConversationMuted(
                        conversationId: widget.conversationId,
                        userId: userId,
                        muted: false,
                      );
                  break;
                case 'clear_me':
                  if (userId == null) break;
                  await ref.read(chatRepositoryProvider).clearConversationForMe(
                        conversationId: widget.conversationId,
                        userId: userId,
                      );
                  break;
                case 'clear_all':
                  await ref
                      .read(chatRepositoryProvider)
                      .clearConversationForEveryone(
                        conversationId: widget.conversationId,
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
                if (currentConversation?.isGroup == true)
                  const PopupMenuItem(
                    value: 'group_info',
                    child: _MenuItemLabel(
                      icon: Icons.info_outline,
                      label: 'Group info',
                    ),
                  ),
                PopupMenuItem(
                  value: locked ? 'unlock' : 'lock',
                  child: _MenuItemLabel(
                    icon:
                        locked ? Icons.lock_open_outlined : Icons.lock_outline,
                    label: locked ? 'Remove lock' : 'Lock chat',
                  ),
                ),
                PopupMenuItem(
                  value: hidden ? 'unhide' : 'hide',
                  child: _MenuItemLabel(
                    icon: hidden
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                    label: hidden ? 'Unhide chat' : 'Hide chat',
                  ),
                ),
                PopupMenuItem(
                  value: isPinned ? 'unpin' : 'pin',
                  child: _MenuItemLabel(
                    icon: isPinned ? Icons.push_pin_outlined : Icons.push_pin,
                    label: isPinned ? 'Unpin chat' : 'Pin chat',
                  ),
                ),
                PopupMenuItem(
                  value: isMuted ? 'unmute' : 'mute',
                  child: _MenuItemLabel(
                    icon: isMuted
                        ? Icons.volume_up_outlined
                        : Icons.volume_off_outlined,
                    label: isMuted ? 'Unmute chat' : 'Mute chat',
                  ),
                ),
                const PopupMenuItem(
                  value: 'clear_me',
                  child: _MenuItemLabel(
                    icon: Icons.cleaning_services_outlined,
                    label: 'Clear messages for me',
                  ),
                ),
                if ((currentConversation?.isDirect == true) ||
                    (currentConversation?.isGroup == true && canManageGroup))
                  const PopupMenuItem(
                    value: 'clear_all',
                    child: _MenuItemLabel(
                      icon: Icons.delete_sweep_outlined,
                      label: 'Clear messages for everyone',
                    ),
                  ),
                if (currentConversation?.isDirect == true &&
                    otherUserId != null)
                  const PopupMenuItem(
                    value: 'delete',
                    child: _MenuItemLabel(
                      icon: Icons.person_remove_outlined,
                      label: 'Delete friend',
                    ),
                  ),
                if (currentConversation?.isDirect == true &&
                    otherUserId != null)
                  const PopupMenuItem(
                    value: 'block',
                    child: _MenuItemLabel(
                      icon: Icons.block_outlined,
                      label: 'Block contact',
                    ),
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
                final isCompact = MediaQuery.sizeOf(context).width < 700;
                return ListView.builder(
                  padding: EdgeInsets.all(isCompact ? 10 : 16),
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
                    return Align(
                      alignment:
                          mine ? Alignment.centerRight : Alignment.centerLeft,
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          maxWidth: isCompact
                              ? MediaQuery.sizeOf(context).width * 0.86
                              : 520,
                        ),
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
                                    style:
                                        Theme.of(context).textTheme.labelMedium,
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
                                  _ReactionSummary(
                                    message: resolved,
                                    membersById: memberMap,
                                    currentUserId: userId,
                                    onRemoveMyReaction: (content, kind) =>
                                        _removeReaction(
                                      resolved,
                                      content,
                                      kind,
                                    ),
                                  ),
                                ],
                                const SizedBox(height: 6),
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        mine
                                            ? '${_formatMessageTime(resolved.createdAt)} • ${_messageStatusLabel(message: resolved, memberItems: memberItems, currentUserId: userId, isGroup: currentConversation?.isGroup == true)}'
                                            : _formatMessageTime(
                                                resolved.createdAt),
                                        style: Theme.of(context)
                                            .textTheme
                                            .labelSmall,
                                      ),
                                    ),
                                    PopupMenuButton<String>(
                                      tooltip: 'Message actions',
                                      onSelected: (action) =>
                                          _handleMessageAction(
                                        message: resolved,
                                        mine: mine,
                                        action: action,
                                      ),
                                      itemBuilder: (context) => [
                                        const PopupMenuItem(
                                          value: 'react',
                                          child: _MenuItemLabel(
                                            icon: Icons.emoji_emotions_outlined,
                                            label: 'React',
                                          ),
                                        ),
                                        const PopupMenuItem(
                                          value: 'share',
                                          child: _MenuItemLabel(
                                            icon: Icons.share_outlined,
                                            label: 'Share',
                                          ),
                                        ),
                                        const PopupMenuItem(
                                          value: 'share_external',
                                          child: _MenuItemLabel(
                                            icon: Icons.open_in_new,
                                            label: 'Share externally',
                                          ),
                                        ),
                                        const PopupMenuItem(
                                          value: 'copy',
                                          child: _MenuItemLabel(
                                            icon: Icons.copy_outlined,
                                            label: 'Copy text',
                                          ),
                                        ),
                                        const PopupMenuItem(
                                          value: 'delete_me',
                                          child: _MenuItemLabel(
                                            icon: Icons.delete_outline,
                                            label: 'Delete for me',
                                          ),
                                        ),
                                        if (mine &&
                                            resolved.kind == 'text' &&
                                            !resolved.isDeletedForEveryone)
                                          const PopupMenuItem(
                                            value: 'edit',
                                            child: _MenuItemLabel(
                                              icon: Icons.edit_outlined,
                                              label: 'Edit',
                                            ),
                                          ),
                                        if (mine &&
                                            !resolved.isDeletedForEveryone)
                                          PopupMenuItem(
                                            value: 'delete_everyone',
                                            enabled:
                                                _canDeleteForEveryone(resolved),
                                            child: const _MenuItemLabel(
                                              icon: Icons.delete_sweep_outlined,
                                              label: 'Delete for everyone',
                                            ),
                                          ),
                                      ],
                                    ),
                                  ],
                                ),
                              ],
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

  String _formatMessageTime(DateTime dateTime) {
    final local = dateTime.toLocal();
    final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
    final minute = local.minute.toString().padLeft(2, '0');
    final suffix = local.hour >= 12 ? 'PM' : 'AM';
    return '$hour:$minute $suffix';
  }

  String _messageStatusLabel({
    required Message message,
    required List<ConversationMember> memberItems,
    required String? currentUserId,
    required bool isGroup,
  }) {
    if (currentUserId == null) return 'Sent';
    final others =
        memberItems.where((member) => member.userId != currentUserId).toList();
    if (others.isEmpty) return 'Sent';
    final isRead = others.every((member) {
      final readAt = member.lastReadAt;
      if (readAt == null) return false;
      return !readAt.isBefore(message.createdAt);
    });
    if (!isRead) return 'Sent';
    if (!isGroup) return 'Read';
    return others.length == 1 ? 'Read' : 'Read by ${others.length}';
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

    return _FileChip(
      fileName: fileName,
      icon: Icons.description_outlined,
      url: url,
    );
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
  const _ReactionSummary({
    required this.message,
    required this.membersById,
    required this.currentUserId,
    required this.onRemoveMyReaction,
  });

  final Message message;
  final Map<String, ConversationMember> membersById;
  final String? currentUserId;
  final Future<void> Function(String content, String kind) onRemoveMyReaction;

  @override
  Widget build(BuildContext context) {
    final grouped = <String, int>{};
    for (final reaction in message.reactions) {
      grouped.update(reaction.content, (count) => count + 1, ifAbsent: () => 1);
    }

    Future<void> openReactionsDialog() async {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Reactions'),
          content: SizedBox(
            width: 420,
            child: ListView.separated(
              shrinkWrap: true,
              itemCount: message.reactions.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final reaction = message.reactions[index];
                final profile = membersById[reaction.userId]?.profile;
                final isMine =
                    currentUserId != null && reaction.userId == currentUserId;
                final userLabel = isMine
                    ? 'You'
                    : (profile?.fullName.trim().isNotEmpty == true
                        ? profile!.fullName
                        : (profile?.email.trim().isNotEmpty == true
                            ? profile!.email
                            : reaction.userId));
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Text(
                    reaction.content,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  title: Text(userLabel),
                  subtitle: Text(reaction.kind),
                  trailing: isMine
                      ? TextButton.icon(
                          onPressed: () async {
                            await onRemoveMyReaction(
                              reaction.content,
                              reaction.kind,
                            );
                            if (dialogContext.mounted) {
                              Navigator.of(dialogContext).pop();
                            }
                          },
                          icon: const Icon(Icons.close, size: 16),
                          label: const Text('Remove'),
                        )
                      : null,
                );
              },
            ),
          ),
          actions: [
            TextButton.icon(
              onPressed: () => Navigator.of(dialogContext).pop(),
              icon: const Icon(Icons.close),
              label: const Text('Close'),
            ),
          ],
        ),
      );
    }

    return Wrap(
      spacing: 4,
      runSpacing: 4,
      children: grouped.entries
          .map(
            (entry) => ActionChip(
              visualDensity: VisualDensity.compact,
              onPressed: openReactionsDialog,
              label: Text(
                entry.value > 1 ? '${entry.key} ${entry.value}' : entry.key,
              ),
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
    this.url,
  });

  final String fileName;
  final IconData icon;
  final String? url;

  @override
  Widget build(BuildContext context) {
    Future<void> openAttachment() async {
      final raw = url?.trim();
      if (raw == null || raw.isEmpty) return;
      final uri = Uri.tryParse(raw);
      if (uri == null) return;
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open this document.')),
        );
      }
    }

    return ActionChip(
      avatar: Icon(icon, size: 18),
      label: Text(fileName, overflow: TextOverflow.ellipsis),
      onPressed: url == null ? null : openAttachment,
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

final _pinnedIdsProvider = StreamProvider.family((ref, String userId) {
  return ref.watch(chatRepositoryProvider).watchPinnedConversationIds(userId);
});

final _mutedIdsProvider = StreamProvider.family((ref, String userId) {
  return ref.watch(chatRepositoryProvider).watchMutedConversationIds(userId);
});

class _MenuItemLabel extends StatelessWidget {
  const _MenuItemLabel({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18),
        const SizedBox(width: 8),
        Text(label),
      ],
    );
  }
}

class _ConversationHeaderTitle extends StatelessWidget {
  const _ConversationHeaderTitle({
    required this.title,
    required this.isGroup,
    this.avatarUrl,
    this.onAvatarTap,
  });

  final String title;
  final bool isGroup;
  final String? avatarUrl;
  final VoidCallback? onAvatarTap;

  @override
  Widget build(BuildContext context) {
    final hasAvatar = avatarUrl != null && avatarUrl!.trim().isNotEmpty;
    return Row(
      children: [
        InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: onAvatarTap,
          child: CircleAvatar(
            radius: 18,
            backgroundImage: hasAvatar ? NetworkImage(avatarUrl!.trim()) : null,
            child: hasAvatar
                ? null
                : Icon(isGroup ? Icons.groups : Icons.person_outline),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            title,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
