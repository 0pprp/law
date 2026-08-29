import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../theme.dart';
import '../widgets/qalat_ui.dart';
import 'task_detail_screen.dart';

class TasksScreen extends StatefulWidget {
  const TasksScreen({super.key});

  @override
  State<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends State<TasksScreen> {
  String? _filter;
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true;
  String? _error;

  static const filters = <String?, String>{
    null: 'الكل',
    'assignment_pending_acceptance': 'بانتظار القبول',
    'assigned': 'مكلفة',
    'in_progress': 'قيد التنفيذ',
    'pending_review': 'مراجعة',
    'submitted': 'بانتظار الاعتماد',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final list = await context.read<AppState>().tasks.listMine(status: _filter);
      setState(() => _rows = list);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: QalatTheme.bg,
      appBar: const QalatAppBar(title: 'مهامي'),
      body: Column(
        children: [
          SizedBox(
            height: 52,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              children: filters.entries.map((e) {
                final selected = _filter == e.key;
                return Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: FilterChip(
                    selected: selected,
                    label: Text(e.value),
                    selectedColor: QalatTheme.teal.withValues(alpha: 0.15),
                    checkmarkColor: QalatTheme.teal,
                    labelStyle: TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 12,
                      color: selected ? QalatTheme.teal : QalatTheme.muted,
                    ),
                    side: BorderSide(
                      color: selected
                          ? QalatTheme.teal.withValues(alpha: 0.35)
                          : Colors.black.withValues(alpha: 0.08),
                    ),
                    backgroundColor: Colors.white,
                    onSelected: (_) {
                      setState(() => _filter = e.key);
                      _load();
                    },
                  ),
                );
              }).toList(),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              color: QalatTheme.teal,
              onRefresh: _load,
              child: _loading
                  ? ListView(children: const [
                      SizedBox(height: 120),
                      Center(child: CircularProgressIndicator(color: QalatTheme.teal)),
                    ])
                  : _error != null
                      ? ListView(
                          children: [
                            Padding(
                              padding: const EdgeInsets.all(16),
                              child: Text(_error!, style: const TextStyle(color: Color(0xFFDC2626))),
                            ),
                          ],
                        )
                      : _rows.isEmpty
                          ? ListView(children: const [
                              SizedBox(height: 80),
                              Center(child: Text('لا مهام', style: TextStyle(color: QalatTheme.muted))),
                            ])
                          : ListView.builder(
                              padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                              itemCount: _rows.length,
                              itemBuilder: (_, i) {
                                final t = _rows[i];
                                final debtor = t['debtors'] as Map?;
                                final def = t['task_definitions'] as Map?;
                                final status = t['task_status']?.toString() ?? '';
                                return Padding(
                                  padding: const EdgeInsets.only(bottom: 10),
                                  child: TaskListCard(
                                    title: '${def?['label'] ?? t['task_type'] ?? 'مهمة'}',
                                    subtitle: '${debtor?['full_name'] ?? '—'}'
                                        '${debtor?['governorate'] != null ? ' · ${debtor!['governorate']}' : ''}',
                                    status: status,
                                    onTap: () async {
                                      await Navigator.of(context).push(
                                        MaterialPageRoute(
                                          builder: (_) => TaskDetailScreen(taskId: t['id'] as String),
                                        ),
                                      );
                                      _load();
                                    },
                                  ),
                                );
                              },
                            ),
            ),
          ),
        ],
      ),
    );
  }
}
