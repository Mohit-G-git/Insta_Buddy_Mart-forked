import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';
import '../services/order_provider.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Provider.of<OrderProvider>(context, listen: false).fetchEscrows();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<OrderProvider>(
      builder: (context, orderState, child) {
        final escrows = orderState.escrows;

        return SafeArea(
          child: CustomScrollView(
            slivers: [
              // Header
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'My Orders',
                        style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.06),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                        ),
                        child: Row(
                          children: [
                            Icon(Icons.filter_list_rounded, color: Colors.white.withValues(alpha: 0.6), size: 18),
                            const SizedBox(width: 6),
                            Text(
                              orderState.isLoading ? 'Loading...' : 'Filter',
                              style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 13),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // Summary Cards
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                  child: Row(
                    children: [
                      _summaryChip('All', escrows.length.toString(), true),
                      const SizedBox(width: 8),
                      // Filtering by escrow state natively from DB output
                      _summaryChip('Active', escrows.where((e) => e['status'] == 'locked').length.toString(), false),
                      const SizedBox(width: 8),
                      _summaryChip('Completed', escrows.where((e) => e['status'] == 'released').length.toString(), false),
                      const SizedBox(width: 8),
                      _summaryChip('Refunded', escrows.where((e) => e['status'] == 'refunded').length.toString(), false),
                    ],
                  ),
                ),
              ),

              // Order List
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
                sliver: escrows.isEmpty 
                  ? const SliverToBoxAdapter(child: Center(child: Text("No orders found", style: TextStyle(color: Colors.white70))))
                  : SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      final order = escrows[index];
                      // Map Escrow DB row to frontend UI
                      final id = order['payment_id'] ?? order['id'];
                      final amount = order['amount'] != null ? '₹${order['amount']}' : '₹0';
                      final statusRaw = order['status'] ?? 'unknown';
                      
                      String uiStatus = 'Processing';
                      Color statusColor = const Color(0xFFFDCB6E);

                      if (statusRaw == 'locked') {
                        uiStatus = 'Authorized';
                        statusColor = const Color(0xFF00CEC9);
                      } else if (statusRaw == 'released') {
                        uiStatus = 'Delivered';
                        statusColor = const Color(0xFF00B894);
                      } else if (statusRaw == 'refunded') {
                        uiStatus = 'Refunded';
                        statusColor = const Color(0xFFFF7675);
                      }

                      return GlassCard(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          children: [
                            Row(
                              children: [
                                Container(
                                  width: 48,
                                  height: 48,
                                  decoration: BoxDecoration(
                                    color: statusColor.withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(14),
                                  ),
                                  child: Icon(Icons.receipt_long_rounded, color: statusColor, size: 24),
                                ),
                                const SizedBox(width: 14),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'Order ID: $id',
                                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Colors.white),
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      const SizedBox(height: 3),
                                      Text(
                                        order['created_at'] != null ? order['created_at'].toString().split('T').first : 'Recent',
                                        style: TextStyle(fontSize: 12, color: Colors.white.withValues(alpha: 0.45)),
                                      ),
                                    ],
                                  ),
                                ),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Text(
                                      amount,
                                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
                                    ),
                                    const SizedBox(height: 4),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: statusColor.withValues(alpha: 0.15),
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                      child: Text(
                                        uiStatus,
                                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: statusColor),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),

                            if (statusRaw == 'locked') ...[
                              const SizedBox(height: 14),
                              _buildProgressBar(),
                            ],
                          ],
                        ),
                      );
                    },
                    childCount: escrows.length,
                  ),
                ),
              ),
            ],
          ),
        );
      }
    );
  }

  Widget _summaryChip(String label, String count, bool isActive) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: isActive ? AppTheme.primaryColor.withValues(alpha: 0.15) : Colors.white.withValues(alpha: 0.04),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isActive ? AppTheme.primaryColor.withValues(alpha: 0.3) : Colors.white.withValues(alpha: 0.06),
          ),
        ),
        child: Column(
          children: [
            Text(
              count,
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: isActive ? AppTheme.primaryColor : Colors.white),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(fontSize: 11, color: isActive ? AppTheme.primaryColor.withValues(alpha: 0.7) : Colors.white.withValues(alpha: 0.4)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProgressBar() {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Tracking', style: TextStyle(fontSize: 11, color: Colors.white.withValues(alpha: 0.4))),
            Text('Processing Payment', style: TextStyle(fontSize: 11, color: Colors.white.withValues(alpha: 0.4))),
          ],
        ),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: 0.25,
            backgroundColor: Colors.white.withValues(alpha: 0.08),
            valueColor: const AlwaysStoppedAnimation(AppTheme.secondaryColor),
            minHeight: 6,
          ),
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            _trackingStep('Ordered', true),
            _trackingStep('Escrow Locked', true),
            _trackingStep('In Transit', false),
            _trackingStep('Delivered', false),
          ],
        ),
      ],
    );
  }

  Widget _trackingStep(String label, bool completed) {
    return Column(
      children: [
        Icon(
          completed ? Icons.check_circle_rounded : Icons.radio_button_unchecked,
          size: 14,
          color: completed ? AppTheme.secondaryColor : Colors.white.withValues(alpha: 0.2),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: TextStyle(fontSize: 9, color: completed ? Colors.white.withValues(alpha: 0.6) : Colors.white.withValues(alpha: 0.25)),
        ),
      ],
    );
  }
}
