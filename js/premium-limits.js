// Premium Limits System for StudyTools
// Manages usage limits for free vs premium users

(function() {
  'use strict';

  const PremiumLimits = {
    // Usage limits configuration
    limits: {
      free: {
        aiTutorMessages: 10,      // 10 messages per day
        aiTutorMaxLength: 500,    // 500 characters max per message
        advancedCalculations: false,
        exportFeatures: false,
        prioritySupport: false
      },
      premium: {
        aiTutorMessages: 100,     // 100 messages per day
        aiTutorMaxLength: 2000,   // 2000 characters max per message
        advancedCalculations: true,
        exportFeatures: true,
        prioritySupport: true
      }
    },

    // Get current user limits
    getCurrentLimits: function() {
      const currentUser = this.getCurrentUser();
      if (currentUser && currentUser.isPremium) {
        return this.limits.premium;
      }
      return this.limits.free;
    },

    // Check if user is premium
    isUserPremium: function() {
      const currentUser = this.getCurrentUser();
      return currentUser && currentUser.isPremium;
    },

    // Get current user
    getCurrentUser: function() {
      try {
        return JSON.parse(localStorage.getItem('studytools_current_user') || 'null');
      } catch (error) {
        console.error('Error getting current user:', error);
        return null;
      }
    },

    // Get today's usage for a specific feature
    getDailyUsage: function(feature) {
      try {
        const today = new Date().toDateString();
        const usageData = JSON.parse(localStorage.getItem('studytools_usage') || '{}');
        return usageData[today]?.[feature] || 0;
      } catch (error) {
        console.error('Error getting daily usage:', error);
        return 0;
      }
    },

    // Increment usage for a feature
    incrementUsage: function(feature) {
      try {
        const today = new Date().toDateString();
        const usageData = JSON.parse(localStorage.getItem('studytools_usage') || '{}');
        
        if (!usageData[today]) {
          usageData[today] = {};
        }
        
        if (!usageData[today][feature]) {
          usageData[today][feature] = 0;
        }
        
        usageData[today][feature]++;
        localStorage.setItem('studytools_usage', JSON.stringify(usageData));
        
        return usageData[today][feature];
      } catch (error) {
        console.error('Error incrementing usage:', error);
        return 0;
      }
    },

    // Check if user has reached limit for a feature
    hasReachedLimit: function(feature) {
      const limits = this.getCurrentLimits();
      const currentUsage = this.getDailyUsage(feature);
      
      if (feature === 'aiTutorMessages') {
        return currentUsage >= limits.aiTutorMessages;
      }
      
      return false;
    },

    // Get remaining usage for a feature
    getRemainingUsage: function(feature) {
      const limits = this.getCurrentLimits();
      const currentUsage = this.getDailyUsage(feature);
      
      if (feature === 'aiTutorMessages') {
        return Math.max(0, limits.aiTutorMessages - currentUsage);
      }
      
      return Infinity;
    },

    // Check if a feature is available to current user
    isFeatureAvailable: function(feature) {
      const limits = this.getCurrentLimits();
      
      switch (feature) {
        case 'advancedCalculations':
          return limits.advancedCalculations;
        case 'exportFeatures':
          return limits.exportFeatures;
        case 'prioritySupport':
          return limits.prioritySupport;
        default:
          return true;
      }
    },

    // Show premium upgrade prompt
    showUpgradePrompt: function(feature) {
      const message = `You've reached your ${feature} limit for today. Upgrade to Pro for unlimited access.`;
      
      // Create modal
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      `;
      
      modal.innerHTML = `
        <div style="
          background: #13131a;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          padding: 2rem;
          max-width: 400px;
          text-align: center;
          color: #e8e8f0;
        ">
          <div style="font-size: 2rem; margin-bottom: 1rem;">⭐</div>
          <h3 style="font-size: 1.5rem; margin-bottom: 1rem; font-weight: 700;">Upgrade to Pro</h3>
          <p style="color: #7a7a90; margin-bottom: 1.5rem;">${message}</p>
          <div style="display: flex; gap: 1rem; flex-direction: column;">
            <a href="/pro.html" style="
              background: linear-gradient(135deg, #5b6af0, #00d4aa);
              color: white;
              padding: 1rem;
              border-radius: 8px;
              text-decoration: none;
              font-weight: 700;
            ">Upgrade Now</a>
            <button onclick="this.closest('div').parentElement.remove()" style="
              background: transparent;
              border: 1px solid rgba(255,255,255,0.1);
              color: #7a7a90;
              padding: 1rem;
              border-radius: 8px;
              cursor: pointer;
              font-weight: 700;
            ">Maybe Later</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      
      // Close on outside click
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
        }
      });
    },

    // Show usage counter
    showUsageCounter: function(feature, container) {
      const remaining = this.getRemainingUsage(feature);
      const limits = this.getCurrentLimits();
      
      if (feature === 'aiTutorMessages') {
        container.innerHTML = `
          <div style="
            font-size: 0.85rem;
            color: #7a7a90;
            margin-bottom: 1rem;
            text-align: center;
          ">
            ${this.isUserPremium() ? '⭐ Pro' : 'Free'} - ${remaining} messages remaining today
          </div>
        `;
      }
    },

    // Reset usage (for testing or daily reset)
    resetDailyUsage: function() {
      localStorage.removeItem('studytools_usage');
    },

    // Get usage statistics
    getUsageStats: function() {
      try {
        const today = new Date().toDateString();
        const usageData = JSON.parse(localStorage.getItem('studytools_usage') || '{}');
        return usageData[today] || {};
      } catch (error) {
        console.error('Error getting usage stats:', error);
        return {};
      }
    }
  };

  // Make available globally
  window.PremiumLimits = PremiumLimits;

  // Dispatch event when ready
  document.dispatchEvent(new CustomEvent('premiumLimitsLoaded'));

})();