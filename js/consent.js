// StudyTools cookie consent + Google Consent Mode v2.
//
// Loaded in <head> BEFORE Google Tag Manager / gtag, so every analytics tag
// starts in the "denied" state and nothing is collected until the visitor
// accepts in the banner. Footer "Cookies" links (class="js-cookie-settings")
// reopen the banner so the choice can be changed at any time.
// Storage key: studytools_consent = "all" | "none".
(function () {
  'use strict';

  var KEY = 'studytools_consent';
  var DENIED = {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied'
  };
  var GRANTED = {
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
    analytics_storage: 'granted'
  };

  var storage = null;
  try { storage = window.localStorage; } catch (e) { storage = null; }

  function read() {
    try { return storage ? storage.getItem(KEY) : null; } catch (e) { return null; }
  }
  function save(value) {
    try { if (storage) storage.setItem(KEY, value); } catch (e) { /* private mode */ }
  }

  // Consent commands must be queued before any tag loads.
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  gtag('consent', 'default', DENIED);

  var saved = read();
  if (saved === 'all') gtag('consent', 'update', GRANTED);
  if (saved === 'none') gtag('consent', 'update', DENIED);

  function apply(value) {
    save(value);
    gtag('consent', 'update', value === 'all' ? GRANTED : DENIED);
    window.dataLayer.push({ event: 'st_consent_' + value });
    saved = value;
  }

  var STYLE = '#st-consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;' +
    'max-width:640px;margin:0 auto;background:#fff;color:#0f172a;border:1px solid #dbe4f0;' +
    'border-radius:14px;box-shadow:0 18px 50px rgba(15,23,42,.18);padding:16px 18px;' +
    'font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '#st-consent p{margin:0 0 12px;color:#334155}' +
    '#st-consent p a{color:#1d4ed8;font-weight:700;text-decoration:underline}' +
    '#st-consent .st-row{display:flex;gap:10px;flex-wrap:wrap}' +
    '#st-consent button{font:inherit;font-weight:800;border-radius:10px;padding:10px 16px;' +
    'cursor:pointer;border:1px solid #dbe4f0;background:#fff;color:#0f172a}' +
    '#st-consent button.st-accept{background:#2563eb;border-color:#2563eb;color:#fff}';

  function hide() {
    var el = document.getElementById('st-consent');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function show() {
    if (!document.body) return;
    hide();
    if (!document.getElementById('st-consent-style')) {
      var style = document.createElement('style');
      style.id = 'st-consent-style';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    var box = document.createElement('div');
    box.id = 'st-consent';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Cookie consent');
    box.innerHTML =
      '<p>We use Google analytics cookies to see which study tools help most students. ' +
      'Necessary cookies keep the site working; nothing else runs until you agree. ' +
      '<a href="/privacy.html">How we use them</a></p>' +
      '<div class="st-row">' +
      '<button type="button" class="st-accept">Accept analytics</button>' +
      '<button type="button" class="st-reject">Only necessary</button>' +
      '</div>';
    document.body.appendChild(box);
    box.querySelector('.st-accept').addEventListener('click', function () {
      apply('all'); hide();
    });
    box.querySelector('.st-reject').addEventListener('click', function () {
      apply('none'); hide();
    });
  }

  // Footer "Cookies" links reopen the banner.
  function onClick(event) {
    var node = event.target;
    while (node && node !== document) {
      if (node.classList && node.classList.contains('js-cookie-settings')) {
        event.preventDefault();
        show();
        return;
      }
      node = node.parentNode;
    }
  }

  function start() {
    if (!saved) show();
    document.addEventListener('click', onClick);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
