import 'dart:convert';
import 'package:flutter/material.dart';
import 'api_client.dart';

class OrderProvider with ChangeNotifier {
  final ApiClient _apiClient = ApiClient();
  
  List<dynamic> _escrows = [];
  bool _isLoading = false;

  List<dynamic> get escrows => _escrows;
  bool get isLoading => _isLoading;

  Future<void> fetchEscrows() async {
    _isLoading = true;
    notifyListeners();

    try {
      final res = await _apiClient.getRequest('/payments/escrows');
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        _escrows = data['data'] ?? [];
      }
    } catch (e) {
      debugPrint('Error fetching escrows: $e');
    }
    
    _isLoading = false;
    notifyListeners();
  }
}
