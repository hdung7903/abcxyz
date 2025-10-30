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

          // Short-circuit noisy analytics/eventing requests client-side
          try {
            const u = String(url);
            const isEventing = /\/api\/rest\/v1\/eventing\/(info|infobatch)/.test(u);
            const isWA = /\/wa\/?/.test(u) || /tags\.coursera\.org/.test(u);
            if ((isEventing || isWA) && method.toUpperCase() === 'POST') {
              const fake = new Response('', { status: 204, statusText: 'No Content' });
              return Promise.resolve(fake);
            }
          } catch(_) {}

          // Log end-event metrics
          try {
            const u = String(url);
            const isEnded = /\/api\/opencourse\.v1\/user\/\d+\/course\/.+\/item\/.+\/lecture\/videoEvents\/ended/.test(u);
            if (isEnded && method.toUpperCase() === 'POST') {
              const vinfo = (window.__VID && typeof window.__VID.t === 'number') ? window.__VID : {};
              const pct = (vinfo.t && vinfo.d) ? ((vinfo.t / vinfo.d) * 100).toFixed(1) : 'n/a';
              console.group('[SkipDebug][end-event][fetch]');
              console.log('url:', url);
              console.log('currentTime:', vinfo.t);
              console.log('duration:', vinfo.d);
              console.log('percent:', pct + '%');
              console.trace('Stack');
              console.groupEnd();
            }
          } catch(_) {}

          // Capture LearningHours GraphQL payload and synthesize heartbeats
          try {
            const isLearningHours = (typeof url === 'string' && url.includes('/graphql-gateway') && url.includes('opname=LearningHours_SendEvent'))
              || (typeof url === 'string' && url.includes('/graphql') && (init && init.body && (init.body + '').includes('LearningHours_SendEvent')));
            if (isLearningHours && method.toUpperCase() === 'POST' && init && init.body) {
              let bodyText = '';
              try { bodyText = typeof init.body === 'string' ? init.body : (init.body && init.body.toString ? init.body.toString() : ''); } catch(_) {}
              let parsed;
              try { parsed = JSON.parse(bodyText); } catch(_) {}
              const first = Array.isArray(parsed) ? parsed[0] : parsed;
              const hb = first && first.variables && first.variables.input && first.variables.input.heartbeat;
              if (hb && hb.courseId && hb.itemDetails && hb.itemDetails.itemId) {
                window.__LH = window.__LH || { endpoint: url.split('?')[0], qs: (url.split('?')[1] || '') };
                window.__LH.template = {
                  courseId: hb.courseId,
                  courseBranchId: hb.courseBranchId || undefined,
                  itemId: hb.itemDetails.itemId,
                  learnerActivityType: hb.itemDetails.learnerActivityType || 'LECTURE',
                  deviceId: hb.deviceId,
                  eventOs: hb.eventOs || (navigator.platform || 'Unknown'),
                  eventPlatform: hb.eventPlatform || 'WEB'
                };

                if (!window.__LH.interval) {
                  window.__LH.interval = setInterval(() => {
                    try { postLearningHours(30000); } catch(_) {}
                  }, 25000);
                  window.addEventListener('beforeunload', () => { try { clearInterval(window.__LH.interval); } catch(_) {} });
                }
              }
            }
          } catch(_) {}

          // Try extract userId from any JSON bodies we see
          try {
            const body = init && init.body;
            if (body && typeof body === 'string') {
              const m = body.match(/"userId"\s*:\s*(\d{5,})/);
              if (m) { window.__CTX = window.__CTX || {}; window.__CTX.userId = m[1]; }
            }
          } catch(_) {}
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

        // Capture LearningHours over XHR too
        try {
          const isLearningHours = (typeof url === 'string' && url.includes('/graphql-gateway') && url.includes('opname=LearningHours_SendEvent'))
            || (typeof url === 'string' && url.includes('/graphql'));
          if (isLearningHours && lastMethod.toUpperCase() === 'POST' && body) {
            let bodyText = '';
            try { bodyText = typeof body === 'string' ? body : (body && body.toString ? body.toString() : ''); } catch(_) {}
            let parsed;
            try { parsed = JSON.parse(bodyText); } catch(_) {}
            const first = Array.isArray(parsed) ? parsed[0] : parsed;
            const hb = first && first.variables && first.variables.input && first.variables.input.heartbeat;
            if (first && first.operationName === 'LearningHours_SendEvent' && hb && hb.courseId && hb.itemDetails && hb.itemDetails.itemId) {
              window.__LH = window.__LH || { endpoint: url.split('?')[0], qs: (url.split('?')[1] || '') };
              window.__LH.template = {
                courseId: hb.courseId,
                courseBranchId: hb.courseBranchId || undefined,
                itemId: hb.itemDetails.itemId,
                learnerActivityType: hb.itemDetails.learnerActivityType || 'LECTURE',
                deviceId: hb.deviceId,
                eventOs: hb.eventOs || (navigator.platform || 'Unknown'),
                eventPlatform: hb.eventPlatform || 'WEB'
              };

              if (!window.__LH.interval) {
                window.__LH.interval = setInterval(() => {
                  try { postLearningHours(30000); } catch(_) {}
                }, 25000);
                window.addEventListener('beforeunload', () => { try { clearInterval(window.__LH.interval); } catch(_) {} });
              }
            }
          }
        } catch(_) {}

        // Log end-event metrics (XHR)
        try {
          const u = String(url);
          const isEnded = /\/api\/opencourse\.v1\/user\/\d+\/course\/.+\/item\/.+\/lecture\/videoEvents\/ended/.test(u);
          if (isEnded && lastMethod.toUpperCase() === 'POST') {
            const vinfo = (window.__VID && typeof window.__VID.t === 'number') ? window.__VID : {};
            const pct = (vinfo.t && vinfo.d) ? ((vinfo.t / vinfo.d) * 100).toFixed(1) : 'n/a';
            console.group('[SkipDebug][end-event][xhr]');
            console.log('url:', url);
            console.log('currentTime:', vinfo.t);
            console.log('duration:', vinfo.d);
            console.log('percent:', pct + '%');
            console.trace('Stack');
            console.groupEnd();
          }
        } catch(_) {}

        // If threshold passed but server expects progress first, wait for a successful progress call then send ended
        try {
          const u = String(url);
          const isProgress = /\/api\/opencourse\.v1\/user\/\d+\/course\/.+\/item\/.+\/lecture\/videoEvents\/progress/.test(u);
          if (isProgress && window.__CTX && window.__CTX.thresholdPassed) {
            const xhr = this;
            const origOnload = xhr.onload;
            xhr.onload = function() {
              try {
                const ok = (xhr.status >= 200 && xhr.status < 300);
                if (ok) {
                  const v = document.querySelector('video');
                  if (v) trySendEndedIfThreshold(v);
                }
              } catch(_) {}
              if (origOnload) return origOnload.apply(this, arguments);
            };
          }
        } catch(_) {}

        // Short-circuit eventing/analytics XHR
        try {
          const u = String(url);
          const isEventing = /\/api\/rest\/v1\/eventing\/(info|infobatch)/.test(u);
          const isWA = /\/wa\/?/.test(u) || /tags\.coursera\.org/.test(u);
          if (isEventing || isWA) {
            // Pretend success without sending
            // Simulate readyState/done callbacks to avoid breaking callers
            const xhr = this;
            setTimeout(() => {
              try {
                Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
                Object.defineProperty(xhr, 'status', { value: 204, configurable: true });
                xhr.onreadystatechange && xhr.onreadystatechange();
                xhr.onload && xhr.onload();
              } catch(_) {}
            }, 0);
            return;
          }
        } catch(_) {}

        // Try extract userId from URL patterns or body
        try {
          const u = String(url);
          // from /user/<id>/ paths
          let m = u.match(/\/user\/(\d{5,})\//);
          if (m) { window.__CTX = window.__CTX || {}; window.__CTX.userId = m[1]; }
          // from any <id>~ prefix we see in response URLs
          if (!m) {
            m = u.match(/(^|\/)\s*(\d{5,})(?=~)/);
            if (m) { window.__CTX = window.__CTX || {}; window.__CTX.userId = m[2]; }
          }
          if (body && typeof body === 'string' && !window.__CTX?.userId) {
            const b = body;
            const mb = b.match(/"userId"\s*:\s*(\d{5,})/);
            if (mb) { window.__CTX = window.__CTX || {}; window.__CTX.userId = mb[1]; }
          }
        } catch(_) {}
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

// Enforce forward seek: prevent scripts from snapping video back to older time
(() => {
  try {
    // Override navigator.sendBeacon to no-op on eventing/analytics
    try {
      const origBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
      if (origBeacon && !navigator.sendBeacon.__skipWrapped) {
        const wrapped = function(url, data) {
          try {
            const u = String(url || '');
            const isEventing = /\/api\/rest\/v1\/eventing\/(info|infobatch)/.test(u);
            const isWA = /\/wa\/?/.test(u) || /tags\.coursera\.org/.test(u);
            if (isEventing || isWA) return true; // report as queued successfully
          } catch(_) {}
          return origBeacon(url, data);
        };
        Object.defineProperty(navigator, 'sendBeacon', { value: wrapped, configurable: true });
        navigator.sendBeacon.__skipWrapped = true;
      }
    } catch(_) {}

    const proto = HTMLMediaElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'currentTime');
    if (!desc || desc.__skipWrapped) return;

    const SEEK_WINDOW_MS = 3000; // protect target for 3s
    const SLACK_SEC = 0.25; // tolerance

    function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

    function ensureGuards(video) {
      if (video.__seekGuardInstalled) return;
      video.__seekGuardInstalled = true;
      video.addEventListener('timeupdate', function() {
        try {
          if (typeof video.__desiredTime === 'number' && now() < (video.__desiredUntil || 0)) {
            const t = desc.get.call(video);
            if (t + SLACK_SEC < video.__desiredTime) {
              desc.set.call(video, video.__desiredTime);
            }
          }
        } catch(_) {}
      }, true);
    }

    Object.defineProperty(proto, 'currentTime', {
      configurable: true,
      enumerable: desc.enumerable,
      get: function() {
        return desc.get.call(this);
      },
      set: function(v) {
        try {
          ensureGuards(this);
          const prev = desc.get.call(this);
          if (typeof v === 'number' && v > prev + SLACK_SEC) {
            this.__desiredTime = v;
            this.__desiredUntil = now() + SEEK_WINDOW_MS;
          } else if (typeof this.__desiredTime === 'number' && now() < (this.__desiredUntil || 0)) {
            if (typeof v === 'number' && v + SLACK_SEC < this.__desiredTime) {
              // Ignore backward snap during protection window
              return;
            }
          }
        } catch(_) {}
        return desc.set.call(this, v);
      }
    });
    Object.defineProperty(proto, 'currentTime', { __skipWrapped: true });
  } catch(_) {}
})();

// Patch seekable to always make video fully seekable
try {
  const proto = HTMLMediaElement.prototype;
  const seekableDesc = Object.getOwnPropertyDescriptor(proto, 'seekable');
  if (seekableDesc) {
    Object.defineProperty(proto, 'seekable', {
      configurable: true,
      enumerable: seekableDesc.enumerable,
      get: function() {
        // Always make full range seekable
        const duration = (typeof this.duration === 'number' && !isNaN(this.duration) && this.duration > 0) ? this.duration : 99999;
        return {
          length: 1,
          start: () => 0,
          end: () => duration,
          // enable for..of, item, etc.
          [Symbol.iterator]: function* () { yield this; },
          0: { start: () => 0, end: () => duration },
        };
      }
    });
    console.log('[SkipDebug] Patched HTMLVideoElement.prototype.seekable');
  }
} catch (e) { console.warn('seekable patch fail', e); }

// Enhance mutation observer: remove only exact banner element!
try {
  const EXACT_SKIP_BANNER = 'Skipping forward is only available on video sections you have already watched';
  function isBannerNode(node) {
    if (!node) return false;
    // Không xóa nếu là <body> hoặc <html>
    if (node.nodeName === 'BODY' || node.nodeName === 'HTML') return false;
    // Chỉ xóa nếu là element có textContent chứa đúng toàn bộ câu banner, hoặc là text node đúng exact.
    const canRemove = (n) => {
      if (!n) return false;
      // Text node
      if (n.nodeType === 3) {
        return (n.textContent||'').trim() === EXACT_SKIP_BANNER;
      }
      // Element node
      if (n.textContent && n.textContent.trim() === EXACT_SKIP_BANNER) {
        return true;
      }
      return false;
    };
    if (canRemove(node)) return true;
    // check children for exact chỉ nếu là element nhỏ (div, p, span, li...)
    if (node.children && node.children.length <= 5) {
      for (const c of node.childNodes) {
        if (canRemove(c)) return true;
      }
    }
    // Hoặc role="alert", class chứa "banner" + text chính xác
    if (node instanceof Element) {
      if ((node.getAttribute('role') === 'alert' || (node.className||'').toLowerCase().includes('banner')) &&
          (node.textContent||'').includes(EXACT_SKIP_BANNER)) {
        return true;
      }
    }
    return false;
  }
  function removeBannerDeepSafe(node) {
    try {
      if (!node) return;
      if (isBannerNode(node)) {
        console.log('[SkipDebug][rm-banner-strict]', node);
        if (node.remove) node.remove();
        else if (node.parentNode) node.parentNode.removeChild(node);
        return;
      }
      if (node.childNodes && node.childNodes.length) {
        Array.from(node.childNodes).forEach(removeBannerDeepSafe);
      }
    } catch(_) {}
  }
  const moStrict = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        removeBannerDeepSafe(n);
      }
    }
  });
  moStrict.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => removeBannerDeepSafe(document.body), 2000);
} catch (e) { console.warn('strict banner removal patch fail', e); }

// Synthesize LearningHours heartbeats and on-seek bursts
function postLearningHours(durationMs) {
  try {
    if (!window.__LH || !window.__LH.template) return;
    const endpointBase = window.__LH.endpoint || 'https://www.coursera.org/graphql-gateway';
    const qs = window.__LH.qs ? ('?' + window.__LH.qs) : '?opname=LearningHours_SendEvent';
    const url = endpointBase + qs;
    const t = window.__LH.template;
    const intDuration = Math.max(1, Math.round(durationMs)); // đảm bảo int và >0
    const payload = [
      {
        operationName: 'LearningHours_SendEvent',
        variables: {
          input: {
            heartbeat: {
              courseId: t.courseId,
              courseBranchId: t.courseBranchId,
              eventPlatform: t.eventPlatform,
              userActionType: 'VIDEO_IS_PLAYING',
              durationMilliSeconds: intDuration,
              eventOs: t.eventOs,
              clientDateTime: new Date().toISOString(),
              deviceId: t.deviceId,
              itemDetails: {
                itemId: t.itemId,
                learnerActivityType: t.learnerActivityType
              }
            }
          }
        },
        query: 'mutation LearningHours_SendEvent($input: LearningHours_SendEventInput!) { LearningHours_SendEvent(input: $input) { __typename ... on LearningHours_SendEventSuccess { id __typename } ... on LearningHours_SendEventError { message __typename } } }'
      }
    ];
    fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).then(res => {
      window.__SKIP_SEND_LOG && window.__SKIP_SEND_LOG('LH', intDuration);
    }).catch(() => {});
  } catch(_) {}
}

(() => {
  try {
    const attach = (v) => {
      if (!(v instanceof HTMLVideoElement)) return;
      if (v.__lhSeekHooked) return;
      v.__lhSeekHooked = true;
      v.addEventListener('seeked', function() {
        try {
          if (!window.__LH || !window.__LH.template) return;
          const prev = (typeof v.__lastTime === 'number') ? v.__lastTime : 0;
          const cur = v.currentTime || 0;
          v.__lastTime = cur;
          const delta = cur - prev;
          if (delta > 5) {
            const chunks = Math.max(1, Math.ceil(delta / 30));
            for (let i = 0; i < chunks; i++) {
              postLearningHours(30000);
            }
          }

          // If past 92% threshold, try to send completion immediately
          trySendEndedIfThreshold(v);
        } catch(_) {}
      }, true);
      v.addEventListener('timeupdate', function() {
        try {
          v.__lastTime = v.currentTime || 0;
          const d = v.duration || 0;
          window.__VID = { t: v.__lastTime, d };
          // Also check threshold on regular updates
          trySendEndedIfThreshold(v);
        } catch(_) {}
      }, true);
    };

    // Attach to existing and future videos
    document.querySelectorAll('video').forEach(attach);
    const mo = new MutationObserver((ms) => {
      for (const m of ms) {
        for (const n of m.addedNodes) {
          if (n instanceof HTMLVideoElement) attach(n);
          if (n && n.querySelectorAll) n.querySelectorAll('video').forEach(attach);
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch(_) {}
})();

// Sửa lỗi scop popover và nâng log, bổ sung gửi progress trước khi ended ---
(function setupSkipToolButton() {
  try {
    if (document.getElementById('skip-tool-float-btn')) return;
    let popover = null;   // moved to outer scope!
    const style = document.createElement('style');
    style.innerHTML = `
      #skip-tool-float-btn {
        position: fixed;
        right: 32px;
        bottom: 38px;
        z-index: 2147483647;
        width: 60px; height: 60px;
        border-radius: 50%;
        background: linear-gradient(135deg,#00c6ff,#0072ff 80%);
        box-shadow: 0 5px 35px 0 rgba(24,118,255,0.30),0 1.5px 8px 0 rgba(28,60,120,0.07);
        color: #fff;
        display: flex; align-items: center; justify-content: center;
        font-size: 32px;
        cursor: pointer;
        opacity: 0.97;
        outline: none; border: none;
        transition: background 0.21s, box-shadow 0.19s, opacity 0.19s, filter 0.15s;
        user-select: none;
        overflow: visible;
      }
      #skip-tool-float-btn.off {
        background: linear-gradient(135deg,#b0b0b0,#747474 80%);
        color: #f9f9f9;
        filter: grayscale(0.4) brightness(0.85);
        opacity: 0.77;
      }
      #skip-tool-float-btn:active {
        box-shadow: 0 1px 6px 0 #2196F3;
        opacity: 0.88;
      }
      #skip-tool-float-btn .twicon {
        transition: transform 0.23s cubic-bezier(.82,0,.47,1.26);
      }
      #skip-tool-float-btn.active .twicon {
        transform: scale(1.22) rotate(16deg);
      }
      #skip-tool-float-btn-ripple {
        position: absolute; left: 0; top: 0;
        width: 100%; height: 100%; border-radius:50%;
        background: rgba(255,255,255,.28);
        opacity: 0; pointer-events:none;
        transition: opacity 0.31s, transform 0.35s;
      }
      #skip-tool-float-btn.ripple #skip-tool-float-btn-ripple {
        opacity: 1; transform: scale(1.65);
      }
      #skip-tool-float-btn-label {
        pointer-events: none;
        position: absolute; right: 72px; bottom: 10px;
        background: rgba(24,24,30,.97); color: #d2e3ff;
        padding: 9px 22px; border-radius: 10px; font-size: 15px; line-height: 1.45;
        box-shadow: 0px 3px 8px 0 rgba(24,30,70,0.19);
        font-weight: 500; letter-spacing: 0.01em;
        opacity: 1;
        white-space: nowrap;
        filter: drop-shadow(0 1.5px 2px #0001);
      }
    `;
    document.head.appendChild(style);

    // Button
    const btn = document.createElement('div');
    btn.id = 'skip-tool-float-btn';
    btn.innerHTML = `
      <span class="twicon" style="font-size:35px;display:inline-block">⏩</span>
      <span id="skip-tool-float-btn-ripple"></span>
    `;
    btn.title = 'Bật/Tắt Skip Tool';
    btn.className = window.__SKIP_TOOL_ENABLED ? 'active' : 'off';

    // State và log
    let logArr = [], logMax = 18;
    window.__SKIP_SEND_LOG = function(type, val, data) {
      let msg = `[${new Date().toLocaleTimeString()}] `;
      if (type === 'LH') msg += `Gửi LearningHours ${val} ms`;
      if (type === 'PROGRESS') msg += `Gửi /videoEvents/progress status:${data}`;
      if (type === 'ENDED') msg += `Gửi /videoEvents/ended status:${data}`;
      logArr.push(msg);
      if (logArr.length > logMax) logArr = logArr.slice(-logMax);
      renderPopoverIfOpen();
    };
    function renderPopoverIfOpen() {
      if (!popover || !popover.parentNode) return;
      let on = !!window.__SKIP_TOOL_ENABLED;
      popover.innerHTML = `
        <span id="skip-pop-close">&times;</span>
        <div id="skip-pop-status" class="${on?'on':'off'}">${on?'● ĐANG BẬT':'● ĐANG TẮT'}</div>
        <div class="skip-pop-row">Log:</div>
        <div id="skip-pop-log">${logArr.length?logArr.map(x=>`<div>- ${x}</div>`).join(''): '<i>Chưa gửi/hành động nào!</i>'}</div>
        <button id="skip-pop-toggle" class="${on?'':'off'}">${on?'Tắt Tool':'Bật Tool'}</button>
      `;
      popover.querySelector('#skip-pop-toggle').onclick = function() {
        window.__SKIP_TOOL_ENABLED = !window.__SKIP_TOOL_ENABLED;
        setBtnState(window.__SKIP_TOOL_ENABLED);
        window.localStorage.setItem('__SKIP_TOOL_ENABLED', window.__SKIP_TOOL_ENABLED ? '1' : '0');
        renderPopoverIfOpen();
      };
      popover.querySelector('#skip-pop-close').onclick = function() {
        if(popover&&popover.parentNode)popover.parentNode.removeChild(popover);
        popover=null;
      };
    }
    function setBtnState(enabled) {
      if (enabled) {
        btn.classList.add('active'); btn.classList.remove('off');
        btn.title = 'Đang bật: Tự động skip và tích xanh (click để mở log/tool)';
      } else {
        btn.classList.remove('active'); btn.classList.add('off');
        btn.title = 'ĐANG TẮT: Không tự động skip/fake time (click để mở tool)';
      }
    }
    window.__SKIP_TOOL_ENABLED = (window.__SKIP_TOOL_ENABLED === undefined) ? true : window.__SKIP_TOOL_ENABLED;
    setBtnState(window.__SKIP_TOOL_ENABLED);

    btn.addEventListener('click', function (e) {
      if(popover&&popover.parentNode){popover.parentNode.removeChild(popover);popover=null;return;}
      popover=document.createElement('div');popover.id='skip-tool-float-btn-popover';document.body.appendChild(popover);setTimeout(renderPopoverIfOpen,20);e.preventDefault();e.stopPropagation();return false;
    });
    // Tooltip
    let label;
    btn.addEventListener('mouseenter', function() {
      if (label) return;
      label = document.createElement('span');
      label.id = 'skip-tool-float-btn-label';
      label.textContent = window.__SKIP_TOOL_ENABLED ? 'Đang bật: Skip & Tick xanh tự động' : 'TẮT: Không skip/fake';
      document.body.appendChild(label);
      const rect = btn.getBoundingClientRect();
      label.style.right = (window.innerWidth - rect.right + 18)+'px';
      label.style.bottom = (window.innerHeight - rect.bottom + 10)+'px';
    });
    btn.addEventListener('mouseleave', function() {
      if (!label) return;
      if (label.parentNode) label.parentNode.removeChild(label);
      label = null;
    });

    document.body.appendChild(btn);
    document.addEventListener('mousedown', function(ev){
      if(popover&&popover.parentNode&&!popover.contains(ev.target)&&ev.target!==btn){popover.parentNode.removeChild(popover);popover=null;}
    },true);
    // Restore state if present
    try {
      const stored = window.localStorage.getItem('__SKIP_TOOL_ENABLED');
      if (stored === '1') { window.__SKIP_TOOL_ENABLED = true; setBtnState(true); }
      else if (stored === '0') { window.__SKIP_TOOL_ENABLED = false; setBtnState(false); }
    } catch(_) {}
  } catch(e) { /* log error */ }
})();

// --- Logic fake progress -> ended ---
async function trySendCourseraProgressFirst(video) {
  // Gửi progress giống Coursera để backend cho tick xanh
  let progressUrl;
  try {
    if(!video) return;
    // Lấy data từ url hiện tại
    const m = window.location.pathname.match(/\/learn\/([^\/]+)\/lecture\/([^\/?#]+)/);
    if (!m) return;
    const courseSlug=m[1],itemId=m[2];
    const userId=window.__CTX?.userId;
    if (!userId) return;
    progressUrl=`https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${courseSlug}/item/${itemId}/lecture/videoEvents/progress?autoEnroll=false`;
    const tCur=Math.floor(video.currentTime||0);
    const duration=Math.floor(video.duration||0);
    let payload={ "position": tCur, "duration": duration };
    let r = await fetch(progressUrl,{
      method:'POST', credentials:'include',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(payload)
    });
    window.__SKIP_SEND_LOG && window.__SKIP_SEND_LOG('PROGRESS',r.status);
    return r.status>=200&&r.status<300;
  } catch(e) { window.__SKIP_SEND_LOG&&window.__SKIP_SEND_LOG('PROGRESS','error'); return false; }
}
// Sửa hàm trySendEndedIfThreshold: gọi progress trước nếu cần
window._orig_trySendEnded = window.trySendEndedIfThreshold || trySendEndedIfThreshold;
window.trySendEndedIfThreshold = async function(video) {
  try {
    if (!window.__SKIP_TOOL_ENABLED) return;
    if (!video) return;
    const d = Number(video.duration||0), t = Number(video.currentTime||0);
    if (!d||!t) return;
    const ratio = t/d;
    if (ratio<0.92) { window.__CTX=window.__CTX||{}; window.__CTX.thresholdPassed=false; return; }
    window.__CTX=window.__CTX||{}; window.__CTX.thresholdPassed=true;
    const completedKey=window.location.pathname+'|'+(window.__VID?window.__VID.d:d)+'|patch';
    if (window.__CTX.endedSentFor === completedKey) return;
    // Kiểm tra đã gọi progress chưa
    let progressOK=false;
    try {
      progressOK=!!window.__CTX.progressOK;
      if(!progressOK) { progressOK = await trySendCourseraProgressFirst(video); window.__CTX.progressOK=progressOK; }
    } catch(e){window.__SKIP_SEND_LOG&&window.__SKIP_SEND_LOG('PROGRESS','ex',e.message);}
    if (!progressOK) {window.__SKIP_SEND_LOG&&window.__SKIP_SEND_LOG('PROGRESS','fail'); return;}
    // Tiếp tục gửi ended
    const m=window.location.pathname.match(/\/learn\/([^\/]+)\/lecture\/([^\/?#]+)/);
    if(!m)return;
    const courseSlug=m[1],itemId=m[2];
    const userId=window.__CTX.userId;
    if(!userId)return;
    const url=`https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${courseSlug}/item/${itemId}/lecture/videoEvents/ended?autoEnroll=false`;
    let res=await fetch(url,{
      method:'POST',credentials:'include',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({contentRequestBody:{}})
    });
    window.__SKIP_SEND_LOG&&window.__SKIP_SEND_LOG('ENDED',res.status);
    if(res.status>=200&&res.status<300){window.__CTX.endedSentFor=completedKey;return true;}
    // Nếu vẫn chưa đủ, kích hoạt mô phỏng!
    window.skipAutoPlayRush && window.skipAutoPlayRush(video);
    return false;
  } catch(e){window.__SKIP_SEND_LOG&&window.__SKIP_SEND_LOG('ENDED','ex',e.message);}
}

// === Fake playback từng bước nếu không tick xanh sau khi tua mạnh ===
let skipAutoPlayStepper = null;
window.skipAutoPlayRush = async function(video, endThen) {
  if (!video || !window.__SKIP_TOOL_ENABLED) return;
  if (skipAutoPlayStepper) skipAutoPlayStepper.stopped = true;
  let start = Math.round(video.currentTime) || 0;
  let dur = Math.round(video.duration) || 0;
  if (!start || !dur || start >= dur) return;
  let next = start,
      step = 6, // giây mỗi bước mô phỏng
      steps = [],
      goal = Math.floor(dur*0.95); // play tới gần 95% tổng duration
  // Chia nhỏ các chunk play còn thiếu
  for (let s = next; s < goal; s += step) steps.push(Math.min(s+step, goal));
  let idx = 0;
  let _log = function(msg) { window.__SKIP_SEND_LOG && window.__SKIP_SEND_LOG('STEP', msg); };
  skipAutoPlayStepper={stopped:false};
  // Hiển thị tiến trình trên popover nếu có
  function showProgressBar() {
    const pop = document.getElementById('skip-tool-float-btn-popover');
    if (pop) {
      let bar = document.getElementById('skip-tick-progress-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'skip-tick-progress-bar';
        bar.style='margin:8px 0 14px 2px;width:97%;height:14px;border-radius:7px;background:#e3f2fd;overflow:hidden;';
        const inBar = document.createElement('div');
        inBar.id = 'skip-tick-progress-in';
        inBar.style = 'height:100%;background:#1890ff;transition:width .22s;';
        bar.appendChild(inBar);
        pop.insertBefore(bar, pop.firstChild);
      }
      let pct = Math.floor((idx/steps.length)*100);
      document.getElementById('skip-tick-progress-in').style.width = pct+'%';
      bar.title = 'Mô phỏng playback '+idx+'/'+steps.length+' bước';
    }
  }
  // run từng step
  async function runStep() {
    if (skipAutoPlayStepper.stopped) { _log('STOP'); return; }
    if (idx >= steps.length) {
      _log('Gần chạm cuối, thử gửi ended thật!');
      let ok = await window.trySendEndedIfThreshold(video);
      if (ok) _log('ENDED 200 OK ✅');
      else _log('ENDED thất bại, cần play thật thêm');
      return; 
    }
    video.currentTime = steps[idx];
    _log(`Giả lập play tới ${steps[idx]}s / ${goal}`);
    await postLearningHours(step*1000);
    let ok = await trySendCourseraProgressFirst(video);
    _log('Progress resp: ' + (ok?'OK':'FAIL'));
    idx++;
    showProgressBar();
    setTimeout(runStep, 850 + Math.random()*550); // nghỉ tí giống real
  }
  showProgressBar();
  runStep();
};
// Khi tua mạnh mà chưa tick xanh, tự động gọi giả lập từng bước
window._orig_trySendEnded = window.trySendEndedIfThreshold || trySendEndedIfThreshold;
window.trySendEndedIfThreshold = async function(video) {
  try {
    if (!window.__SKIP_TOOL_ENABLED) return;
    if (!video) return;
    const d = Number(video.duration||0), t = Number(video.currentTime||0);
    if (!d||!t) return;
    const ratio = t/d;
    if (ratio<0.92) { window.__CTX=window.__CTX||{}; window.__CTX.thresholdPassed=false; return; }
    window.__CTX=window.__CTX||{}; window.__CTX.thresholdPassed=true;
    const completedKey=window.location.pathname+'|'+(window.__VID?window.__VID.d:d)+'|patch';
    if (window.__CTX.endedSentFor === completedKey) return;
    // Kiểm tra đã gọi progress chưa
    let progressOK=false;
    try {
      progressOK=!!window.__CTX.progressOK;
      if(!progressOK) { progressOK = await trySendCourseraProgressFirst(video); window.__CTX.progressOK=progressOK; }
    } catch(e){window.__SKIP_SEND_LOG&&window.__SKIP_SEND_LOG('PROGRESS','ex',e.message);}
    if (!progressOK) {window.__SKIP_SEND_LOG&&window.__SKIP_SEND_LOG('PROGRESS','fail'); return;}
    // Tiếp tục gửi ended
    const m=window.location.pathname.match(/\/learn\/([^\/]+)\/lecture\/([^\/?#]+)/);
    if(!m)return;
    const courseSlug=m[1],itemId=m[2];
    const userId=window.__CTX.userId;
    if(!userId)return;
    const url=`https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${courseSlug}/item/${itemId}/lecture/videoEvents/ended?autoEnroll=false`;
    let res=await fetch(url,{
      method:'POST',credentials:'include',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({contentRequestBody:{}})
    });
    window.__SKIP_SEND_LOG&&window.__SKIP_SEND_LOG('ENDED',res.status);
    if(res.status>=200&&res.status<300){window.__CTX.endedSentFor=completedKey;return true;}
    // Nếu vẫn chưa đủ, kích hoạt mô phỏng!
    window.skipAutoPlayRush && window.skipAutoPlayRush(video);
    return false;
  } catch(e){window.__SKIP_SEND_LOG&&window.__SKIP_SEND_LOG('ENDED','ex',e.message);}
}

// ---- Improved FLOAT BUTTON UI using tailwind/antd inspiration ----
(function setupSkipToolButton() {
  try {
    if (document.getElementById('skip-tool-float-btn')) return;

    // Inline modern gradient+shadow style
    const style = document.createElement('style');
    style.innerHTML = `
      #skip-tool-float-btn {
        position: fixed;
        right: 32px;
        bottom: 38px;
        z-index: 2147483647;
        width: 60px; height: 60px;
        border-radius: 50%;
        background: linear-gradient(135deg,#00c6ff,#0072ff 80%);
        box-shadow: 0 5px 35px 0 rgba(24,118,255,0.30),0 1.5px 8px 0 rgba(28,60,120,0.07);
        color: #fff;
        display: flex; align-items: center; justify-content: center;
        font-size: 32px;
        cursor: pointer;
        opacity: 0.97;
        outline: none; border: none;
        transition: background 0.21s, box-shadow 0.19s, opacity 0.19s, filter 0.15s;
        user-select: none;
        overflow: visible;
      }
      #skip-tool-float-btn.off {
        background: linear-gradient(135deg,#b0b0b0,#747474 80%);
        color: #f9f9f9;
        filter: grayscale(0.4) brightness(0.85);
        opacity: 0.77;
      }
      #skip-tool-float-btn:active {
        box-shadow: 0 1px 6px 0 #2196F3;
        opacity: 0.88;
      }
      #skip-tool-float-btn .twicon {
        transition: transform 0.23s cubic-bezier(.82,0,.47,1.26);
      }
      #skip-tool-float-btn.active .twicon {
        transform: scale(1.22) rotate(16deg);
      }
      #skip-tool-float-btn-ripple {
        position: absolute; left: 0; top: 0;
        width: 100%; height: 100%; border-radius:50%;
        background: rgba(255,255,255,.28);
        opacity: 0; pointer-events:none;
        transition: opacity 0.31s, transform 0.35s;
      }
      #skip-tool-float-btn.ripple #skip-tool-float-btn-ripple {
        opacity: 1; transform: scale(1.65);
      }
      #skip-tool-float-btn-label {
        pointer-events: none;
        position: absolute; right: 72px; bottom: 10px;
        background: rgba(24,24,30,.97); color: #d2e3ff;
        padding: 9px 22px; border-radius: 10px; font-size: 15px; line-height: 1.45;
        box-shadow: 0px 3px 8px 0 rgba(24,30,70,0.19);
        font-weight: 500; letter-spacing: 0.01em;
        opacity: 1;
        white-space: nowrap;
        filter: drop-shadow(0 1.5px 2px #0001);
      }
    `;
    document.head.appendChild(style);

    // Button
    const btn = document.createElement('div');
    btn.id = 'skip-tool-float-btn';
    btn.innerHTML = `
      <span class="twicon" style="font-size:35px;display:inline-block">⏩</span>
      <span id="skip-tool-float-btn-ripple"></span>
    `;
    btn.title = 'Bật/Tắt Skip Tool';
    btn.className = window.__SKIP_TOOL_ENABLED ? 'active' : 'off';

    function setBtnState(enabled) {
      if (enabled) {
        btn.classList.add('active'); btn.classList.remove('off');
        btn.title = 'Đang bật: Tự động skip và tích xanh (click để mở log/tool)';
      } else {
        btn.classList.remove('active'); btn.classList.add('off');
        btn.title = 'ĐANG TẮT: Không tự động skip/fake time (click để mở tool)';
      }
    }
    window.__SKIP_TOOL_ENABLED = (window.__SKIP_TOOL_ENABLED === undefined) ? true : window.__SKIP_TOOL_ENABLED;
    setBtnState(window.__SKIP_TOOL_ENABLED);

    btn.addEventListener('click', function (e) {
      if(popover&&popover.parentNode){popover.parentNode.removeChild(popover);popover=null;return;}
      popover=document.createElement('div');popover.id='skip-tool-float-btn-popover';document.body.appendChild(popover);setTimeout(renderPopoverIfOpen,20);e.preventDefault();e.stopPropagation();return false;
    });
    // Tooltip
    let label;
    btn.addEventListener('mouseenter', function() {
      if (label) return;
      label = document.createElement('span');
      label.id = 'skip-tool-float-btn-label';
      label.textContent = window.__SKIP_TOOL_ENABLED ? 'Đang bật: Skip & Tick xanh tự động' : 'TẮT: Không skip/fake';
      document.body.appendChild(label);
      const rect = btn.getBoundingClientRect();
      label.style.right = (window.innerWidth - rect.right + 18)+'px';
      label.style.bottom = (window.innerHeight - rect.bottom + 10)+'px';
    });
    btn.addEventListener('mouseleave', function() {
      if (!label) return;
      if (label.parentNode) label.parentNode.removeChild(label);
      label = null;
    });

    document.body.appendChild(btn);
    // Restore state if present
    try {
      const stored = window.localStorage.getItem('__SKIP_TOOL_ENABLED');
      if (stored === '1') { window.__SKIP_TOOL_ENABLED = true; setBtnState(true); }
      else if (stored === '0') { window.__SKIP_TOOL_ENABLED = false; setBtnState(false); }
    } catch(_) {}
  } catch(e) { /* log error */ }
})();

// ---- LOGIC: Burst LearningHours fake đủ thời lượng khi seek ----
(function patchLearningHoursBurst() {
  // Patch postLearningHours và burst logic if skipped
  let _postLearningHours = window.postLearningHours || postLearningHours;
  function safePostLearningHours(durMs = 30000) {
    if (!window.__SKIP_TOOL_ENABLED) return;
    return _postLearningHours(durMs);
  }
  window.postLearningHours = safePostLearningHours;

  // Patch: khi tua (seeked), gửi burst tính đúng tổng duration vừa skip
  document.addEventListener('seeked', function(event) {
    if (!window.__SKIP_TOOL_ENABLED) return;
    let v = event.target;
    if (!(v instanceof HTMLVideoElement)) return;
    if (!window.__LH || !window.__LH.template) return;
    const prev = (typeof v.__lastTime === 'number') ? v.__lastTime : 0;
    const cur = v.currentTime || 0;
    const delta = Math.abs(cur - prev);
    let toSend = 0;
    if (delta > 5) {
      // Tính tổng số burst gửi đủ phần vừa skip
      let totalDuration = Math.ceil(delta) * 1000;
      let sent = 0, each = 30000; // 30s 
      while (sent + each <= totalDuration) {
        setTimeout(()=>safePostLearningHours(each), sent/10); // tản đều để không quá spam
        sent += each;
      }
      let dư = totalDuration-sent;
      if (dư > 0) setTimeout(()=>safePostLearningHours(dư), sent/10);
    }
  }, true);

  // Khi đã tới >92%, kiểm tra tổng watch time gửi LearningHours >= 92% duration, nếu thiếu gửi bù
  setInterval(function() {
    if (!window.__SKIP_TOOL_ENABLED) return;
    const v = document.querySelector('video');
    if (!v || !window.__LH || !window.__LH.template) return;
    const d = v.duration;
    const ct = v.currentTime;
    if (d && ct && ct/d > 0.91) {
      // Ước lượng tổng time đã gửi lên từ LH template count
      // (hoặc có thể thêm bộ đếm thực tế nếu muốn exact)
      // Nếu thiếu phần nhỏ, gửi bù cho chắc
      safePostLearningHours(Math.max(0, d*1000-ct*1000));
    }
  }, 8000);
})();

// Patch: ĐIỀU KIỆN HOẠT ĐỘNG tih năng skip/fake chỉ KHI window.__SKIP_TOOL_ENABLED === true
// === PATCH CÁC CHỨC NĂNG AUTO-SKIP, FAKE LEARNING, AUTO COMPLETION... ===
(function patchSkipGuardLogic() {
  // Patch toàn bộ entry cho hook và các hàm phụ
  const guard = (fn) => function patched() {
    if (!window.__SKIP_TOOL_ENABLED) return;
    return fn.apply(this, arguments);
  };
  try {
    // Patch các sự kiện video
    const proto = HTMLMediaElement.prototype;
    const origSet = Object.getOwnPropertyDescriptor(proto, 'currentTime')?.set;
    const origGet = Object.getOwnPropertyDescriptor(proto, 'currentTime')?.get;
    if (origSet && origGet && !origSet.__skipGuardWrap) {
      Object.defineProperty(proto, 'currentTime', {
        configurable: true,
        enumerable: true,
        get: function() { return origGet.call(this); },
        set: function(v) {
          if (!window.__SKIP_TOOL_ENABLED) return origSet.call(this, v);
          return origSet.call(this, v);
        }
      });
      Object.defineProperty(proto, 'currentTime', { __skipGuardWrap: true });
    }
  } catch(_) {}
  // patch postLearningHours
  if (typeof postLearningHours === 'function') {
    window.postLearningHours = guard(postLearningHours);
  }
  // patch trySendEndedIfThreshold
  if (typeof trySendEndedIfThreshold === 'function') {
    window.trySendEndedIfThreshold = guard(trySendEndedIfThreshold);
  }
})();

// --- AUTO-PLAY REAL đoạn cuối để Coursera tick xanh chuẩn ---
let skipPlayNativeTask = null;
window.skipForceRealPlayback = async function(video) {
  if (!video || !window.__SKIP_TOOL_ENABLED) return;
  if (skipPlayNativeTask && skipPlayNativeTask.timer) clearInterval(skipPlayNativeTask.timer);
  skipPlayNativeTask = { stopped: false };
  // Set playbackRate max, force play
  try { video.playbackRate = 16; } catch(_) { video.playbackRate = 2; }
  try { video.muted = true; } catch(_) {}
  video.currentTime = Math.max(video.currentTime, Math.floor(video.duration*0.90));
  try { video.play(); } catch(_) {}
  let showLog = function(msg) { window.__SKIP_SEND_LOG && window.__SKIP_SEND_LOG('REAL', msg); };
  showLog('Bắt đầu auto-play real đoạn cuối (tick xanh nhanh nhất)');
  // Cập nhật log trên popover progress
  if (document.visibilityState !== 'visible') {
    try { window.focus(); } catch(_) {}
    showLog('⚠️ Tab này nên để foreground để Coursera nhận play real!');
  }
  skipPlayNativeTask.timer = setInterval(async function() {
    if (!window.__SKIP_TOOL_ENABLED) { video.pause(); clearInterval(skipPlayNativeTask.timer); showLog('Ng. dùng đã tắt auto-play (pause)'); return; }
    let prog = ((video.currentTime||0)/(video.duration||1))*100;
    showLog(`Auto-play real: ${(video.currentTime||0).toFixed(1)}/${(video.duration||0).toFixed(1)} (${prog.toFixed(1)}%) @${video.playbackRate}x`);
    if (video.currentTime+1 >= 0.96*video.duration) {
      clearInterval(skipPlayNativeTask.timer);
      video.pause();
      showLog('Enough auto-played! Đang gửi tick xanh lại...');
      let ok = await window.trySendEndedIfThreshold(video);
      if (ok) showLog('Tick xanh thành công! Dừng auto-play.');
      else showLog('Vẫn chưa tick xanh, có thể play lại thêm hoặc thử reload!');
    }
  }, 1000);
};
// Khi tất cả các patch fake khác thất bại, gọi skipForceRealPlayback(video) ở cuối trySendEndedIfThreshold()
window._orig_trySendEnded = window.trySendEndedIfThreshold || trySendEndedIfThreshold;
window.trySendEndedIfThreshold = async function(video) {
  try {
    if (!window.__SKIP_TOOL_ENABLED) return;
    if (!video) return;
    const d = Number(video.duration||0), t = Number(video.currentTime||0);
    if (!d||!t) return;
    const ratio = t/d;
    if (ratio<0.92) { window.__CTX=window.__CTX||{}; window.__CTX.thresholdPassed=false; return; }
    window.__CTX=window.__CTX||{}; window.__CTX.thresholdPassed=true;
    const completedKey=window.location.pathname+'|'+(window.__VID?window.__VID.d:d)+'|patch';
    if (window.__CTX.endedSentFor === completedKey) return true;
    // Kiểm tra đã gọi progress chưa
    let progressOK=false;
    try {
      progressOK=!!window.__CTX.progressOK;
      if(!progressOK) { progressOK = await trySendCourseraProgressFirst(video); window.__CTX.progressOK=progressOK; }
    } catch(e){window.__SKIP_SEND_LOG&&window.__SKIP_SEND_LOG('PROGRESS','ex',e.message);}
    if (!progressOK) {window.__SKIP_SEND_LOG&&window.__SKIP_SEND_LOG('PROGRESS','fail'); return;}
    // Tiếp tục gửi ended
    const m=window.location.pathname.match(/\/learn\/([^\/]+)\/lecture\/([^\/?#]+)/);
    if(!m)return;
    const courseSlug=m[1],itemId=m[2];
    const userId=window.__CTX.userId;
    if(!userId)return;
    const url=`https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${courseSlug}/item/${itemId}/lecture/videoEvents/ended?autoEnroll=false`;
    let res=await fetch(url,{
      method:'POST',credentials:'include',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({contentRequestBody:{}})
    });
    window.__SKIP_SEND_LOG&&window.__SKIP_SEND_LOG('ENDED',res.status);
    if(res.status>=200&&res.status<300){window.__CTX.endedSentFor=completedKey;return true;}
    // Nếu tất cả các patch fake vẫn FAIL, auto-play real để chắc chắn tick xanh!
    window.skipForceRealPlayback && window.skipForceRealPlayback(video);
    return false;
  } catch(e){window.__SKIP_SEND_LOG&&window.__SKIP_SEND_LOG('ENDED','ex',e.message);}
}


