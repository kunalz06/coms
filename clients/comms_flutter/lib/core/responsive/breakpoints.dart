class AppBreakpoints {
  static const compact = 600.0;
  static const medium = 900.0;
  static const expanded = 1200.0;
}

enum WindowClass { compact, medium, expanded }

WindowClass windowClassForWidth(double width) {
  if (width < AppBreakpoints.compact) return WindowClass.compact;
  if (width < AppBreakpoints.expanded) return WindowClass.medium;
  return WindowClass.expanded;
}
