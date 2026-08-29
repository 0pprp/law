import 'package:flutter/material.dart';
import '../theme.dart';
import 'dashboard_screen.dart';
import 'tasks_screen.dart';
import 'profile_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final pages = const [
      DashboardScreen(),
      TasksScreen(),
      ProfileScreen(),
    ];
    return Scaffold(
      backgroundColor: QalatTheme.bg,
      body: pages[_index],
      bottomNavigationBar: NavigationBar(
        height: 68,
        backgroundColor: Colors.white,
        indicatorColor: QalatTheme.teal.withValues(alpha: 0.12),
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined, color: QalatTheme.muted),
            selectedIcon: Icon(Icons.home, color: QalatTheme.teal),
            label: 'الرئيسية',
          ),
          NavigationDestination(
            icon: Icon(Icons.assignment_outlined, color: QalatTheme.muted),
            selectedIcon: Icon(Icons.assignment, color: QalatTheme.teal),
            label: 'مهامي',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline, color: QalatTheme.muted),
            selectedIcon: Icon(Icons.person, color: QalatTheme.teal),
            label: 'ملفي',
          ),
        ],
      ),
    );
  }
}
