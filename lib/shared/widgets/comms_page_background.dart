import 'package:flutter/material.dart';

/// One lightweight paint layer rather than stacked translucent decorations.
/// Keeps scrolling and live WebRTC surfaces inexpensive to composite.
class CommsPageBackground extends StatelessWidget {
  const CommsPageBackground({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            scheme.surface,
            Color.alphaBlend(
              scheme.primary.withValues(alpha: 0.035),
              scheme.surface,
            ),
            scheme.surface,
          ],
        ),
      ),
      child: child,
    );
  }
}
