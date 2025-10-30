// Inject page-context script to capture real call stacks and network
(function inject() {
  try {
    const script = document.createElement('script');
    script.textContent = `(() => {
      const BANNER_TEXT = 'Skipping forward is only available on video sections you have already watched';

      function nodeContainsBanner(node) {
        try {
          if (!node) return false;
          const text = (node.textContent || '').toLowerCase();
          if (text.includes(BANNER_TEXT.toLowerCase())) return true;
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node;
            // aria role alert used by Coursera banner
            if (el.getAttribute && el.getAttribute('role') === 'alert') {
              const t = (el.textContent || '').toLowerCase();
              if (t.includes(BANNER_TEXT.toLowerCase())) return true;
            }
          }
        } catch(_) {}
        return false;
      }

      function logBanner(eventName, parent, child) {
        try {
          console.group('[SkipBanner]', eventName);
          if (parent) console.log('parent:', parent);
          if (child) console.log('child:', child);
          console.log('time:', new Date().toISOString());
          console.trace('Stack');
          console.groupEnd();
        } catch(_) {}
      }

      // Wrap DOM insertion APIs to detect when banner is inserted
      const wrap = (proto, method) => {
        const orig = proto[method];
        if (!orig || orig.__skipWrapped) return;
        const wrapped = function(...args) {
          try {
            const child = args[0];
            if (nodeContainsBanner(child) || nodeContainsBanner(this)) {
              logBanner(method, this, child);
            }
          } catch(_) {}
          return orig.apply(this, args);
        };
        wrapped.__skipWrapped = true;
        Object.defineProperty(proto, method, { value: wrapped, configurable: true });
      };

      wrap(Element.prototype, 'appendChild');
      wrap(Node.prototype, 'insertBefore');
      wrap(Node.prototype, 'replaceChild');

      // MutationObserver fallback (covers innerHTML updates)
      try {
        const mo = new MutationObserver((mutations) => {
          for (const m of mutations) {
            for (const n of m.addedNodes) {
              if (nodeContainsBanner(n)) {
                logBanner('MutationObserver', m.target, n);
              }
            }
          }
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
      } catch(_) {}

      // Instrument fetch
      try {
        const origFetch = window.fetch;
        if (origFetch && !origFetch.__skipWrapped) {
          const wrappedFetch = function(input, init) {
            try {
              const url = typeof input === 'string' ? input : (input && input.url) || '';
              const method = (init && init.method) || 'GET';
              if (url.includes('/api/rest/v1/eventing/') || url.includes('/api/rest/') || url.includes('/eventing')) {
                console.group('[SkipDebug][fetch]');
                console.log('method:', method);
                console.log('url:', url);
                console.trace('Stack');
                console.groupEnd();
              }
            } catch(_) {}
            return origFetch.apply(this, arguments);
          };
          wrappedFetch.__skipWrapped = true;
          window.fetch = wrappedFetch;
        }
      } catch(_) {}

      // Instrument XHR
      try {
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        let lastUrl = '';
        XMLHttpRequest.prototype.open = function(method, url) {
          try { lastUrl = url; } catch(_) {}
          return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function(body) {
          try {
            const url = lastUrl || '';
            if (url.includes('/api/rest/v1/eventing/') || url.includes('/api/rest/') || url.includes('/eventing')) {
              console.group('[SkipDebug][xhr]');
              console.log('method:', (this && this._method) || '');
              console.log('url:', url);
              console.trace('Stack');
              console.groupEnd();
            }
          } catch(_) {}
          return origSend.apply(this, arguments);
        };
      } catch(_) {}

      // Log seek control clicks as context
      try {
        document.addEventListener('click', (e) => {
          const t = e.target;
          if (!(t instanceof Element)) return;
          const btn = t.closest('[aria-label="Seek Video Forward 10 seconds"], [aria-label="Seek Video Backward 10 seconds"]');
          if (btn) {
            console.group('[SkipDebug][seek-click]');
            console.log('label:', btn.getAttribute('aria-label'));
            console.trace('Stack');
            console.groupEnd();
          }
        }, true);
      } catch(_) {}

      console.log('[SkipDebug] hooks installed');
    })();`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch (e) {
    // Fallback: basic content-script observer (no page stack)
    try {
      const BANNER_TEXT = 'Skipping forward is only available on video sections you have already watched';
      const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const n of m.addedNodes) {
            const text = (n && n.textContent || '').toLowerCase();
            if (text.includes(BANNER_TEXT.toLowerCase())) {
              console.log('[SkipBanner][content-script] banner detected', n);
            }
          }
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {}
  }
})();


