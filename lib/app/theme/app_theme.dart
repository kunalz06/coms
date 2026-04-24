import 'package:flutter/material.dart';

class AppTheme {
  static ThemeData light() {
    final base = ColorScheme.fromSeed(
      seedColor: const Color(0xFF0B5FFF),
      brightness: Brightness.light,
    );
    final scheme = base.copyWith(
      primary: const Color(0xFF0B5FFF),
      onPrimary: Colors.white,
      primaryContainer: const Color(0xFFDDE7FF),
      onPrimaryContainer: const Color(0xFF0D1B4A),
      secondary: const Color(0xFF00796B),
      onSecondary: Colors.white,
      secondaryContainer: const Color(0xFFD3F1EC),
      onSecondaryContainer: const Color(0xFF042D26),
      tertiary: const Color(0xFFD97706),
      onTertiary: Colors.white,
      tertiaryContainer: const Color(0xFFFFE7C7),
      onTertiaryContainer: const Color(0xFF3C2500),
      surface: const Color(0xFFF8FAFD),
      onSurface: const Color(0xFF111827),
      onSurfaceVariant: const Color(0xFF4B5563),
      outline: const Color(0xFF8A96A8),
      outlineVariant: const Color(0xFFC6D0DF),
    );
    return _base(scheme, false);
  }

  static ThemeData dark() {
    final base = ColorScheme.fromSeed(
      seedColor: const Color(0xFF7EA3FF),
      brightness: Brightness.dark,
    );
    final scheme = base.copyWith(
      primary: const Color(0xFF7EA3FF),
      onPrimary: const Color(0xFF001A52),
      primaryContainer: const Color(0xFF10347A),
      onPrimaryContainer: const Color(0xFFDDE7FF),
      secondary: const Color(0xFF69D5C5),
      onSecondary: const Color(0xFF003830),
      secondaryContainer: const Color(0xFF0E4F44),
      onSecondaryContainer: const Color(0xFFD3F1EC),
      tertiary: const Color(0xFFFFB357),
      onTertiary: const Color(0xFF452700),
      tertiaryContainer: const Color(0xFF6A3F00),
      onTertiaryContainer: const Color(0xFFFFE7C7),
      surface: const Color(0xFF0E121B),
      onSurface: const Color(0xFFE8ECF5),
      onSurfaceVariant: const Color(0xFFC4CCDA),
      outline: const Color(0xFF8D99AB),
      outlineVariant: const Color(0xFF3A4353),
    );
    return _base(scheme, true);
  }

  static ThemeData _base(ColorScheme scheme, bool isDark) {
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface.withValues(alpha: 0.86),
        foregroundColor: scheme.onSurface,
        surfaceTintColor: Colors.transparent,
      ),
      cardTheme: CardThemeData(
        elevation: isDark ? 0 : 1,
        color: scheme.surfaceContainerHighest.withValues(alpha: isDark ? 0.34 : 0.58),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerHighest.withValues(alpha: isDark ? 0.30 : 0.46),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 44),
          backgroundColor: scheme.primary,
          foregroundColor: scheme.onPrimary,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(48, 44),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surface.withValues(alpha: 0.94),
        indicatorColor: scheme.primaryContainer,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            color: states.contains(WidgetState.selected)
                ? scheme.onPrimaryContainer
                : scheme.onSurfaceVariant,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: scheme.surface.withValues(alpha: 0.92),
        indicatorColor: scheme.primaryContainer,
        selectedIconTheme: IconThemeData(color: scheme.onPrimaryContainer),
        unselectedIconTheme: IconThemeData(color: scheme.onSurfaceVariant),
        selectedLabelTextStyle: TextStyle(
          color: scheme.onPrimaryContainer,
          fontWeight: FontWeight.w600,
        ),
        unselectedLabelTextStyle: TextStyle(color: scheme.onSurfaceVariant),
      ),
      listTileTheme: ListTileThemeData(
        iconColor: scheme.secondary,
      ),
    );
  }
}
