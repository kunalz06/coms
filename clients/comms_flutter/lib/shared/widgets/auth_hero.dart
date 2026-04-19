import 'package:flutter/material.dart';

import 'comms_logo.dart';

class AuthHero extends StatelessWidget {
  const AuthHero({
    required this.title,
    required this.subtitle,
    this.logoSize = 68,
    super.key,
  });

  final String title;
  final String subtitle;
  final double logoSize;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final baseStyle = theme.textTheme.headlineMedium?.copyWith(
      fontWeight: FontWeight.w800,
      letterSpacing: 0,
    );

    return Column(
      children: [
        CommsLogo(size: logoSize, showWordmark: true),
        const SizedBox(height: 12),
        Stack(
          alignment: Alignment.center,
          children: [
            Transform.translate(
              offset: const Offset(1.5, 1.5),
              child: Text(
                title,
                textAlign: TextAlign.center,
                style: baseStyle?.copyWith(
                  color: theme.colorScheme.primary.withValues(alpha: 0.28),
                ),
              ),
            ),
            Text(
              title,
              textAlign: TextAlign.center,
              style: baseStyle?.copyWith(
                color: theme.colorScheme.onSurface,
                shadows: [
                  Shadow(
                    color: theme.colorScheme.primary.withValues(alpha: 0.35),
                    offset: const Offset(0.8, 1.0),
                    blurRadius: 0,
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          subtitle,
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}
