// One-shot mobile + rich-results pass. Idempotent — safe to re-run.
//
//   node scripts/mobile-schema-pass.mjs
//
// 1) Article pages: .nav without flex-wrap clips the brand and links on
//    narrow phones; add gap + wrap so they stack instead of overflowing.
// 2) BlogPosting JSON-LD: Google article rich results need a raster image
//    (JPEG/PNG/WebP — not SVG) and publisher.logo is recommended, so point
//    the schema image at the 1200x630 og PNG and attach the site logo.
// 3) pro.html once received literal PowerShell "`r" "`n" escapes inside the
//    comparison table, which rendered as visible junk; strip them.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ORIGIN = 'https://www.studytools.pro';

const OLD_NAV = '.nav{display:flex;justify-content:space-between;padding:20px 0}';
const NEW_NAV = '.nav{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:20px 0}';

const PUBLISHER_RE = /"publisher":\{"@type":"Organization","name":"StudyTools"\}/g;
const PUBLISHER_NEW = '"publisher":{"@type":"Organization","name":"StudyTools","logo":{"@type":"ImageObject","url":"' +
  ORIGIN + '/apple-touch-icon.png"}}';

const SCHEMA_IMAGE_RE = /"image":"https:\/\/www\.studytools\.pro\/assets\/[^"]+\.svg"/g;
const SCHEMA_IMAGE_NEW = '"image":"' + ORIGIN + '/og-generic.png"';

let navFixed = 0;
let imagesRasterised = 0;
let logosAdded = 0;
let escapesStripped = 0;
let filesTouched = 0;

const files = readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();

for (const file of files) {
  const path = join(ROOT, file);
  let html = readFileSync(path, 'utf8');
  const before = html;

  if (html.includes(OLD_NAV)) {
    html = html.split(OLD_NAV).join(NEW_NAV);
    navFixed++;
  }

  html = html.replace(SCHEMA_IMAGE_RE, () => {
    imagesRasterised++;
    return SCHEMA_IMAGE_NEW;
  });

  html = html.replace(PUBLISHER_RE, () => {
    logosAdded++;
    return PUBLISHER_NEW;
  });

  if (html.includes('`r`n')) {
    html = html.split('`r`n').join('');
    escapesStripped++;
  }

  if (html !== before) {
    writeFileSync(path, html);
    filesTouched++;
  }
}

console.log('mobile-schema-pass: ' + filesTouched + ' file(s) touched — ' +
  navFixed + ' nav fix(es), ' + imagesRasterised + ' schema image(s) rasterised, ' +
  logosAdded + ' publisher logo(s), ' + escapesStripped + ' stray escape block(s)');
