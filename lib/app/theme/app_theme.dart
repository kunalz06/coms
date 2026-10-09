import 'package:flutter/material.dart';

/// Aurora design tokens shared by every COMMS surface, including calls,
/// conversations, meetings, attachments, and search.
class AppTheme {
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF5647F5),
      brightness: Brightness.light,
    ).copyWith(
      primary: const Color(0xFF5045DF),
      onPrimary: Colors.white,
      primaryContainer: const Color(0xFFE5E2FF),
      onPrimaryContainer: const Color(0xFF251778),
      secondary: const Color(0xFFD72E81),
      onSecondary: Colors.white,
      secondaryContainer: const Color(0xFFFFD9EB),
      onSecondaryContainer: const Color(0xFF6C1242),
      tertiary: const Color(0xFFBA5B11),
      onTertiary: Colors.white,
      tertiaryContainer: const Color(0xFFFFE4CC),
      onTertiaryContainer: const Color(0xFF612F08),
      surface: const Color(0xFFF8F9FF),
      onSurface: const Color(0xFF181A35),
      onSurfaceVariant: const Color(0xFF5C6079),
      outline: const Color(0xFF8386A0),
      outlineVariant: const Color(0xFFDCE0F0),
      surfaceContainerLow: Colors.white,
      surfaceContainer: const Color(0xFFF2F3FC),
      surfaceContainerHigh: const Color(0xFFE9ECF9),
    );
    return _base(scheme, false);
  }

  static ThemeData dark() {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFFA6A2FF),
      brightness: Brightness.dark,
    ).copyWith(
      primary: const Color(0xFFAAA5FF),
      onPrimary: const Color(0xFF211966),
      primaryContainer: const Color(0xFF373075),
      onPrimaryContainer: const Color(0xFFE7E4FF),
      secondary: const Color(0xFFFF9DCE),
      onSecondary: const Color(0xFF5F123C),
      secondaryContainer: const Color(0xFF632448),
      onSecondaryContainer: const Color(0xFFFFE0F0),
      tertiary: const Color(0xFFFFBE83),
      onTertiary: const Color(0xFF542700),
      tertiaryContainer: const Color(0xFF6A3810),
      onTertiaryContainer: const Color(0xFFFFE4CF),
      surface: const Color(0xFF0E1123),
      onSurface: const Color(0xFFF1F1FF),
      onSurfaceVariant: const Color(0xFFB4B8D2),
      outline: const Color(0xFF777B9C),
      outlineVariant: const Color(0xFF343853),
      surfaceContainerLow: const Color(0xFF171B33),
      surfaceContainer: const Color(0xFF20243C),
      surfaceContainerHigh: const Color(0xFF2A2D49),
    );
    return _base(scheme, true);
  }

  static ThemeData _base(ColorScheme scheme, bool dark) {
    final radius = BorderRadius.circular(20);
    return ThemeData(
      useMaterial3: true,
      brightness: dark ? Brightness.dark : Brightness.light,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      visualDensity: VisualDensity.standard,
      splashFactory: InkRipple.splashFactory,
      textTheme: TextTheme(
        headlineLarge: TextStyle(
          color: scheme.onSurface, fontSize: 32, fontWeight: FontWeight.w800,
          letterSpacing: -1.1,
        ),
        headlineMedium: TextStyle(
          color: scheme.onSurface, fontSize: 26, fontWeight: FontWeight.w800,
          letterSpacing: -0.7,
        ),
        titleLarge: TextStyle(
          color: scheme.onSurface, fontSize: 22, fontWeight: FontWeight.w800,
          letterSpacing: -0.5,
        ),
        titleMedium: TextStyle(
          color: scheme.onSurface, fontSize: 16, fontWeight: FontWeight.w700,
        ),
        bodyLarge: TextStyle(color: scheme.onSurface, fontSize: 16),
        bodyMedium: TextStyle(color: scheme.onSurface, fontSize: 14),
        bodySmall: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
        labelLarge: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: TextStyle(
          color: scheme.onSurface, fontSize: 23,
          fontWeight: FontWeight.w800, letterSpacing: -0.6,
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: scheme.surfaceContainerLow,
        margin: const EdgeInsets.symmetric(vertical: 5),
        shape: RoundedRectangleBorder(
          borderRadius: radius,
          side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.72)),
        ),
      ),
      dividerTheme: DividerThemeData(
        thickness: 0.7,
        color: scheme.outlineVariant.withValues(alpha: 0.65),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainer,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        hintStyle: TextStyle(color: scheme.onSurfaceVariant),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: scheme.primary, width: 2),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 46),
          backgroundColor: scheme.primary,
          foregroundColor: scheme.onPrimary,
          textStyle: const TextStyle(fontWeight: FontWeight.w700),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(48, 46),
          foregroundColor: scheme.primary,
          side: BorderSide(color: scheme.outlineVariant),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: scheme.primary,
        foregroundColor: scheme.onPrimary,
        extendedTextStyle: const TextStyle(fontWeight: FontWeight.w700),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          foregroundColor: scheme.onSurfaceVariant,
          hoverColor: scheme.primaryContainer.withValues(alpha: 0.45),
          focusColor: scheme.primaryContainer.withValues(alpha: 0.55),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
      tabBarTheme: TabBarThemeData(
        indicatorColor: scheme.primary,
        indicatorSize: TabBarIndicatorSize.tab,
        labelColor: scheme.primary,
        unselectedLabelColor: scheme.onSurfaceVariant,
        labelStyle: const TextStyle(fontWeight: FontWeight.w800),
        dividerColor: scheme.outlineVariant,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? scheme.onPrimary : scheme.outline,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? scheme.primary : scheme.surfaceContainerHigh,
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: scheme.inverseSurface,
        contentTextStyle: TextStyle(color: scheme.onInverseSurface),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 72,
        elevation: 0,
        backgroundColor: scheme.surfaceContainerLow,
        indicatorColor: scheme.primaryContainer,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            fontSize: 12,
            color: states.contains(WidgetState.selected)
                ? scheme.primary : scheme.onSurfaceVariant,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w800 : FontWeight.w600,
          ),
        ),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: scheme.surfaceContainerLow,
        indicatorColor: scheme.primaryContainer,
        selectedIconTheme: IconThemeData(color: scheme.primary, size: 25),
        unselectedIconTheme: IconThemeData(color: scheme.onSurfaceVariant),
        selectedLabelTextStyle: TextStyle(
          color: scheme.primary, fontWeight: FontWeight.w800,
        ),
        unselectedLabelTextStyle: TextStyle(
          color: scheme.onSurfaceVariant, fontWeight: FontWeight.w600,
        ),
      ),
      listTileTheme: ListTileThemeData(
        iconColor: scheme.primary,
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 5),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: scheme.surfaceContainerLow,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      ),
    );
  }
}
