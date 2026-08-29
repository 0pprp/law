import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import '../models/task_defs.dart';
import '../theme.dart';

class CompletionResult {
  CompletionResult({
    required this.values,
    required this.files,
    required this.generalNotes,
  });

  final Map<String, String> values;
  final Map<String, ({Uint8List bytes, String name, String contentType})> files;
  final String generalNotes;
}

/// Matches web LawyerTaskCompletionModal.
Future<CompletionResult?> showCompletionDialog({
  required BuildContext context,
  required String taskLabel,
  required List<ReqField> reqFields,
  required List<String> teamOptions,
  Map<String, String>? initialValues,
}) {
  return showDialog<CompletionResult>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => _CompletionDialog(
      taskLabel: taskLabel,
      reqFields: reqFields,
      teamOptions: teamOptions,
      initialValues: initialValues ?? const {},
    ),
  );
}

class _CompletionDialog extends StatefulWidget {
  const _CompletionDialog({
    required this.taskLabel,
    required this.reqFields,
    required this.teamOptions,
    required this.initialValues,
  });

  final String taskLabel;
  final List<ReqField> reqFields;
  final List<String> teamOptions;
  final Map<String, String> initialValues;

  @override
  State<_CompletionDialog> createState() => _CompletionDialogState();
}

class _CompletionDialogState extends State<_CompletionDialog> {
  late final Map<String, TextEditingController> _ctrls;
  late final TextEditingController _generalNotes;
  final Map<String, ({Uint8List bytes, String name, String contentType})> _files = {};
  final Map<String, String> _gps = {};
  String? _error;
  bool _gpsLoading = false;
  String? _gpsLoadingKey;

  @override
  void initState() {
    super.initState();
    _ctrls = {
      for (final f in widget.reqFields)
        if (!['image', 'pdf', 'receipt', 'gps'].contains(f.fieldType))
          f.fieldKey: TextEditingController(text: widget.initialValues[f.fieldKey] ?? ''),
    };
    for (final e in widget.initialValues.entries) {
      if (e.key.startsWith('gps') || e.value.contains(',')) {
        // keep gps string if present
      }
      if (widget.reqFields.any((f) => f.fieldKey == e.key && f.fieldType == 'gps')) {
        _gps[e.key] = e.value;
      }
    }
    _generalNotes = TextEditingController();
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) {
      c.dispose();
    }
    _generalNotes.dispose();
    super.dispose();
  }

  Map<String, String> _collectValues() {
    final values = <String, String>{};
    for (final e in _ctrls.entries) {
      values[e.key] = e.value.text;
    }
    values.addAll(_gps);
    return values;
  }

  Future<void> _pickGps(String key) async {
    setState(() {
      _gpsLoading = true;
      _gpsLoadingKey = key;
      _error = null;
    });
    try {
      final perm = await Geolocator.requestPermission();
      if (perm != LocationPermission.always && perm != LocationPermission.whileInUse) {
        throw Exception('تم رفض إذن الموقع');
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      setState(() {
        _gps[key] = '${pos.latitude.toStringAsFixed(6)}, ${pos.longitude.toStringAsFixed(6)}';
      });
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) {
        setState(() {
          _gpsLoading = false;
          _gpsLoadingKey = null;
        });
      }
    }
  }

  Future<void> _pickFile(ReqField f) async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    setState(() {
      _files[f.fieldKey] = (
        bytes: bytes,
        name: file.name,
        contentType: 'image/jpeg',
      );
      _error = null;
    });
  }

  void _submit() {
    final values = _collectValues();
    final err = validateCompletionFields(widget.reqFields, values, _files.keys.toSet());
    if (err != null) {
      setState(() => _error = err);
      return;
    }
    Navigator.of(context).pop(CompletionResult(
      values: values,
      files: Map.from(_files),
      generalNotes: _generalNotes.text.trim(),
    ));
  }

  Widget _field(ReqField f) {
    final label = f.label;
    final req = f.isRequired;
    final labelW = Text.rich(
      TextSpan(
        text: label,
        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: QalatTheme.ink),
        children: [
          if (req) const TextSpan(text: ' *', style: TextStyle(color: Color(0xFFDC2626))),
        ],
      ),
    );

    switch (f.fieldType) {
      case 'note':
      case 'legal_result':
      case 'court_decision':
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            labelW,
            const SizedBox(height: 6),
            TextField(
              controller: _ctrls[f.fieldKey],
              maxLines: f.fieldType == 'legal_result' ? 2 : 3,
              decoration: InputDecoration(
                hintText: f.fieldType == 'legal_result'
                    ? 'النتيجة القانونية للمهمة...'
                    : f.fieldType == 'court_decision'
                        ? 'اكتب قرار المحكمة...'
                        : 'اكتب ملاحظاتك...',
              ),
            ),
          ],
        );
      case 'team':
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            labelW,
            const SizedBox(height: 6),
            DropdownButtonFormField<String>(
              initialValue: (_ctrls[f.fieldKey]?.text.isNotEmpty ?? false) ? _ctrls[f.fieldKey]!.text : '',
              decoration: const InputDecoration(hintText: '— اختر الفريق —'),
              items: [
                const DropdownMenuItem(value: '', child: Text('— اختر الفريق —')),
                ...widget.teamOptions.map((n) => DropdownMenuItem(value: n, child: Text(n))),
              ],
              onChanged: (v) => _ctrls[f.fieldKey]?.text = v ?? '',
            ),
          ],
        );
      case 'date':
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            labelW,
            const SizedBox(height: 6),
            TextField(
              controller: _ctrls[f.fieldKey],
              readOnly: true,
              decoration: const InputDecoration(
                hintText: 'YYYY-MM-DD',
                suffixIcon: Icon(Icons.calendar_today_outlined, size: 18),
              ),
              onTap: () async {
                final now = DateTime.now();
                final picked = await showDatePicker(
                  context: context,
                  initialDate: now,
                  firstDate: DateTime(now.year - 5),
                  lastDate: DateTime(now.year + 5),
                );
                if (picked != null) {
                  _ctrls[f.fieldKey]?.text =
                      '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
                  setState(() {});
                }
              },
            ),
          ],
        );
      case 'gps':
        final confirmed = (_gps[f.fieldKey] ?? '').isNotEmpty;
        final loading = _gpsLoading && _gpsLoadingKey == f.fieldKey;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            labelW,
            const SizedBox(height: 8),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: confirmed ? const Color(0xFF16A34A) : QalatTheme.teal,
              ),
              onPressed: loading ? null : () => _pickGps(f.fieldKey),
              child: Text(
                loading
                    ? 'جارٍ تحديد الموقع...'
                    : confirmed
                        ? '✓ تم التحديد — اضغط لتحديث الموقع'
                        : 'تحديد الموقع',
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
            if (confirmed)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  _gps[f.fieldKey]!,
                  textAlign: TextAlign.center,
                  textDirection: TextDirection.ltr,
                  style: const TextStyle(fontSize: 10, color: QalatTheme.muted, fontFamily: 'monospace'),
                ),
              ),
          ],
        );
      case 'image':
      case 'pdf':
      case 'receipt':
        final picked = _files[f.fieldKey];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            labelW,
            const SizedBox(height: 6),
            OutlinedButton.icon(
              onPressed: () => _pickFile(f),
              icon: const Icon(Icons.upload_file),
              label: Text(picked == null ? 'اختيار ملف' : '✓ ${picked.name}'),
            ),
          ],
        );
      case 'number':
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            labelW,
            const SizedBox(height: 6),
            TextField(
              controller: _ctrls[f.fieldKey],
              keyboardType: TextInputType.number,
              textDirection: TextDirection.ltr,
              decoration: const InputDecoration(hintText: '0'),
            ),
          ],
        );
      default:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            labelW,
            const SizedBox(height: 6),
            TextField(
              controller: _ctrls[f.fieldKey],
              textDirection: ['decision_number', 'case_number'].contains(f.fieldType)
                  ? TextDirection.ltr
                  : TextDirection.rtl,
              decoration: InputDecoration(hintText: 'أدخل $label...'),
            ),
          ],
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final sorted = [...widget.reqFields]..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    final requiredNames = sorted.where((f) => f.isRequired).map((f) => f.label).join(' — ');

    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480, maxHeight: 720),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 16, 10, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'تأكيد الإنجاز: ${widget.taskLabel}',
                      style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: QalatTheme.ink),
                    ),
                  ),
                  IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
                ],
              ),
            ),
            const Divider(height: 1),
            Flexible(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                shrinkWrap: true,
                children: [
                  const Text(
                    'ملاحظات عامة (اختياري)',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: QalatTheme.ink),
                  ),
                  const SizedBox(height: 6),
                  TextField(
                    controller: _generalNotes,
                    maxLines: 2,
                    decoration: const InputDecoration(hintText: 'أضف أي ملاحظات إضافية...'),
                  ),
                  if (requiredNames.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFFBEB),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFFDE68A)),
                      ),
                      child: Text(
                        'الحقول الإلزامية قبل الإرسال: $requiredNames',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF92400E)),
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  ...sorted.map((f) => Padding(
                        padding: const EdgeInsets.only(bottom: 14),
                        child: _field(f),
                      )),
                  if (_error != null)
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEF2F2),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFFECACA)),
                      ),
                      child: Text(_error!, style: const TextStyle(color: Color(0xFFB91C1C), fontWeight: FontWeight.w800, fontSize: 12)),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _submit,
                  child: const Text('إرسال للاعتماد', style: TextStyle(fontWeight: FontWeight.w900)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
