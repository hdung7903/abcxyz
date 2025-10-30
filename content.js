// Inject page-context script using src to satisfy page CSP
(function inject() {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('pageHooks.js');
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
    script.addEventListener('load', () => script.remove());
  } catch (_) {
    // no-op
  }
})();


