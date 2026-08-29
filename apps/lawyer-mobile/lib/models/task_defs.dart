class ReqField {
  ReqField({
    required this.id,
    required this.fieldKey,
    required this.fieldType,
    this.fieldLabel,
    required this.isRequired,
    required this.sortOrder,
  });

  final String id;
  final String fieldKey;
  final String fieldType;
  final String? fieldLabel;
  final bool isRequired;
  final int sortOrder;

  factory ReqField.fromJson(Map<String, dynamic> j) => ReqField(
        id: j['id']?.toString() ?? '',
        fieldKey: j['field_key']?.toString() ?? '',
        fieldType: j['field_type']?.toString() ?? 'text',
        fieldLabel: j['field_label']?.toString(),
        isRequired: j['is_required'] == true,
        sortOrder: (j['sort_order'] as num?)?.toInt() ?? 0,
      );

  String get label {
    if (fieldLabel != null && fieldLabel!.trim().isNotEmpty) return fieldLabel!;
    return defaultLabel(fieldType);
  }

  static String defaultLabel(String type) {
    const map = {
      'note': 'ملاحظة',
      'image': 'صورة',
      'pdf': 'ملف PDF',
      'decision_number': 'رقم القرار',
      'case_number': 'رقم الدعوى',
      'date': 'تاريخ المرافعة',
      'gps': 'موقع GPS',
      'receipt': 'وصل الصرف',
      'legal_result': 'النتيجة القانونية',
      'court_decision': 'قرار المحكمة',
      'team': 'الفريق',
      'court_name': 'اسم المحكمة',
      'text': 'نص',
      'number': 'رقم',
    };
    return map[type] ?? type;
  }
}

class ExpenseDef {
  ExpenseDef({
    required this.id,
    required this.taskDefinitionId,
    required this.name,
    required this.maxAmount,
    required this.sortOrder,
  });

  final String id;
  final String taskDefinitionId;
  final String name;
  final double maxAmount;
  final int sortOrder;

  factory ExpenseDef.fromJson(Map<String, dynamic> j) => ExpenseDef(
        id: j['id']?.toString() ?? '',
        taskDefinitionId: j['task_definition_id']?.toString() ?? '',
        name: j['name']?.toString() ?? '',
        maxAmount: (j['max_amount'] as num?)?.toDouble() ?? 0,
        sortOrder: (j['sort_order'] as num?)?.toInt() ?? 0,
      );
}

class PendingExpense {
  PendingExpense({
    required this.defId,
    required this.name,
    required this.maxAmount,
    required this.amount,
    required this.note,
  });

  final String defId;
  final String name;
  final double maxAmount;
  final double amount;
  final String note;

  Map<String, dynamic> toJson() => {
        'defId': defId,
        'name': name,
        'max_amount': maxAmount,
        'amount': amount,
        'note': note,
        'task_definition_expense_id': defId.startsWith('catalog:') ? null : defId,
      };
}

class ExpenseRowInput {
  ExpenseRowInput({this.amount = '', this.note = ''});
  String amount;
  String note;
}

String? validateExpenseRows(List<ExpenseDef> defs, List<ExpenseRowInput> rows) {
  for (var i = 0; i < defs.length; i++) {
    final def = defs[i];
    if (i >= rows.length) return 'بيانات ناقصة: ${def.name}';
    final row = rows[i];
    final raw = row.amount.trim().replaceAll(',', '');
    if (raw.isEmpty) {
      return 'يجب إدخال المبلغ لـ «${def.name}» — اكتب 0 إذا لم تصرف';
    }
    if (!RegExp(r'^\d+$').hasMatch(raw)) {
      return 'المبلغ غير صالح لـ «${def.name}» — أدخل رقماً فقط';
    }
    final amt = double.tryParse(raw) ?? -1;
    if (amt < 0) return 'المبلغ لا يمكن أن يكون سالباً — ${def.name}';
    if (amt > def.maxAmount) {
      return 'لا يمكن تجاوز الحد الأعلى ${def.maxAmount.toStringAsFixed(0)} د.ع — ${def.name}';
    }
    if (amt > 0 && row.note.trim().isEmpty) {
      return 'يجب إدخال ملاحظة لـ «${def.name}» عند وجود مبلغ';
    }
  }
  return null;
}

List<PendingExpense> pendingFromDefs(List<ExpenseDef> defs, List<ExpenseRowInput> rows) {
  return List.generate(defs.length, (i) {
    final raw = rows[i].amount.trim().replaceAll(',', '');
    return PendingExpense(
      defId: defs[i].id,
      name: defs[i].name,
      maxAmount: defs[i].maxAmount,
      amount: double.tryParse(raw) ?? 0,
      note: rows[i].note,
    );
  });
}

String? validateCompletionFields(
  List<ReqField> fields,
  Map<String, String> values,
  Set<String> fileKeys,
) {
  for (final f in fields) {
    if (!f.isRequired) continue;
    final label = f.label;
    if (['image', 'pdf', 'receipt'].contains(f.fieldType)) {
      if (!fileKeys.contains(f.fieldKey)) return 'يجب رفع: $label';
    } else if (f.fieldType == 'gps') {
      if ((values[f.fieldKey] ?? '').isEmpty) return 'يجب تحديد موقع GPS';
    } else if ((values[f.fieldKey] ?? '').trim().isEmpty) {
      return 'يجب إدخال: $label';
    }
  }
  return null;
}
