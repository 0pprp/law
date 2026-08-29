import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config.dart';
import 'auth_service.dart';
import 'task_file_uploader.dart';

class ApiClient {
  ApiClient(this.auth);
  final AuthService auth;

  bool get _hasApi => AppConfig.apiBaseUrl.trim().isNotEmpty;

  Uri _u(String path) {
    final base = AppConfig.apiBaseUrl.replaceAll(RegExp(r'/$'), '');
    return Uri.parse('$base$path');
  }

  Map<String, String> _headers({bool json = true}) {
    final h = <String, String>{'Accept': 'application/json'};
    if (json) h['Content-Type'] = 'application/json';
    final t = auth.accessToken;
    if (t != null) h['Authorization'] = 'Bearer $t';
    return h;
  }

  Future<Map<String, dynamic>> getJson(String path) async {
    if (!_hasApi && path == '/lawyer/wallet') {
      return WalletService(Supabase.instance.client).fetchWallet();
    }
    if (!_hasApi) {
      throw Exception('واجهة API غير مُعدّة — هذه العملية تحتاج السيرفر');
    }
    final res = await http.get(_u(path), headers: _headers());
    return _decode(res);
  }

  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body) async {
    if (!_hasApi && path == '/lawyer/task-assignment') {
      await _assignViaSupabase(body);
      return {'success': true};
    }
    if (!_hasApi && path == '/lawyer/complete-task') {
      await _completeViaSupabase(body);
      return {'success': true};
    }
    if (!_hasApi && path == '/lawyer/incomplete-task') {
      await _incompleteViaSupabase(body);
      return {'success': true};
    }
    if (!_hasApi && path == '/lawyer/payout-request') {
      await _payoutViaSupabase(body);
      return {'success': true};
    }
    if (!_hasApi && path == '/lawyer/persist-task-expenses') {
      await _persistExpensesViaSupabase(body);
      return {'ok': true};
    }
    if (!_hasApi) {
      throw Exception('واجهة API غير مُعدّة — هذه العملية تحتاج السيرفر');
    }
    final res = await http.post(
      _u(path),
      headers: _headers(),
      body: jsonEncode(body),
    );
    return _decode(res);
  }

  Future<void> _assignViaSupabase(Map<String, dynamic> body) async {
    final client = Supabase.instance.client;
    final uid = client.auth.currentUser!.id;
    final taskId = body['taskId'] as String;
    final action = body['action'] as String;
    final task = await client
        .from('tasks')
        .select('id, assigned_to, task_status')
        .eq('id', taskId)
        .maybeSingle();
    if (task == null || task['assigned_to'] != uid) {
      throw Exception('المهمة غير موجودة أو غير مكلفة لك');
    }
    if (task['task_status'] != 'assignment_pending_acceptance') {
      throw Exception('لا يوجد طلب تكليف بانتظار الرد');
    }
    if (action == 'accept') {
      await client.from('tasks').update({
        'task_status': 'assigned',
        'accepted_at': DateTime.now().toUtc().toIso8601String(),
        'acceptance_method': 'manual',
      }).eq('id', taskId).eq('task_status', 'assignment_pending_acceptance');
      return;
    }
    if (action == 'reject') {
      final reason = (body['reason'] as String?)?.trim() ?? '';
      if (reason.isEmpty) throw Exception('سبب الرفض مطلوب');
      try {
        await client.from('tasks').update({
          'task_status': 'waiting_assignment',
          'assigned_to': null,
          'assigned_at': null,
          'assignment_expires_at': null,
          'acceptance_method': null,
          'given_up_at': DateTime.now().toUtc().toIso8601String(),
          'give_up_reason': reason,
          'assignment_rejected_by': uid,
        }).eq('id', taskId).eq('task_status', 'assignment_pending_acceptance');
      } catch (_) {
        await client.from('tasks').update({
          'task_status': 'waiting_assignment',
          'assigned_to': null,
          'assigned_at': null,
          'assignment_expires_at': null,
          'acceptance_method': null,
          'given_up_at': DateTime.now().toUtc().toIso8601String(),
          'give_up_reason': reason,
        }).eq('id', taskId).eq('task_status', 'assignment_pending_acceptance');
      }
      return;
    }
    throw Exception('إجراء غير معروف');
  }

  Future<void> _completeViaSupabase(Map<String, dynamic> body) async {
    final client = Supabase.instance.client;
    final uid = client.auth.currentUser!.id;
    final taskId = body['taskId'] as String;
    final task = await client
        .from('tasks')
        .select('id, assigned_to, debtor_id, lawyer_notes')
        .eq('id', taskId)
        .maybeSingle();
    if (task == null || task['assigned_to'] != uid) {
      throw Exception('المهمة غير متاحة');
    }

    final completionData = <String, dynamic>{};
    final rawCompletion = body['completionData'] ?? body['fieldValues'];
    if (rawCompletion is Map) {
      completionData.addAll(Map<String, dynamic>.from(rawCompletion));
    }

    final notes = body['notes']?.toString().trim();
    final lawyerNotes = (completionData['note'] ?? notes)?.toString().trim();
    final legalResult = completionData['legal_result']?.toString().trim();

    final baseUpdate = <String, dynamic>{
      'completion_data': completionData.isEmpty ? null : completionData,
      'completed_at': DateTime.now().toUtc().toIso8601String(),
      'lawyer_notes': (lawyerNotes != null && lawyerNotes.isNotEmpty)
          ? lawyerNotes
          : task['lawyer_notes'],
    };
    if (legalResult != null && legalResult.isNotEmpty) {
      baseUpdate['legal_result'] = legalResult;
    }

    // Match web: try submitted then pending_review
    Object? lastErr;
    for (final status in ['submitted', 'pending_review']) {
      try {
        await client.from('tasks').update({
          ...baseUpdate,
          'task_status': status,
        }).eq('id', taskId);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr != null) throw Exception(lastErr.toString());

    // Persist draft expenses with completion (same as web expenseStepDone)
    final expenseRows = body['expenses'];
    if (expenseRows is List && expenseRows.isNotEmpty) {
      await _persistExpensesViaSupabase({
        'taskId': taskId,
        'debtorId': body['debtorId'] ?? task['debtor_id'],
        'caseId': body['caseId'],
        'branchId': body['branchId'],
        'rows': expenseRows,
      });
    }

    // GPS from completion_data "lat, lng" → debtor
    final gpsRaw = completionData.values
        .whereType<String>()
        .firstWhere(
          (v) => RegExp(r'^-?\d+\.\d+\s*,\s*-?\d+\.\d+$').hasMatch(v.trim()),
          orElse: () => '',
        );
    final debtorId = (body['debtorId'] ?? task['debtor_id'])?.toString();
    if (debtorId != null && gpsRaw.isNotEmpty) {
      final parts = gpsRaw.split(',');
      final lat = double.tryParse(parts[0].trim());
      final lng = double.tryParse(parts[1].trim());
      if (lat != null && lng != null) {
        try {
          await client.from('debtors').update({
            'latitude': lat,
            'longitude': lng,
            'location_captured_at': DateTime.now().toUtc().toIso8601String(),
          }).eq('id', debtorId);
        } catch (_) {}
      }
    } else {
      final lat = body['latitude'];
      final lng = body['longitude'];
      if (debtorId != null && lat != null && lng != null) {
        try {
          await client.from('debtors').update({
            'latitude': lat,
            'longitude': lng,
            'location_captured_at': DateTime.now().toUtc().toIso8601String(),
          }).eq('id', debtorId);
        } catch (_) {}
      }
    }
  }

  /// Matches web IncompleteWithoutCompletionModal / buildIncompleteCompletionData.
  Future<void> _incompleteViaSupabase(Map<String, dynamic> body) async {
    final client = Supabase.instance.client;
    final uid = client.auth.currentUser!.id;
    final taskId = body['taskId'] as String;
    final reason = (body['reason'] as String?)?.trim() ?? '';
    if (reason.isEmpty) throw Exception('يجب إدخال السبب');

    final task = await client
        .from('tasks')
        .select('id, assigned_to, task_status')
        .eq('id', taskId)
        .maybeSingle();
    if (task == null || task['assigned_to'] != uid) {
      throw Exception('المهمة غير متاحة');
    }

    final completionData = <String, String>{
      'incomplete_without_completion': '1',
      'incomplete_reason': reason,
    };

    final baseWithCols = <String, dynamic>{
      'lawyer_notes': reason,
      'completion_data': completionData,
      'completed_at': DateTime.now().toUtc().toIso8601String(),
      'incomplete_request': true,
      'incomplete_reason': reason,
    };
    final baseFallback = <String, dynamic>{
      'lawyer_notes': reason,
      'completion_data': completionData,
      'completed_at': DateTime.now().toUtc().toIso8601String(),
    };

    // Web order for incomplete: pending_review then submitted
    Object? lastErr;
    for (final status in ['pending_review', 'submitted']) {
      try {
        await client.from('tasks').update({
          ...baseWithCols,
          'task_status': status,
        }).eq('id', taskId);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        final msg = e.toString();
        if (RegExp(r'incomplete_request|incomplete_reason', caseSensitive: false).hasMatch(msg)) {
          try {
            await client.from('tasks').update({
              ...baseFallback,
              'task_status': status,
            }).eq('id', taskId);
            lastErr = null;
            break;
          } catch (e2) {
            lastErr = e2;
          }
        }
      }
    }
    if (lastErr != null) throw Exception(lastErr.toString());
  }

  Future<void> _payoutViaSupabase(Map<String, dynamic> body) async {
    final client = Supabase.instance.client;
    final uid = client.auth.currentUser!.id;
    final profile = await client
        .from('profiles')
        .select('branch_id')
        .eq('id', uid)
        .maybeSingle();
    final amount = (body['amount'] as num?)?.toDouble() ?? 0;
    if (amount <= 0) throw Exception('المبلغ غير صالح');
    await client.from('lawyer_payout_requests').insert({
      'lawyer_id': uid,
      'branch_id': profile?['branch_id'],
      'title': (body['title'] as String?)?.trim().isNotEmpty == true
          ? body['title']
          : 'طلب سحب',
      'amount': amount,
      'notes': body['notes'],
      'wallet_kind': body['walletKind'] == 'savings' ? 'savings' : 'fees',
      'status': 'pending',
    });
  }

  Future<void> _persistExpensesViaSupabase(Map<String, dynamic> body) async {
    final client = Supabase.instance.client;
    final uid = client.auth.currentUser!.id;
    final taskId = body['taskId'];
    final rows = (body['rows'] as List?) ?? [];
    if (taskId == null) throw Exception('معرّف المهمة مطلوب');

    // Clear previous pending expenses (same as web)
    try {
      await client
          .from('expenses')
          .delete()
          .eq('task_id', taskId)
          .inFilter('status', ['pending_review', 'pending_approval', 'pending'])
          .filter('wallet_deducted_at', 'is', null);
    } catch (_) {
      try {
        await client
            .from('expenses')
            .delete()
            .eq('task_id', taskId)
            .eq('status', 'pending');
      } catch (_) {}
    }

    final today = DateTime.now().toIso8601String().split('T').first;
    final inserts = <Map<String, dynamic>>[];
    for (final raw in rows) {
      final r = Map<String, dynamic>.from(raw as Map);
      final amount = (r['amount'] as num?)?.toDouble() ?? 0;
      final name = (r['name'] as String?)?.trim() ?? '';
      if (name.isEmpty) continue;
      // Web inserts ALL rows including amount 0
      final note = (r['note'] as String?)?.trim();
      final defId = (r['task_definition_expense_id'] ?? r['defId'])?.toString();
      inserts.add({
        'task_id': taskId,
        'debtor_id': body['debtorId'],
        'case_id': body['caseId'],
        'branch_id': body['branchId'],
        'created_by': uid,
        'lawyer_id': uid,
        'expense_type': name,
        'amount': amount,
        'description': (note == null || note.isEmpty) ? null : note,
        'status': 'pending_review',
        'expense_date': today,
        'max_allowed_amount': r['max_amount'],
        if (defId != null && !defId.startsWith('catalog:'))
          'task_definition_expense_id': defId,
      });
    }
    if (inserts.isEmpty) return;

    try {
      await client.from('expenses').insert(inserts);
    } catch (_) {
      // Fallback without lawyer_id / max / status enum
      for (final row in inserts) {
        final fallback = Map<String, dynamic>.from(row)
          ..remove('lawyer_id')
          ..remove('max_allowed_amount')
          ..remove('task_definition_expense_id');
        fallback['status'] = 'pending';
        await client.from('expenses').insert(fallback);
      }
    }
  }

  Future<Map<String, dynamic>> uploadFile({
    required String taskId,
    required List<int> bytes,
    required String filename,
    String? contentType,
    String? description,
  }) async {
    if (!_hasApi) {
      return TaskFileUploader().upload(
        taskId: taskId,
        bytes: bytes,
        filename: filename,
        contentType: contentType,
        description: description,
      );
    }

    final data = bytes is Uint8List ? bytes : Uint8List.fromList(bytes);
    var safeName = filename.trim().isEmpty ? 'upload.jpg' : filename.trim();
    var mime = contentType ?? 'image/jpeg';
    if (!safeName.contains('.')) safeName = '$safeName.jpg';

    final req = http.MultipartRequest('POST', _u('/lawyer/upload-task-file'));
    final t = auth.accessToken;
    if (t != null) req.headers['Authorization'] = 'Bearer $t';
    req.fields['taskId'] = taskId;
    req.files.add(http.MultipartFile.fromBytes(
      'file',
      data,
      filename: safeName,
      contentType: MediaType.parse(mime),
    ));
    final streamed = await req.send();
    final res = await http.Response.fromStream(streamed);
    return _decode(res);
  }

  Map<String, dynamic> _decode(http.Response res) {
    final raw = utf8.decode(res.bodyBytes);
    if (!(raw.trimLeft().startsWith('{') || raw.trimLeft().startsWith('['))) {
      throw Exception('استجابة غير صالحة من السيرفر');
    }
    final map = jsonDecode(raw) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      throw Exception(map['error']?.toString() ?? 'خطأ ${res.statusCode}');
    }
    return map;
  }
}

class WalletService {
  WalletService(this.client);
  final SupabaseClient client;

  Future<Map<String, dynamic>> fetchWallet() async {
    final uid = client.auth.currentUser!.id;
    double fees = 0;
    double savings = 0;
    final feeTxs = <Map<String, dynamic>>[];
    final savingsTxs = <Map<String, dynamic>>[];

    try {
      final balRows = await client
          .from('lawyer_wallet_transactions')
          .select('amount, wallet')
          .eq('lawyer_id', uid)
          .limit(5000);
      for (final r in (balRows as List)) {
        final row = Map<String, dynamic>.from(r as Map);
        final amt = (row['amount'] as num?)?.toDouble() ?? 0;
        final wallet = (row['wallet'] as String?) ?? 'fees';
        if (wallet == 'savings' || wallet == 'disbursement') {
          savings += amt;
        } else {
          fees += amt;
        }
      }
    } catch (_) {
      try {
        final balRows = await client
            .from('lawyer_wallet_transactions')
            .select('amount')
            .eq('lawyer_id', uid)
            .limit(5000);
        for (final r in (balRows as List)) {
          fees += ((r as Map)['amount'] as num?)?.toDouble() ?? 0;
        }
      } catch (_) {}
    }

    try {
      final rows = await client
          .from('lawyer_wallet_transactions')
          .select('id, amount, type, wallet, notes, created_at, reference_id')
          .eq('lawyer_id', uid)
          .order('created_at', ascending: false)
          .limit(100);
      for (final r in (rows as List)) {
        final row = Map<String, dynamic>.from(r as Map);
        final wallet = (row['wallet'] as String?) ?? 'fees';
        if (wallet == 'savings' || wallet == 'disbursement') {
          savingsTxs.add(row);
        } else {
          feeTxs.add(row);
        }
      }
    } catch (_) {
      try {
        final rows = await client
            .from('lawyer_wallet_transactions')
            .select('id, amount, type, notes, created_at, reference_id')
            .eq('lawyer_id', uid)
            .order('created_at', ascending: false)
            .limit(100);
        for (final r in (rows as List)) {
          feeTxs.add(Map<String, dynamic>.from(r as Map));
        }
      } catch (_) {}
    }

    Map<String, dynamic>? stationery;
    final stationeryTxs = <Map<String, dynamic>>[];
    try {
      final bal = await client
          .from('lawyer_stationery_wallets')
          .select('stamps_balance')
          .eq('lawyer_id', uid)
          .maybeSingle();
      stationery = {
        'stamps': (bal?['stamps_balance'] as num?)?.toDouble() ?? 0,
      };
      final txs = await client
          .from('lawyer_stationery_transactions')
          .select('id, item, amount, type, notes, created_at, reference_id')
          .eq('lawyer_id', uid)
          .order('created_at', ascending: false)
          .limit(100);
      for (final r in (txs as List)) {
        stationeryTxs.add(Map<String, dynamic>.from(r as Map));
      }
    } catch (_) {
      stationery = {'stamps': 0};
    }

    return {
      'balances': {'fees': fees, 'savings': savings},
      'feeTxs': feeTxs,
      'savingsTxs': savingsTxs,
      'stationery': stationery,
      'stationeryTxs': stationeryTxs,
    };
  }
}

class TasksService {
  TasksService(this.client);
  final SupabaseClient client;

  static const _debtorEmbed =
      'debtors!tasks_debtor_id_fkey('
      'full_name, phone, governorate, address, receipt_number, receipt_type, '
      'receipt_amount, remaining_amount, case_type, court_name, latitude, longitude, '
      'location_captured_at, branch_list_id, '
      'branch_list:branch_lists(name, court_name, execution_office)'
      ')';

  Future<List<Map<String, dynamic>>> listMine({String? status}) async {
    final uid = client.auth.currentUser!.id;
    final rows = await client
        .from('tasks')
        .select(
          'id, task_type, task_status, due_date, created_at, assigned_at, reward_amount, '
          'branch_id, debtor_id, court_name, governorate, $_debtorEmbed, task_definitions(label)',
        )
        .eq('assigned_to', uid)
        .order('created_at', ascending: false)
        .limit(100);
    var list = (rows as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    if (status != null && status.isNotEmpty) {
      list = list.where((e) => e['task_status'] == status).toList();
    }
    return list;
  }

  Future<Map<String, dynamic>?> getOne(String id) async {
    Map<String, dynamic>? map;
    try {
      final row = await client
          .from('tasks')
          .select(
            '*, $_debtorEmbed, task_definitions(label, fee_amount)',
          )
          .eq('id', id)
          .maybeSingle();
      if (row != null) map = Map<String, dynamic>.from(row);
    } catch (_) {
      // Fallback without nested branch_lists
      final row = await client
          .from('tasks')
          .select(
            '*, debtors!tasks_debtor_id_fkey(full_name, phone, governorate, address, '
            'receipt_number, receipt_type, receipt_amount, remaining_amount, case_type, '
            'court_name, latitude, longitude, location_captured_at), '
            'task_definitions(label, fee_amount)',
          )
          .eq('id', id)
          .maybeSingle();
      if (row != null) map = Map<String, dynamic>.from(row);
    }
    if (map == null) return null;

    final debtorId = map['debtor_id']?.toString();
    if (debtorId != null) {
      try {
        final atts = await client
            .from('debtor_attachments')
            .select('id, file_name, file_path, mime_type, created_at')
            .eq('debtor_id', debtorId)
            .order('created_at', ascending: false)
            .limit(20);
        map['debtor_attachments'] =
            (atts as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      } catch (_) {
        map['debtor_attachments'] = <Map<String, dynamic>>[];
      }
    }
    return map;
  }

  Future<Map<String, int>> counts() async {
    final list = await listMine();
    int pending = 0, assigned = 0, review = 0;
    for (final t in list) {
      final s = t['task_status'] as String? ?? '';
      if (s == 'assignment_pending_acceptance') pending++;
      if (s == 'assigned' || s == 'in_progress') assigned++;
      if (s == 'pending_review' || s == 'submitted') review++;
    }
    return {
      'pending_accept': pending,
      'active': assigned,
      'in_review': review,
      'total': list.length,
    };
  }
}
