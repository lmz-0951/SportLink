/* Register PWA only on secure origins; leave SportLink application logic unchanged. */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('SportLink PWA registration:', err));
  });
}
