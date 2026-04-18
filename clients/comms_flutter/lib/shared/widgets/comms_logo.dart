import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

class CommsLogo extends StatelessWidget {
  const CommsLogo({
    this.size = 56,
    this.showWordmark = false,
    super.key,
  });

  final double size;
  final bool showWordmark;

  @override
  Widget build(BuildContext context) {
    final logo = SvgPicture.asset(
      'icon_logo.svg',
      width: size,
      height: size,
      colorFilter: ColorFilter.mode(
        Theme.of(context).colorScheme.onSurface,
        BlendMode.srcIn,
      ),
      semanticsLabel: 'COMMS logo',
    );

    if (!showWordmark) return logo;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        logo,
        const SizedBox(height: 12),
        Text(
          'COMMS',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                fontWeight: FontWeight.w700,
                letterSpacing: 2,
              ),
        ),
      ],
    );
  }
}
