import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/task_defs.dart';
import '../theme.dart';

/// Matches web TaskCompletionExpenseModal.
Future<List<PendingExpense>?> showExpenseDialog({
  required BuildContext context,
  required String taskLabel,
  required List<ExpenseDef> expenseDefs,
}) {
  return showDialog<List<PendingExpense>>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => _ExpenseDialog(taskLabel: taskLabel, expenseDefs: expenseDefs),
  );
}

class _ExpenseDialog extends StatefulWidget {
  const _ExpenseDialog({required this.taskLabel, required this.expenseDefs});
  final String taskLabel;
  final List<ExpenseDef> expenseDefs;

  @override
  State<_ExpenseDialog> createState() => _ExpenseDialogState();
}

class _ExpenseDialogState extends State<_ExpenseDialog> {
  late final List<ExpenseRowInput> _rows;
  String? _error;

  @override
  void initState() {
    super.initState();
    _rows = List.generate(widget.expenseDefs.length, (_) => ExpenseRowInput());
  }

  void _confirm() {
    final err = validateExpenseRows(widget.expenseDefs, _rows);
    if (err != null) {
      setState(() => _error = err);
      return;
    }
    Navigator.of(context).pop(pendingFromDefs(widget.expenseDefs, _rows));
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480, maxHeight: 720),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 16, 10, 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'صرفيات المهمة',
                          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: QalatTheme.ink),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          widget.taskLabel,
                          style: const TextStyle(fontWeight: FontWeight.w800, color: QalatTheme.teal, fontSize: 13),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 10),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFFFBEB),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: const Color(0xFFFDE68A)),
                          ),
                          child: const Text(
                            'جميع البنود إلزامية — إذا لم تصرف على أي بند، اكتب 0\n'
                            'تُخصم المبالغ أكبر من 0 من محفظة الصرفيات عند اعتماد الإنجاز فقط',
                            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFF92400E), height: 1.4),
                          ),
                        ),
                      ],
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
            Flexible(
              child: ListView.builder(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                shrinkWrap: true,
                itemCount: widget.expenseDefs.length,
                itemBuilder: (_, i) {
                  final def = widget.expenseDefs[i];
                  final raw = _rows[i].amount.trim().replaceAll(',', '');
                  final amt = raw.isEmpty ? null : double.tryParse(raw);
                  final noteRequired = amt != null && amt > 0;
                  return Container(
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF0F9FF),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFBAE6FD)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text.rich(
                          TextSpan(
                            text: def.name,
                            style: const TextStyle(fontWeight: FontWeight.w800, color: QalatTheme.ink),
                            children: const [
                              TextSpan(text: ' *', style: TextStyle(color: Color(0xFFDC2626))),
                            ],
                          ),
                        ),
                        const SizedBox(height: 8),
                        TextField(
                          keyboardType: TextInputType.number,
                          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                          decoration: const InputDecoration(
                            labelText: 'المبلغ الفعلي (د.ع) *',
                            hintText: '0',
                          ),
                          textDirection: TextDirection.ltr,
                          onChanged: (v) => setState(() {
                            _rows[i].amount = v;
                            _error = null;
                          }),
                        ),
                        const SizedBox(height: 8),
                        TextField(
                          maxLines: 2,
                          decoration: InputDecoration(
                            labelText: noteRequired ? 'ملاحظة *' : 'ملاحظة',
                            hintText: noteRequired ? 'تفاصيل الصرفية...' : 'اختياري عند المبلغ 0',
                          ),
                          onChanged: (v) => setState(() {
                            _rows[i].note = v;
                            _error = null;
                          }),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF2F2),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFFECACA)),
                  ),
                  child: Text(_error!, style: const TextStyle(color: Color(0xFFB91C1C), fontWeight: FontWeight.w800, fontSize: 12)),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFF0284C7)),
                  onPressed: _confirm,
                  child: const Text('تم', style: TextStyle(fontWeight: FontWeight.w900)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
