// Premium Status Manager for StudyTools
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
    isUserPremium() {
      try {
        const currentUser = JSON.parse(localStorage.getItem('studytools_current_user') || 'null');
        const subscription = JSON.parse(localStorage.getItem('studytools_subscription') || 'null');
        return Boolean(currentUser?.isPremium || subscription?.isActive);
      } catch (_) {
        return false;
      }
    },

    getCurrentUser() {
      try { return JSON.parse(localStorage.getItem('studytools_current_user') || 'null'); }
      catch (_) { return null; }
    },

    addPremiumBadge() {
      if (!this.isUserPremium()) return;
      const navLinks = document.querySelector('.nav-links');
      if (!navLinks || document.querySelector('.premium-badge')) return;
      const badge = document.createElement('a');
      badge.className = 'premium-badge';
      badge.href = '/pro.html';
      badge.textContent = 'Pro';
      navLinks.appendChild(badge);
    },

    addLoginButton() {},
    logout() {},

    lockPremiumFeatures() {
      if (this.isUserPremium()) return;
      document.querySelectorAll('.premium-lock').forEach(element => {
        element.style.opacity = '0.5';
        element.style.pointerEvents = 'none';
        element.style.position = 'relative';
        if (element.querySelector('.premium-overlay')) return;
        const overlay = document.createElement('div');
        overlay.className = 'premium-overlay';
        overlay.innerHTML = '<div class="premium-overlay-inner"><strong>Premium feature</strong><span>Upgrade to Pro to unlock</span><a href="/pro.html">View Pro</a></div>';
        element.appendChild(overlay);
      });
    },

    addPremiumBadges() {
      document.querySelectorAll('.premium-feature').forEach(element => {
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
      this.addPremiumBadge();
      this.lockPremiumFeatures();
      this.addPremiumBadges();
      document.dispatchEvent(new CustomEvent('premiumStatusLoaded', {
        detail: { isPremium: this.isUserPremium() }
      }));
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => PremiumManager.init());
  } else {
    PremiumManager.init();
  }

  window.PremiumManager = PremiumManager;
})();
