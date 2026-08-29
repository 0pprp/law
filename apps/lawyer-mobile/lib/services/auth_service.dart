import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config.dart';

class LawyerProfile {
  LawyerProfile({
    required this.id,
    required this.role,
    this.username,
    this.fullName,
    this.phone,
    this.branchId,
    this.branchName,
    this.governorate,
  });

  final String id;
  final String role;
  final String? username;
  final String? fullName;
  final String? phone;
  final String? branchId;
  final String? branchName;
  final String? governorate;

  factory LawyerProfile.fromJson(Map<String, dynamic> j) => LawyerProfile(
        id: j['id'] as String,
        role: j['role'] as String? ?? 'lawyer',
        username: j['username'] as String?,
        fullName: j['full_name'] as String?,
        phone: j['phone'] as String?,
        branchId: j['branch_id'] as String?,
        branchName: j['branch_name'] as String?,
        governorate: j['governorate'] as String?,
      );

  LawyerProfile copyWith({String? branchName}) => LawyerProfile(
        id: id,
        role: role,
        username: username,
        fullName: fullName,
        phone: phone,
        branchId: branchId,
        branchName: branchName ?? this.branchName,
        governorate: governorate,
      );
}

class AuthService {
  LawyerProfile? profile;

  static const _internalDomain = 'internal.qalat.local';

  String _emailFromUsername(String username) {
    final trimmed = username.trim().toLowerCase();
    if (trimmed.contains('@')) return trimmed;
    return '$trimmed@$_internalDomain';
  }

  bool _looksLikeJson(String raw) {
    final t = raw.trimLeft();
    return t.startsWith('{') || t.startsWith('[');
  }

  Uri _loginUri(String base) {
    final b = base.replaceAll(RegExp(r'/$'), '');
    if (b.contains(':5088') || b.contains('lawyer-api') || b.contains('api-lawyer')) {
      return Uri.parse('$b/auth/mobile-login');
    }
    return Uri.parse('$b/api/auth/mobile-login');
  }

  /// Primary: same credentials as web via Supabase Auth (no server HTML pages).
  Future<void> _loginViaSupabase(String username, String password) async {
    final email = _emailFromUsername(username);
    final client = Supabase.instance.client;

    AuthResponse? res;
    try {
      res = await client.auth.signInWithPassword(email: email, password: password);
    } on AuthException {
      // Legacy accounts sometimes used a different email — try raw input if it had @
      if (username.contains('@')) rethrow;
      rethrow;
    }

    if (res.session == null || res.user == null) {
      throw Exception('بيانات الدخول غير صحيحة');
    }

    await refreshProfile();
    if (profile == null) {
      await client.auth.signOut();
      throw Exception('تعذر قراءة ملف المحامي');
    }
    if (profile!.role != 'lawyer') {
      await client.auth.signOut();
      profile = null;
      throw Exception('تطبيق المحامي للمحامين فقط');
    }
  }

  /// Optional BFF / Next mobile-login when available (must return JSON).
  Future<bool> _loginViaHttpApi(String username, String password) async {
    final bases = <String>[
      AppConfig.apiBaseUrl,
      AppConfig.nextBaseUrl,
    ].where((e) => e.trim().isNotEmpty && !e.contains('YOUR_')).toList();

    for (final base in bases) {
      try {
        final res = await http
            .post(
              _loginUri(base),
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: jsonEncode({
                'username': username.trim(),
                'password': password,
              }),
            )
            .timeout(const Duration(seconds: 12));

        final raw = utf8.decode(res.bodyBytes);
        if (!_looksLikeJson(raw)) {
          // HTML 404/login page — skip this base
          continue;
        }
        final body = jsonDecode(raw) as Map<String, dynamic>;
        if (res.statusCode >= 400) continue;

        final refresh = body['refresh_token'] as String?;
        if (refresh == null || refresh.isEmpty) continue;
        await Supabase.instance.client.auth.setSession(refresh);

        final p = body['profile'] as Map<String, dynamic>?;
        if (p != null) {
          profile = LawyerProfile.fromJson(p);
        } else {
          await refreshProfile();
        }
        if (profile?.role == 'lawyer') return true;
        await logout();
      } catch (_) {
        continue;
      }
    }
    return false;
  }

  Future<void> login(String username, String password) async {
    if (username.trim().isEmpty || password.isEmpty) {
      throw Exception('بيانات الدخول مطلوبة');
    }

    // 1) Prefer direct Supabase (works offline from Next/.NET deploy status)
    try {
      await _loginViaSupabase(username, password);
      return;
    } on AuthException catch (e) {
      // 2) Fall back to HTTP APIs if Supabase email mapping differs
      final ok = await _loginViaHttpApi(username, password);
      if (ok) return;
      final msg = e.message.trim().isEmpty ? 'بيانات الدخول غير صحيحة' : e.message;
      throw Exception(msg);
    } catch (e) {
      final ok = await _loginViaHttpApi(username, password);
      if (ok) return;
      throw Exception(e.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<void> refreshProfile() async {
    final client = Supabase.instance.client;
    final uid = client.auth.currentUser?.id;
    if (uid == null) return;
    final row = await client
        .from('profiles')
        .select('id, role, username, full_name, phone, branch_id, governorate, is_active')
        .eq('id', uid)
        .maybeSingle();
    if (row == null) return;
    final map = Map<String, dynamic>.from(row);
    if (map['is_active'] == false) {
      await logout();
      throw Exception('الحساب غير فعال، يرجى التواصل مع الإدارة');
    }
    var p = LawyerProfile.fromJson(map);
    final bid = p.branchId;
    if (bid != null && bid.isNotEmpty) {
      try {
        final branch = await client
            .from('branches')
            .select('name')
            .eq('id', bid)
            .maybeSingle();
        final name = branch?['name']?.toString();
        if (name != null && name.isNotEmpty) {
          p = p.copyWith(branchName: name);
        }
      } catch (_) {}
    }
    profile = p;
  }

  Future<void> logout() async {
    profile = null;
    await Supabase.instance.client.auth.signOut();
  }

  bool get isLoggedIn => Supabase.instance.client.auth.currentSession != null;

  String? get accessToken =>
      Supabase.instance.client.auth.currentSession?.accessToken;
}
