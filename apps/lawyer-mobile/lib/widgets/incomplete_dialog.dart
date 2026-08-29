import 'package:flutter/material.dart';
import '../theme.dart';

/// Matches web IncompleteWithoutCompletionModal — reason only.
Future<String?> showIncompleteDialog({
  required BuildContext context,
  required String taskLabel,
}) {
  return showDialog<String>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => _IncompleteDialog(taskLabel: taskLabel),
  );
}

class _IncompleteDialog extends StatefulWidget {
  const _IncompleteDialog({required this.taskLabel});
  final String taskLabel;

  @override
  State<_IncompleteDialog> createState() => _IncompleteDialogState();
}

class _IncompleteDialogState extends State<_IncompleteDialog> {
  final _reason = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _submit() {
    final trimmed = _reason.text.trim();
    if (trimmed.isEmpty) {
      setState(() => _error = 'يجب إدخال السبب');
      return;
    }
    Navigator.of(context).pop(trimmed);
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
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
                        Text(
                          'إرسال بدون إنجاز: ${widget.taskLabel}',
                          style: const TextStyle(
                            fontWeight: FontWeight.w900,
                            fontSize: 16,
                            color: QalatTheme.ink,
                          ),
                        ),
                        const SizedBox(height: 6),
                        const Text(
                          'سيُراجع الطلب في تبويب «غير منجزة» — لن تُحسب أتعاب ولن يُعتبر إنجازاً',
                          style: TextStyle(fontSize: 11, color: QalatTheme.muted, height: 1.35),
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
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text.rich(
                    TextSpan(
                      text: 'السبب',
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: QalatTheme.ink),
                      children: [
                        TextSpan(text: ' *', style: TextStyle(color: Color(0xFFDC2626))),
                      ],
                    ),
                  ),
                  const SizedBox(height: 6),
                  TextField(
                    controller: _reason,
                    maxLines: 4,
                    autofocus: true,
                    decoration: const InputDecoration(
                      hintText: 'اكتب سبب الإرسال بدون إنجاز...',
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEF2F2),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFFECACA)),
                      ),
                      child: Text(
                        _error!,
                        style: const TextStyle(
                          color: Color(0xFFB91C1C),
                          fontWeight: FontWeight.w800,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFFD97706),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                onPressed: _submit,
                child: const Text(
                  'إرسال بدون إنجاز',
                  style: TextStyle(fontWeight: FontWeight.w900),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
