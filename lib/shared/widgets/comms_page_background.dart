import 'package:flutter/material.dart';

class CommsPageBackground extends StatelessWidget {
  const CommsPageBackground({
    required this.child,
    super.key,
  });

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(color: colors.surface),
      child: Stack(
        children: [
          Positioned.fill(child: child),
          Positioned(
            top: -60,
            right: -120,
            child: IgnorePointer(
              child: _Shape(
                width: 360,
                height: 190,
                color: colors.secondaryContainer.withValues(alpha: 0.20),
              ),
            ),
          ),
          Positioned(
            top: 220,
            left: -90,
            child: IgnorePointer(
              child: _Shape(
                width: 260,
                height: 170,
                color: colors.tertiaryContainer.withValues(alpha: 0.14),
              ),
            ),
          ),
          Positioned(
            bottom: -40,
            right: 50,
            child: IgnorePointer(
              child: _Shape(
                width: 220,
                height: 110,
                color: colors.primaryContainer.withValues(alpha: 0.14),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Shape extends StatelessWidget {
  const _Shape({
    required this.width,
    required this.height,
    required this.color,
  });

  final double width;
  final double height;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Transform.rotate(
      angle: -0.18,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(30),
          border: Border.all(
            color: Theme.of(context)
                .colorScheme
                .outlineVariant
                .withValues(alpha: 0.35),
          ),
        ),
        child: SizedBox(width: width, height: height),
      ),
    );
  }
}
