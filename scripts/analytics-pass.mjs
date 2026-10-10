// Analytics pass: one canonical, Consent-Mode-safe GA4 snippet on every page.
//
//   node scripts/analytics-pass.mjs     (idempotent — safe to re-run)
//
// What it does:
//   1. Removes the legacy gtag/GA4 snippets that were written page-by-page in
//      inconsistent positions (some before consent.js existed, some duplicated).
//   2. Inserts ONE canonical GA4 block right AFTER /js/consent.js so Google
//      Consent Mode v2 starts analytics in the "denied" state and only
//      measures visitors who accept the cookie banner (EU/UK requirement).
//
// Measurement id: G-66DETECVGK. GTM (GTM-P8T9B392) stays on every page as the
// container for future tags, but page views are driven by gtag.js so they do
// not depend on container configuration. If you ever configure the GA4 tag
// inside the GTM container instead, REMOVE the gtag snippet here first or
// GA4 will count every page view twice.
//
// The canonical block is identified by the <!-- Google tag (GA4) --> marker;
// only blocks WITHOUT that marker are removed, which makes the pass stable.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const GA4 = 'G-66DETECVGK';
const GA4_SRC_TOKEN = 'gtag/js?id=' + GA4;
const MARKER = '<!-- Google tag (GA4) -->';
const LEGACY_COMMENTS = new Set(['<!-- Google tag (gtag.js) -->', '<!-- Google Analytics -->']);

const BLOCK = [
  MARKER,
  '<script async src="https://www.googletagmanager.com/' + GA4_SRC_TOKEN + '"></script>',
  '<script>',
  '  window.dataLayer = window.dataLayer || [];',
  '  function gtag(){window.dataLayer.push(arguments);}',
  "  gtag('js', new Date());",
  "  gtag('config', '" + GA4 + "');",
  '</script>'
].join('\n');

function removeLegacyGauges(html) {
  let removed = 0;
  let scan = true;
  while (scan) {
    scan = false;
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
      const attrs = m[1] || '';
      const body = m[2] || '';
      const isGa4 = /src\s*=/i.test(attrs)
        ? attrs.includes(GA4_SRC_TOKEN)
        : body.includes(GA4);
      if (!isGa4) continue;
      if (html.slice(Math.max(0, m.index - 600), m.index).includes(MARKER)) continue; // canonical block

      let start = m.index;
      const end = m.index + m[0].length;

      // Include the line indentation of the script tag.
      const lineStart = html.lastIndexOf('\n', start - 1) + 1;
      if (html.slice(lineStart, start).trim() === '') start = lineStart;

      // Include a legacy comment line directly above, if any.
      const prevLineStart = html.lastIndexOf('\n', lineStart - 2) + 1;
      const prevLine = html.slice(prevLineStart, lineStart).replace(/[\r\n]+$/, '');
      if (LEGACY_COMMENTS.has(prevLine.trim())) start = prevLineStart;

      html = html.slice(0, start) + html.slice(end);
      removed++;
      scan = true;
      break;
    }
  }
  return { html, removed };
}

function transform(html) {
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  const afterRemoval = removeLegacyGauges(html);
  let out = afterRemoval.html;

  if (!out.includes(GA4)) {
    const anchor = /<script[^>]*\/js\/consent\.js[^>]*><\/script>/i.exec(out);
    if (!anchor) return { html, changed: false, error: 'consent.js script tag not found' };
    const at = anchor.index + anchor[0].length;
    const lineStart = out.lastIndexOf('\n', at - 1) + 1;
    const indent = out.slice(lineStart, at).trim() === '' ? out.slice(lineStart, at) : '';
    const block = BLOCK.split('\n').join(eol + indent);
    out = out.slice(0, at) + eol + indent + block + out.slice(at);
  }

  return { html: out, changed: out !== html, removed: afterRemoval.removed };
}

const files = readdirSync(ROOT).filter(f => f.endsWith('.html'));
let updated = 0;
let already = 0;
const problems = [];

for (const f of files) {
  const path = join(ROOT, f);
  const source = readFileSync(path, 'utf8');
  const result = transform(source);
  if (result.error) {
    problems.push(f + ': ' + result.error);
  } else if (result.changed) {
    writeFileSync(path, result.html);
    updated++;
    console.log('updated ' + f + (result.removed ? ' (removed ' + result.removed + ' legacy snippet(s))' : ''));
  } else {
    already++;
  }
}

console.log('analytics-pass: ' + updated + ' page(s) updated, ' + already + ' already canonical, ' + files.length + ' total.');
if (problems.length) {
  for (const p of problems) console.error('ERROR ' + p);
  process.exit(1);
}