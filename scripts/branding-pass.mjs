// One-shot brand pass: shared header/footer, Google Tag Manager and cookie
// consent on every page. Idempotent — safe to re-run; it skips anything that
// is already in place.
//
//   node scripts/branding-pass.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const GTM_ID = 'GTM-P8T9B392';

const GTM_HEAD = `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');</script>
<!-- End Google Tag Manager -->`;

const GTM_NOSCRIPT = `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;

// Must execute before any tag: Consent Mode defaults live in this file.
const CONSENT_TAG = '<script src="/js/consent.js"></script>';

const HEADER = '<header class="site-header"><a class="logo" href="/">StudyTools</a>' +
  '<nav class="public-nav"><a href="/blog.html">Guides</a><a href="/pro.html">Pro</a>' +
  '<a href="/contact.html">Contact</a><a href="/login.html">Log in</a></nav></header>';

const FOOTER = `<footer class="site-footer">
  <div>
    <a class="logo" href="/">StudyTools</a>
    <p>Free AI study tools for students. Understand it, practise it, remember it.</p>
  </div>
  <nav>
    <a href="/blog.html">Study guides</a>
    <a href="/pro.html">Pro plans</a>
    <a href="/about.html">About</a>
    <a href="/contact.html">Contact</a>
    <a href="/terms.html">Terms</a>
    <a href="/privacy.html">Privacy</a>
    <a href="#" class="js-cookie-settings">Cookies</a>
    <a href="/login.html">Log in</a>
  </nav>
  <small>&copy; 2026 StudyTools &middot; support@studytools.pro</small>
</footer>`;

const FALLBACK_STYLE = `<style>/* Brand chrome: fallback for pages that do not load /css/studytools-design.css */
.site-header{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;min-height:64px;padding:12px max(20px,calc((100% - 1180px)/2));background:#fff;border-bottom:1px solid #f1f5f9}
.site-header .logo{font-size:1.35rem;font-weight:800;letter-spacing:-.03em;color:#172554;text-decoration:none}
.site-header .public-nav{display:flex;gap:20px;flex-wrap:wrap}
.site-header .public-nav a{color:#64748b;font-weight:700;font-size:.95rem;text-decoration:none}
.site-header .public-nav a:hover{color:#2563eb}
.site-footer{display:grid;gap:16px;margin-top:48px;padding:30px max(20px,calc((100% - 1180px)/2));border-top:1px solid #e2e8f0;background:#fff}
.site-footer .logo{font-size:1.25rem;font-weight:800;color:#172554;text-decoration:none}
.site-footer p{margin:6px 0 0;color:#64748b;font-size:.9rem;max-width:46ch}
.site-footer nav{display:flex;gap:16px;flex-wrap:wrap}
.site-footer nav a{color:#475569;font-size:.88rem;font-weight:700;text-decoration:none}
.site-footer nav a:hover{color:#2563eb}
.site-footer small{color:#94a3b8;font-size:.8rem}
@media(min-width:760px){.site-footer{grid-template-columns:1.1fr 2fr;align-items:start}}
</style>`;

// Full-screen shells and the dark PLAY hub keep their own chrome.
const NO_HEADER = new Set([
  '404.html', 'login.html', 'register.html', 'dashboard.html',
  'profile.html', 'pro-success.html', 'play.html'
]);
const NO_FOOTER = new Set([
  '404.html', 'dashboard.html', 'profile.html', 'pro-success.html', 'play.html'
]);

function insertAfterHead(html, block) {
  const open = html.search(/<head[^>]*>/i);
  if (open < 0) return html;
  const at = html.indexOf('>', open) + 1;
  if (at <= 0) return html;
  return html.slice(0, at) + '\n' + block + html.slice(at);
}

let changed = 0;
const files = readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();

for (const file of files) {
  const path = join(ROOT, file);
  let html = readFileSync(path, 'utf8');
  const before = html;

  // 1) Google Tag Manager (head) ...
  if (!html.includes(GTM_ID)) html = insertAfterHead(html, GTM_HEAD);

  // 2) ... then consent, so it sits above GTM and above every gtag config.
  if (!html.includes('/js/consent.js')) html = insertAfterHead(html, CONSENT_TAG);

  // 3) GTM noscript fallback right after <body>.
  if (!html.includes('googletagmanager.com/ns.html?id=' + GTM_ID)) {
    const body = html.match(/<body[^>]*>/i);
    if (body) html = html.replace(body[0], body[0] + '\n' + GTM_NOSCRIPT);
  }

  // 4) Brand header, unless the page already has its own navigation.
  const hasNav = /site-header|class="nav"|nav-in|public-nav/.test(html);
  if (!hasNav && !NO_HEADER.has(file)) {
    const body = html.match(/<body[^>]*>/i);
    if (body) html = html.replace(body[0], body[0] + '\n' + HEADER);
  }

  // 5) Brand footer: replace any legacy <footer> block, or append one.
  if (!NO_FOOTER.has(file) && !html.includes('js-cookie-settings')) {
    const block = html.match(/<footer\b[\s\S]*?<\/footer>/i);
    if (block) {
      html = html.replace(block[0], FOOTER);
    } else if (html.includes('</body>')) {
      const at = html.lastIndexOf('</body>');
      html = html.slice(0, at) + FOOTER + '\n' + html.slice(at);
    }
  }

  // 6) Style fallback for pages without the shared design system.
  const hasChrome = html.includes('class="site-header"') || html.includes('class="site-footer"');
  if (hasChrome && !html.includes('studytools-design.css') &&
      !html.includes('Brand chrome: fallback')) {
    html = insertAfterHead(html, FALLBACK_STYLE);
  }

  if (html !== before) {
    writeFileSync(path, html);
    changed++;
    console.log('updated ' + file);
  }
}

console.log(changed + ' of ' + files.length + ' pages updated');
