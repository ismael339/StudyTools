// Sticky PLAY banner shown on every tool page.
// Dismissed state is kept per session so the banner never becomes noise.

(function () {
  'use strict';

  var DISMISS_KEY = 'studytools_play_banner_dismissed';

  function alreadyDismissed() {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function remember() {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch (error) {
      /* storage unavailable, banner reappears on next page */
    }
  }

  function render() {
    if (alreadyDismissed()) return;
    if (location.pathname.indexOf('play') !== -1) return;

    var style = document.createElement('style');
    style.textContent = [
      '.play-sticky{position:fixed;left:0;right:0;bottom:0;z-index:9998;display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;',
      'padding:12px 52px 12px 16px;background:linear-gradient(135deg,rgba(0,245,212,.95),rgba(58,208,255,.95));color:#06070d;',
      'font-family:inherit;font-weight:800;font-size:.95rem;box-shadow:0 -8px 30px rgba(0,0,0,.35)}',
      '.play-sticky a.play-sticky-cta{display:inline-flex;align-items:center;gap:6px;background:#06070d;color:#00f5d4;border-radius:999px;',
      'padding:9px 16px;text-decoration:none;font-weight:900;white-space:nowrap}',
      '.play-sticky button{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:transparent;border:none;color:#06070d;',
      'font-size:1.3rem;line-height:1;cursor:pointer;font-weight:900}',
      '@media(max-width:520px){.play-sticky{font-size:.85rem;padding:10px 44px 10px 12px}}'
    ].join('');
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.className = 'play-sticky';
    bar.setAttribute('role', 'complementary');
    bar.innerHTML = '<span>Finished summarizing? Turn it into a game with PLAY</span>' +
      '<a class="play-sticky-cta" href="/play.html">\uD83C\uDFAE Play now</a>' +
      '<button type="button" aria-label="Dismiss PLAY banner">\u00D7</button>';

    bar.querySelector('button').addEventListener('click', function () {
      remember();
      bar.remove();
    });

    document.body.appendChild(bar);
    document.body.style.paddingBottom = '76px';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
