// Add faithful HowTo schema to the how-to guides (Phase 2B).
//
//   node scripts/seo-howto-pass.mjs         (apply, idempotent)
//   node scripts/seo-howto-pass.mjs --dry   (report only)
//
// Google renders HowTo steps as a rich result (numbered steps) which lifts CTR.
// The schema MUST mirror the visible article, so steps are read from the real
// <h2> headings that appear before the "expanded-guide" block (the genuine
// instructional steps), never from the generic SEO prose after it. Introductory
// "Why …" headings are explanations, not steps, and are filtered out. Each step
// text is the first paragraph under that heading. Pages that already carry a
// HowTo block are left untouched, so this is safe to re-run.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ORIGIN = 'https://www.studytools.pro';
const DRY = process.argv.includes('--dry');

// Only genuine how-to guides get HowTo schema.
const CANDIDATES = readdirSync(ROOT).filter(
  (f) => f.endsWith('.html') && /^how-to-|what-grade-do-i-need|what-to-do-the-night/.test(f)
);

const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&mdash;/g, '—')
  .replace(/&minus;/g, '−').replace(/&times;/g, '×').replace(/&rarr;/g, '→');

// Pull ordered [heading, firstParagraph] steps from the pre-expanded-guide body.
function extractSteps(html) {
  const cut = html.indexOf('expanded-guide');
  const lead = cut > 0 ? html.slice(0, cut) : html;
  // Split on each <h2 …>…</h2> and read the first <p> that follows.
  const parts = lead.split(/<h2[^>]*>/i).slice(1);
  const steps = [];
  for (const part of parts) {
    const close = part.indexOf('</h2>');
    if (close < 0) continue;
    const heading = decode(stripTags(part.slice(0, close)));
    const after = part.slice(close);
    const pm = after.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const text = pm ? decode(stripTags(pm[1])) : '';
    // Skip explanatory intros and question (FAQ) headings — they are not steps.
    if (/^why\b/i.test(heading)) continue;
    if (/\?$/.test(heading)) continue;
    if (!text) continue;
    steps.push({ name: heading, text: text.slice(0, 380) });
  }
  return steps;
}

function buildHowTo(html, slug) {
  const title = decode(stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || slug));
  const steps = extractSteps(html);
  if (steps.length < 3) return null; // too thin to be a real HowTo
  const total = (html.match(/(\d+)\s*min read/i) || [])[1];
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: title,
    description: decode(((html.match(/<meta name="description" content="([^"]*)"/i) || [])[1] || title)),
    ...(total ? { totalTime: 'PT' + total + 'M' } : {}),
    step: steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}

function main() {
  let changed = 0, skipped = 0;
  for (const file of CANDIDATES) {
    const html = readFileSync(join(ROOT, file), 'utf8');
    if (html.includes('"HowTo"')) { skipped++; continue; } // already has it
    const slug = file.replace(/\.html$/, '');
    const schema = buildHowTo(html, slug);
    if (!schema) { console.log('  skip (thin) ' + file); continue; }
    const block = '<script type="application/ld+json">' + JSON.stringify(schema) + '</script>';
    const out = html.replace(/<\/head>/i, '  ' + block + '\n</head>');
    changed++;
    if (!DRY) writeFileSync(join(ROOT, file), out);
    console.log((DRY ? 'would add HowTo (' + schema.step.length + ' steps) ' : 'added HowTo (' + schema.step.length + ' steps) ') + file);
  }
  console.log('\n' + (DRY ? '[dry run] ' : '') + changed + ' HowTo added, ' + skipped + ' already present.');
}

main();
