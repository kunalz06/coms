import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:comms_flutter/app/theme/app_theme.dart';
import 'package:comms_flutter/shared/widgets/comms_feature_banner.dart';

void main() {
  test('Aurora themes retain distinct foreground and surface palettes', () {
    final light = AppTheme.light().colorScheme;
    final dark = AppTheme.dark().colorScheme;
    expect(light.brightness, Brightness.light);
    expect(dark.brightness, Brightness.dark);
    expect(light.surface, isNot(dark.surface));
    expect(light.primary, isNot(light.secondary));
    expect(dark.primary, isNot(dark.secondary));
    expect(light.onSurface, isNot(light.surface));
    expect(dark.onSurface, isNot(dark.surface));
  });

  testWidgets('feature banner renders in both themes', (tester) async {
    for (final theme in [AppTheme.light(), AppTheme.dark()]) {
      await tester.pumpWidget(
        MaterialApp(
          theme: theme,
          home: const Scaffold(
            body: Center(
              child: SizedBox(
                width: 380,
                child: CommsFeatureBanner(
                  title: 'Messages',
                  subtitle: 'Conversations that matter',
                  icon: Icons.forum_rounded,
                ),
              ),
            ),
          ),
        ),
      );
      expect(find.text('Messages'), findsOneWidget);
      expect(find.text('Conversations that matter'), findsOneWidget);
    }
  });
}
