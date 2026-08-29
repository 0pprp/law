import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/task_defs.dart';

class TaskDefinitionBundle {
  TaskDefinitionBundle({
    required this.definitionId,
    required this.label,
    required this.feeAmount,
    required this.fields,
    required this.expenses,
  });

  final String? definitionId;
  final String? label;
  final double feeAmount;
  final List<ReqField> fields;
  final List<ExpenseDef> expenses;
}

class TaskCompletionService {
  TaskCompletionService(this.client);
  final SupabaseClient client;

  Future<TaskDefinitionBundle> loadDefinitionBundle(Map<String, dynamic> task) async {
    final defId = task['task_definition_id']?.toString();
    final branchId = task['branch_id']?.toString();
    final taskType = task['task_type']?.toString();
    final defEmbed = task['task_definitions'];
    String? label;
    double fee = (task['reward_amount'] as num?)?.toDouble() ?? 0;

    if (defEmbed is Map) {
      label = defEmbed['label']?.toString();
      fee = (defEmbed['fee_amount'] as num?)?.toDouble() ?? fee;
    }

    Map<String, dynamic>? defRow;
    if (defId != null && defId.isNotEmpty) {
      defRow = await _fetchDefinition(defId);
    }
    if (defRow == null && taskType != null && taskType.isNotEmpty) {
      defRow = await _findDefinitionByType(taskType, branchId);
    }

    if (defRow == null) {
      return TaskDefinitionBundle(
        definitionId: defId,
        label: label,
        feeAmount: fee,
        fields: const [],
        expenses: const [],
      );
    }

    final fields = ((defRow['task_required_fields'] as List?) ?? [])
        .map((e) => ReqField.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList()
      ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

    final expenses = ((defRow['task_definition_expenses'] as List?) ?? [])
        .map((e) => ExpenseDef.fromJson(Map<String, dynamic>.from(e as Map)))
        .where((e) => e.maxAmount > 0)
        .toList()
      ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

    return TaskDefinitionBundle(
      definitionId: defRow['id']?.toString() ?? defId,
      label: defRow['label']?.toString() ?? label,
      feeAmount: (defRow['fee_amount'] as num?)?.toDouble() ?? fee,
      fields: fields,
      expenses: expenses,
    );
  }

  Future<Map<String, dynamic>?> _fetchDefinition(String id) async {
    try {
      final row = await client
          .from('task_definitions')
          .select(
            'id, label, fee_amount, task_type, '
            'task_required_fields(id, field_key, field_type, field_label, is_required, sort_order), '
            'task_definition_expenses(id, task_definition_id, name, max_amount, sort_order)',
          )
          .eq('id', id)
          .maybeSingle();
      return row == null ? null : Map<String, dynamic>.from(row);
    } catch (_) {
      return null;
    }
  }

  Future<Map<String, dynamic>?> _findDefinitionByType(String taskType, String? branchId) async {
    try {
      if (branchId != null) {
        final row = await client
            .from('task_definitions')
            .select(
              'id, label, fee_amount, task_type, '
              'task_required_fields(id, field_key, field_type, field_label, is_required, sort_order), '
              'task_definition_expenses(id, task_definition_id, name, max_amount, sort_order)',
            )
            .eq('task_type', taskType)
            .eq('is_active', true)
            .eq('branch_id', branchId)
            .limit(1)
            .maybeSingle();
        if (row != null) return Map<String, dynamic>.from(row);
      }
      final row = await client
          .from('task_definitions')
          .select(
            'id, label, fee_amount, task_type, '
            'task_required_fields(id, field_key, field_type, field_label, is_required, sort_order), '
            'task_definition_expenses(id, task_definition_id, name, max_amount, sort_order)',
          )
          .eq('task_type', taskType)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
      return row == null ? null : Map<String, dynamic>.from(row);
    } catch (_) {
      return null;
    }
  }

  Future<List<String>> loadTeamOptions(String? branchId) async {
    if (branchId == null || branchId.isEmpty) return [];
    final names = <String>{};
    try {
      final depts = await client
          .from('execution_departments')
          .select('name')
          .eq('branch_id', branchId)
          .eq('is_active', true)
          .order('name');
      for (final r in (depts as List)) {
        final n = (r as Map)['name']?.toString();
        if (n != null && n.isNotEmpty) names.add(n);
      }
    } catch (_) {}
    try {
      final courts = await client
          .from('courts')
          .select('name')
          .eq('branch_id', branchId)
          .eq('is_active', true)
          .order('name');
      for (final r in (courts as List)) {
        final n = (r as Map)['name']?.toString();
        if (n != null && n.isNotEmpty) names.add(n);
      }
    } catch (_) {}
    final list = names.toList()..sort();
    return list;
  }

  Future<List<Map<String, dynamic>>> listAttachments(String taskId) async {
    try {
      final rows = await client
          .from('task_attachments')
          .select('id, file_name, file_path, mime_type, description, created_at')
          .eq('task_id', taskId)
          .order('created_at', ascending: false);
      return (rows as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      try {
        final rows = await client
            .from('task_attachments')
            .select('id, file_name, storage_path, content_type, created_at')
            .eq('task_id', taskId)
            .order('created_at', ascending: false);
        return (rows as List).map((e) {
          final m = Map<String, dynamic>.from(e as Map);
          m['file_path'] = m['storage_path'];
          return m;
        }).toList();
      } catch (_) {
        return [];
      }
    }
  }

  Future<bool> hasPendingExpenses(String taskId) async {
    try {
      final rows = await client
          .from('expenses')
          .select('id')
          .eq('task_id', taskId)
          .limit(1);
      return (rows as List).isNotEmpty;
    } catch (_) {
      return false;
    }
  }
}

/// Matches web `lib/incomplete-completion.ts`
const incompleteRequestFlag = 'incomplete_without_completion';
const incompleteReasonKey = 'incomplete_reason';

Map<String, String> buildIncompleteCompletionData(String reason) => {
      incompleteRequestFlag: '1',
      incompleteReasonKey: reason.trim(),
    };

bool isIncompleteCompletionRequest(Map<String, dynamic>? task) {
  if (task == null) return false;
  if (task['incomplete_request'] == true) return true;
  final data = task['completion_data'];
  if (data is! Map) return false;
  final flag = data[incompleteRequestFlag];
  return flag == true || flag == '1' || flag == 'true' || flag == 1;
}
