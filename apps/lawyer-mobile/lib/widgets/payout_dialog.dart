import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme.dart';

class PayoutDialogResult {
  PayoutDialogResult({required this.title, required this.amount, this.notes});
  final String title;
  final double amount;
  final String? notes;
}

/// Payout request as a modal (not an embedded page section).
Future<PayoutDialogResult?> showPayoutDialog({
  required BuildContext context,
  required double availableBalance,
  String walletKind = 'fees',
}) {
  return showDialog<PayoutDialogResult>(
    context: context,
    builder: (ctx) => _PayoutDialog(
      availableBalance: availableBalance,
      walletKind: walletKind,
    ),
  );
}

class _PayoutDialog extends StatefulWidget {
  const _PayoutDialog({required this.availableBalance, required this.walletKind});
  final double availableBalance;
  final String walletKind;

  @override
  State<_PayoutDialog> createState() => _PayoutDialogState();
}

class _PayoutDialogState extends State<_PayoutDialog> {
  final _title = TextEditingController();
  final _amount = TextEditingController();
  final _notes = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _title.dispose();
    _amount.dispose();
    _notes.dispose();
    super.dispose();
  }

  void _submit() {
    final title = _title.text.trim();
    final raw = _amount.text.trim().replaceAll(',', '');
    final amt = double.tryParse(raw);
    if (title.isEmpty) {
      setState(() => _error = 'أدخل اسم الطلب');
      return;
    }
    if (amt == null || amt <= 0) {
      setState(() => _error = 'أدخل مبلغاً صحيحاً');
      return;
    }
    if (amt > widget.availableBalance) {
      setState(() => _error = 'المبلغ يتجاوز الرصيد المتاح (${widget.availableBalance.toStringAsFixed(0)})');
      return;
    }
    Navigator.pop(
      context,
      PayoutDialogResult(
        title: title,
        amount: amt,
        notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isFees = widget.walletKind != 'savings';
    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    isFees ? 'طلب صرف أتعاب' : 'طلب سحب صرفيات',
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: QalatTheme.ink),
                  ),
                ),
                IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
              ],
            ),
            Text(
              'الرصيد المتاح: ${widget.availableBalance.toStringAsFixed(0)} د.ع',
              style: const TextStyle(color: QalatTheme.teal, fontWeight: FontWeight.w800, fontSize: 12),
              textDirection: TextDirection.ltr,
              textAlign: TextAlign.right,
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _title,
              decoration: const InputDecoration(labelText: 'اسم الطلب *', hintText: 'مثال: صرف أتعاب شهر...'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _amount,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              textDirection: TextDirection.ltr,
              decoration: const InputDecoration(labelText: 'المبلغ (د.ع) *'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _notes,
              decoration: const InputDecoration(labelText: 'ملاحظات (اختياري)'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(_error!, style: const TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.w700, fontSize: 12)),
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: widget.availableBalance <= 0 ? null : _submit,
              child: const Text('إرسال الطلب للإدارة', style: TextStyle(fontWeight: FontWeight.w900)),
            ),
          ],
        ),
      ),
    );
  }
}
