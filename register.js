if ('serviceWorker' in navigator && window.isSecureContext) {
  const root = new URL('./', document.currentScript.src);
  navigator.serviceWorker.register(new URL('sw.js', root)).catch(() => {
    // The toolbox still works in an open tab when offline caching is unavailable.
  });
}
