import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import '../config.dart';
import '../main.dart';
import '../models/task_defs.dart';
import '../services/task_completion_service.dart';
import '../services/task_file_uploader.dart';
import '../theme.dart';
import '../widgets/completion_dialog.dart';
import '../widgets/expense_dialog.dart';
import '../widgets/incomplete_dialog.dart';
import '../widgets/qalat_ui.dart';

const _receiptLabels = {
  'check': 'صك',
  'bill_of_exchange': 'كمبيالة',
  'trust': 'وصل أمانة',
  'contract': 'عقد',
  'other': 'أخرى',
};

class TaskDetailScreen extends StatefulWidget {
  const TaskDetailScreen({super.key, required this.taskId});
  final String taskId;

  @override
  State<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends State<TaskDetailScreen> {
  Map<String, dynamic>? _task;
  TaskDefinitionBundle? _bundle;
  List<Map<String, dynamic>> _attachments = [];
  bool _hasExpenses = false;
  bool _loading = true;
  bool _busy = false;
  String? _error;
  final _rejectReason = TextEditingController();
  final _lawyerNotes = TextEditingController();

  late final TaskCompletionService _defs;

  @override
  void initState() {
    super.initState();
    _defs = TaskCompletionService(Supabase.instance.client);
    _load();
  }

  @override
  void dispose() {
    _rejectReason.dispose();
    _lawyerNotes.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final t = await context.read<AppState>().tasks.getOne(widget.taskId);
      if (t == null) {
        setState(() => _task = null);
        return;
      }
      final bundle = await _defs.loadDefinitionBundle(t);
      final atts = await _defs.listAttachments(widget.taskId);
      final hasExp = await _defs.hasPendingExpenses(widget.taskId);
      _lawyerNotes.text = t['lawyer_notes']?.toString() ?? '';
      setState(() {
        _task = t;
        _bundle = bundle;
        _attachments = atts;
        _hasExpenses = hasExp;
      });
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _assign(String action) async {
    setState(() => _busy = true);
    try {
      final body = <String, dynamic>{'taskId': widget.taskId, 'action': action};
      if (action == 'reject') {
        if (_rejectReason.text.trim().isEmpty) throw Exception('سبب الرفض مطلوب');
        body['reason'] = _rejectReason.text.trim();
      }
      await context.read<AppState>().api.postJson('/lawyer/task-assignment', body);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(action == 'accept' ? 'تم قبول التكليف' : 'تم رفض التكليف'),
            backgroundColor: QalatTheme.teal,
          ),
        );
      }
      await _load();
    } catch (e) {
      _snack(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _saveNotes() async {
    setState(() => _busy = true);
    try {
      final client = Supabase.instance.client;
      final status = _task?['task_status']?.toString();
      await client.from('tasks').update({
        'lawyer_notes': _lawyerNotes.text.trim().isEmpty ? null : _lawyerNotes.text.trim(),
        if (status == 'assigned') 'task_status': 'in_progress',
      }).eq('id', widget.taskId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم حفظ الملاحظات'), backgroundColor: QalatTheme.teal),
        );
      }
      await _load();
    } catch (e) {
      _snack(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _uploadAttachment() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (file == null) return;
    setState(() => _busy = true);
    try {
      final bytes = await file.readAsBytes();
      await context.read<AppState>().api.uploadFile(
            taskId: widget.taskId,
            bytes: bytes,
            filename: file.name,
            contentType: 'image/jpeg',
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم رفع الملف'), backgroundColor: QalatTheme.teal),
        );
      }
      await _load();
    } catch (e) {
      _snack(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Web flow: expenses modal (if defs) → completion modal → submit.
  Future<void> _startCompleteFlow() async {
    final t = _task;
    final bundle = _bundle;
    if (t == null || bundle == null) return;

    setState(() => _busy = true);
    try {
      List<PendingExpense> pending = [];
      if (bundle.expenses.isNotEmpty) {
        setState(() => _busy = false);
        final rows = await showExpenseDialog(
          context: context,
          taskLabel: bundle.label ?? t['task_type']?.toString() ?? 'مهمة',
          expenseDefs: bundle.expenses,
        );
        if (rows == null) return;
        pending = rows;
        if (!mounted) return;
        setState(() => _busy = true);
      }

      final team = await _defs.loadTeamOptions(t['branch_id']?.toString());
      if (!mounted) return;
      setState(() => _busy = false);

      final existing = <String, String>{};
      final cd = t['completion_data'];
      if (cd is Map) {
        for (final e in cd.entries) {
          if (e.value is String) existing[e.key.toString()] = e.value as String;
        }
      }

      final result = await showCompletionDialog(
        context: context,
        taskLabel: bundle.label ?? t['task_type']?.toString() ?? 'مهمة',
        reqFields: bundle.fields,
        teamOptions: team,
        initialValues: existing,
      );
      if (result == null) return;

      setState(() => _busy = true);

      // Upload required field files first
      for (final e in result.files.entries) {
        await context.read<AppState>().api.uploadFile(
              taskId: widget.taskId,
              bytes: e.value.bytes,
              filename: e.value.name,
              contentType: e.value.contentType,
            );
      }

      final completionData = <String, String>{...result.values};
      for (final e in result.files.entries) {
        completionData[e.key] = e.value.name;
      }
      if (result.generalNotes.isNotEmpty) {
        completionData['general_notes'] = result.generalNotes;
      }

      await context.read<AppState>().api.postJson('/lawyer/complete-task', {
        'taskId': widget.taskId,
        'debtorId': t['debtor_id'],
        'caseId': t['case_id'],
        'branchId': t['branch_id'],
        'completionData': completionData,
        'notes': completionData['note'] ?? result.generalNotes,
        if (pending.isNotEmpty) 'expenses': pending.map((e) => e.toJson()).toList(),
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('أُرسل الإنجاز للاعتماد'), backgroundColor: QalatTheme.teal),
        );
        Navigator.pop(context);
      }
    } catch (e) {
      _snack(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Web IncompleteWithoutCompletionModal — reason only, no required fields.
  Future<void> _startIncompleteFlow() async {
    final t = _task;
    final bundle = _bundle;
    if (t == null) return;
    final label = bundle?.label ?? t['task_type']?.toString() ?? 'مهمة';
    final reason = await showIncompleteDialog(context: context, taskLabel: label);
    if (reason == null || reason.trim().isEmpty) return;
    if (!mounted) return;

    setState(() => _busy = true);
    try {
      final api = context.read<AppState>().api;
      await api.postJson('/lawyer/incomplete-task', {
        'taskId': widget.taskId,
        'reason': reason.trim(),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('أُرسل طلب بدون إنجاز للمراجعة'),
          backgroundColor: Color(0xFFD97706),
        ),
      );
      Navigator.pop(context);
    } catch (e) {
      _snack(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _registerExpensesImmediate() async {
    final t = _task;
    final bundle = _bundle;
    if (t == null || bundle == null || bundle.expenses.isEmpty) return;
    final rows = await showExpenseDialog(
      context: context,
      taskLabel: bundle.label ?? 'مهمة',
      expenseDefs: bundle.expenses,
    );
    if (rows == null) return;
    setState(() => _busy = true);
    try {
      await context.read<AppState>().api.postJson('/lawyer/persist-task-expenses', {
        'taskId': widget.taskId,
        'debtorId': t['debtor_id'],
        'caseId': t['case_id'],
        'branchId': t['branch_id'],
        'rows': rows.map((e) => e.toJson()).toList(),
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم حفظ الصرفيات'), backgroundColor: QalatTheme.teal),
        );
      }
      await _load();
    } catch (e) {
      _snack(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _snack(Object e) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
    );
  }

  String? _debtorCourt(Map? debtor, Map<String, dynamic> task) {
    final override = debtor?['court_name']?.toString().trim();
    if (override != null && override.isNotEmpty) return override;
    final bl = debtor?['branch_list'];
    if (bl is Map) {
      final c = bl['court_name']?.toString().trim();
      if (c != null && c.isNotEmpty) return c;
    }
    if (bl is List && bl.isNotEmpty && bl.first is Map) {
      final c = (bl.first as Map)['court_name']?.toString().trim();
      if (c != null && c.isNotEmpty) return c;
    }
    final tc = task['court_name']?.toString().trim();
    if (tc != null && tc.isNotEmpty) return tc;
    return null;
  }

  String? _debtorListName(Map? debtor) {
    final bl = _branchList(debtor);
    return bl?['name']?.toString();
  }

  Map? _branchList(Map? debtor) {
    final bl = debtor?['branch_list'];
    if (bl is Map) return bl;
    if (bl is List && bl.isNotEmpty && bl.first is Map) {
      return bl.first as Map;
    }
    return null;
  }

  String? _executionOffice(Map? debtor) {
    final v = _branchList(debtor)?['execution_office']?.toString().trim();
    if (v != null && v.isNotEmpty) return v;
    return null;
  }

  String? _fmtMoney(dynamic raw) {
    if (raw == null) return null;
    final n = raw is num ? raw.toDouble() : double.tryParse(raw.toString());
    if (n == null) return null;
    if (n % 1 == 0) return n.toStringAsFixed(0);
    return n.toStringAsFixed(2);
  }

  bool _canSubmitStatus(String status) {
    return const {
      'assigned',
      'in_progress',
      'new',
      'rejected',
      'needs_info',
      'needs_revision',
    }.contains(status);
  }

  Map<String, dynamic>? _primaryDebtorFile(List atts) {
    Map<String, dynamic>? pdf;
    Map<String, dynamic>? any;
    for (final raw in atts) {
      final a = Map<String, dynamic>.from(raw as Map);
      final path = a['file_path']?.toString();
      if (path == null || path.isEmpty) continue;
      any ??= a;
      final mime = a['mime_type']?.toString() ?? '';
      if (mime.contains('pdf') || path.toLowerCase().endsWith('.pdf')) {
        pdf = a;
        break;
      }
    }
    return pdf ?? any;
  }

  Future<void> _openDebtorFile(Map<String, dynamic> att) async {
    final url = AppConfig.storedFileUrl('debtor-files', att['file_path']?.toString());
    if (url.isEmpty) {
      _snack(Exception('رابط الملف غير متاح'));
      return;
    }
    final uri = Uri.parse(url);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok) _snack(Exception('تعذر فتح الرابط في المتصفح'));
  }

  Future<void> _openTaskAttachment(Map<String, dynamic> att) async {
    final path = att['file_path']?.toString() ?? att['storage_path']?.toString();
    if (path == null || path.isEmpty) {
      _snack(Exception('رابط المرفق غير متاح'));
      return;
    }
    String? url;
    try {
      url = await TaskFileUploader().signedUrl(path);
    } catch (_) {}
    url ??= AppConfig.storedFileUrl('task-files', path);
    if (url.isEmpty) {
      _snack(Exception('رابط المرفق غير متاح'));
      return;
    }
    final uri = Uri.parse(url);
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok) _snack(Exception('تعذر فتح الرابط في المتصفح'));
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        backgroundColor: QalatTheme.bg,
        body: Center(child: CircularProgressIndicator(color: QalatTheme.teal)),
      );
    }
    if (_task == null) {
      return Scaffold(
        backgroundColor: QalatTheme.bg,
        appBar: const QalatAppBar(title: 'مهمة', showBrand: false),
        body: Center(child: Text(_error ?? 'المهمة غير موجودة')),
      );
    }

    final t = _task!;
    final debtor = t['debtors'] as Map?;
    final def = t['task_definitions'] as Map?;
    final status = t['task_status'] as String? ?? '';
    final pending = status == 'assignment_pending_acceptance';
    final canSubmit = _canSubmitStatus(status);
    final isSubmitted = status == 'submitted' || status == 'pending_review';
    final isApproved = status == 'approved' || status == 'completed';
    final isRejected = status == 'rejected' || status == 'needs_info' || status == 'needs_revision';
    final title = '${_bundle?.label ?? def?['label'] ?? t['task_type'] ?? 'مهمة'}';
    final canAddExpensesAfterSubmit =
        isSubmitted && !_hasExpenses && (_bundle?.expenses.isNotEmpty ?? false);
    final court = _debtorCourt(debtor, t);
    final listName = _debtorListName(debtor);
    final execution = _executionOffice(debtor);
    final receiptAmount = _fmtMoney(debtor?['receipt_amount']);
    final receiptType = debtor?['receipt_type']?.toString();
    final receiptLabel = receiptType == null
        ? null
        : (_receiptLabels[receiptType] ?? receiptType);
    final debtorAtts = (t['debtor_attachments'] as List?) ?? const [];
    final primaryFile = _primaryDebtorFile(debtorAtts);
    final reqFields = _bundle?.fields ?? const <ReqField>[];
    final requiredFields = reqFields.where((f) => f.isRequired).toList();
    final optionalFields = reqFields.where((f) => !f.isRequired).toList();
    final incompletePending = isSubmitted && isIncompleteCompletionRequest(t);

    return Scaffold(
      backgroundColor: QalatTheme.bg,
      appBar: QalatAppBar(title: title, showBrand: false),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
        children: [
          // TOP: مبلغ الوصل + المحكمة + التنفيذ
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: Colors.black.withValues(alpha: 0.05)),
            ),
            child: Column(
              children: [
                _KvRow(label: 'مبلغ الوصل', value: receiptAmount != null ? '$receiptAmount د.ع' : '—'),
                _KvRow(label: 'المحكمة', value: court ?? '—'),
                _KvRow(label: 'التنفيذ', value: execution ?? '—', last: true),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // Task required fields (read-only checklist, matches LawyerTaskRequirements)
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: QalatTheme.teal.withValues(alpha: 0.2)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                  decoration: BoxDecoration(
                    color: QalatTheme.teal.withValues(alpha: 0.08),
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'اسم المهمة',
                        style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: QalatTheme.teal),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        title,
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: Color(0xFF1D6365)),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (requiredFields.isNotEmpty) ...[
                        const Text(
                          'المطلوبات الإلزامية',
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: QalatTheme.ink),
                        ),
                        const SizedBox(height: 8),
                        ...requiredFields.map(
                          (f) => Padding(
                            padding: const EdgeInsets.only(bottom: 6),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('•  ', style: TextStyle(color: QalatTheme.teal, fontWeight: FontWeight.w900)),
                                Expanded(child: Text(f.label, style: const TextStyle(fontSize: 13, color: QalatTheme.ink))),
                              ],
                            ),
                          ),
                        ),
                      ] else
                        const Text(
                          'لا توجد حقول إلزامية محددة لهذه المهمة.',
                          style: TextStyle(fontSize: 13, color: QalatTheme.muted),
                        ),
                      if (optionalFields.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        const Text(
                          'حقول اختيارية',
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: QalatTheme.muted),
                        ),
                        const SizedBox(height: 6),
                        ...optionalFields.map(
                          (f) => Padding(
                            padding: const EdgeInsets.only(bottom: 4),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('○  ', style: TextStyle(color: QalatTheme.muted)),
                                Expanded(
                                  child: Text(f.label, style: const TextStyle(fontSize: 12, color: QalatTheme.muted)),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // Debtor data — dedicated section below
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: Colors.black.withValues(alpha: 0.04)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'بيانات المدين',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12, color: QalatTheme.muted),
                ),
                const SizedBox(height: 8),
                Text(
                  debtor?['full_name']?.toString() ?? '—',
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: QalatTheme.ink),
                ),
                const SizedBox(height: 10),
                StatusChip(status: status),
                const SizedBox(height: 12),
                if (debtor?['phone'] != null)
                  _InfoRow(icon: Icons.phone_outlined, text: '${debtor!['phone']}'),
                if (receiptLabel != null)
                  _InfoRow(icon: Icons.description_outlined, text: 'نوع السند: $receiptLabel'),
                if (listName != null && listName.isNotEmpty)
                  _InfoRow(icon: Icons.list_alt, text: 'القائمة: $listName'),
                if (debtor?['address'] != null)
                  _InfoRow(icon: Icons.home_outlined, text: '${debtor!['address']}'),
                if (debtor?['governorate'] != null)
                  _InfoRow(icon: Icons.place_outlined, text: '${debtor!['governorate']}'),
                if (debtor?['receipt_number'] != null)
                  _InfoRow(icon: Icons.tag, text: 'رقم الوصل: ${debtor!['receipt_number']}'),
                if (t['due_date'] != null)
                  _InfoRow(icon: Icons.event, text: 'الاستحقاق: ${t['due_date']}'),
                if (t['admin_notes'] != null) ...[
                  const SizedBox(height: 8),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: QalatTheme.teal.withValues(alpha: 0.06),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: QalatTheme.teal.withValues(alpha: 0.2)),
                    ),
                    child: Text(
                      'ملاحظات الإدارة: ${t['admin_notes']}',
                      style: const TextStyle(fontSize: 12, color: QalatTheme.ink, height: 1.4),
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                if (primaryFile != null)
                  OutlinedButton.icon(
                    onPressed: () => _openDebtorFile(primaryFile),
                    icon: const Icon(Icons.open_in_browser),
                    label: const Text('فتح ملف المدين في المتصفح', style: TextStyle(fontWeight: FontWeight.w800)),
                  )
                else
                  const Text(
                    'لا يوجد ملف مدين مرفق',
                    style: TextStyle(fontSize: 12, color: QalatTheme.muted),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          if (isSubmitted)
            _Banner(
              color: incompletePending ? const Color(0xFFFFFBEB) : const Color(0xFFF3E8FF),
              border: incompletePending ? const Color(0xFFFDE68A) : const Color(0xFFE9D5FF),
              textColor: incompletePending ? const Color(0xFF92400E) : const Color(0xFF6B21A8),
              text: incompletePending
                  ? '⏳ طلب إرسال بدون إنجاز بانتظار قرار الإدارة'
                  : '⏳ المهمة بانتظار اعتماد الإدارة',
            ),
          if (canAddExpensesAfterSubmit) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFF0F9FF),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFBAE6FD)),
              ),
              child: Column(
                children: [
                  const Text(
                    'لم تُسجّل صرفيات هذه المهمة بعد',
                    style: TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF0C4A6E)),
                  ),
                  const SizedBox(height: 10),
                  FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: const Color(0xFF0284C7)),
                    onPressed: _busy ? null : _registerExpensesImmediate,
                    child: const Text('تسجيل صرفيات المهمة'),
                  ),
                ],
              ),
            ),
          ],
          if (isApproved)
            const _Banner(
              color: Color(0xFFF0FDF4),
              border: Color(0xFFBBF7D0),
              textColor: Color(0xFF166534),
              text: '✓ تمت الموافقة على المهمة',
            ),
          if (isRejected)
            _Banner(
              color: const Color(0xFFFEF2F2),
              border: const Color(0xFFFECACA),
              textColor: const Color(0xFF991B1B),
              text: t['admin_notes'] != null
                  ? '✗ تم رفض الطلب\n${t['admin_notes']}'
                  : '✗ تم رفض الطلب — يرجى المراجعة وإعادة الإرسال',
            ),

          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: Colors.black.withValues(alpha: 0.05)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Text('مرفقات المهمة', style: TextStyle(fontWeight: FontWeight.w800, color: QalatTheme.ink)),
                    ),
                    if (canSubmit || pending)
                      TextButton(
                        onPressed: _busy ? null : _uploadAttachment,
                        child: const Text('+ رفع ملف', style: TextStyle(fontWeight: FontWeight.w800, color: QalatTheme.teal)),
                      ),
                  ],
                ),
                if (_attachments.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Text('لا توجد مرفقات بعد', textAlign: TextAlign.center, style: TextStyle(color: QalatTheme.muted, fontSize: 12)),
                  )
                else
                  ..._attachments.map((a) => ListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        title: Text(a['file_name']?.toString() ?? 'ملف', style: const TextStyle(fontSize: 13)),
                        trailing: IconButton(
                          icon: const Icon(Icons.open_in_new, size: 18, color: QalatTheme.teal),
                          onPressed: () => _openTaskAttachment(a),
                        ),
                      )),
              ],
            ),
          ),

          if (!isApproved) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: Colors.black.withValues(alpha: 0.05)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('ملاحظاتي', style: TextStyle(fontWeight: FontWeight.w800, color: QalatTheme.ink)),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _lawyerNotes,
                    maxLines: 3,
                    decoration: const InputDecoration(hintText: 'أضف ملاحظاتك هنا...'),
                  ),
                  const SizedBox(height: 10),
                  FilledButton(
                    onPressed: _busy ? null : _saveNotes,
                    child: const Text('حفظ الملاحظات', style: TextStyle(fontWeight: FontWeight.w800)),
                  ),
                ],
              ),
            ),
          ],

          if (pending) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _rejectReason,
              decoration: const InputDecoration(labelText: 'سبب الرفض (عند الرفض)'),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    onPressed: _busy ? null : () => _assign('accept'),
                    child: const Text('قبول التكليف'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(
                    onPressed: _busy ? null : () => _assign('reject'),
                    child: const Text('رفض'),
                  ),
                ),
              ],
            ),
          ],

          if (canSubmit) ...[
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : _startCompleteFlow,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Text(
                  _busy ? 'جارٍ التحقق...' : 'تم الإنجاز — إرسال للاعتماد',
                  style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15),
                ),
              ),
            ),
            const SizedBox(height: 10),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFD97706),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              onPressed: _busy ? null : _startIncompleteFlow,
              child: const Text(
                'إرسال بدون إنجاز',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14),
              ),
            ),
          ],

          if (_busy)
            const Padding(
              padding: EdgeInsets.only(top: 16),
              child: Center(child: CircularProgressIndicator(color: QalatTheme.teal)),
            ),
        ],
      ),
    );
  }
}

class _KvRow extends StatelessWidget {
  const _KvRow({required this.label, required this.value, this.last = false});
  final String label;
  final String value;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        border: last
            ? null
            : const Border(bottom: BorderSide(color: Color(0xFFF1F5F9))),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 96,
            child: Text(label, style: const TextStyle(fontSize: 13, color: QalatTheme.muted)),
          ),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.left,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: QalatTheme.ink),
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          Icon(icon, size: 16, color: QalatTheme.teal),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: const TextStyle(color: QalatTheme.muted, fontSize: 13))),
        ],
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({
    required this.color,
    required this.border,
    required this.textColor,
    required this.text,
  });
  final Color color;
  final Color border;
  final Color textColor;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: border),
      ),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: TextStyle(fontWeight: FontWeight.w800, color: textColor, fontSize: 13),
      ),
    );
  }
}
