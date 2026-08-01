// Premium Status Manager for StudyTools
// This script handles user premium status detection and UI updates

(function() {
  'use strict';

  const PremiumManager = {
    // Check if user is premium
    isUserPremium: function() {
      // Check current user first
      const currentUser = JSON.parse(localStorage.getItem('studytools_current_user') || 'null');
      if (currentUser && currentUser.isPremium) {
        return true;
      }

      // Check subscription data
      const subscriptionData = JSON.parse(localStorage.getItem('studytools_subscription') || 'null');
      if (subscriptionData && subscriptionData.isActive) {
        return true;
      }

      return false;
    },

    // Get current user
    getCurrentUser: function() {
      return JSON.parse(localStorage.getItem('studytools_current_user') || 'null');
    },

    // Add premium badge to navigation
    addPremiumBadge: function() {
      if (!this.isUserPremium()) return;

      const navLinks = document.querySelector('.nav-links');
      if (navLinks && !document.querySelector('.premium-badge')) {
        const badge = document.createElement('span');
        badge.className = 'premium-badge';
        badge.innerHTML = '⭐ Pro';
        badge.style.cssText = `
          background: linear-gradient(135deg, var(--accent), var(--mint));
          color: white;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 700;
          margin-left: 8px;
          cursor: pointer;
        `;
        badge.onclick = () => window.location.href = '/pro.html';
        navLinks.appendChild(badge);
      }
    },

    // Add login button to navigation
    addLoginButton: function() {
      const currentUser = this.getCurrentUser();
      const navLinks = document.querySelector('.nav-links');
      
      if (!navLinks) return;

      // Remove existing login/logout button if any
      const existingAuthBtn = document.querySelector('.auth-button');
      if (existingAuthBtn) existingAuthBtn.remove();

      const authBtn = document.createElement('a');
      authBtn.className = 'auth-button';
      
      if (currentUser) {
        authBtn.textContent = 'Logout';
        authBtn.href = '#';
        authBtn.onclick = (e) => {
          e.preventDefault();
          this.logout();
        };
      } else {
        authBtn.textContent = 'Login';
        authBtn.href = '/auth.html';
      }

      authBtn.style.cssText = `
        color: var(--muted);
        font-size: 0.9rem;
        font-weight: 700;
        padding: 9px 12px;
        border-radius: 8px;
        margin-left: 8px;
      `;
      authBtn.onmouseover = function() { this.style.color = 'var(--text)'; this.style.background = 'rgba(255,255,255,0.06)'; };
      authBtn.onmouseout = function() { this.style.color = 'var(--muted)'; this.style.background = 'transparent'; };

      navLinks.appendChild(authBtn);
    },

    // Logout user
    logout: function() {
      localStorage.removeItem('studytools_current_user');
      // Keep subscription data as it's tied to PayPal, not session
      window.location.href = '/';
    },

    // Lock premium features
    lockPremiumFeatures: function() {
      if (this.isUserPremium()) return;

      // Find elements with premium-lock class
      const premiumElements = document.querySelectorAll('.premium-lock');
      premiumElements.forEach(element => {
        element.style.opacity = '0.5';
        element.style.pointerEvents = 'none';
        element.style.position = 'relative';

        // Add lock overlay
        if (!element.querySelector('.premium-overlay')) {
          const overlay = document.createElement('div');
          overlay.className = 'premium-overlay';
          overlay.innerHTML = `
            <div style="
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: rgba(0,0,0,0.7);
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              border-radius: inherit;
              color: white;
              text-align: center;
              padding: 1rem;
            ">
              <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔒</div>
              <div style="font-weight: 700; margin-bottom: 0.5rem;">Premium Feature</div>
              <div style="font-size: 0.85rem; opacity: 0.9;">Upgrade to Pro to unlock</div>
              <a href="/pro.html" style="
                margin-top: 1rem;
                background: linear-gradient(135deg, var(--accent), var(--mint));
                color: white;
                padding: 0.5rem 1rem;
                border-radius: 6px;
                text-decoration: none;
                font-weight: 700;
                font-size: 0.85rem;
              ">Upgrade Now</a>
            </div>
          `;
          element.appendChild(overlay);
        }
      });
    },

    // Add premium feature badges
    addPremiumBadges: function() {
      const premiumBadges = document.querySelectorAll('.premium-feature');
      premiumBadges.forEach(badge => {
        if (!this.isUserPremium()) {
          badge.innerHTML = `
            <span style="
              background: linear-gradient(135deg, var(--accent), var(--mint));
              color: white;
              padding: 2px 8px;
              border-radius: 999px;
              font-size: 0.7rem;
              font-weight: 700;
              margin-left: 8px;
            ">⭐ Pro</span>
          `;
        }
      });
    },

    // Initialize premium manager
    init: function() {
      this.addPremiumBadge();
      this.addLoginButton();
      this.lockPremiumFeatures();
      this.addPremiumBadges();

      // Dispatch custom event for other scripts to listen
      document.dispatchEvent(new CustomEvent('premiumStatusLoaded', {
        detail: { isPremium: this.isUserPremium() }
      }));
    }
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => PremiumManager.init());
  } else {
    PremiumManager.init();
  }

  // Make available globally
  window.PremiumManager = PremiumManager;

})();