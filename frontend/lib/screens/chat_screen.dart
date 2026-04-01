import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';
import '../services/chat_provider.dart';
import '../services/auth_provider.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _messageController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final chat = Provider.of<ChatProvider>(context, listen: false);
      chat.connectSocket();
      chat.fetchRooms();
    });
  }

  @override
  void dispose() {
    _messageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<ChatProvider>(
      builder: (context, chat, child) {
        return SafeArea(
          child: Column(
            children: [
              // Header
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                child: Row(
                  children: [
                    if (chat.activeRoomId != null)
                      GestureDetector(
                        onTap: () => chat.closeRoom(),
                        child: const Padding(
                          padding: EdgeInsets.only(right: 12),
                          child: Icon(Icons.arrow_back_rounded, color: Colors.white),
                        ),
                      ),
                    Expanded(
                      child: Text(
                        chat.activeRoomId != null
                            ? 'Chat' 
                            : 'Messages',
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.06),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(
                        chat.activeRoomId != null ? Icons.more_vert_rounded : Icons.edit_rounded,
                        color: Colors.white, 
                        size: 20
                      ),
                    ),
                  ],
                ),
              ),

              // Content
              Expanded(
                child: chat.activeRoomId != null
                    ? _buildChatView(chat)
                    : _buildConversationList(chat),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildConversationList(ChatProvider chat) {
    if (chat.rooms.isEmpty) {
      return const Center(child: Text("No conversations found", style: TextStyle(color: Colors.white70)));
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      itemCount: chat.rooms.length,
      itemBuilder: (context, index) {
        final conv = chat.rooms[index];
        final unread = conv['unread_count'] is String ? int.parse(conv['unread_count']) : (conv['unread_count'] ?? 0);
        final name = conv['other_member'] != null ? conv['other_member']['full_name'] : (conv['room_name'] ?? 'Unknown');
        final isOnline = conv['other_member']?['is_online'] ?? false;
        final lastMsg = conv['last_message']?['content'] ?? 'No messages yet';

        return GlassCard(
          margin: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          onTap: () => chat.openRoom(conv['id']),
          child: Row(
            children: [
              Stack(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: AppTheme.primaryColor.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Center(
                      child: Text(name.isNotEmpty ? name[0].toUpperCase() : '?', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold))
                    )
                  ),
                  if (isOnline)
                    Positioned(
                      right: 0,
                      bottom: 0,
                      child: Container(
                        width: 12,
                        height: 12,
                        decoration: BoxDecoration(
                          color: AppTheme.successColor,
                          shape: BoxShape.circle,
                          border: Border.all(color: AppTheme.surfaceDark, width: 2),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: TextStyle(fontSize: 15, fontWeight: unread > 0 ? FontWeight.w700 : FontWeight.w500, color: Colors.white),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      lastMsg,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 13,
                        color: unread > 0 ? Colors.white.withValues(alpha: 0.8) : Colors.white.withValues(alpha: 0.4),
                      ),
                    ),
                  ],
                ),
              ),
              if (unread > 0)
                 Container(
                    margin: const EdgeInsets.only(left: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      gradient: AppTheme.primaryGradient,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text('$unread', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
                 ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildChatView(ChatProvider chat) {
    final currentUserId = Provider.of<AuthProvider>(context, listen: false).userProfile?['id'];

    return Column(
      children: [
        Expanded(
          child: ListView.builder(
            reverse: true, // we assume messages arrive newest first in the array from API
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            itemCount: chat.messages.length,
            itemBuilder: (context, index) {
              final msg = chat.messages[index];
              final isMe = msg['sender_id'] == currentUserId;
              
              return Align(
                alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
                child: Container(
                  margin: const EdgeInsets.symmetric(vertical: 4),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  constraints: BoxConstraints(
                    maxWidth: MediaQuery.of(context).size.width * 0.75,
                  ),
                  decoration: BoxDecoration(
                    color: isMe
                        ? AppTheme.primaryColor.withValues(alpha: 0.2)
                        : Colors.white.withValues(alpha: 0.06),
                    borderRadius: BorderRadius.only(
                      topLeft: const Radius.circular(16),
                      topRight: const Radius.circular(16),
                      bottomLeft: Radius.circular(isMe ? 16 : 4),
                      bottomRight: Radius.circular(isMe ? 4 : 16),
                    ),
                    border: Border.all(
                      color: isMe
                          ? AppTheme.primaryColor.withValues(alpha: 0.3)
                          : Colors.white.withValues(alpha: 0.08),
                    ),
                  ),
                  child: Text(
                    msg['content'] ?? '',
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                  ),
                ),
              );
            },
          ),
        ),

        // Message Input
        Container(
          padding: const EdgeInsets.fromLTRB(16, 8, 8, 16),
          decoration: BoxDecoration(
            color: AppTheme.surfaceCard,
            border: Border(top: BorderSide(color: Colors.white.withValues(alpha: 0.05))),
          ),
          child: SafeArea(
            top: false,
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _messageController,
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                    decoration: const InputDecoration(
                      hintText: 'Type a message...',
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    ),
                  ),
                ),
                GestureDetector(
                  onTap: () {
                    if (_messageController.text.isNotEmpty) {
                      chat.sendMessage(_messageController.text);
                      _messageController.clear();
                    }
                  },
                  child: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      gradient: AppTheme.primaryGradient,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(Icons.send_rounded, color: Colors.white, size: 20),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
