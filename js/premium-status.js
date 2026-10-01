// Premium Status Manager for StudyTools.
//
// This used to unlock the interface from localStorage.getItem('studytools_user_plan'),
// which meant editing one value in devtools gave anyone Pro. The badge and the
// locks now wait for /api/entitlement, the same server answer api/chat.js
// enforces, so a tampered browser can only change a picture, not an allowance.

(function () {
  'use strict';

  function loadSharedToolTheme() {
    if (document.querySelector('link[data-studytools-tool-theme]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/tool-pages.css';
    link.dataset.studytoolsToolTheme = 'true';
    document.head.appendChild(link);
  }

  const PremiumManager = {
    resolved: false,
    premium: false,
    currentUser: null,
    waiting: [],

    isUserPremium() {
      if (window.PremiumLimits && typeof window.PremiumLimits.isUserPremium === 'function') {
        return window.PremiumLimits.isUserPremium();
      }
      return this.premium === true;
    },

    getCurrentUser() {
      return this.currentUser;
    },

    // Ask the server, then run whatever was queued while we were waiting.
    resolve() {
      if (!window.PremiumLimits || typeof window.PremiumLimits.refresh !== 'function') {
        this.apply(false);
        return Promise.resolve(false);
      }
      return window.PremiumLimits.refresh(true).then((state) => {
        this.apply(state.active === true);
        return state.active === true;
      });
    },

    onResolved(callback) {
      if (this.resolved) {
        callback(this.premium);
        return;
      }
      this.waiting.push(callback);
    },

    apply(isPremium) {
      this.premium = isPremium;
      this.resolved = true;
      this.addPremiumBadge();
      this.lockPremiumFeatures();
      this.addPremiumBadges();
      const queued = this.waiting.slice();
      this.waiting.length = 0;
      queued.forEach((callback) => { try { callback(isPremium); } catch (error) { /* ignore */ } });
      document.dispatchEvent(new CustomEvent('premiumStatusLoaded', {
        detail: { isPremium: isPremium, source: 'server' }
      }));
    },

    addPremiumBadge() {
      if (!this.isUserPremium()) return;
      const navLinks = document.querySelector('.nav-links, .public-nav');
      if (!navLinks || document.querySelector('.premium-badge')) return;
      const badge = document.createElement('a');
      badge.className = 'premium-badge';
      badge.href = '/dashboard.html';
      badge.textContent = 'Pro';
      navLinks.appendChild(badge);
    },

    addLoginButton() {},
    logout() {},

    lockPremiumFeatures() {
      if (this.isUserPremium()) {
        document.querySelectorAll('.premium-lock').forEach((element) => {
          element.style.opacity = '1';
          element.style.pointerEvents = 'auto';
          const overlay = element.querySelector('.premium-overlay');
          if (overlay) overlay.remove();
        });
        return;
      }
      document.querySelectorAll('.premium-lock').forEach((element) => {
        element.style.opacity = '0.5';
        element.style.pointerEvents = 'none';
        element.style.position = 'relative';
        if (element.querySelector('.premium-overlay')) return;
        const overlay = document.createElement('div');
        overlay.className = 'premium-overlay';
        overlay.innerHTML = '<div class="premium-overlay-inner"><strong>Pro feature</strong><span>Upgrade to StudyTools Pro to unlock</span><a href="/pro.html">View Pro plans</a></div>';
        element.appendChild(overlay);
      });
    },

    addPremiumBadges() {
      document.querySelectorAll('.premium-feature').forEach((element) => {
        if (!this.isUserPremium() && !element.querySelector('.premium-badge')) {
          const badge = document.createElement('span');
          badge.className = 'premium-badge';
          badge.textContent = 'Pro';
          element.appendChild(badge);
        }
      });
    },

    init() {
      loadSharedToolTheme();
      this.resolve();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => PremiumManager.init());
  } else {
    PremiumManager.init();
  }

  window.PremiumManager = PremiumManager;
})();