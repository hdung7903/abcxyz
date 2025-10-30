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
    const payload = [
      {
        operationName: 'LearningHours_SendEvent',
        variables: {
          input: {
            heartbeat: {
              courseId: t.courseId,
              courseBranchId: t.courseBranchId,
              eventPlatform: t.eventPlatform,
              userActionType: 'VIDEO_PLAYING',
              durationMilliSeconds: durationMs,
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

function trySendEndedIfThreshold(video) {
  try {
    if (!video) return;
    const d = Number(video.duration || 0);
    const t = Number(video.currentTime || 0);
    if (!d || !t) return;
    const ratio = t / d;
    if (ratio < 0.92) { window.__CTX = window.__CTX || {}; window.__CTX.thresholdPassed = false; return; }
    window.__CTX = window.__CTX || {};
    window.__CTX.thresholdPassed = true;

    if (window.__CTX.endedSentFor === (window.location.pathname + '|' + (window.__VID ? window.__VID.d : d))) return;

    // Derive courseSlug and itemId from URL: /learn/:slug/lecture/:itemId
    const m = window.location.pathname.match(/\/learn\/([^\/]+)\/lecture\/([^\/?#]+)/);
    if (!m) return;
    const courseSlug = m[1];
    const itemId = m[2];

    // User ID: from captured context
    const userId = window.__CTX.userId;
    if (!userId) return;

    const url = `https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${courseSlug}/item/${itemId}/lecture/videoEvents/ended?autoEnroll=false`;
    fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    }).then(() => {
      window.__CTX.endedSentFor = window.location.pathname + '|' + (window.__VID ? window.__VID.d : d);
      console.log('[SkipDebug][ended][auto]', { url, percent: (ratio * 100).toFixed(1) + '%' });
    }).catch(() => {});
  } catch(_) {}
}


