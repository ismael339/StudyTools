// Build original Open Graph + Google Images artwork for every public page.
//
//   node scripts/build-og-images.mjs            (or: npm run images)
//   node scripts/build-og-images.mjs --only=gpa-calculator,pomodoro-timer
//
// For each page it renders a bespoke HTML canvas and rasterises it with
// headless Chrome into TWO files under /images:
//   images/<slug>-og.png      1200x630  (Open Graph / Twitter / Discover)
//   images/<slug>-square.png   800x800  (Google Images, which favours squares)
// Every canvas is dark-themed to match the site, carries the StudyTools
// wordmark, and is named after the page slug — never "image1.png".
//
// Three archetypes:
//   tool    — a realistic in-app mockup with real numbers (the money pages)
//   diagram — an explanatory infographic (forgetting curve, Pomodoro cycle…)
//   article — a branded title card with an accent and a subject motif
//
// Requires Chrome/Edge on the machine (auto-detected). Images are committed,
// so this only needs re-running when a page title or tool UI changes.

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const OUT = join(ROOT, 'images');
const TMP = join(ROOT, 'scripts', '.og-build');
const ORIGIN = 'https://www.studytools.pro';

// ---------------------------------------------------------------- archetypes

const ACCENT = {
  violet: ['#7c3aed', '#a78bfa'],
  blue:   ['#2563eb', '#60a5fa'],
  teal:   ['#0d9488', '#2dd4bf'],
  amber:  ['#d97706', '#fbbf24'],
  rose:   ['#e11d48', '#fb7185'],
  green:  ['#059669', '#34d399'],
  indigo: ['#4f46e5', '#818cf8'],
};

const LOGO = (size = 22) =>
  `<div style="position:absolute;right:34px;bottom:30px;display:flex;align-items:center;gap:10px;opacity:.96">` +
  `<span style="width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#6366f1,#22d3ee);` +
  `display:grid;place-items:center;color:#0b0d16;font:800 ${Math.round(size * 0.6)}px Arial">S</span>` +
  `<span style="color:#e8ecf7;font:800 ${size}px/1 Arial;letter-spacing:-.02em">Study<span style="color:#22d3ee">Tools</span></span></div>`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Dark, self-contained page shell. `square` switches the layout to 800x800.
function shell({ w, h, square, accent, body, kicker }) {
  const [a, b] = ACCENT[accent] || ACCENT.violet;
  const pad = square ? 60 : 56;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box}
  html,body{width:${w}px;height:${h}px;overflow:hidden}
  body{background:#0a0c14;font-family:Arial,Helvetica,system-ui,sans-serif;color:#eef2f9;position:relative}
  body::before{content:"";position:absolute;inset:0;
    background:radial-gradient(720px 460px at 12% -8%, ${a}33, transparent 60%),
               radial-gradient(640px 520px at 108% 112%, ${b}2a, transparent 58%),
               linear-gradient(160deg,#0a0c14 0%,#0d1020 55%,#0a0c14 100%)}
  body::after{content:"";position:absolute;inset:0;opacity:.05;
    background-image:linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px);
    background-size:44px 44px;mask-image:radial-gradient(circle at 50% 40%,#000,transparent 78%)}
  .wrap{position:relative;z-index:2;width:100%;height:100%;padding:${pad}px;display:flex;flex-direction:column}
  .kicker{font:800 ${square ? 19 : 18}px/1 Arial;letter-spacing:.16em;text-transform:uppercase;color:${b};display:flex;align-items:center;gap:12px}
  .kicker::before{content:"";width:34px;height:3px;border-radius:2px;background:linear-gradient(90deg,${a},${b})}
  h1{font-weight:800;letter-spacing:-.025em;color:#f6f8ff;line-height:1.04}
  </style></head><body><div class="wrap">
  ${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}
  ${body}
  ${LOGO(square ? 24 : 22)}
  </div></body></html>`;
}

// ------------------------------------------------------- archetype: article
// A branded title card with an abstract subject motif behind the text.
function renderArticle(page, w, h, square) {
  const titleSize = square ? 52 : (page.title.length > 42 ? 60 : 74);
  const sub = page.subtitle
    ? `<p style="margin-top:${square ? 20 : 26}px;color:#aeb6cc;font-weight:600;font-size:${square ? 25 : 27}px;line-height:1.35;max-width:${square ? '100%' : '30ch'}">${esc(page.subtitle)}</p>`
    : '';
  const body =
    `<div style="flex:1;display:flex;flex-direction:column;justify-content:center">` +
      articleMotif(page.motif, page.accent) +
      `<h1 style="font-size:${titleSize}px;margin-top:${square ? 18 : 10}px;max-width:${square ? '100%' : '17ch'}">${esc(page.title)}</h1>` +
      sub +
    `</div>`;
  return shell({ w, h, square, accent: page.accent, kicker: page.kicker, body });
}

// Small generative motifs drawn with inline SVG so every article feels unique.
function articleMotif(kind, accent) {
  const [a, b] = ACCENT[accent] || ACCENT.violet;
  const wrap = (inner) =>
    `<div style="margin-bottom:14px"><svg width="150" height="46" viewBox="0 0 150 46" fill="none">${inner}</svg></div>`;
  const dot = (x, y, r, c) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
  switch (kind) {
    case 'curve':
      return wrap(`<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
        `<path d="M6 40 C40 8, 70 8, 144 28" stroke="url(#g)" stroke-width="4" fill="none" stroke-linecap="round"/>` +
        dot(6, 40, 5, b) + dot(144, 28, 5, b));
    case 'cycle':
      return wrap(`<circle cx="23" cy="23" r="16" stroke="${a}" stroke-width="4" fill="none"/><path d="M23 7 A16 16 0 0 1 39 23" stroke="${b}" stroke-width="4" fill="none" stroke-linecap="round"/>` +
        `<rect x="52" y="12" width="90" height="6" rx="3" fill="${b}" opacity=".85"/><rect x="52" y="28" width="64" height="6" rx="3" fill="${a}" opacity=".55"/>`);
    case 'compare':
      return wrap(`<rect x="4" y="6" width="64" height="34" rx="8" fill="${a}" opacity=".22"/><rect x="4" y="6" width="64" height="34" rx="8" stroke="${a}" stroke-width="2"/>` +
        `<rect x="82" y="6" width="64" height="34" rx="8" fill="${b}" opacity=".22"/><rect x="82" y="6" width="64" height="34" rx="8" stroke="${b}" stroke-width="2"/>` +
        `<path d="M18 23 l7 7 14 -16" stroke="${b}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="M100 18 l20 0 M100 30 l14 0" stroke="${a}" stroke-width="4" stroke-linecap="round"/>`);
    case 'checklist':
      return wrap(`<rect x="6" y="4" width="38" height="38" rx="9" fill="${a}" opacity=".2"/><rect x="6" y="4" width="38" height="38" rx="9" stroke="${a}" stroke-width="2"/>` +
        `<path d="M16 23 l6 6 12 -14" stroke="${b}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<rect x="58" y="10" width="84" height="7" rx="3.5" fill="#ffffff" opacity=".5"/><rect x="58" y="28" width="58" height="7" rx="3.5" fill="${b}" opacity=".8"/>`);
    case 'brain':
      return wrap(`<circle cx="24" cy="23" r="17" stroke="${a}" stroke-width="3" fill="${a}" fill-opacity=".14"/>` +
        dot(24, 23, 6, b) + dot(41, 12, 3.5, b) + dot(41, 34, 3.5, b) + dot(8, 12, 3, a) +
        `<path d="M24 23 L41 12 M24 23 L41 34 M24 23 L8 12" stroke="${a}" stroke-width="2"/>` +
        `<rect x="58" y="16" width="82" height="6" rx="3" fill="#fff" opacity=".45"/><rect x="58" y="30" width="50" height="6" rx="3" fill="${b}" opacity=".8"/>`);
    default:
      return wrap(dot(10, 23, 6, a) + dot(34, 23, 6, b) + dot(58, 23, 6, a) +
        `<rect x="76" y="19" width="66" height="8" rx="4" fill="#fff" opacity=".4"/>`);
  }
}

// --------------------------------------------------------- archetype: tool
// A realistic, in-app mockup with believable numbers. This is the highest
// leverage artwork: what a student sees in Google Images right before they
// decide to click through and use the tool.
function renderTool(page, w, h, square) {
  const demo = TOOL_DEMO[page.slug] || genericDemo(page);
  const [a, b] = ACCENT[page.accent] || ACCENT.violet;
  const titleSize = square ? 44 : 54;
  const panel = (inner) =>
    `<div style="background:#111624;border:1px solid #232b3f;border-radius:18px;padding:${square ? 22 : 26}px;box-shadow:0 30px 70px rgba(0,0,0,.5)">${inner}</div>`;
  const rows = demo.rows.map((r) =>
    `<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 14px;background:#0c1020;border:1px solid #1c2338;border-radius:11px;margin-bottom:9px">
       <span style="color:#c7cee2;font-weight:600;font-size:${square ? 19 : 20}px">${esc(r[0])}</span>
       <span style="color:#8b93ad;font-weight:600;font-size:${square ? 18 : 19}px">${esc(r[1])}</span>
     </div>`).join('');
  const result =
    `<div style="margin-top:16px;padding:18px;border-radius:14px;background:linear-gradient(135deg,${a}33,${b}22);border:1px solid ${b}55;text-align:center">
       <div style="color:#aab3cc;font-weight:700;font-size:${square ? 15 : 16}px;letter-spacing:.1em;text-transform:uppercase">${esc(demo.resultLabel)}</div>
       <div style="color:#f4f7ff;font-weight:800;font-size:${square ? 40 : 46}px;margin-top:6px;letter-spacing:-.02em">${esc(demo.resultValue)}</div>
     </div>`;
  const head =
    `<h1 style="font-size:${titleSize}px;line-height:1.05">${esc(page.title)}</h1>` +
    (page.subtitle ? `<p style="margin-top:12px;color:#aeb6cc;font-weight:600;font-size:${square ? 20 : 22}px;line-height:1.35;max-width:${square ? '100%' : '34ch'}">${esc(page.subtitle)}</p>` : '');
  const layout = square
    ? `<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:20px">${head}${panel(rows + result)}</div>`
    : `<div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center">
         <div>${head}</div><div>${panel(rows + result)}</div>
       </div>`;
  return shell({ w, h, square, accent: page.accent, kicker: page.kicker || 'Free study tool', body: layout });
}

function genericDemo(page) {
  return {
    resultLabel: 'Result', resultValue: 'Ready',
    rows: [['Add your own', 'in seconds'], ['No sign-up', 'free today']],
  };
}

// Believable sample data per tool — real student-style inputs and outputs.
const TOOL_DEMO = {
  'gpa-calculator': {
    resultLabel: 'Cumulative GPA', resultValue: '3.72',
    rows: [['AP Calculus · A (4.0)', '4 credits'], ['English Lit · A− (3.7)', '4 credits'],
           ['Biology · B+ (3.3)', '3 credits'], ['History · B (3.0)', '3 credits']],
  },
  'grade-calculator': {
    resultLabel: 'Grade needed on final', resultValue: '87.4%',
    rows: [['Current grade', '84%'], ['Final exam weight', '30%'],
           ['Target course grade', '90%'], ['Marks already earned', '504 / 600']],
  },
  'pomodoro-timer': {
    resultLabel: 'Focus session', resultValue: '18:42',
    rows: [['Session', 'Focus · 25 min'], ['Break after', '5 min'],
           ['Completed today', '4 pomodoros'], ['Current streak', 'Day 6']],
  },
  'flashcard-maker': {
    resultLabel: 'Cards ready to study', resultValue: '24',
    rows: [['Q · Photosynthesis purpose?', 'A · Make glucose + O₂'],
           ['Q · Mitochondria function?', 'A · Cellular respiration'],
           ['Q · DNA vs RNA base?', 'A · Thymine vs Uracil']],
  },
  'citation-generator': {
    resultLabel: 'APA 7 citation', resultValue: 'Formatted',
    rows: [['Website · APA 7', 'Author, 2026'], ['Book · MLA 9', 'Title, publisher'],
           ['Journal · Chicago', 'Vol. 12, pp. 44'], ['YouTube · APA 7', 'Channel, date']],
  },
  'study-assistant': {
    resultLabel: 'Free AI requests today', resultValue: '12 left',
    rows: [['“Explain this step”', 'clear, short'], ['“Quiz me on chapter 4”', '8 questions'],
           ['“Check my working”', 'line by line']],
  },
  'exam-solver': {
    resultLabel: 'Worked solution', resultValue: 'Step by step',
    rows: [['Scan or type the problem', 'any subject'], ['See every step', 'not just the answer'],
           ['Understand the method', 'reuse it']],
  },
  'study-schedule': {
    resultLabel: 'Week planned', resultValue: '12 h 30 m',
    rows: [['Mon · Calculus problem set', '90 min'], ['Tue · Biology revision', '60 min'],
           ['Wed · Essay outline', '45 min'], ['Fri · Past-paper practice', '75 min']],
  },
  'drill': {
    resultLabel: 'Drill accuracy', resultValue: '92%',
    rows: [['Weak topic detected', 'Quadratics'], ['Questions this month', '3 of 2 free'],
           ['Difficulty adapts', 'to your level']],
  },
  'planner': {
    resultLabel: 'Next milestone', resultValue: 'Exam ready',
    rows: [['Adapts to your dates', 'auto'], ['Reorders by weakness', 'smart'],
           ['Tracks what you finished', 'honest']],
  },
};

// ------------------------------------------------------- archetype: diagram
// An explanatory infographic: a labelled chart the student can learn from even
// without visiting the site, which is exactly what earns image links.
function renderDiagram(page, w, h, square) {
  const titleSize = square ? 40 : 50;
  const head =
    `<h1 style="font-size:${titleSize}px;line-height:1.06;max-width:${square ? '100%' : '20ch'}">${esc(page.title)}</h1>` +
    (page.subtitle ? `<p style="margin-top:12px;color:#aeb6cc;font-weight:600;font-size:${square ? 19 : 21}px;line-height:1.35;max-width:${square ? '100%' : '40ch'}">${esc(page.subtitle)}</p>` : '');
  const chart = DIAGRAM[page.slug];
  const chartBox = chart
    ? `<div style="background:#0e1220;border:1px solid #232b3f;border-radius:18px;padding:${square ? 18 : 26}px;box-shadow:0 24px 60px rgba(0,0,0,.45)">${chart(square)}</div>`
    : '';
  const layout = square
    ? `<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:22px">${head}${chartBox}</div>`
    : `<div style="flex:1;display:grid;grid-template-columns:1fr 1.15fr;gap:38px;align-items:center">
         <div>${head}</div>${chartBox}
       </div>`;
  return shell({ w, h, square, accent: page.accent, kicker: page.kicker, body: layout });
}

// Each returns an inline-SVG chart the student can read without the site.
const DIAGRAM = {
  'spaced-repetition-for-students': () => `
    <svg viewBox="0 0 520 300" width="100%" style="display:block">
      <defs>
        <linearGradient id="sr1" x1="0" x2="1"><stop offset="0" stop-color="#f472b6"/><stop offset="1" stop-color="#e11d48"/></linearGradient>
        <linearGradient id="sr2" x1="0" x2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#059669"/></linearGradient>
      </defs>
      <line x1="52" y1="20" x2="52" y2="250" stroke="#2a3350" stroke-width="2"/>
      <line x1="52" y1="250" x2="500" y2="250" stroke="#2a3350" stroke-width="2"/>
      <text x="60" y="278" fill="#8b93ad" font-size="13" font-family="Arial">Time &rarr;</text>
      <text x="30" y="24" fill="#8b93ad" font-size="13" font-family="Arial">Recall</text>
      <path d="M60 30 C120 150, 200 220, 500 240" stroke="url(#sr1)" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M60 30 C120 90, 150 70, 200 90 C260 60, 300 80, 360 60 C420 70, 460 40, 500 45" stroke="url(#sr2)" stroke-width="4" fill="none" stroke-linecap="round"/>
      <circle cx="200" cy="90" r="6" fill="#34d399"/><circle cx="360" cy="60" r="6" fill="#34d399"/>
      <text x="250" y="180" fill="#fb7185" font-size="14" font-family="Arial" font-weight="700">No review &mdash; forgotten</text>
      <text x="286" y="105" fill="#34d399" font-size="14" font-family="Arial" font-weight="700">Spaced review &mdash; retained</text>
    </svg>`,
  'pomodoro-technique-for-students': () => `
    <svg viewBox="0 0 520 300" width="100%" style="display:block">
      <g font-family="Arial" font-weight="700">
        <circle cx="120" cy="120" r="58" fill="#7c3aed22" stroke="#a78bfa" stroke-width="3"/>
        <text x="120" y="112" fill="#f4f7ff" font-size="26" text-anchor="middle">25</text>
        <text x="120" y="140" fill="#aeb6cc" font-size="14" text-anchor="middle">focus</text>
        <circle cx="300" cy="120" r="46" fill="#22d3ee18" stroke="#22d3ee" stroke-width="3"/>
        <text x="300" y="114" fill="#f4f7ff" font-size="22" text-anchor="middle">5</text>
        <text x="300" y="140" fill="#aeb6cc" font-size="13" text-anchor="middle">break</text>
        <circle cx="440" cy="120" r="40" fill="#34d39918" stroke="#34d399" stroke-width="3"/>
        <text x="440" y="114" fill="#f4f7ff" font-size="20" text-anchor="middle">15</text>
        <text x="440" y="140" fill="#aeb6cc" font-size="12" text-anchor="middle">long break</text>
        <path d="M180 120 L246 120" stroke="#64748b" stroke-width="3" marker-end="url(#ar)"/>
        <path d="M348 120 L392 120" stroke="#64748b" stroke-width="3" marker-end="url(#ar)"/>
        <defs><marker id="ar" markerWidth="9" markerHeight="9" refX="6" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9 z" fill="#64748b"/></marker></defs>
        <text x="260" y="230" fill="#8b93ad" font-size="15" text-anchor="middle">Repeat 4&times;, then take the long break</text>
      </g>
    </svg>`,
  'active-recall-study-method': () => `
    <svg viewBox="0 0 520 300" width="100%" style="display:block" font-family="Arial">
      <rect x="20" y="30" width="230" height="230" rx="16" fill="#e11d4818" stroke="#fb7185" stroke-width="2"/>
      <rect x="270" y="30" width="230" height="230" rx="16" fill="#05966918" stroke="#34d399" stroke-width="2"/>
      <text x="135" y="66" fill="#fb7185" font-size="18" font-weight="800" text-anchor="middle">Re-reading</text>
      <text x="385" y="66" fill="#34d399" font-size="18" font-weight="800" text-anchor="middle">Active recall</text>
      <g font-size="14" fill="#c7cee2">
        <text x="44" y="104">&#10007;  Feels easy</text><text x="44" y="140">&#10007;  Familiarity is not memory</text>
        <text x="44" y="176">&#10007;  No feedback</text><text x="44" y="212">&#10007;  Fades in days</text>
        <text x="294" y="104">&#10003;  Feels hard (that is good)</text><text x="294" y="140">&#10003;  Trains retrieval</text>
        <text x="294" y="176">&#10003;  Shows weak spots</text><text x="294" y="212">&#10003;  Lasts for weeks</text>
      </g>
    </svg>`,
  'what-grade-do-i-need-on-my-final': () => `
    <svg viewBox="0 0 520 300" width="100%" style="display:block" font-family="Arial">
      <rect x="24" y="34" width="472" height="80" rx="14" fill="#0c1020" stroke="#232b3f" stroke-width="2"/>
      <text x="260" y="70" fill="#f4f7ff" font-size="19" font-weight="800" text-anchor="middle">needed = (target &minus; current &times; (1&minus;w)) &divide; w</text>
      <text x="260" y="98" fill="#8b93ad" font-size="13" text-anchor="middle">w = weight of the final exam</text>
      <rect x="24" y="142" width="230" height="118" rx="14" fill="#7c3aed20" stroke="#a78bfa" stroke-width="2"/>
      <text x="139" y="176" fill="#aeb6cc" font-size="13" text-anchor="middle">Current 84% &middot; final weight 40%</text>
      <text x="139" y="220" fill="#f4f7ff" font-size="34" font-weight="800" text-anchor="middle">96%</text>
      <text x="139" y="246" fill="#a78bfa" font-size="13" text-anchor="middle">needed for an A</text>
      <rect x="274" y="142" width="222" height="118" rx="14" fill="#05966920" stroke="#34d399" stroke-width="2"/>
      <text x="385" y="176" fill="#aeb6cc" font-size="13" text-anchor="middle">Current 84% &middot; final weight 40%</text>
      <text x="385" y="220" fill="#f4f7ff" font-size="34" font-weight="800" text-anchor="middle">60%</text>
      <text x="385" y="246" fill="#34d399" font-size="13" text-anchor="middle">to secure a passing C</text>
    </svg>`,
};

// ------------------------------------------------------------- page manifest
// kind: tool | diagram | article. Every public page gets bespoke artwork.
// accent picks the gradient pair; kicker is the small eyebrow label.
const PAGES = [
  // ---- tools (money pages: rank for the tool query, drive sign-ups) ----
  { slug: 'gpa-calculator', kind: 'tool', accent: 'indigo', kicker: 'Free tool',
    title: 'Free GPA Calculator for Students', subtitle: 'Weighted & unweighted. Add classes, get your GPA instantly.' },
  { slug: 'grade-calculator', kind: 'tool', accent: 'violet', kicker: 'Free tool',
    title: 'Free Grade Calculator', subtitle: 'See what you need on the final to hit your target grade.' },
  { slug: 'pomodoro-timer', kind: 'tool', accent: 'teal', kicker: 'Free tool',
    title: 'Free Online Pomodoro Timer', subtitle: '25-minute focus sessions with built-in breaks.' },
  { slug: 'flashcard-maker', kind: 'tool', accent: 'amber', kicker: 'Free tool',
    title: 'Free Flashcard Maker', subtitle: 'Turn any notes into active-recall flashcards in seconds.' },
  { slug: 'citation-generator', kind: 'tool', accent: 'blue', kicker: 'Free tool',
    title: 'Free Citation Generator', subtitle: 'APA, MLA and Chicago citations, formatted for you.' },
  { slug: 'study-assistant', kind: 'tool', accent: 'green', kicker: 'Free tool',
    title: 'Free AI Tutor for Students', subtitle: 'Ask any question. Get clear, step-by-step explanations.' },
  { slug: 'exam-solver', kind: 'tool', accent: 'rose', kicker: 'Free tool',
    title: 'Free Exam Solver', subtitle: 'Worked solutions that show every step, not just the answer.' },
  { slug: 'study-schedule', kind: 'tool', accent: 'indigo', kicker: 'Free tool',
    title: 'Free Study Schedule Maker', subtitle: 'Build a weekly plan you will actually follow.' },
  { slug: 'drill', kind: 'tool', accent: 'teal', kicker: 'Free tool',
    title: 'Study Coach Drills', subtitle: 'Short, adaptive practice that targets your weak topics.' },
  { slug: 'planner', kind: 'tool', accent: 'violet', kicker: 'Free tool',
    title: 'Adaptive Revision Planner', subtitle: 'A plan that reorders itself as you improve.' },

  // ---- diagrams (the concept explainers that earn image links) ----
  { slug: 'spaced-repetition-for-students', kind: 'diagram', accent: 'rose', kicker: 'Study method',
    title: 'Spaced Repetition for Students', subtitle: 'Review at growing intervals and stop forgetting what you learn.' },
  { slug: 'pomodoro-technique-for-students', kind: 'diagram', accent: 'teal', kicker: 'Study method',
    title: 'The Pomodoro Technique, Done Right', subtitle: '25 minutes focus, 5 minutes break, repeated in cycles.' },
  { slug: 'active-recall-study-method', kind: 'diagram', accent: 'green', kicker: 'Study method',
    title: 'Active Recall vs Re-reading', subtitle: 'Why testing yourself beats reading the notes again.' },
  { slug: 'what-grade-do-i-need-on-my-final', kind: 'diagram', accent: 'violet', kicker: 'Grade planning',
    title: 'What Grade Do I Need on My Final?', subtitle: 'The formula that turns your target into a number.' },

  // ---- signature articles (curated subtitle + motif) ----
  { slug: 'how-to-study-for-a-math-test', kind: 'article', accent: 'blue', kicker: 'Study guide', motif: 'checklist',
    title: 'How to Study for a Math Test', subtitle: 'A realistic 7-day plan, from topic list to final revision.' },
  { slug: 'how-to-revise-for-exams', kind: 'article', accent: 'indigo', kicker: 'Study guide', motif: 'curve',
    title: 'How to Revise for Exams', subtitle: 'A plan that actually works instead of last-minute cramming.' },
  { slug: 'how-to-make-flashcards-that-work', kind: 'article', accent: 'amber', kicker: 'Study guide', motif: 'compare',
    title: 'How to Make Flashcards That Work', subtitle: 'One idea per card, and questions that force recall.' },
  { slug: 'how-to-take-better-notes-in-class', kind: 'article', accent: 'teal', kicker: 'Study guide', motif: 'checklist',
    title: 'How to Take Better Notes in Class', subtitle: 'Write less, understand more, and review faster.' },
  { slug: 'how-to-write-an-essay-fast', kind: 'article', accent: 'rose', kicker: 'Study guide', motif: 'checklist',
    title: 'How to Write an Essay Fast', subtitle: 'A structure that gets words down without the panic.' },
  { slug: 'how-to-stop-procrastinating-homework', kind: 'article', accent: 'green', kicker: 'Study guide', motif: 'cycle',
    title: 'How to Stop Procrastinating Homework', subtitle: 'Start in five minutes with a lower bar, not more willpower.' },
  { slug: 'how-to-study-with-no-motivation', kind: 'article', accent: 'violet', kicker: 'Study guide', motif: 'brain',
    title: 'How to Study With No Motivation', subtitle: 'Tiny systems that work on the days you feel nothing.' },
  { slug: 'how-to-summarize-a-chapter', kind: 'article', accent: 'blue', kicker: 'Study guide', motif: 'checklist',
    title: 'How to Summarize a Chapter', subtitle: 'Compress a chapter into notes you can actually revise.' },
  { slug: 'how-to-study-for-an-exam-in-one-week', kind: 'article', accent: 'amber', kicker: 'Study guide', motif: 'curve',
    title: 'How to Study for an Exam in One Week', subtitle: 'Seven days, prioritised by what earns the most marks.' },
  { slug: 'how-to-take-notes-from-a-textbook', kind: 'article', accent: 'teal', kicker: 'Study guide', motif: 'checklist',
    title: 'How to Take Notes From a Textbook', subtitle: 'A repeatable system for dense chapters.' },
  { slug: 'how-to-memorize-vocabulary-fast', kind: 'article', accent: 'green', kicker: 'Study guide', motif: 'curve',
    title: 'How to Memorize Vocabulary Fast', subtitle: 'Pair spaced repetition with real example sentences.' },
  { slug: 'study-mistakes-students-make', kind: 'article', accent: 'rose', kicker: 'Study guide', motif: 'compare',
    title: 'Study Mistakes Students Make', subtitle: 'Ten habits that quietly cap your grades, and the fixes.' },
  { slug: 'what-to-do-the-night-before-an-exam', kind: 'article', accent: 'indigo', kicker: 'Study guide', motif: 'checklist',
    title: 'What to Do the Night Before an Exam', subtitle: 'A calm plan that protects your sleep and your memory.' },
  { slug: 'how-to-create-a-study-schedule', kind: 'article', accent: 'blue', kicker: 'Study guide', motif: 'cycle',
    title: 'How to Create a Study Schedule', subtitle: 'One you will actually follow through the week.' },
  { slug: 'how-to-make-a-study-plan-for-finals', kind: 'article', accent: 'violet', kicker: 'Study guide', motif: 'curve',
    title: 'How to Make a Study Plan for Finals', subtitle: 'Spread the load before finals week hits.' },
  { slug: 'exam-anxiety-how-to-calm-down', kind: 'article', accent: 'teal', kicker: 'Wellbeing', motif: 'brain',
    title: 'Exam Anxiety: How to Calm Down', subtitle: 'Practical ways to steady your nerves and still perform.' },
  { slug: 'best-time-to-study-for-students', kind: 'article', accent: 'amber', kicker: 'Study guide', motif: 'cycle',
    title: 'The Best Time to Study', subtitle: 'Match your sessions to your energy, not a rule of thumb.' },
  { slug: 'how-to-do-homework-without-getting-distracted', kind: 'article', accent: 'green', kicker: 'Study guide', motif: 'compare',
    title: 'How to Do Homework Without Distractions', subtitle: 'Remove the pull before you rely on discipline.' },
  { slug: 'how-to-use-a-gpa-calculator', kind: 'article', accent: 'indigo', kicker: 'Study guide', motif: 'checklist',
    title: 'How to Use a GPA Calculator', subtitle: 'Get a number you can trust, and know what it means.' },
  { slug: 'apa-citation-examples-for-students', kind: 'article', accent: 'blue', kicker: 'Citing', motif: 'checklist',
    title: 'APA Citation Examples for Students', subtitle: 'Websites, books and journals, copy-ready.' },
  { slug: 'ai-homework-helper-without-cheating', kind: 'article', accent: 'teal', kicker: 'Study guide', motif: 'compare',
    title: 'Use an AI Homework Helper Without Cheating', subtitle: 'Get help that actually teaches you the method.' },
  { slug: 'how-to-use-ai-to-summarize-notes', kind: 'article', accent: 'violet', kicker: 'Study guide', motif: 'checklist',
    title: 'How to Use AI to Summarize Notes', subtitle: 'Shorter notes that keep the meaning intact.' },
  { slug: 'best-study-routine-for-high-school-students', kind: 'article', accent: 'rose', kicker: 'Study guide', motif: 'cycle',
    title: 'Best Study Routine for High School', subtitle: 'A sustainable routine that survives busy weeks.' },
  { slug: 'best-study-apps-for-students', kind: 'article', accent: 'indigo', kicker: 'Study guide', motif: 'compare',
    title: 'The Best Study Apps for Students', subtitle: 'What is worth installing, and what is just a distraction.' },
  { slug: 'best-free-ai-study-tools-for-students', kind: 'article', accent: 'green', kicker: 'Study guide', motif: 'compare',
    title: 'Best Free AI Study Tools', subtitle: 'What you get for free, and where Pro earns its keep.' },
  { slug: 'how-ai-improves-learning', kind: 'article', accent: 'blue', kicker: 'Research', motif: 'brain',
    title: 'How AI Improves Learning', subtitle: 'Where it helps retention, and where it does not.' },
  { slug: 'benefits-of-ai-in-education', kind: 'article', accent: 'violet', kicker: 'Research', motif: 'brain',
    title: 'Benefits of AI in Education', subtitle: 'The honest case for students and teachers.' },
  { slug: 'ai-homework-helper', kind: 'article', accent: 'teal', kicker: 'Study guide', motif: 'compare',
    title: 'AI Homework Helpers, Ranked', subtitle: 'The best free options and what each is good at.' },
  { slug: 'how-to-study-math-effectively', kind: 'article', accent: 'indigo', kicker: 'Study guide', motif: 'checklist',
    title: 'How to Study Math Effectively', subtitle: 'Practice over re-reading, and how to check your work.' },
  { slug: 'how-to-reduce-exam-stress', kind: 'article', accent: 'teal', kicker: 'Wellbeing', motif: 'brain',
    title: 'How to Reduce Exam Stress', subtitle: 'Planning and breathing that actually calm you down.' },
  { slug: 'app', kind: 'tool', accent: 'violet', kicker: 'Free tool',
    title: 'AI Notes Summarizer', subtitle: 'Paste notes, get a summary, outline and flashcards.' },

  // ---- remaining public pages (unique branded card, never generic) ----
  { slug: 'index', kind: 'article', accent: 'violet', kicker: 'StudyTools', motif: 'brain',
    title: 'Free AI Study Tools for Students', subtitle: 'AI tutor, calculators, flashcards and more. No sign-up.' },
  { slug: 'blog', kind: 'article', accent: 'indigo', kicker: 'Study guides', motif: 'checklist',
    title: 'Study Guides & How-Tos', subtitle: 'Practical, evidence-based guides to studying smarter.' },
  { slug: 'pro', kind: 'article', accent: 'green', kicker: 'StudyTools Pro', motif: 'curve',
    title: 'Go Further With Pro', subtitle: '2000 requests a day, full-length answers, everything saved.' },
  { slug: 'about', kind: 'article', accent: 'blue', kicker: 'About', motif: 'brain',
    title: 'Built by a Student, for Students', subtitle: 'A small, honest study toolkit. No dark patterns.' },
  { slug: 'play', kind: 'article', accent: 'amber', kicker: 'PLAY', motif: 'cycle',
    title: 'Turn Studying Into a Game', subtitle: 'Flashcard battle, memory match and more.' },
  { slug: 'contact', kind: 'article', accent: 'teal', kicker: 'Contact', motif: 'checklist',
    title: 'Contact StudyTools', subtitle: 'Questions, feedback or a bug? We read every message.' },
  { slug: 'privacy', kind: 'article', accent: 'indigo', kicker: 'Privacy', motif: 'checklist',
    title: 'Privacy Policy', subtitle: 'No ads, no dark patterns, no selling your data.' },
  { slug: 'terms', kind: 'article', accent: 'violet', kicker: 'Terms', motif: 'checklist',
    title: 'Terms of Use', subtitle: 'How StudyTools works, billing and cancellations.' },
];

// Any indexable page not curated above still gets a branded card, using the
// real <title> from the HTML so we never ship a generic image to a live page.
const EXTRA_SLUGS = {
  'blog': { accent: 'indigo', kicker: 'Study guides', title: 'Study Guides & How-Tos', subtitle: 'Practical, evidence-based guides to studying smarter.' },
  'index': { accent: 'violet', kicker: 'StudyTools', title: 'Free AI Study Tools for Students', subtitle: 'AI tutor, calculators, flashcards and more. No sign-up.' },
  'pro': { accent: 'green', kicker: 'StudyTools Pro', title: 'Go Further With Pro', subtitle: '2000 requests a day, full-length answers, everything saved.' },
};

// ------------------------------------------------------------------ raster
function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  // Fall back to PATH lookups.
  for (const name of ['google-chrome', 'chromium', 'chrome', 'chromium-browser']) {
    try { execFileSync('which', [name], { stdio: 'ignore' }); return name; } catch { /* keep looking */ }
  }
  throw new Error('No Chrome/Edge found. Install Chrome or pass --chrome=<path>.');
}

function screenshot(chrome, htmlPath, pngPath, w, h) {
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--force-color-profile=srgb',
    '--default-background-color=00000000',
    '--window-size=' + w + ',' + h,
    '--screenshot=' + pngPath,
    'file:///' + htmlPath.replace(/\\/g, '/'),
  ], { stdio: 'ignore' });
}

// --------------------------------------------------------------------- main
function main() {
  const args = process.argv.slice(2);
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
  const chromeArg = args.find((a) => a.startsWith('--chrome='));
  const chrome = chromeArg ? chromeArg.slice(9) : findChrome();

  mkdirSync(OUT, { recursive: true });
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  let made = 0;
  for (const page of PAGES) {
    if (only && !only.has(page.slug)) continue;
    for (const [w, h, suffix] of [[1200, 630, '-og'], [800, 800, '-square']]) {
      const square = w === h;
      const html = page.kind === 'tool' ? renderTool(page, w, h, square)
        : page.kind === 'diagram' ? renderDiagram(page, w, h, square)
        : renderArticle(page, w, h, square);
      const htmlPath = join(TMP, page.slug + suffix + '.html');
      const pngPath = join(OUT, page.slug + suffix + '.png');
      writeFileSync(htmlPath, html);
      screenshot(chrome, htmlPath, pngPath, w, h);
    }
    made++;
    process.stdout.write('  ok  ' + page.slug + '\n');
  }
  rmSync(TMP, { recursive: true, force: true });
  console.log('\nBuilt artwork for ' + made + ' pages into /images (' + (made * 2) + ' PNGs).');
}

main();

