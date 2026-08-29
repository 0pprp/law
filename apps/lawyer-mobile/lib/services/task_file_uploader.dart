import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config.dart';

/// Upload task files without Next.js (avoids «غير مصرح» when server isn't redeployed).
/// Uses Supabase Storage bucket `task-files` + `task_attachments` RLS for assigned lawyers.
class TaskFileUploader {
  TaskFileUploader();

  Future<Map<String, dynamic>> upload({
    required String taskId,
    required List<int> bytes,
    required String filename,
    String? contentType,
    String? description,
  }) async {
    final client = Supabase.instance.client;
    final uid = client.auth.currentUser?.id;
    if (uid == null) throw Exception('يجب تسجيل الدخول أولاً');

    try {
      await client.auth.refreshSession();
    } catch (_) {}

    var safeName = filename.trim().isEmpty ? 'upload.jpg' : filename.trim();
    var mime = contentType;
    final lower = safeName.toLowerCase();
    if (!lower.contains('.')) {
      if (mime == 'image/png') {
        safeName = '$safeName.png';
      } else if (mime == 'application/pdf') {
        safeName = '$safeName.pdf';
      } else {
        safeName = '$safeName.jpg';
        mime ??= 'image/jpeg';
      }
    }
    mime ??= lower.endsWith('.png')
        ? 'image/png'
        : lower.endsWith('.pdf')
            ? 'application/pdf'
            : 'image/jpeg';

    final data = bytes is Uint8List ? bytes : Uint8List.fromList(bytes);
    final ext = safeName.contains('.') ? safeName.split('.').last : 'jpg';
    final stamp = DateTime.now().millisecondsSinceEpoch;
    final desc = (description ?? '').trim();
    final objectPath = desc.isEmpty
        ? '$taskId/$stamp.$ext'
        : '$taskId/${desc.replaceAll(RegExp(r'[^\w\u0600-\u06FF-]+'), '-').replaceAll(RegExp(r'-+'), '-')}-$stamp.$ext';

    // 1) Storage (RLS: assigned lawyer only)
    try {
      await client.storage.from('task-files').uploadBinary(
            objectPath,
            data,
            fileOptions: FileOptions(contentType: mime, upsert: true),
          );
    } on StorageException catch (e) {
      // Fall back to Next JSON API (R2) if storage bucket missing
      return _uploadViaNextJson(
        taskId: taskId,
        bytes: data,
        filename: safeName,
        contentType: mime,
        description: description,
        storageError: e.message,
      );
    }

    // 2) DB row
    try {
      await client.from('task_attachments').insert({
        'task_id': taskId,
        'file_name': safeName.length > 200 ? safeName.substring(0, 200) : safeName,
        'file_path': objectPath,
        'file_size': data.length,
        'mime_type': mime,
        'description': () {
          final d = (description ?? '').trim();
          if (d.isEmpty) return null;
          return d.length > 200 ? d.substring(0, 200) : d;
        }(),
        'uploaded_by': uid,
      });
    } catch (e) {
      // Cleanup storage object on DB failure
      try {
        await client.storage.from('task-files').remove([objectPath]);
      } catch (_) {}
      throw Exception('فشل حفظ المرفق في قاعدة البيانات: $e');
    }

    // Best-effort: also mirror to R2 via Next (so admin portal can open file)
    try {
      await _uploadViaNextJson(
        taskId: taskId,
        bytes: data,
        filename: safeName,
        contentType: mime,
        description: description,
        mirrorOnly: true,
      );
    } catch (_) {}

    return {'ok': true, 'path': objectPath, 'fileName': safeName, 'via': 'supabase-storage'};
  }

  Future<String?> signedUrl(String filePath) async {
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      return filePath;
    }
    try {
      return await Supabase.instance.client.storage
          .from('task-files')
          .createSignedUrl(filePath, 3600);
    } catch (_) {
      final r2 = AppConfig.storedFileUrl('task-files', filePath);
      return r2.isEmpty ? null : r2;
    }
  }

  Future<Map<String, dynamic>> _uploadViaNextJson({
    required String taskId,
    required Uint8List bytes,
    required String filename,
    required String contentType,
    String? description,
    String? storageError,
    bool mirrorOnly = false,
  }) async {
    final token = Supabase.instance.client.auth.currentSession?.accessToken;
    if (token == null || token.isEmpty) {
      throw Exception(storageError == null
          ? 'يجب تسجيل الدخول أولاً'
          : 'فشل التخزين ($storageError) ولا توجد جلسة للرفع البديل');
    }
    final base = AppConfig.nextBaseUrl.replaceAll(RegExp(r'/$'), '');
    final res = await http.post(
      Uri.parse('$base/api/lawyer/mobile-upload-task-file'),
      headers: {
        'Authorization': 'Bearer $token',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'taskId': taskId,
        'fileName': filename,
        'contentType': contentType,
        'dataBase64': base64Encode(bytes),
        'access_token': token,
        if (description != null && description.trim().isNotEmpty) 'description': description.trim(),
      }),
    );
    final raw = utf8.decode(res.bodyBytes);
    if (!(raw.trimLeft().startsWith('{') || raw.trimLeft().startsWith('['))) {
      if (mirrorOnly) return {'ok': false};
      throw Exception('استجابة غير صالحة من السيرفر');
    }
    final map = jsonDecode(raw) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      if (mirrorOnly) return map;
      final err = map['error']?.toString() ?? 'خطأ ${res.statusCode}';
      // Friendly Arabic for known codes / legacy
      if (err.contains('MOBILE_AUTH') || err == 'غير مصرح') {
        throw Exception(
          'تعذر الرفع عبر السيرفر (غير مصرح). تأكد أن حسابك محامٍ والمهمة مكلفة لك. '
          'إن استمر الخطأ: حدّث الموقع على السيرفر ثم أعد المحاولة.',
        );
      }
      throw Exception(err);
    }
    return map;
  }
}
