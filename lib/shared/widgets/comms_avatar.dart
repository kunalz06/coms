import 'package:flutter/material.dart';

class CommsAvatar extends StatelessWidget {
  const CommsAvatar({
    required this.name,
    this.imageUrl,
    this.radius = 22,
    super.key,
  });

  final String name;
  final String? imageUrl;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final initial =
        name.trim().isEmpty ? 'C' : name.trim().characters.first.toUpperCase();
    final url = imageUrl;
    final pixelSize = (radius * 2 * MediaQuery.devicePixelRatioOf(context))
        .round()
        .clamp(32, 256);
    final provider = url == null || url.isEmpty
        ? null
        : ResizeImage(
            NetworkImage(url),
            width: pixelSize,
            height: pixelSize,
          );
    final scheme = Theme.of(context).colorScheme;
    return CircleAvatar(
      radius: radius,
      backgroundColor: scheme.primaryContainer,
      foregroundColor: scheme.onPrimaryContainer,
      backgroundImage: provider,
      child: provider == null
          ? Text(initial, style: const TextStyle(fontWeight: FontWeight.w800))
          : null,
    );
  }
}
