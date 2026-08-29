import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'config.dart';
import 'services/auth_service.dart';
import 'services/api_client.dart';
import 'screens/login_screen.dart';
import 'screens/home_shell.dart';
import 'theme.dart';

class AppState extends ChangeNotifier {
  AppState({required this.auth, required this.api, required this.tasks});

  final AuthService auth;
  final ApiClient api;
  final TasksService tasks;

  Future<void> login(String u, String p) async {
    await auth.login(u, p);
    notifyListeners();
  }

  Future<void> logout() async {
    await auth.logout();
    notifyListeners();
  }
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Supabase.initialize(
    url: AppConfig.supabaseUrl,
    anonKey: AppConfig.supabaseAnonKey,
  );

  final auth = AuthService();
  if (auth.isLoggedIn) {
    try {
      await auth.refreshProfile();
    } catch (_) {}
  }
  final api = ApiClient(auth);
  final tasks = TasksService(Supabase.instance.client);
  final state = AppState(auth: auth, api: api, tasks: tasks);

  runApp(
    ChangeNotifierProvider.value(
      value: state,
      child: const QalatLawyerApp(),
    ),
  );
}

class QalatLawyerApp extends StatelessWidget {
  const QalatLawyerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<AppState>(
      builder: (context, state, _) {
        return MaterialApp(
          title: 'قانونية قلعة الضمان',
          debugShowCheckedModeBanner: false,
          locale: const Locale('ar'),
          builder: (context, child) => Directionality(
            textDirection: TextDirection.rtl,
            child: child ?? const SizedBox.shrink(),
          ),
          theme: QalatTheme.material(),
          home: state.auth.isLoggedIn ? const HomeShell() : const LoginScreen(),
        );
      },
    );
  }
}
