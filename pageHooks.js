(() => {
  const BANNER_TEXT = 'Skipping forward is only available on video sections you have already watched';

  function nodeContainsBanner(node) {
    try {
      if (!node) return false;
      const text = (node.textContent || '').toLowerCase();
      if (text.includes(BANNER_TEXT.toLowerCase())) return true;
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node;
        if (el.getAttribute && el.getAttribute('role') === 'alert') {
          const t = (el.textContent || '').toLowerCase();
          if (t.includes(BANNER_TEXT.toLowerCase())) return true;
        }
      }
    } catch(_) {}
    return false;
  }

  function cssPath(el) {
    try {
      if (!(el instanceof Element)) return '';
      const parts = [];
      while (el && parts.length < 6) {
        let part = el.nodeName.toLowerCase();
        if (el.id) { part += `#${el.id}`; parts.unshift(part); break; }
        if (el.classList && el.classList.length) part += '.' + Array.from(el.classList).slice(0,2).join('.');
        const parent = el.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(x => x.nodeName === el.nodeName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(el)+1})`;
        }
        parts.unshift(part);
        el = parent;
      }
      return parts.join(' > ');
    } catch(_) { return ''; }
  }

  function logBanner(eventName, parent, child) {
    try {
      console.group('[SkipBanner]', eventName);
      if (parent) console.log('parent:', parent);
      if (child) console.log('child:', child);
      if (parent) console.log('parentPath:', cssPath(parent));
      if (child && child instanceof Element) console.log('childPath:', cssPath(child));
      console.log('time:', new Date().toISOString());
      console.trace('Stack');
      console.groupEnd();
    } catch(_) {}
  }

  const wrap = (proto, method) => {
    const orig = proto[method];
    if (!orig || orig.__skipWrapped) return;
    const wrapped = function(...args) {
      try {
        const child = args[0];
        if (nodeContainsBanner(child) || nodeContainsBanner(this)) {
          logBanner(method, this, child);
          // Always suppress inserting the banner
          return child;
        }
      } catch(_) {}
      return orig.apply(this, args);
    };
    wrapped.__skipWrapped = true;
    Object.defineProperty(proto, method, { value: wrapped, configurable: true });
  };

  try {
    wrap(Element.prototype, 'appendChild');
    wrap(Node.prototype, 'insertBefore');
    wrap(Node.prototype, 'replaceChild');
  } catch(_) {}

  try {
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (nodeContainsBanner(n)) {
            logBanner('MutationObserver', m.target, n);
            try {
              // Remove the banner node and its alert container if present
              const alertContainer = (n instanceof Element) ? n.closest('[role="alert"]') : null;
              if (n.remove) n.remove();
              if (alertContainer && alertContainer.remove) alertContainer.remove();
            } catch(_) {}
          }
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch(_) {}

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
            try {
              const body = init && init.body;
              if (body) {
                if (typeof body === 'string') {
                  console.log('body(str):', body.slice(0, 500));
                } else if (body instanceof URLSearchParams) {
                  console.log('body(params):', body.toString().slice(0, 500));
                } else if (body instanceof Blob) {
                  console.log('body(blob):', body.type, body.size);
                } else {
                  console.log('body(obj):', body);
                }
              }
            } catch(_) {}
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

  try {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    let lastUrl = '';
    let lastMethod = '';
    XMLHttpRequest.prototype.open = function(method, url) {
      try { lastUrl = url; lastMethod = method || ''; } catch(_) {}
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      try {
        const url = lastUrl || '';
        if (url.includes('/api/rest/v1/eventing/') || url.includes('/api/rest/') || url.includes('/eventing')) {
          console.group('[SkipDebug][xhr]');
          console.log('method:', lastMethod);
          console.log('url:', url);
          try {
            if (typeof body === 'string') {
              console.log('body(str):', body.slice(0, 500));
            } else if (body) {
              console.log('body:', body);
            }
          } catch(_) {}
          console.trace('Stack');
          console.groupEnd();
        }
      } catch(_) {}
      return origSend.apply(this, arguments);
    };
  } catch(_) {}

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

  console.log('[SkipDebug] hooks installed (page)');
})();


