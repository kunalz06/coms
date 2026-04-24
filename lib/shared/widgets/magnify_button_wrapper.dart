import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

class MagnifyButtonWrapper extends StatefulWidget {
  const MagnifyButtonWrapper({
    required this.child,
    super.key,
  });

  final Widget child;

  @override
  State<MagnifyButtonWrapper> createState() => _MagnifyButtonWrapperState();
}

class _MagnifyButtonWrapperState extends State<MagnifyButtonWrapper> {
  var _hovering = false;
  Offset _offset = Offset.zero;

  void _updateOffset(Offset localPosition, Size size) {
    if (size.width <= 0 || size.height <= 0) return;
    final center = Offset(size.width / 2, size.height / 2);
    final dx = (localPosition.dx - center.dx) / size.width;
    final dy = (localPosition.dy - center.dy) / size.height;
    setState(() {
      _offset = Offset(dx * 7, dy * 7);
    });
  }

  void _reset() {
    setState(() {
      _hovering = false;
      _offset = Offset.zero;
    });
  }

  @override
  Widget build(BuildContext context) {
    final scale = _hovering ? 1.045 : 1.0;
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = Size(
          constraints.maxWidth.isFinite ? constraints.maxWidth : 120,
          constraints.maxHeight.isFinite ? constraints.maxHeight : 44,
        );
        return MouseRegion(
          onEnter: (_) => setState(() => _hovering = true),
          onExit: (_) => _reset(),
          onHover: (event) {
            if (!kIsWeb) return;
            _updateOffset(event.localPosition, size);
          },
          child: Listener(
            behavior: HitTestBehavior.translucent,
            onPointerDown: (event) {
              _hovering = true;
              _updateOffset(event.localPosition, size);
            },
            onPointerMove: (event) {
              if (!_hovering) return;
              _updateOffset(event.localPosition, size);
            },
            onPointerUp: (_) => _reset(),
            onPointerCancel: (_) => _reset(),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 120),
              curve: Curves.easeOutCubic,
              transform: Matrix4.identity()
                ..translate(_offset.dx, _offset.dy)
                ..scale(scale),
              transformAlignment: Alignment.center,
              child: widget.child,
            ),
          ),
        );
      },
    );
  }
}
