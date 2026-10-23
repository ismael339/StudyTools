// StudyTools Analytics Events
// GA4 events via Google Tag Manager dataLayer.
// Respects Google Consent Mode v2 (see /js/consent.js): no events are sent
// until the visitor accepts analytics (studytools_consent === 'all').
// No personal data (emails, user input, tutor question content) is ever sent.

(function () {
  'use strict';

  var CONSENT_KEY = 'studytools_consent';
  var dataLayer = window.dataLayer || [];

  // Returns true only when the visitor accepted analytics in the cookie banner.
  function consentGranted() {
    try {
      return window.localStorage.getItem(CONSENT_KEY) === 'all';
    } catch (e) {
      return false;
    }
  }

  // Push an event to dataLayer (captured by GTM). No-op if consent denied.
  function push(eventName, params) {
    if (!consentGranted()) return;
    var eventObj = { event: eventName };
    var key;
    for (key in params) {
      if (params.hasOwnProperty(key)) {
        eventObj[key] = params[key];
      }
    }
    dataLayer.push(eventObj);
  }

  function pagePath() {
    return window.location.pathname + window.location.search;
  }

  // --- Event API ---

  // tool_used: first time a tool is executed in this session (dedup via sessionStorage)
  var _usedTools = (function () {
    try {
      var raw = sessionStorage.getItem('st_used_tools');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  })();

  function toolUsed(toolName) {
    if (_usedTools.indexOf(toolName) >= 0) return;
    _usedTools.push(toolName);
    try {
      sessionStorage.setItem('st_used_tools', JSON.stringify(_usedTools));
    } catch (e) { /* private mode */ }
    push('tool_used', { tool_name: toolName });
  }

  function aiLimitReached(toolName) {
    push('ai_limit_reached', { tool_name: toolName });
  }

  function proCtaClick(location, page) {
    push('pro_cta_click', { location: location, page_path: page });
  }

  function checkoutStart(plan) {
    push('pro_checkout_start', { plan: plan });
  }

  function purchase(transactionId) {
    push('purchase', { currency: 'EUR', transaction_id: transactionId });
  }

  function signupComplete() {
    push('signup_complete', {});
  }

  function loginComplete() {
    push('login_complete', {});
  }

  function newsletterSubscribe() {
    push('newsletter_subscribe', {});
  }

  function blogToToolClick(fromPage, toolName) {
    push('blog_to_tool_click', { from_page: fromPage, tool_name: toolName });
  }

  // --- Event delegation: data-* attributes on click ---

  document.addEventListener('click', function (event) {
    var target = event.target;
    while (target && target !== document) {
      if (target.getAttribute) {
        // Tool execution button: data-tool-action="gpa_calculator"
        var toolAction = target.getAttribute('data-tool-action');
        if (toolAction) {
          toolUsed(toolAction);
        }

        // Pro plans link/button: data-pro-cta="header | home_pricing | tool_page | blog_article | limit_banner"
        var proCta = target.getAttribute('data-pro-cta');
        if (proCta) {
          proCtaClick(proCta, pagePath());
        }

        // Blog article → tool link: data-blog-to-tool + data-tool-name
        var blogToTool = target.getAttribute('data-blog-to-tool');
        if (blogToTool) {
          blogToToolClick(pagePath(), target.getAttribute('data-tool-name') || '');
        }
      }
      target = target.parentNode;
    }
  }, false);

  // --- Form submission tracking (delegation) ---
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || !form.getAttribute) return;

    if (form.getAttribute('data-newsletter-form')) {
      newsletterSubscribe();
    }
    if (form.getAttribute('data-login-form')) {
      loginComplete();
    }
    if (form.getAttribute('data-register-form')) {
      signupComplete();
    }
  }, false);

  // --- Public API for inline scripts ---
  window.StudyToolsAnalytics = {
    toolUsed: toolUsed,
    aiLimitReached: aiLimitReached,
    proCtaClick: proCtaClick,
    checkoutStart: checkoutStart,
    purchase: purchase,
    signupComplete: signupComplete,
    loginComplete: loginComplete,
    newsletterSubscribe: newsletterSubscribe,
    blogToToolClick: blogToToolClick
  };
})();
