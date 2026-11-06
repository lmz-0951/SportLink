/* Register PWA only on secure origins; leave SportLink application logic unchanged. */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    const script = new URL('./sw.js', document.baseURI);
    navigator.serviceWorker.register(script, { scope: new URL('./', document.baseURI).pathname })
      .catch(err => console.warn('SportLink PWA registration:', err));
  });
}
