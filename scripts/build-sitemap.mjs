// Regenerate sitemap.xml from the pages on disk.
//
//   node scripts/build-sitemap.mjs     (or: npm run sitemap)
//
// Excludes noindex and robots-blocked pages, stamps each URL with the date of
// its last git commit, and keeps the priority/changefreq scheme:
//   home 1.0 weekly | tools 0.9 monthly | blog index 0.9 weekly
//   pro 0.9 weekly | articles 0.8 monthly | play 0.7 | static 0.3 yearly
// Run scripts/seo-check.mjs afterwards to validate the result.

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const ORIGIN = 'https://www.studytools.pro';
const TODAY = new Date().toISOString().slice(0, 10);

const BLOCKED = new Set(['/dashboard.html', '/profile.html', '/pro-success.html', '/login.html', '/register.html']);
const TOOLS = new Set([
  '/app.html', '/exam-solver.html', '/citation-generator.html', '/flashcard-maker.html',
  '/gpa-calculator.html', '/grade-calculator.html', '/planner.html', '/pomodoro-timer.html',
  '/study-schedule.html', '/drill.html', '/study-assistant.html'
]);
const STATIC = new Set(['/about.html', '/contact.html', '/privacy.html', '/terms.html']);

function schedule(path) {
  if (path === '/') return { changefreq: 'weekly', priority: '1.0' };
  if (path === '/blog.html') return { changefreq: 'weekly', priority: '0.9' };
  if (path === '/pro.html') return { changefreq: 'weekly', priority: '0.9' };
  if (TOOLS.has(path)) return { changefreq: 'monthly', priority: '0.9' };
  if (path === '/play.html') return { changefreq: 'monthly', priority: '0.7' };
  if (STATIC.has(path)) return { changefreq: 'yearly', priority: '0.3' };
  return { changefreq: 'monthly', priority: '0.8' }; // study guides
}

function lastmod(file) {
  try {
    const out = execSync('git log -1 --format=%cs -- "' + file + '"', { cwd: ROOT, encoding: 'utf8' }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch { /* not committed yet */ }
  return TODAY;
}

const pages = readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
const urls = [];

for (const file of pages) {
  const html = readFileSync(join(ROOT, file), 'utf8');
  const path = file === 'index.html' ? '/' : '/' + file;
  const robots = (html.match(/<meta[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/i) || [, ''])[1].toLowerCase();
  if (BLOCKED.has(path) || robots.includes('noindex')) continue;
  const loc = ORIGIN + path;
  const s = schedule(path);
  urls.push(
    '  <url>\n' +
    '    <loc>' + loc + '</loc>\n' +
    '    <lastmod>' + lastmod(file) + '</lastmod>\n' +
    '    <changefreq>' + s.changefreq + '</changefreq>\n' +
    '    <priority>' + s.priority + '</priority>\n' +
    '  </url>'
  );
}

const xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.join('\n') + '\n' +
  '</urlset>\n';

const before = existsSync(join(ROOT, 'sitemap.xml')) ? readFileSync(join(ROOT, 'sitemap.xml'), 'utf8') : '';
if (before !== xml) process.stdout.write('writing sitemap.xml (' + urls.length + ' urls)\n');
writeFileSync(join(ROOT, 'sitemap.xml'), xml);
