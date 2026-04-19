{{flutter_js}}
{{flutter_build_config}}

// Explicitly clear stale workers from earlier builds to avoid startup timeouts.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
    }
  }).finally(() => {
    _flutter.loader.load({
      serviceWorkerSettings: {
        serviceWorkerVersion: null,
      },
    });
  });
} else {
  _flutter.loader.load({
    serviceWorkerSettings: {
      serviceWorkerVersion: null,
    },
  });
}
