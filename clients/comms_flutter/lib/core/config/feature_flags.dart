class FeatureFlags {
  const FeatureFlags({
    this.globalSearch = false,
    this.callTab = false,
    this.callReconnectUx = false,
    this.chatLock = false,
    this.hiddenChats = false,
    this.privacyPasswordReset = false,
    this.fileCompression = false,
  });

  final bool globalSearch;
  final bool callTab;
  final bool callReconnectUx;
  final bool chatLock;
  final bool hiddenChats;
  final bool privacyPasswordReset;
  final bool fileCompression;

  static const current = FeatureFlags(
    globalSearch: true,
    callTab: true,
    callReconnectUx: true,
    chatLock: true,
    hiddenChats: true,
    privacyPasswordReset: true,
    fileCompression: true,
  );
}
