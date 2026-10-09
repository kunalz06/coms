import 'package:flutter/material.dart';

/// Compact feature hero used in narrow panes and on phones. No images,
/// animation controllers, or blur filters: fast on low-memory devices.
class CommsFeatureBanner extends StatelessWidget {
  const CommsFeatureBanner({
    required this.title,
    required this.subtitle,
    required this.icon,
    this.badge,
    super.key,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 8, 14, 14),
      child: Semantics(
        container: true,
        label: '$title. $subtitle',
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: dark
                  ? const [Color(0xFF3F367D), Color(0xFF7C2D69)]
                  : const [Color(0xFF6655F6), Color(0xFFD7479B)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(22),
          ),
          child: SizedBox(
            height: 92,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.20),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Icon(icon, size: 27, color: Colors.white),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 19,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.3,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          subtitle,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.90),
                            fontSize: 12,
                            height: 1.3,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (badge != null) ...[
                    const SizedBox(width: 6),
                    Tooltip(
                      message: badge!,
                      child: Icon(
                        Icons.auto_awesome_rounded,
                        color: scheme.tertiaryContainer,
                        size: 20,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
