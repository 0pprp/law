import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../theme.dart';
import '../widgets/qalat_ui.dart';
import 'task_detail_screen.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  Map<String, int>? _counts;
  List<Map<String, dynamic>> _recent = [];
  String? _error;
  bool _loading = true;

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
      final tasks = context.read<AppState>().tasks;
      final counts = await tasks.counts();
      final list = await tasks.listMine();
      setState(() {
        _counts = counts;
        _recent = list.take(8).toList();
      });
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _initials(String? name) {
    if (name == null || name.trim().isEmpty) return 'م';
    final parts = name.trim().split(RegExp(r'\s+')).where((e) => e.isNotEmpty).take(2);
    return parts.map((e) => e[0]).join();
  }

  @override
  Widget build(BuildContext context) {
    final profile = context.watch<AppState>().auth.profile;
    final name = profile?.fullName ?? 'محامي';
    final gov = profile?.governorate;

    return Scaffold(
      backgroundColor: QalatTheme.bg,
      appBar: const QalatAppBar(),
      body: RefreshIndicator(
        color: QalatTheme.teal,
        onRefresh: _load,
        child: _loading
            ? ListView(children: const [
                SizedBox(height: 160),
                Center(child: CircularProgressIndicator(color: QalatTheme.teal)),
              ])
            : ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                children: [
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(28),
                      gradient: const LinearGradient(
                        begin: Alignment.topRight,
                        end: Alignment.bottomLeft,
                        colors: [Color(0xFF231F20), Color(0xFF1a1617), Color(0xFF1D6365)],
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.18),
                          blurRadius: 18,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 56,
                          height: 56,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(18),
                            gradient: const LinearGradient(
                              colors: [QalatTheme.teal, QalatTheme.tealDeep],
                            ),
                          ),
                          child: Text(
                            _initials(name),
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w900,
                              fontSize: 20,
                            ),
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'مرحباً بك',
                                style: TextStyle(color: Colors.white54, fontSize: 12, fontWeight: FontWeight.w600),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 20,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              if (gov != null && gov.isNotEmpty) ...[
                                const SizedBox(height: 6),
                                Row(
                                  children: [
                                    const Icon(Icons.place_outlined, size: 14, color: QalatTheme.teal),
                                    const SizedBox(width: 4),
                                    Text(gov, style: const TextStyle(color: Colors.white60, fontSize: 12)),
                                  ],
                                ),
                              ],
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!, style: const TextStyle(color: Color(0xFFDC2626))),
                  ],
                  if (_counts != null) ...[
                    const SizedBox(height: 16),
                    GridView.count(
                      crossAxisCount: 2,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: 10,
                      crossAxisSpacing: 10,
                      childAspectRatio: 1.45,
                      children: [
                        _StatTile(
                          label: 'بانتظار القبول',
                          value: _counts!['pending_accept'] ?? 0,
                          color: const Color(0xFFD97706),
                        ),
                        _StatTile(
                          label: 'نشطة',
                          value: _counts!['active'] ?? 0,
                          color: QalatTheme.teal,
                        ),
                        _StatTile(
                          label: 'قيد المراجعة',
                          value: _counts!['in_review'] ?? 0,
                          color: const Color(0xFF7C3AED),
                        ),
                        _StatTile(
                          label: 'الكل',
                          value: _counts!['total'] ?? 0,
                          color: const Color(0xFF2563EB),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 22),
                  const Text(
                    'آخر المهام',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                      color: QalatTheme.ink,
                    ),
                  ),
                  const SizedBox(height: 10),
                  if (_recent.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 28),
                      child: Center(child: Text('لا مهام حالياً', style: TextStyle(color: QalatTheme.muted))),
                    )
                  else
                    ..._recent.map((t) {
                      final debtor = t['debtors'] as Map?;
                      final def = t['task_definitions'] as Map?;
                      final title = '${def?['label'] ?? t['task_type'] ?? 'مهمة'}';
                      final person = debtor?['full_name'] ?? '—';
                      final status = t['task_status']?.toString() ?? '';
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: TaskListCard(
                          title: title,
                          subtitle: '$person',
                          status: status,
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => TaskDetailScreen(taskId: t['id'] as String),
                            ),
                          ),
                        ),
                      );
                    }),
                ],
              ),
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.label, required this.value, required this.color});
  final String label;
  final int value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: color.withValues(alpha: 0.12)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            '$value',
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.w900,
              color: color,
              height: 1,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: color.withValues(alpha: 0.85),
            ),
          ),
        ],
      ),
    );
  }
}
