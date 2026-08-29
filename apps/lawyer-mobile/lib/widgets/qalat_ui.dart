import 'package:flutter/material.dart';
import '../theme.dart';

/// Shared dark header matching lawyer web layout.
class QalatAppBar extends StatelessWidget implements PreferredSizeWidget {
  const QalatAppBar({
    super.key,
    this.title,
    this.showBrand = true,
    this.actions,
    this.leading,
  });

  final String? title;
  final bool showBrand;
  final List<Widget>? actions;
  final Widget? leading;

  @override
  Size get preferredSize => const Size.fromHeight(56);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      backgroundColor: QalatTheme.ink,
      foregroundColor: Colors.white,
      elevation: 0,
      leading: leading,
      title: showBrand
          ? Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(10),
                    gradient: const LinearGradient(
                      colors: [QalatTheme.teal, QalatTheme.tealDeep],
                    ),
                  ),
                  child: const Icon(Icons.account_balance, size: 18, color: Colors.white),
                ),
                const SizedBox(width: 10),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title ?? 'قانونية قلعة الضمان',
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                      ),
                    ),
                    if (title == null)
                      const Text(
                        'البوابة القانونية',
                        style: TextStyle(fontSize: 11, color: Colors.white54),
                      ),
                  ],
                ),
              ],
            )
          : Text(title ?? '', style: const TextStyle(fontWeight: FontWeight.w800)),
      actions: actions,
    );
  }
}

class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final color = QalatTheme.statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Text(
        QalatTheme.statusLabel(status),
        style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w800),
      ),
    );
  }
}

class TaskListCard extends StatelessWidget {
  const TaskListCard({
    super.key,
    required this.title,
    required this.subtitle,
    required this.status,
    this.onTap,
  });

  final String title;
  final String subtitle;
  final String status;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: Colors.black.withValues(alpha: 0.04)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.04),
                blurRadius: 12,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                        color: QalatTheme.ink,
                      ),
                    ),
                  ),
                  StatusChip(status: status),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                subtitle,
                style: const TextStyle(color: QalatTheme.muted, fontSize: 13),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
