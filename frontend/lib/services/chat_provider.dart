import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:shared_preferences/shared_preferences.dart';
import 'api_client.dart';

class ChatProvider with ChangeNotifier {
  final ApiClient _apiClient = ApiClient();
  IO.Socket? _socket;
  
  List<dynamic> _rooms = [];
  List<dynamic> _messages = [];
  String? _activeRoomId;

  List<dynamic> get rooms => _rooms;
  List<dynamic> get messages => _messages;
  String? get activeRoomId => _activeRoomId;

  void connectSocket() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('access_token');
    
    if (token == null) return;

    // Chat system running on API Gateway or direct port?
    // According to app setup it's routed through API Gateway which runs on 3000
    // but websocket endpoint could be directly on Gateway if Gateway proxies websockets
    // Usually API Gateway handles WS upgrade or we connect to Chat port (3001)
    // We'll connect directly to Chat Service on 3001
    _socket = IO.io('http://10.0.2.2:3001', <String, dynamic>{
      'transports': ['websocket'],
      'autoConnect': false,
      'auth': {'token': token},
    });

    _socket!.connect();

    _socket!.onConnect((_) {
      debugPrint('Connected to chat socket');
    });

    _socket!.on('new_message', (data) {
      if (_activeRoomId != null && data['room_id'] == _activeRoomId) {
        _messages.insert(0, data);
        notifyListeners();
      }
      fetchRooms();
    });

    _socket!.onDisconnect((_) => debugPrint('Disconnected from chat socket'));
  }

  void disconnectSocket() {
    _socket?.disconnect();
    _socket = null;
  }

  Future<void> fetchRooms() async {
    try {
      final res = await _apiClient.getRequest('/chat/rooms');
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        _rooms = data['data'] ?? [];
        notifyListeners();
      }
    } catch (e) {
      debugPrint('Error fetching rooms: $e');
    }
  }

  Future<void> openRoom(String roomId) async {
    _activeRoomId = roomId;
    _messages = [];
    notifyListeners();
    
    _socket?.emit('join_room', {'roomId': roomId});
    
    try {
      final res = await _apiClient.getRequest('/chat/rooms/$roomId/messages');
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        _messages = data['data']['messages'] ?? [];
        notifyListeners();
      }
    } catch (e) {
      debugPrint('Error fetching messages: $e');
    }
  }

  void closeRoom() {
    _activeRoomId = null;
    _messages = [];
    notifyListeners();
  }

  void sendMessage(String content) {
    if (_activeRoomId == null || _socket == null) return;
    String cleanContent = content.trim();
    if (cleanContent.isEmpty) return;

    _socket!.emit('send_message', {
      'roomId': _activeRoomId,
      'content': cleanContent,
      'type': 'text',
    });
  }
}
