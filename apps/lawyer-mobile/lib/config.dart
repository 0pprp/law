/// Runtime config — override via --dart-define at build time.
class AppConfig {
  static const supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: 'https://YOUR_PROJECT.supabase.co',
  );
  static const supabaseAnonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue: 'YOUR_ANON_KEY',
  );

  /// Optional .NET BFF. Empty = skip (login uses Supabase directly).
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: '',
  );

  /// Optional Next.js mobile-login fallback (only if endpoint is deployed).
  static const nextBaseUrl = String.fromEnvironment(
    'NEXT_BASE_URL',
    defaultValue: 'https://qalatlaw.com',
  );

  /// Public R2 base for debtor/task file links (same as web NEXT_PUBLIC_R2_PUBLIC_URL).
  static const r2PublicUrl = String.fromEnvironment(
    'R2_PUBLIC_URL',
    defaultValue: 'https://pub-029fa309232c423fbacd7723c644d28f.r2.dev',
  );

  static String storedFileUrl(String bucket, String? storedPath) {
    final raw = (storedPath ?? '').trim();
    if (raw.isEmpty) return '';
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    final clean = raw.replaceFirst(RegExp(r'^/+'), '');
    final base = r2PublicUrl.replaceAll(RegExp(r'/$'), '');
    if (clean.startsWith('$bucket/')) return '$base/$clean';
    final first = clean.split('/').first;
    if (first == 'task-files' || first == 'debtor-files' || first == 'lawyer-files') {
      return '$base/$clean';
    }
    return '$base/$bucket/$clean';
  }
}
