import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../theme.dart';

/// Bottom sheet: last 3 ops + "عرض المزيد" for full list.
Future<void> showWalletActivitySheet({
  required BuildContext context,
  required String title,
  required List<Map<String, dynamic>> transactions,
  String Function(Map<String, dynamic> tx)? formatAmount,
  String Function(Map<String, dynamic> tx)? formatSubtitle,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (ctx) => _WalletActivitySheet(
      title: title,
      transactions: transactions,
      formatAmount: formatAmount ?? _defaultAmount,
      formatSubtitle: formatSubtitle ?? _defaultSubtitle,
    ),
  );
}

String _defaultAmount(Map<String, dynamic> tx) {
  final amt = (tx['amount'] as num?)?.toDouble() ?? 0;
  final sign = amt > 0 ? '+' : '';
  final s = amt % 1 == 0 ? amt.toStringAsFixed(0) : amt.toStringAsFixed(2);
  return '$sign$s';
}

String _defaultSubtitle(Map<String, dynamic> tx) {
  final type = tx['type']?.toString() ?? '';
  final notes = tx['notes']?.toString();
  final typeAr = switch (type) {
    'deposit' => 'إيداع',
    'withdrawal' => 'سحب',
    'credit' => 'إضافة',
    'debit' => 'خصم',
    'lawsuit_deduction' => 'خصم دعوى',
    'fee' => 'أتعاب',
    'payout' => 'صرف',
    _ => type.isEmpty ? 'عملية' : type,
  };
  if (notes != null && notes.isNotEmpty) return '$typeAr · $notes';
  return typeAr;
}

class _WalletActivitySheet extends StatefulWidget {
  const _WalletActivitySheet({
    required this.title,
    required this.transactions,
    required this.formatAmount,
    required this.formatSubtitle,
  });

  final String title;
  final List<Map<String, dynamic>> transactions;
  final String Function(Map<String, dynamic>) formatAmount;
  final String Function(Map<String, dynamic>) formatSubtitle;

  @override
  State<_WalletActivitySheet> createState() => _WalletActivitySheetState();
}

class _WalletActivitySheetState extends State<_WalletActivitySheet> {
  bool _showAll = false;

  @override
  Widget build(BuildContext context) {
    final list = _showAll ? widget.transactions : widget.transactions.take(3).toList();
    final df = DateFormat('yyyy/MM/dd HH:mm');

    return DraggableScrollableSheet(
      initialChildSize: 0.55,
      minChildSize: 0.35,
      maxChildSize: 0.92,
      expand: false,
      builder: (context, scrollCtrl) {
        return Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
          ),
          child: Column(
            children: [
              const SizedBox(height: 10),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.black12,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 14, 20, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        widget.title,
                        style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 17,
                          color: QalatTheme.ink,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: list.isEmpty
                    ? const Center(
                        child: Text('لا توجد عمليات', style: TextStyle(color: QalatTheme.muted)),
                      )
                    : ListView.separated(
                        controller: scrollCtrl,
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                        itemCount: list.length + (!_showAll && widget.transactions.length > 3 ? 1 : 0),
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (context, i) {
                          if (!_showAll && widget.transactions.length > 3 && i == list.length) {
                            return TextButton(
                              onPressed: () => setState(() => _showAll = true),
                              child: const Text(
                                'عرض المزيد',
                                style: TextStyle(fontWeight: FontWeight.w800, color: QalatTheme.teal),
                              ),
                            );
                          }
                          final tx = list[i];
                          final created = tx['created_at']?.toString();
                          DateTime? dt;
                          if (created != null) dt = DateTime.tryParse(created)?.toLocal();
                          final amt = (tx['amount'] as num?)?.toDouble() ?? 0;
                          final color = amt >= 0 ? QalatTheme.teal : const Color(0xFFDC2626);
                          return ListTile(
                            contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
                            title: Text(
                              widget.formatSubtitle(tx),
                              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                            ),
                            subtitle: dt != null
                                ? Text(df.format(dt), style: const TextStyle(fontSize: 11, color: QalatTheme.muted))
                                : null,
                            trailing: Text(
                              widget.formatAmount(tx),
                              style: TextStyle(fontWeight: FontWeight.w900, color: color, fontSize: 15),
                            ),
                          );
                        },
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}
