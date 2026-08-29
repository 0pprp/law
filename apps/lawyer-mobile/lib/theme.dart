import 'package:flutter/material.dart';

/// Matches the lawyer web portal palette (قلعة الضمان).
class QalatTheme {
  static const ink = Color(0xFF231F20);
  static const teal = Color(0xFF2C8780);
  static const tealDeep = Color(0xFF1D6365);
  static const bg = Color(0xFFF3F1F2);
  static const muted = Color(0xFF767676);
  static const card = Colors.white;

  static ThemeData material() {
    final base = ColorScheme.fromSeed(
      seedColor: teal,
      brightness: Brightness.light,
      primary: teal,
      surface: bg,
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: base,
      scaffoldBackgroundColor: bg,
      appBarTheme: const AppBarTheme(
        backgroundColor: ink,
        foregroundColor: Colors.white,
        elevation: 0,
        centerTitle: false,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: teal,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 18),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: teal,
          side: BorderSide(color: teal.withValues(alpha: 0.35)),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
        ),
      ),
      cardTheme: CardThemeData(
        color: card,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: Colors.black.withValues(alpha: 0.04)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: Colors.black.withValues(alpha: 0.08)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: teal, width: 1.4),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: Colors.white,
        indicatorColor: teal.withValues(alpha: 0.12),
        labelTextStyle: WidgetStateProperty.resolveWith((s) {
          final selected = s.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 11,
            fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
            color: selected ? teal : muted,
          );
        }),
      ),
    );
  }

  static String statusLabel(String status) {
    const map = {
      'assignment_pending_acceptance': 'بانتظار قبول المحامي',
      'assigned': 'مكلفة',
      'in_progress': 'قيد التنفيذ',
      'submitted': 'بانتظار الاعتماد',
      'pending_review': 'بانتظار المراجعة',
      'approved': 'منجزة',
      'completed': 'منجزة',
      'rejected': 'مرفوضة',
      'needs_revision': 'مرفوضة',
      'waiting_assignment': 'بانتظار التكليف',
      'failed': 'تعذر الإنجاز',
      'postponed': 'مؤجلة',
      'closed': 'مغلقة',
    };
    return map[status] ?? status;
  }

  static Color statusColor(String status) {
    switch (status) {
      case 'assignment_pending_acceptance':
        return const Color(0xFFD97706);
      case 'assigned':
      case 'new':
        return const Color(0xFF2563EB);
      case 'in_progress':
        return const Color(0xFFCA8A04);
      case 'submitted':
      case 'pending_review':
        return const Color(0xFF7C3AED);
      case 'approved':
      case 'completed':
        return teal;
      case 'rejected':
      case 'needs_revision':
      case 'failed':
        return const Color(0xFFDC2626);
      default:
        return muted;
    }
  }
}
