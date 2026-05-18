import 'package:flutter/material.dart';

class AppTheme {
  static ThemeData light() {
    final base = ColorScheme.fromSeed(
      seedColor: const Color(0xFF006A60),
      brightness: Brightness.light,
    );
    final scheme = base.copyWith(
      primary: const Color(0xFF006A60),
      onPrimary: Colors.white,
      primaryContainer: const Color(0xFF8FF2E3),
      onPrimaryContainer: const Color(0xFF00201C),
      secondary: const Color(0xFF6D5E00),
      onSecondary: Colors.white,
      secondaryContainer: const Color(0xFFFFE45E),
      onSecondaryContainer: const Color(0xFF211B00),
      tertiary: const Color(0xFFA83F6A),
      onTertiary: Colors.white,
      tertiaryContainer: const Color(0xFFFFD8E8),
      onTertiaryContainer: const Color(0xFF3F001D),
      surface: const Color(0xFFFBFCF7),
      onSurface: const Color(0xFF181C1B),
      onSurfaceVariant: const Color(0xFF444947),
      outline: const Color(0xFF747977),
      outlineVariant: const Color(0xFFC4C9C6),
    );
    return _base(scheme, false);
  }

  static ThemeData dark() {
    final base = ColorScheme.fromSeed(
      seedColor: const Color(0xFF6FDBCC),
      brightness: Brightness.dark,
    );
    final scheme = base.copyWith(
      primary: const Color(0xFF6FDBCC),
      onPrimary: const Color(0xFF003731),
      primaryContainer: const Color(0xFF005048),
      onPrimaryContainer: const Color(0xFF8FF2E3),
      secondary: const Color(0xFFE5CA35),
      onSecondary: const Color(0xFF393000),
      secondaryContainer: const Color(0xFF534600),
      onSecondaryContainer: const Color(0xFFFFE45E),
      tertiary: const Color(0xFFFFB0CC),
      onTertiary: const Color(0xFF650034),
      tertiaryContainer: const Color(0xFF862650),
      onTertiaryContainer: const Color(0xFFFFD8E8),
      surface: const Color(0xFF111411),
      onSurface: const Color(0xFFE1E4DF),
      onSurfaceVariant: const Color(0xFFC3C8C4),
      outline: const Color(0xFF8D938F),
      outlineVariant: const Color(0xFF424844),
    );
    return _base(scheme, true);
  }

  static ThemeData _base(ColorScheme scheme, bool isDark) {
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      visualDensity: VisualDensity.standard,
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface.withValues(alpha: 0.86),
        foregroundColor: scheme.onSurface,
        surfaceTintColor: scheme.primary,
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
          foregroundColor: scheme.primary,
          side: BorderSide(color: scheme.outline),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          foregroundColor: scheme.onSurfaceVariant,
          hoverColor: scheme.primaryContainer.withValues(alpha: 0.34),
          focusColor: scheme.primaryContainer.withValues(alpha: 0.42),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
      tabBarTheme: TabBarThemeData(
        indicatorColor: scheme.primary,
        labelColor: scheme.primary,
        unselectedLabelColor: scheme.onSurfaceVariant,
        dividerColor: scheme.outlineVariant,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? scheme.onPrimary
              : scheme.outline,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? scheme.primary
              : scheme.surfaceContainerHighest,
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: scheme.inverseSurface,
        contentTextStyle: TextStyle(color: scheme.onInverseSurface),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
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
