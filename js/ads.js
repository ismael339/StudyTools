// StudyTools ads controller — Monetag In-Page Push display ads, wired into the
// freemium model without scaring readers away.
//
//   <script src="/js/ads.js" defer></script>   (article pages only)
//   <script src="/js/premium-limits.js"></script>  (must load on tutor/tool pages)
//   <script src="/js/consent.js"></script>         (sets studytools_consent)
//
// Rules this file enforces, in order, before it loads anything from Monetag:
//   1. Not on the AI tutor or any tool page — those are the product, ads there
//      push students away. Only pages with og:type=article (the blog) qualify.
//   2. Never for Pro subscribers — "no ads" is a real Pro benefit.
//   3. Never before cookie consent — Monetag sets ad cookies, so we wait for
//      studytools_consent === 'all' (the visitor already opted in to analytics).
//   4. It stays fully inert until ST_CONFIG.monetag.inPagePush.zoneId is filled
//      in, so this file is safe to ship before the Monetag code arrives.
//
// NOTE: Monetag's web platform does NOT offer rewarded video (Rewarded
// Interstitial / Rewarded Popup are SDK-for-TMA only, i.e. Telegram Mini Apps).
// STRewards.canReward() returns false on web, so the "+3 requests" watch-video
// button will not appear. The server-side reward API (/api/reward) and Firestore
// caps remain in place for when you add a rewarded provider later.
//
// Zone ID below comes from your Monetag dashboard (In-Page Push zone).
// You gave: zone '12064180' from nap5k.com/tag.min.js

(function () {
  'use strict';

  var ST_CONFIG = {
    monetag: {
      // In-Page Push zone — shows native-like push ads on the page.
      // Get the zone ID from Monetag → Websites → your site → Zones → In-Page Push.
      inPagePush: {
        zoneId: '12064180'   // <-- your In-Page Push zone ID
      },
      // Rewarded video — NOT available on Monetag web (TMA only). Kept for
      // future use if you switch to a rewarded-capable provider.
      rewarded: {
        zoneId: '',
        rewardPerVideo: 3    // requests granted per completed video (server caps too)
      }
    },
    // Monetag In-Page Push is page-level, not per-article container. One tag
    // per page is enough; keep max at 1 to avoid over-monetising.
    maxDisplayPerArticle: 1
  };

  var AD_LABEL = 'Advertisement';

  function consented() {
    try { return localStorage.getItem('studytools_consent') === 'all'; } catch (e) { return false; }
  }

  function isPro() {
    try { return !!(window.PremiumLimits && PremiumLimits.isUserPremium()); }
    catch (e) { return false; }
  }

  function isArticlePage() {
    var og = document.querySelector('meta[property="og:type"][content="article"]');
    if (!og) return false;
    // Belt and braces: never on the tutor or a tool, even if mis-tagged.
    var path = location.pathname;
    var deny = /\/(study-assistant|exam-solver|citation-generator|flashcard-maker|gpa-calculator|grade-calculator|planner|pomodoro-timer|study-schedule|drill|app|pro|play)\.html?$/i;
    return !deny.test(path);
  }

  function canShowAds() {
    var d = ST_CONFIG.monetag.inPagePush;
    return !!(d.zoneId) && isArticlePage() && !isPro() && consented();
  }

  // Monetag In-Page Push tag: self-executing snippet that appends a
  // <script data-zone="..."> with src=https://nap5k.com/tag.min.js to the page.
  // One tag per page is the reliable pattern.
  function loadInPagePush() {
    var s = document.createElement('script');
    s.dataset.zone = ST_CONFIG.monetag.inPagePush.zoneId;
    s.src = 'https://nap5k.com/tag.min.js';
    s.async = true;
    document.body.appendChild(s);
  }

  // Insert nothing into the DOM for In-Page Push — Monetag renders its own
  // push-style creative. We only need to load the tag once per page.
  function injectDisplay() {
    if (!canShowAds()) return;
    if (document.querySelector('script[data-st-monetag-loaded]')) return; // already loaded
    loadInPagePush();
    var marker = document.createElement('script');
    marker.dataset.stMonetagLoaded = '1';
    document.body.appendChild(marker);
  }

  // ---- public API used by the upgrade modal (rewards) ----
  var STRewards = {
    config: ST_CONFIG,

    // True when a rewarded unit is configured and the visitor is eligible
    // (free tier). Pro never sees it — they have no daily limit to top up.
    // Monetag web has no rewarded video, so this returns false unless you
    // wire a different rewarded provider here.
    canReward: function () {
      return false;
    },

    // Stub — no rewarded provider wired on Monetag web. onComplete(false)
    // so the modal falls back gracefully (no "Watch video" button shown).
    play: function (container, onComplete) {
      if (onComplete) onComplete(false);
    }
  };

  window.STAds = { config: ST_CONFIG, canShowAds: canShowAds, injectDisplay: injectDisplay };
  window.STRewards = STRewards;

  function start() {
    // Pro state loads async; re-check once entitlement is ready so a Pro user
    // never sees an ad flash in.
    injectDisplay();
    document.addEventListener('premiumLimitsLoaded', injectDisplay);
    document.addEventListener('authStateReady', function () { setTimeout(injectDisplay, 300); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
