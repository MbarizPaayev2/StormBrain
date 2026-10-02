/* sb.js - StormBrain local helpers (window.SB). */
(function (window, document) {
  'use strict';
  var SB = {};
  SB.version = '1.0.0';

  SB.escapeHtml = function (s) {
    var d = document.createElement('div');
    d.textContent = (s === null || s === void 0) ? '' : String(s);
    return d.innerHTML;
  };
  SB.truncate = function (s, n) {
    s = String(s === null || s === void 0 ? '' : s);
    n = n || 100;
    return s.length > n ? s.slice(0, n) + '...' : s;
  };
  SB.num = function (v, fb) {
    var n = Number(v);
    return isFinite(n) ? n : (fb === void 0 ? 0 : fb);
  };
  SB.formatDateTime = function (d) {
    try {
      var t = d instanceof Date ? d : new Date(d === void 0 ? Date.now() : d);
      return t.toLocaleString();
    } catch (e) { return String(d || ''); }
  };
  SB.formatDateShort = function (d) {
    try {
      var t = d instanceof Date ? d : new Date(d);
      return t.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    } catch (e) { return ''; }
  };
  SB.todayLabel = function (ago) {
    var t = new Date();
    t.setDate(t.getDate() - (ago || 0));
    return SB.formatDateShort(t);
  };
  function ensureToastBox() {
    var box = document.getElementById('sb-toast-box');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'sb-toast-box';
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
    return box;
  }
  function localToast(title, desc, type) {
    try {
      var shortDesc = SB.truncate(String(desc == null ? '' : desc).replace(/\s+/g, ' ').trim(), 160);
      var box = ensureToastBox();
      var el = document.createElement('div');
      el.className = 'sb-toast sb-toast-' + (type || 'info');
      el.innerHTML =
        '<div class="sb-toast-title">' + SB.escapeHtml(title || 'StormBrain') + '</div>' +
        (shortDesc ? '<div class="sb-toast-desc">' + SB.escapeHtml(shortDesc) + '</div>' : '');
      box.appendChild(el);
      while (box.children.length > 4) box.removeChild(box.firstChild);
      setTimeout(function () {
        el.className += ' sb-toast-hide';
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
      }, 4000);
    } catch (e) {}
  }
  SB.notify = function (title, desc, type) {
    var t = type || 'success';
    try {
      if (window.GrowlNotification && window.GrowlNotification.notify) {
        window.GrowlNotification.notify({
          title: title, description: SB.truncate(desc || '', 100),
          type: t === 'error' ? 'error' : 'success',
          closeTimeout: 4000, showProgress: true
        });
        return;
      }
    } catch (e) {}
    localToast(title, desc, t);
  };
  SB.showNotif = SB.notify;
  SB.toast = SB.notify;

  SB.ajaxMessage = function (xhr, fallback) {
    if (xhr && xhr.responseJSON) {
      return xhr.responseJSON.message || xhr.responseJSON.error || fallback || 'Error';
    }
    if (xhr && xhr.status === 0) return 'Offline / server elcatmazdir';
    if (xhr && xhr.status) return (fallback || 'Error') + ' (HTTP ' + xhr.status + ')';
    return fallback || 'Error';
  };
  SB.ajaxError = function (xhr, fallback, opts) {
    if (fallback && typeof fallback === 'object' && !opts) { opts = fallback; fallback = 'Error'; }
    var msg = SB.ajaxMessage(xhr, fallback);
    if (opts && opts.silent) { try { console.warn('[SB] ajax:', msg); } catch (e) {} return msg; }
    SB.notify('Xeta', msg, 'error');
    return msg;
  };
  SB.quietError = function (xhr) { return SB.ajaxError(xhr, 'Error', { silent: true }); };

  SB.chartReady = function () { return typeof window.Chart !== 'undefined'; };
  SB.leafletReady = function () { return !!(window.L && window.L.map); };
  SB.offline = function () { return typeof navigator !== 'undefined' && navigator.onLine === false; };
  SB.createChart = function (ctx, cfg) {
    if (!SB.chartReady()) { SB.chartPlaceholder(typeof ctx === 'string' ? ctx : null); return null; }
    try {
      var el = typeof ctx === 'string' ? document.getElementById(ctx) : ctx;
      if (!el) return null;
      return new window.Chart(el, cfg);
    } catch (e) { return null; }
  };
  SB.chartPlaceholder = function (id, text) {
    if (!id || SB.chartReady()) return;
    var el = document.getElementById(id);
    if (el && el.parentNode && !el.parentNode.querySelector('[data-sb-chart-note]')) {
      var p = document.createElement('p');
      p.setAttribute('data-sb-chart-note', '1');
      p.style.cssText = 'color:var(--text-secondary);text-align:center;padding:12px 0;font-size:12px;';
      p.textContent = text || 'Qrafik offline-dir (Chart.js elcatmazdir).';
      el.parentNode.appendChild(p);
    }
  };
  SB.createMap = function (id, view, zoom) {
    if (!SB.leafletReady()) {
      var el = document.getElementById(id || 'map');
      if (el && !el.getAttribute('data-sb-offline')) {
        el.setAttribute('data-sb-offline', '1');
        el.innerHTML = '<p style="color:var(--text-secondary);text-align:center;' +
          'padding:40px 20px;">Xerite offline-dir (Leaflet/CDN elcatmazdir).</p>';
      }
      return null;
    }
    var m = window.L.map(id || 'map').setView(view || [20, 0], zoom || 2);
    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd', maxZoom: 19
    }).addTo(m);
    window.L.control.scale({ metric: true, imperial: false }).addTo(m);
    return m;
  };

  try {
    window.addEventListener('offline', function () {
      localToast('Offline', 'Server/CDN elcatan deyil.', 'error');
    });
  } catch (e) {}

  window.SB = SB;
})(window, document);

