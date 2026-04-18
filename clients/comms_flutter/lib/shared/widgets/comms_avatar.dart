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
    return CircleAvatar(
      radius: radius,
      backgroundImage: imageUrl == null || imageUrl!.isEmpty
          ? null
          : NetworkImage(imageUrl!),
      child: imageUrl == null || imageUrl!.isEmpty ? Text(initial) : null,
    );
  }
}
