// Premium limits for StudyTools.
//
// Security note: the plan is never read from localStorage any more. The old
// version asked localStorage.getItem('studytools_user_plan'), which meant that
// typing one line in the browser console unlocked Pro. The plan now comes from
// /api/entitlement, which reads Firestore with the signed-in user's own token,
// and api/chat.js enforces the real quota on the server, so this file is only
// the interface: it shows counters and offers the upgrade, it does not unlock.

(function() {
  'use strict';

  var FREE_DAILY_AI = 15;
  var PRO_DAILY_AI = 2000;
  var CACHE_MS = 60000;
  var CACHE_KEY = 'studytools_entitlement_cache';

  var state = {
    loaded: false,
    loading: false,
    signedIn: false,
    plan: 'free',
    active: false,
    premiumUntil: null,
    used: 0,
    limit: FREE_DAILY_AI,
    remaining: FREE_DAILY_AI,
    email: null
  };

  // Only used to make the interface instant. A tampered value can at worst show
  // Pro in the UI for a minute; the server still refuses the request.
  function readCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.at || Date.now() - parsed.at > CACHE_MS) return null;
      return parsed.value || null;
    } catch (error) {
      return null;
    }
  }

  function writeCache(value) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), value: value }));
    } catch (error) {
      /* private mode */
    }
  }

  function clearCache() {
    try {
      sessionStorage.removeItem(CACHE_KEY);
    } catch (error) {
      /* ignore */
    }
  }

  function firebaseUser() {
    try {
      if (typeof firebase === 'undefined' || !firebase.auth) return null;
      return firebase.auth().currentUser;
    } catch (error) {
      return null;
    }
  }

  var PremiumLimits = {
    // Kept for backwards compatibility with the tool pages.
    limits: {
      free: { aiTutorMessages: FREE_DAILY_AI, aiTutorMaxLength: 600, aiNotesSets: 3, examQuestions: 3 },
      premium: { aiTutorMessages: PRO_DAILY_AI, aiTutorMaxLength: 4000, aiNotesSets: 999, examQuestions: 999 }
    },

    getState: function() {
      return state;
    },

    isUserPremium: function() {
      return state.active === true;
    },

    getCurrentLimits: function() {
      return this.isUserPremium() ? this.limits.premium : this.limits.free;
    },

    // Asks the server who the user is. Safe to call as often as you like: the
    // result is cached for a minute and never trusted for enforcement.
    refresh: function(force) {
      var self = this;
      if (state.loading && !force) return Promise.resolve(state);
      if (!force) {
        var cached = readCache();
        if (cached) {
          state = Object.assign({}, state, cached, { loaded: true });
          return Promise.resolve(state);
        }
      }
      var user = firebaseUser();
      if (!user) {
        state = Object.assign({}, state, {
          loaded: true, signedIn: false, active: false, plan: 'free',
          limit: FREE_DAILY_AI, remaining: FREE_DAILY_AI
        });
        return Promise.resolve(state);
      }
      state.loading = true;
      return user.getIdToken().then(function(idToken) {
        return fetch('/api/entitlement', { headers: { Authorization: 'Bearer ' + idToken } });
      }).then(function(response) {
        if (!response.ok) throw new Error('entitlement ' + response.status);
        return response.json();
      }).then(function(data) {
        state = {
          loaded: true, loading: false,
          signedIn: data.signedIn === true,
          plan: data.plan || 'free',
          active: data.active === true,
          premiumUntil: data.premiumUntil || null,
          used: Number(data.used) || 0,
          limit: Number(data.limit) || FREE_DAILY_AI,
          remaining: Number(data.remaining) || 0,
          email: data.email || null
        };
        writeCache({
          signedIn: state.signedIn, plan: state.plan, active: state.active,
          premiumUntil: state.premiumUntil, used: state.used,
          limit: state.limit, remaining: state.remaining
        });
        document.dispatchEvent(new CustomEvent('premiumStatusChanged', { detail: state }));
        return state;
      }).catch(function(error) {
        // Never block a paying customer because the status call failed.
        state.loading = false;
        state.loaded = true;
        return state;
      });
    },

    // Local per-feature counters still exist, but only as a courtesy for the
    // interface. The authoritative counter lives in Firestore via api/chat.js.
    getDailyUsage: function(feature) {
      try {
        var today = new Date().toDateString();
        var usageData = JSON.parse(localStorage.getItem('studytools_usage') || '{}');
        return (usageData[today] && usageData[today][feature]) || 0;
      } catch (error) {
        return 0;
      }
    },

    incrementUsage: function(feature) {
      try {
        var today = new Date().toDateString();
        var usageData = JSON.parse(localStorage.getItem('studytools_usage') || '{}');
        if (!usageData[today]) usageData[today] = {};
        usageData[today][feature] = (usageData[today][feature] || 0) + 1;
        localStorage.setItem('studytools_usage', JSON.stringify(usageData));
        return usageData[today][feature];
      } catch (error) {
        return 0;
      }
    },

    hasReachedLimit: function(feature) {
      if (this.isUserPremium()) return false;
      var limits = this.getCurrentLimits();
      var used = this.getDailyUsage(feature);
      if (feature === 'aiTutorMessages') return used >= limits.aiTutorMessages;
      if (feature === 'aiNotesSets') return used >= limits.aiNotesSets;
      if (feature === 'examQuestions') return used >= limits.examQuestions;
      return false;
    },

    getRemainingUsage: function(feature) {
      if (this.isUserPremium()) return Infinity;
      var limits = this.getCurrentLimits();
      var used = this.getDailyUsage(feature);
      return Math.max(0, (limits[feature] || 0) - used);
    },

    getRemainingAiMessages: function() {
      if (this.isUserPremium()) return Infinity;
      return Math.max(0, state.limit - state.used);
    },

    // Called by the tool pages when /api/chat answers with 429.
    syncFromQuota: function(quota) {
      if (!quota) return;
      if (typeof quota.used === 'number') state.used = quota.used;
      if (typeof quota.limit === 'number') state.limit = quota.limit;
      if (typeof quota.remaining === 'number') state.remaining = quota.remaining;
      if (typeof quota.plan === 'string') {
        state.plan = quota.plan;
        state.active = quota.plan === 'premium';
      }
      clearCache();
    },

    resetDailyUsage: function() {
      localStorage.removeItem('studytools_usage');
      clearCache();
    },

    getUsageStats: function() {
      try {
        var today = new Date().toDateString();
        var usageData = JSON.parse(localStorage.getItem('studytools_usage') || '{}');
        return usageData[today] || {};
      } catch (error) {
        return {};
      }
    },

    upgradeUrl: function() {
      var user = firebaseUser();
      if (!user) return '/login.html?redirect=' + encodeURIComponent('/pro.html');
      return '/pro.html';
    },

    showUpgradePrompt: function(featureName) {
      if (document.getElementById('st-upgrade-modal')) return;
      var what = featureName || 'this tool';
      var remaining = this.getRemainingAiMessages();
      var modal = document.createElement('div');
      modal.id = 'st-upgrade-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'Upgrade to StudyTools Pro');
      modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,system-ui,sans-serif';
      modal.innerHTML = [
        '<div style="background:#fff;max-width:430px;width:100%;border-radius:16px;padding:30px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.35)">',
        '<div style="font-size:26px;margin-bottom:12px">\u26A1</div>',
        '<h2 style="font-size:1.4rem;font-weight:800;color:#0f172a;margin:0 0 10px;line-height:1.25">You have reached your free daily limit</h2>',
        '<p style="color:#64748b;font-size:.95rem;line-height:1.55;margin:0 0 20px">',
        'You used your free AI allowance for today. Free accounts get ',
        FREE_DAILY_AI,
        ' AI requests a day. <strong>StudyTools Pro</strong> raises it to ',
        PRO_DAILY_AI,
        ' a day, with full-length answers and everything saved to your account.</p>',
        '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;text-align:left;margin-bottom:20px;font-size:.88rem;color:#334155;line-height:1.7">',
        '<div>\u2713 <strong>' + PRO_DAILY_AI + ' AI requests per day</strong> instead of ' + FREE_DAILY_AI + '</div>',
        '<div>\u2713 Full-length explanations instead of short answers</div>',
        '<div>\u2713 Study sets, chats and citations saved to your account</div>',
        '<div style="margin-top:6px"><strong>\u20AC3.99/month</strong> \u00B7 \u20AC29.99/year \u00B7 cancel any time in PayPal</div>',
        '</div>',
        '<a href="' + this.upgradeUrl() + '" style="background:#2563eb;color:#fff;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:700;display:block;margin-bottom:10px">See Pro plans</a>',
        '<button data-st-close style="background:transparent;border:none;color:#64748b;padding:10px;cursor:pointer;font-weight:600;font-size:.88rem">Stay free, I will keep studying</button>',
        '</div>'
      ].join('');
      document.body.appendChild(modal);
      modal.addEventListener('click', function(event) {
        if (event.target === modal || event.target.hasAttribute('data-st-close')) modal.remove();
      });
      document.addEventListener('keydown', function onKey(event) {
        if (event.key === 'Escape') {
          modal.remove();
          document.removeEventListener('keydown', onKey);
        }
      });
    },

    showUsageCounter: function(feature, container) {
      if (!container) return;
      var self = this;
      this.refresh().then(function() {
        if (self.isUserPremium()) {
          container.innerHTML = '<div style="font-size:.85rem;color:#10b981;margin-bottom:1rem;text-align:center">\u2B50 Pro \u00B7 full access, no daily limit</div>';
          return;
        }
        var remaining = Math.max(0, state.limit - state.used);
        container.innerHTML = '<div style="font-size:.85rem;color:#64748b;margin-bottom:1rem;text-align:center">Free \u00B7 ' +
          remaining + ' of ' + state.limit + ' AI requests left today</div>';
      });
    }
  };

  window.PremiumLimits = PremiumLimits;
  document.dispatchEvent(new CustomEvent('premiumLimitsLoaded'));

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { PremiumLimits.refresh(); });
  } else {
    PremiumLimits.refresh();
  }

  // Re-check after sign-in so Pro appears without a manual reload.
  document.addEventListener('authStateReady', function() { PremiumLimits.refresh(true); });

})();