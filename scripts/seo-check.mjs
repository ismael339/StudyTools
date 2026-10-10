// SEO and integrity check for every page of the site.
//
//   node scripts/seo-check.mjs     (or: npm run seo:check)
//
// Errors (exit 1): missing/duplicate title or description, missing or wrong
// canonical, noindex on a public page, broken internal links (including
// case-only mismatches, which break on Linux hosting), invalid JSON-LD,
// sitemap drift (missing indexable pages, blocked pages listed, dead URLs,
// future lastmod), a missing robots.txt sitemap pointer, and a public page
// missing the shared brand shell (site header, site-footer, Google Tag
// Manager, the GA4/gtag snippet or its order after /js/consent.js, or the
// cookie banner itself).
// Warnings (exit 0): out-of-range title/description lengths, images without
// alt, missing Open Graph or Twitter tags.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ORIGIN = 'https://www.studytools.pro';

const ROBOTS_BLOCKED = new Set([
  '/dashboard.html', '/profile.html', '/pro-success.html',
  '/login.html', '/register.html', '/api/'
]);

const errors = [];
const warnings = [];
const err = (page, message) => errors.push(page + ': ' + message);
const warn = (page, message) => warnings.push(page + ': ' + message);

function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? '';
  return out;
}

function metaMap(html) {
  const map = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const a = attrs(tag);
    const key = a.name || a.property;
    if (key) map[key.toLowerCase()] = a.content || '';
  }
  return map;
}

const pages = readdirSync(ROOT).filter(f => f.endsWith('.html'));
const titles = new Map();
const descs = new Map();
const actualFiles = new Set(pages);

// Root-relative target -> exists? Also verifies exact case: hosting runs Linux.
function localTargetExists(path) {
  const clean = path.split('#')[0].split('?')[0];
  if (!clean || clean === '/') return { ok: true };
  const rel = clean.replace(/^\//, '');
  if (rel.startsWith('api/')) return { ok: true };
  if (!rel.includes('.')) return { ok: true }; // extensionless: vercel redirect
  if (!existsSync(join(ROOT, rel))) return { ok: false };
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  try {
    const names = readdirSync(join(ROOT, dir));
    return { ok: true, exact: names.includes(base) };
  } catch {
    return { ok: false };
  }
}

const indexable = [];

for (const file of pages) {
  const html = readFileSync(join(ROOT, file), 'utf8');
  const page = '/' + file;
  const metas = metaMap(html);
  const robots = (metas.robots || '').toLowerCase();
  const isNoindex = robots.includes('noindex');
  const isBlocked = ROBOTS_BLOCKED.has(page);
  const isPublic = file !== '404.html' && !isNoindex && !isBlocked;

  // --- title ---
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  const report = isPublic ? err : warn;
  if (!title) report(page, 'missing <title>');
  else {
    if (titles.has(title)) report(page, 'duplicate title shared with ' + titles.get(title));
    titles.set(title, page);
    if (title.length < 10 || title.length > 70) warn(page, 'title length ' + title.length + ' (aim 10-70): ' + title);
  }

  // --- description ---
  const desc = metas.description || '';
  if (!desc) report(page, 'missing meta description');
  else {
    if (descs.has(desc)) report(page, 'duplicate description shared with ' + descs.get(desc));
    descs.set(desc, page);
    if (desc.length < 50 || desc.length > 165) warn(page, 'description length ' + desc.length + ' (aim 50-165)');
  }

  // --- robots / indexability ---
  if (isPublic && isNoindex) err(page, 'public page carries noindex');
  if (file === '404.html' && !isNoindex) warn(page, '404 page should carry noindex');

  // --- canonical ---
  const canonicalTag = (html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i) || [])[0];
  if (isPublic) {
    if (!canonicalTag) err(page, 'missing canonical');
    else {
      const href = attrs(canonicalTag).href || '';
      const expected = file === 'index.html' ? ORIGIN + '/' : ORIGIN + '/' + file;
      if (href !== expected) err(page, 'canonical "' + href + '" != "' + expected + '"');
    }
  }

  // --- social meta ---
  if (isPublic) {
    if (!metas['og:title']) warn(page, 'missing og:title');
    if (!metas['og:description']) warn(page, 'missing og:description');
    if (!metas['og:image']) warn(page, 'missing og:image');
    if (!metas['og:url']) warn(page, 'missing og:url');
    if (!metas['twitter:card']) warn(page, 'missing twitter:card');
  }

  // --- basics ---
  if (!/<html[^>]*\blang\s*=/i.test(html)) warn(page, 'missing <html lang>');
  if (!html.match(/name=["']viewport["']/i)) warn(page, 'missing viewport');
  const h1s = (html.match(/<h1[\s>]/gi) || []).length;
  if (isPublic && h1s === 0) warn(page, 'no <h1>');
  if (h1s > 1) warn(page, h1s + ' <h1> tags (aim 1)');

  // --- JSON-LD ---
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { JSON.parse(m[1].trim()); }
    catch (e) { err(page, 'invalid JSON-LD: ' + e.message); }
  }

  // --- broken internal links (href/src + inline navigations) ---
  const targets = [];
  for (const tag of html.matchAll(/<(?:a|link|script|img|source|iframe)\b[^>]*>/gi)) {
    const a = attrs(tag[0]);
    if (a.href) targets.push(a.href);
    if (a.src) targets.push(a.src);
    if (a.srcset) targets.push(...a.srcset.split(',').map(s => s.trim().split(/\s+/)[0]));
  }
  for (const m of html.matchAll(/location\.href\s*=\s*["']([^"']+)["']/g)) targets.push(m[1]);
  for (const m of html.matchAll(/window\.open\(\s*["']([^"']+)["']/g)) targets.push(m[1]);

  for (const raw of targets) {
    if (!raw) continue;
    if (/^(https?:)?\/\//i.test(raw) || /^(mailto|tel|javascript|data):/i.test(raw)) continue;
    if (raw.startsWith('#')) continue;
    const res = localTargetExists(raw);
    if (!res.ok) err(page, 'broken internal link: ' + raw);
    else if (res.exact === false) err(page, 'case-mismatch link (breaks on Linux): ' + raw);
  }

  // --- images without alt ---
  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(tag[0]);
    if (!('alt' in a)) warn(page, '<img> without alt: ' + (a.src || '?'));
  }

  // --- brand shell: shared header/footer, analytics and cookie consent ---
  if (isPublic) {
    if (!html.includes('GTM-P8T9B392')) err(page, 'missing Google Tag Manager');
    if (!html.includes('/js/consent.js')) err(page, 'missing /js/consent.js (cookie consent)');
    // GA4 (gtag.js) must exist exactly once (src + config = 2 mentions) and
    // must load AFTER consent.js so Consent Mode v2 starts analytics denied.
    const ga4 = html.split('G-66DETECVGK').length - 1;
    const consentAt = html.indexOf('/js/consent.js');
    const ga4At = html.indexOf('G-66DETECVGK');
    if (ga4 === 0) err(page, 'missing GA4 snippet (G-66DETECVGK)');
    else if (ga4 > 2) err(page, 'duplicate GA4 snippets (' + ga4 + ' mentions of G-66DETECVGK, expected 2)');
    else if (consentAt < 0 || consentAt > ga4At) err(page, 'GA4 must load after /js/consent.js (Consent Mode v2)');
    if (!html.includes('class="site-footer"')) err(page, 'missing shared site-footer');
    if (!/site-header|class="nav"|nav-in|public-nav/.test(html)) err(page, 'missing site navigation');
  }

  if (isPublic) indexable.push({ file, path: page });
}

// --- robots.txt ---
const robotsTxt = existsSync(join(ROOT, 'robots.txt')) ? readFileSync(join(ROOT, 'robots.txt'), 'utf8') : '';
if (!robotsTxt.includes('Sitemap: ' + ORIGIN + '/sitemap.xml')) err('robots.txt', 'missing Sitemap pointer');
if (!robotsTxt.includes('Disallow: /api/')) warn('robots.txt', 'API not disallowed');

// --- sitemap.xml ---
try {
  const sm = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  const entries = [...sm.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)]
    .map(m => ({ loc: m[1], lastmod: m[2], path: m[1].replace(ORIGIN, '') || '/' }));
  const inSitemap = new Set(entries.map(e => e.path));

  for (const p of indexable) {
    const key = p.path === '/index.html' ? '/' : p.path;
    if (!inSitemap.has(key)) err('sitemap.xml', 'indexable page missing: ' + p.path);
  }
  for (const e of entries) {
    if (!e.loc.startsWith(ORIGIN)) err('sitemap.xml', 'non-absolute URL: ' + e.loc);
    if (ROBOTS_BLOCKED.has(e.path)) err('sitemap.xml', 'robots-blocked page listed: ' + e.path);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.lastmod)) err('sitemap.xml', 'bad lastmod for ' + e.path);
    else if (e.lastmod > new Date().toISOString().slice(0, 10)) err('sitemap.xml', 'future lastmod for ' + e.path);
    const file = e.path === '/' ? 'index.html' : e.path.replace(/^\//, '');
    if (!existsSync(join(ROOT, file))) err('sitemap.xml', 'dead URL (no file): ' + e.path);
  }
} catch (e) {
  err('sitemap.xml', 'unreadable: ' + e.message);
}

// --- report ---
for (const w of warnings) console.log('warn - ' + w);
console.log('\n' + pages.length + ' pages, ' + indexable.length + ' indexable, ' +
  errors.length + ' errors, ' + warnings.length + ' warnings');
if (errors.length) {
  console.log('\nERRORS:');
  for (const e of errors) console.log('  x ' + e);
  process.exit(1);
}
console.log('seo-check passed');
