// Premium Limits System for StudyTools
// Manages usage limits for free vs premium users

(function() {
  'use strict';

  const PremiumLimits = {
    // Usage limits configuration
    limits: {
      free: {
        aiTutorMessages: 5,       // 5 messages per day
        aiTutorMaxLength: 600,    // 600 characters max per message
        aiNotesSets: 3,           // 3 study sets per day
        examQuestions: 5,         // 5 exam questions per day
        advancedCalculations: false,
        exportFeatures: false,
        prioritySupport: false
      },
      premium: {
        aiTutorMessages: 100,     // 100 messages per day
        aiTutorMaxLength: 4000,   // 4000 characters max per message
        aiNotesSets: 999,         // Unlimited study sets
        examQuestions: 999,       // Unlimited exam questions per day
        advancedCalculations: true,
        exportFeatures: true,
        prioritySupport: true
      }
    },

    // Get current user limits
    getCurrentLimits: function() {
      if (this.isUserPremium()) {
        return this.limits.premium;
      }
      return this.limits.free;
    },

    // Check if user is premium
    isUserPremium: function() {
      try {
        const plan = localStorage.getItem('studytools_user_plan');
        if (plan === 'premium') return true;
        const currentUser = this.getCurrentUser();
        return Boolean(currentUser && (currentUser.isPremium || currentUser.plan === 'premium'));
      } catch (_) {
        return false;
      }
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
      if (this.isUserPremium()) return false;
      const limits = this.getCurrentLimits();
      const currentUsage = this.getDailyUsage(feature);

      if (feature === 'aiTutorMessages') {
        return currentUsage >= limits.aiTutorMessages;
      }

      if (feature === 'aiNotesSets') {
        return currentUsage >= limits.aiNotesSets;
      }

      if (feature === 'examQuestions') {
        return currentUsage >= limits.examQuestions;
      }

      return false;
    },

    // Get remaining usage for a feature
    getRemainingUsage: function(feature) {
      if (this.isUserPremium()) return 999;
      const limits = this.getCurrentLimits();
      const currentUsage = this.getDailyUsage(feature);

      if (feature === 'aiTutorMessages') {
        return Math.max(0, limits.aiTutorMessages - currentUsage);
      }

      if (feature === 'aiNotesSets') {
        return Math.max(0, limits.aiNotesSets - currentUsage);
      }

      if (feature === 'examQuestions') {
        return Math.max(0, limits.examQuestions - currentUsage);
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
      if (document.getElementById('st-upgrade-modal')) return;

      const modal = document.createElement('div');
      modal.id = 'st-upgrade-modal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(10, 15, 30, 0.85);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        padding: 20px;
        animation: fadeIn 0.2s ease-out;
      `;
      
      modal.innerHTML = `
        <div style="
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 32px 28px;
          max-width: 440px;
          width: 100%;
          text-align: center;
          color: #0f172a;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          font-family: system-ui, -apple-system, sans-serif;
        ">
          <div style="display:inline-flex; align-items:center; justify-content:center; width:52px; height:52px; border-radius:50%; background:#eff6ff; color:#2563eb; font-size:26px; margin-bottom:16px;">
            ⚡
          </div>
          <h3 style="font-size: 1.45rem; font-weight: 800; color: #0f172a; margin-bottom: 8px; line-height: 1.2;">Has alcanzado tu límite gratuito</h3>
          <p style="color: #64748b; font-size: 0.95rem; line-height: 1.5; margin-bottom: 24px;">
            Asegura tus mejores notas con <strong>StudyTools Pro</strong>. Preguntas ilimitadas, explicaciones en profundidad y modo examen sin interrupciones.
          </p>

          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:14px; text-align:left; margin-bottom:24px; font-size:0.88rem; color:#334155;">
            <div style="margin-bottom:6px;">✓ <strong>100 mensajes IA / día</strong> (vs 5 del plan gratis)</div>
            <div style="margin-bottom:6px;">✓ <strong>Explicaciones de examen completas</strong></div>
            <div>✓ <strong>Solo €3.99/mes</strong> · Cancela cuando quieras</div>
          </div>

          <div style="display: flex; gap: 10px; flex-direction: column;">
            <a href="/pro.html" style="
              background: #2563eb;
              color: white;
              padding: 14px 20px;
              border-radius: 10px;
              text-decoration: none;
              font-weight: 700;
              font-size: 1rem;
              transition: background 0.15s ease;
              display: block;
            ">Desbloquear StudyTools Pro</a>
            <button onclick="document.getElementById('st-upgrade-modal').remove()" style="
              background: transparent;
              border: none;
              color: #94a3b8;
              padding: 10px;
              cursor: pointer;
              font-weight: 600;
              font-size: 0.88rem;
            ">Continuar en plan gratis mañana</button>
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
            color: #64748b;
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