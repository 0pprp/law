import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../theme.dart';
import '../widgets/qalat_ui.dart';
import '../widgets/wallet_activity_sheet.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Map<String, dynamic>? _wallet;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadWallet();
  }

  Future<void> _loadWallet() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final w = await context.read<AppState>().api.getJson('/lawyer/wallet');
      setState(() => _wallet = w);
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  double _bal(String key) {
    final bal = _wallet?['balances'];
    if (bal is Map) return (bal[key] as num?)?.toDouble() ?? 0;
    return 0;
  }

  double _stamps() {
    final s = _wallet?['stationery'];
    if (s is Map) return (s['stamps'] as num?)?.toDouble() ?? 0;
    return 0;
  }

  String _fmt(double v) {
    if (v % 1 == 0) return v.toStringAsFixed(0);
    return v.toStringAsFixed(2);
  }

  List<Map<String, dynamic>> _txs(String key) {
    final raw = _wallet?[key];
    if (raw is! List) return [];
    return raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  Future<void> _openFeesActivity() async {
    await showWalletActivitySheet(
      context: context,
      title: 'سجل الأتعاب',
      transactions: _txs('feeTxs'),
    );
  }

  Future<void> _openSavingsActivity() async {
    await showWalletActivitySheet(
      context: context,
      title: 'سجل الصرفيات / التوفير',
      transactions: _txs('savingsTxs'),
    );
  }

  Future<void> _openStationeryActivity() async {
    await showWalletActivitySheet(
      context: context,
      title: 'سجل محفظة القرطاسية',
      transactions: _txs('stationeryTxs'),
      formatAmount: (tx) {
        final amt = (tx['amount'] as num?)?.toDouble() ?? 0;
        final sign = amt > 0 ? '+' : '';
        return '$sign${amt % 1 == 0 ? amt.toStringAsFixed(0) : amt.toStringAsFixed(2)} طابع';
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AppState>().auth;
    final p = auth.profile;
    final fees = _bal('fees');
    final savings = _bal('savings');
    final feesAvailable = fees < 0 ? 0.0 : fees;
    final stamps = _stamps();

    return Scaffold(
      backgroundColor: QalatTheme.bg,
      appBar: QalatAppBar(
        title: 'ملفي',
        actions: [
          TextButton(
            onPressed: () => context.read<AppState>().logout(),
            child: const Text('خروج', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
      body: RefreshIndicator(
        color: QalatTheme.teal,
        onRefresh: _loadWallet,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
          children: [
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
                  Text(
                    p?.fullName ?? '—',
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: QalatTheme.ink),
                  ),
                  if ((p?.branchName ?? '').isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        const Icon(Icons.apartment_outlined, size: 16, color: QalatTheme.teal),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            'الفرع: ${p!.branchName}',
                            style: const TextStyle(color: QalatTheme.muted, fontWeight: FontWeight.w700),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'المحفظة',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: QalatTheme.ink),
            ),
            const SizedBox(height: 4),
            const Text(
              'اضغط على أي محفظة لعرض آخر العمليات',
              style: TextStyle(fontSize: 11, color: QalatTheme.muted),
            ),
            const SizedBox(height: 10),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator(color: QalatTheme.teal)),
              ),
            if (_error != null) Text(_error!, style: const TextStyle(color: Color(0xFFDC2626))),
            if (_wallet != null) ...[
              Row(
                children: [
                  Expanded(
                    child: _WalletCard(
                      label: 'الأتعاب',
                      value: _fmt(feesAvailable),
                      hint: fees < 0 ? 'صافي سالب: ${_fmt(fees)}' : 'اضغط لسجل النشاط',
                      color: fees < 0 ? const Color(0xFFDC2626) : QalatTheme.teal,
                      onTap: _openFeesActivity,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _WalletCard(
                      label: 'الصرفيات / التوفير',
                      value: _fmt(savings),
                      hint: 'اضغط لسجل النشاط',
                      color: const Color(0xFF0284C7),
                      onTap: _openSavingsActivity,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              _WalletCard(
                label: 'محفظة القرطاسية',
                value: '${_fmt(stamps)} طابع',
                hint: 'اضغط لسجل النشاط الكامل',
                color: const Color(0xFF7C3AED),
                onTap: _openStationeryActivity,
                wide: true,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _WalletCard extends StatelessWidget {
  const _WalletCard({
    required this.label,
    required this.value,
    required this.hint,
    required this.color,
    required this.onTap,
    this.wide = false,
  });
  final String label;
  final String value;
  final String hint;
  final Color color;
  final VoidCallback onTap;
  final bool wide;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          width: wide ? double.infinity : null,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: color.withValues(alpha: 0.15)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 12)),
                  ),
                  Icon(Icons.chevron_left, size: 18, color: color.withValues(alpha: 0.7)),
                ],
              ),
              const SizedBox(height: 8),
              Text(value, style: TextStyle(color: color, fontWeight: FontWeight.w900, fontSize: 22)),
              const SizedBox(height: 4),
              Text(hint, style: const TextStyle(color: QalatTheme.muted, fontSize: 10)),
            ],
          ),
        ),
      ),
    );
  }
}
