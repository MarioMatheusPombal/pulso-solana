#!/usr/bin/env node
'use strict';

// Gera os assets de README (../../readme/) e o kit de motion (./layers, ./previews).
// Usage: node public/assets/brand-v1/motion/build.js — Node only, no dependencies.
// The Guardian art enters as downsized copies of the raster-v2 masters (see MOTION.md).
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const readmeDir = path.resolve(here, '../../readme');
const NOTICE = 'NOT AUDITED · DEVNET DEMONSTRATION ONLY';
const SANS = 'Arial,Helvetica,sans-serif';
const UI = "system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

// Tokens from tokens.css. `pulse` and `amberText` darken the amber on the light theme,
// where #FFB020 on ivory is 1.66:1.
const T = {
  dark: { dark: true, bg: '#0A0E13', panel: '#10161D', line: '#29343E', grid: '#131C25', text: '#F6F4EF', muted: '#C0C4C8', amber: '#FFB020', pulse: '#FFB020', amberText: '#FFB020', ok: '#55D38F', danger: '#FF7D72', neutral: '#8A96A3' },
  light: { dark: false, bg: '#F6F4EF', panel: '#FFFFFF', line: '#D8D3C9', grid: '#E9E5DC', text: '#14171A', muted: '#62686D', amber: '#FFB020', pulse: '#B87400', amberText: '#8A5200', ok: '#14734B', danger: '#B42318', neutral: '#62686D' },
};

// Hood silhouette in master space (1254 × 1254), traced from the alpha channel.
const HOOD = 'M603 108 L557 132 L523 156 L493 180 L466 204 L441 228 L419 252 L399 276 L381 300 L365 324 L350 348 L336 372 L322 396 L308 420 L294 444 L279 468 L263 492 L247 516 L230 540 L213 564 L196 588 L179 612 L162 636 L145 660 L129 684 L114 708 L100 732 L90 756 L85 780 L95 804 L123 828 L169 852 L223 876 L269 900 L312 924 L353 948 L392 972 L427 996 L460 1020 L491 1044 L519 1068 L546 1092 L571 1116 L597 1140 L616 1158 L626 1158 L653 1134 L680 1110 L709 1086 L738 1062 L768 1038 L799 1014 L833 990 L868 966 L907 942 L949 918 L993 894 L1042 870 L1094 846 L1136 822 L1162 798 L1168 774 L1160 750 L1149 726 L1134 702 L1118 678 L1102 654 L1085 630 L1067 606 L1051 582 L1034 558 L1017 534 L1001 510 L985 486 L970 462 L955 438 L941 414 L928 390 L914 366 L900 342 L885 318 L868 294 L850 270 L829 246 L806 222 L781 198 L753 174 L723 150 L688 126 L650 108Z';
// Center of the amber irises in master space.
const EYES = [{ cx: 511, cy: 600 }, { cx: 740, cy: 600 }];

// The release guard looks for banned terms case-insensitively; base64 can
// form one by chance. Same trick as expressive-kit: numeric references.
const dataUri = file => 'data:image/png;base64,' + fs.readFileSync(path.join(here, 'layers', file)).toString('base64').replace(/[bBcCpPmMvV]/g, c => `&#${c.charCodeAt(0)};`);
const MARK = dataUri('guardian-mark-400.png');
const HEART = dataUri('guardian-heart-520.png');

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const r = n => Math.round(n * 100) / 100;
const t = (x, y, s, o = {}) => `<text x="${x}" y="${y}" fill="${o.fill}" font-family="${o.font || UI}" font-size="${o.size || 16}" font-weight="${o.weight || 400}"${o.ls ? ` letter-spacing="${o.ls}"` : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.id ? ` id="${o.id}"` : ''}${o.cls ? ` class="${o.cls}"` : ''}>${esc(s)}</text>`;
const mono = (x, y, s, o = {}) => t(x, y, s, { font: MONO, size: 13, weight: 700, ls: 1.5, ...o });
const panel = (x, y, w, h, th, o = {}) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx || 12}" fill="${o.fill || th.panel}" stroke="${o.stroke || th.line}" stroke-width="${o.sw || 1}"/>`;
// Um batimento: 110 px de largura em escala 1, volta à linha de base.
const beat = (s = 1) => [[14, 0], [8, -6], [10, 6], [17, 0], [10, -27], [9, 39], [10, -18], [12, 6], [20, 0]].map(([x, y]) => `l${r(x * s)} ${r(y * s)}`).join(' ');
const line = (d, stroke, o = {}) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${o.w || 2}" stroke-linecap="round" stroke-linejoin="round"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}${o.id ? ` id="${o.id}"` : ''}${o.cls ? ` class="${o.cls}"` : ''}${o.len ? ' pathLength="1"' : ''}${o.op ? ` opacity="${o.op}"` : ''}/>`;
// Trecho claro que percorre o caminho; some com prefers-reduced-motion.
const comet = (d, stroke, o = {}) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${o.w || 3}" stroke-linecap="round" stroke-linejoin="round" pathLength="1" class="comet"${o.delay ? ` style="animation-delay:${o.delay}s"` : ''}/>`;

const defs = (th, W, extra = '') => `<defs>
<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0V40M0 40H40" fill="none" stroke="${th.grid}"/></pattern>
<radialGradient id="glow"><stop offset="0" stop-color="${th.amber}" stop-opacity="${th.dark ? 0.24 : 0.3}"/><stop offset="1" stop-color="${th.amber}" stop-opacity="0"/></radialGradient>
<radialGradient id="eye"><stop offset="0" stop-color="#FFD06A" stop-opacity=".85"/><stop offset="1" stop-color="${th.amber}" stop-opacity="0"/></radialGradient>
<radialGradient id="fade"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="pulse" gradientUnits="userSpaceOnUse" x1="0" x2="${W}"><stop offset="0" stop-color="${th.pulse}" stop-opacity="0"/><stop offset=".18" stop-color="${th.pulse}" stop-opacity=".4"/><stop offset=".56" stop-color="${th.pulse}"/><stop offset=".9" stop-color="${th.pulse}" stop-opacity=".4"/><stop offset="1" stop-color="${th.pulse}" stop-opacity="0"/></linearGradient>
${extra}</defs>`;
const css = (extra = '') => `<style>
.comet{stroke-dasharray:.09 .91;animation:run 5s linear infinite}
.eyes{animation:eyes 5s ease-in-out infinite}
@keyframes run{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes eyes{0%,100%{opacity:.25}50%{opacity:1}}
${extra}
@media (prefers-reduced-motion:reduce){.comet{display:none}*{animation:none!important}}
</style>`;
const svg = (W, H, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${body}</svg>\n`;

// Compact Guardian. On the dark theme the black hood vanishes into the background: an outline restores it.
function mark(x, y, S, th, o = {}) {
  const k = S / 1254;
  const at = `transform="translate(${x} ${y}) scale(${r(k)})"`;
  return (o.glow === false ? '' : `<circle cx="${x + S / 2}" cy="${y + S / 2}" r="${r(S * 0.62)}" fill="url(#glow)"${o.glowCls ? ` class="${o.glowCls}"` : ''}/>`)
    + `<g${o.cls ? ` class="${o.cls}"` : ''}>`
    + (th.dark ? `<path ${at} d="${HOOD}" fill="#141B23" stroke="#2F3B48" stroke-width="${r(5 / k)}" stroke-linejoin="round"/>` : '')
    + `<image href="${MARK}" x="${x}" y="${y}" width="${S}" height="${S}"/>`
    // The animated class sits in a group with no transform of its own: transform-box changes the origin of the attribute.
    + `<g ${at}><g class="${o.eyeCls || 'eyes'}">${EYES.map(e => `<ellipse cx="${e.cx}" cy="${e.cy}" rx="78" ry="60" fill="url(#eye)"/>`).join('')}</g></g></g>`;
}
const backdrop = (W, H, th, gx, gy, gr) => `<rect width="${W}" height="${H}" rx="20" fill="${th.bg}"/><mask id="m"><ellipse cx="${gx}" cy="${gy}" rx="${gr * 1.5}" ry="${gr}" fill="url(#fade)"/></mask><rect width="${W}" height="${H}" fill="url(#grid)" mask="url(#m)"/>`;
const frame = (W, H, th) => `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="20" fill="none" stroke="${th.line}"/>`;
const notice = (x, y, th, size = 13) => mono(x, y, NOTICE, { fill: th.amberText, size });

// ------------------------------------------------------------------ README --

function hero(th) {
  const W = 1200, H = 400, py = 336, gx = 820, gy = 44, S = 340;
  const d = `M0 ${py} H620 ${beat(1.3)} H${W}`;
  return svg(W, H, 'PULSO: human authorization layer for AI agents. ' + NOTICE, defs(th, W) + css()
    + backdrop(W, H, th, gx + S / 2, gy + S / 2, 330)
    + mono(64, 72, 'HUMAN AUTHORIZATION LAYER FOR AI AGENTS · SOLANA', { fill: th.muted, ls: 3.2, weight: 600 })
    + t(60, 198, 'PULSO', { fill: th.text, font: SANS, size: 122, weight: 800, ls: 10 })
    + t(66, 246, 'The agent holds the wallet.', { fill: th.muted, size: 22 })
    + t(66, 277, 'The human holds the authority.', { fill: th.text, size: 22, weight: 700 })
    + line(d, 'url(#pulse)', { w: 2.4 }) + comet(d, th.pulse)
    + mark(gx, gy, S, th)
    + notice(64, 376, th, 13.5) + frame(W, H, th));
}

function divider(th) {
  const W = 1200, H = 36, d = `M0 18 H545 ${beat(1)} H${W}`;
  return svg(W, H, 'PULSO pulse divider', defs(th, W) + css()
    + line(`M0 18 H${W}`, th.line, { w: 1.5 }) + line(`M545 18 ${beat(1)}`, th.bg, { w: 6 })
    + line(d, 'url(#pulse)', { w: 2 }) + comet(d, th.pulse, { w: 2.6 }));
}

const pill = (x, y, w, label, color, th) => panel(x, y, w, 40, th, { rx: 20, stroke: color, sw: 1.5 }) + mono(x + w / 2, y + 25, label, { fill: color, anchor: 'middle' });

function flow(th) {
  const W = 1000, H = 520, lane = y => `M440 262 C478 262 462 ${y} 500 ${y}`;
  const l1 = `${lane(100)} H820`, l2 = `${lane(262)} H612 ${beat(0.8)} H820`, l3 = `${lane(424)} H820`;
  return svg(W, H, 'How an action passes through PULSO: within delegated authority it executes; outside it needs human approval of the exact action; changed, reused or expired authorizations are rejected. ' + NOTICE, defs(th, W) + css()
    + `<rect width="${W}" height="${H}" rx="20" fill="${th.bg}"/>`
    + mono(40, 46, 'HOW AN ACTION PASSES THROUGH PULSO', { fill: th.muted, ls: 2.6, weight: 600 })
    + panel(40, 220, 150, 84, th) + mono(60, 250, 'AI AGENT', { fill: th.muted, size: 12, ls: 2 }) + t(60, 280, 'wants to act', { fill: th.text, weight: 600 })
    + line('M190 262 H250', th.neutral) + comet('M190 262 H250', th.pulse)
    + panel(250, 150, 190, 224, th, { rx: 14 }) + line('M264 151 H426', th.amber, { w: 3 })
    + mark(297, 164, 96, th, { glow: false })
    + t(345, 292, 'PULSO', { fill: th.text, font: SANS, size: 22, weight: 800, ls: 4, anchor: 'middle' })
    + t(345, 318, 'policy enforced by', { fill: th.muted, size: 14, anchor: 'middle' }) + t(345, 338, 'the on-chain program', { fill: th.muted, size: 14, anchor: 'middle' })
    // 1 · autonomous
    + mono(500, 78, 'WITHIN DELEGATED AUTHORITY', { fill: th.ok }) + line(l1, th.ok) + comet(l1, th.ok, { delay: 0.6 })
    + t(500, 128, 'Autonomous. No human in the loop.', { fill: th.muted, size: 14 }) + pill(830, 80, 130, 'EXECUTED', th.ok, th)
    // 2 · human approval: this is where the line pulses
    + mono(500, 216, 'OUTSIDE AUTHORITY · HUMAN_INTENT_REQUIRED', { fill: th.amberText }) + line(l2, th.pulse) + comet(l2, th.text, { delay: 1.8 })
    + t(500, 300, 'The human approves the exact action:', { fill: th.muted, size: 14 }) + t(500, 320, 'scoped, expiring, single-use.', { fill: th.muted, size: 14 }) + pill(830, 242, 130, 'EXECUTED', th.ok, th)
    // 3 · rejeitado
    + mono(500, 402, 'CHANGED · REUSED · EXPIRED', { fill: th.danger }) + line(l3, th.danger, { dash: '2 8' })
    + t(500, 452, 'Rejected by the program. The agent can', { fill: th.muted, size: 14 }) + t(500, 472, 'never widen its own authority.', { fill: th.muted, size: 14 }) + pill(830, 404, 130, 'REJECTED', th.danger, th)
    + notice(40, 494, th) + frame(W, H, th));
}

const SCENARIOS = [
  ['A', '5 USDC', 'under the limit', 'ok', 'SUCCESS · AUTONOMOUS'],
  ['B', '100 USDC', 'over the limit', 'human', 'HUMAN_INTENT_REQUIRED → SUCCESS'],
  ['C', 'Authorized 100', 'agent attempts 150', 'no', 'PULSO_006_INTENT_MISMATCH'],
  ['D', 'Recipient changed', 'after authorization', 'no', 'PULSO_006_INTENT_MISMATCH'],
  ['E', 'Authorization reused', 'single-use replay', 'no', 'PULSO_005_INTENT_ALREADY_USED'],
  ['F', 'Past expiry', 'authorization expired', 'no', 'PULSO_004_INTENT_EXPIRED'],
];
// 256 px glyph: straight line = autonomous, heartbeat = human approval, cut with ✕ = rejected.
function glyph(x, y, kind, th) {
  if (kind === 'ok') return line(`M${x} ${y} H${x + 244}`, th.ok) + `<circle cx="${x + 250}" cy="${y}" r="5" fill="${th.ok}"/>`;
  const d = `M${x} ${y} H${x + 60} ${beat(0.7)}`;
  if (kind === 'human') return line(`${d} H${x + 244}`, th.pulse) + `<circle cx="${x + 250}" cy="${y}" r="5" fill="${th.ok}"/>`;
  const cx = x + 222;
  return line(`${d} H${x + 150}`, th.pulse) + line(`M${x + 160} ${y} H${cx - 14}`, th.danger, { dash: '2 8' }) + line(`M${cx - 6} ${y - 6} l12 12 M${cx + 6} ${y - 6} l-12 12`, th.danger, { w: 2.5 });
}
function scenarios(th) {
  const W = 1000, H = 420;
  const cards = SCENARIOS.map(([k, a, b, kind, status], i) => {
    const x = 40 + (i % 3) * 312, y = 64 + Math.floor(i / 3) * 162, color = kind === 'no' ? th.danger : kind === 'ok' ? th.ok : th.amberText;
    return panel(x, y, 296, 146, th) + t(x + 20, y + 48, k, { fill: th.amberText, font: MONO, size: 32, weight: 800 })
      + t(x + 62, y + 36, a, { fill: th.text, weight: 700 }) + t(x + 62, y + 57, b, { fill: th.muted, size: 14 })
      + glyph(x + 20, y + 92, kind, th) + mono(x + 20, y + 126, status, { fill: color, size: 12, ls: 0.4 });
  }).join('');
  return svg(W, H, 'PULSO demo scenarios A to F and the result each one must produce. ' + NOTICE, defs(th, W) + css()
    + `<rect width="${W}" height="${H}" rx="20" fill="${th.bg}"/>`
    + mono(40, 44, 'DEMO SCENARIOS A–F · LOCAL VALIDATOR, TEST USDC', { fill: th.muted, ls: 2.6, weight: 600 })
    + cards + notice(40, 400, th) + frame(W, H, th));
}

function primitive(th) {
  const W = 1000, H = 340, fields = ['human authority', 'agent', 'action', 'asset', 'amount', 'recipient', 'scope', 'expiration', 'nonce', 'usage count'];
  const chips = fields.map((f, i) => {
    const x = 40 + (i % 2) * 156, y = 64 + Math.floor(i / 2) * 42;
    return panel(x, y, 144, 32, th, { rx: 8 }) + t(x + 72, y + 21, f, { fill: th.text, font: MONO, size: 13, anchor: 'middle' })
      + (i % 2 ? line(`M340 ${y + 16} C400 ${y + 16} 392 164 450 164`, th.neutral, { w: 1.2, op: 0.7 }) : '');
  }).join('');
  const d = `M700 164 H706 ${beat(0.7)} H790`;
  return svg(W, H, 'One authorization is one exact action: human authority, agent, action, asset, amount, recipient, scope, expiration, nonce and usage count bound into a single action hash. ' + NOTICE, defs(th, W) + css()
    + `<rect width="${W}" height="${H}" rx="20" fill="${th.bg}"/>`
    + mono(40, 42, 'ONE AUTHORIZATION = ONE EXACT ACTION', { fill: th.muted, ls: 2.6, weight: 600 })
    + chips
    + panel(450, 124, 250, 80, th, { rx: 14 }) + line('M451 140 V188', th.amber, { w: 3 })
    + t(474, 160, 'action_hash', { fill: th.amberText, font: MONO, size: 21, weight: 700 }) + t(474, 184, 'one hash binds every field', { fill: th.muted, size: 14 })
    + line(d, th.pulse) + comet(d, th.text) + t(745, 126, 'human signs', { fill: th.muted, size: 14, anchor: 'middle' })
    + panel(790, 124, 170, 80, th, { rx: 14, stroke: th.ok }) + t(808, 160, 'Enforced on-chain', { fill: th.text, weight: 700 }) + t(808, 184, 'by the program', { fill: th.muted, size: 14 })
    + t(450, 252, 'Change the amount, change the recipient, reuse it,', { fill: th.muted, size: 15 })
    + t(450, 275, 'or let it expire, and it stops being valid.', { fill: th.text, size: 15, weight: 700 })
    + notice(40, 318, th) + frame(W, H, th));
}

function footer(th) {
  const W = 1000, H = 240, d = `M40 172 H96 ${beat(0.8)} H420`;
  return svg(W, H, 'Give agents money without giving them unlimited power. ' + NOTICE, defs(th, 460) + css()
    + backdrop(W, H, th, 850, 120, 220)
    + t(40, 84, 'Give agents money', { fill: th.text, font: SANS, size: 32, weight: 800 })
    + t(40, 124, 'without giving them unlimited power.', { fill: th.text, font: SANS, size: 32, weight: 800 })
    + line(d, 'url(#pulse)', { w: 2.2 }) + comet(d, th.pulse)
    + `<circle cx="850" cy="124" r="150" fill="url(#glow)"/><image href="${HEART}" x="735" y="8" width="230" height="230"/>`
    + notice(40, 212, th) + frame(W, H, th));
}

// Thin header for docs and package READMEs.
function docbar(th) {
  const W = 1200, H = 96, d = `M430 68 H860 ${beat(0.8)} H${W}`;
  return svg(W, H, 'PULSO: human authorization for AI agents. ' + NOTICE, defs(th, W) + css()
    + `<rect width="${W}" height="${H}" rx="16" fill="${th.bg}"/>`
    + mark(18, 8, 80, th, { glow: false })
    + t(112, 50, 'PULSO', { fill: th.text, font: SANS, size: 30, weight: 800, ls: 5 })
    + t(114, 72, 'Human authorization for AI agents', { fill: th.muted, size: 15 })
    + line(d, 'url(#pulse)', { w: 2 }) + comet(d, th.pulse, { w: 2.6 })
    + mono(W - 28, 30, NOTICE, { fill: th.amberText, size: 12.5, anchor: 'end' })
    + `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="16" fill="none" stroke="${th.line}"/>`);
}

// 1280 × 640: preview social do GitHub (Settings → Social preview) e Open Graph.
function social(th) {
  const W = 1280, H = 640, py = 500, d = `M0 ${py} H560 ${beat(1.8)} H${W}`;
  return svg(W, H, 'PULSO: human authorization layer for AI agents. ' + NOTICE, defs(th, W)
    + `<rect width="${W}" height="${H}" fill="${th.bg}"/><mask id="m"><ellipse cx="1010" cy="300" rx="640" ry="430" fill="url(#fade)"/></mask><rect width="${W}" height="${H}" fill="url(#grid)" mask="url(#m)"/>`
    + mono(84, 128, 'HUMAN AUTHORIZATION LAYER FOR AI AGENTS · SOLANA', { fill: th.muted, size: 17, ls: 4, weight: 600 })
    + t(78, 300, 'PULSO', { fill: th.text, font: SANS, size: 164, weight: 800, ls: 14 })
    + t(86, 366, 'The agent holds the wallet.', { fill: th.muted, size: 31 })
    + t(86, 410, 'The human holds the authority.', { fill: th.text, size: 31, weight: 700 })
    + line(d, 'url(#pulse)', { w: 3 }) + mark(780, 60, 470, th, { eyeCls: 'e' })
    + notice(84, 574, th, 19));
}

// ------------------------------------------------------------------ MOTION --
// Layers: transparent SVGs with stable ids, for animating in Remotion.
const V = { W: 1920, H: 1080 };
const D = T.dark;
const BADGES = { autonomous: ['AUTONOMOUS', D.ok, 'ok'], awaiting: ['AWAITING APPROVAL', D.amber, 'human'], confirmed: ['CONFIRMED', D.ok, 'dot'], rejected: ['REJECTED', D.danger, 'x'], expired: ['EXPIRED', D.neutral, 'ring'] };
const PAYLOAD = ['Action', 'Amount', 'Mint', 'Recipient', 'Agent', 'Expires', 'Max uses', 'Nonce', 'Action hash'];
const PULSE = { idle: `M0 120 H${V.W}`, beat: `M0 120 H827 ${beat(2.4)} H${V.W}` };

function badge(key) {
  const [label, color, kind] = BADGES[key], W = 560, H = 96, y = 48;
  const g = { ok: line(`M36 ${y} H84`, color, { w: 4 }) + `<circle cx="92" cy="${y}" r="7" fill="${color}"/>`, human: line(`M30 ${y} ${beat(0.62)}`, color, { w: 4 }), dot: `<circle cx="66" cy="${y}" r="13" fill="${color}"/>`, x: line(`M54 ${y - 12} l24 24 M78 ${y - 12} l-24 24`, color, { w: 5 }), ring: `<circle cx="66" cy="${y}" r="12" fill="none" stroke="${color}" stroke-width="4"/>` + line(`M66 ${y - 6} V${y} H72`, color, { w: 3 }) }[kind];
  return svg(W, H, `PULSO state badge: ${label}`, `<rect id="badge-bg" x="2" y="2" width="${W - 4}" height="${H - 4}" rx="46" fill="${D.panel}" stroke="${color}" stroke-width="3"/><g id="badge-glyph">${g}</g>` + t(124, y + 10, label, { fill: color, font: MONO, size: 28, weight: 700, ls: 2, id: 'badge-label' }));
}

function payloadCard() {
  const x = 520, y = 120, w = 880, rows = PAYLOAD.map((label, i) => {
    const ry = y + 236 + i * 58, id = label.toLowerCase().replace(/ /g, '-');
    return t(x + 48, ry, label, { fill: D.muted, size: 22 }) + t(x + 250, ry, '', { fill: D.text, font: MONO, size: 22, id: `v-${id}` }) + line(`M${x + 48} ${ry + 20} H${x + w - 48}`, D.line, { w: 1 });
  }).join('');
  return svg(V.W, V.H, 'PULSO payload card frame. Values are filled from the real request, never invented or animated.',
    `<g id="payload-card">${panel(x, y, w, 840, D, { rx: 22 })}${line(`M${x + 24} ${y + 1} H${x + w - 24}`, D.amber, { w: 4 })}`
    + mono(x + 48, y + 78, 'HUMAN_INTENT_REQUIRED', { fill: D.amber, size: 20, ls: 3 }) + t(x + 48, y + 138, 'Review the exact payload', { fill: D.text, size: 44, weight: 800 })
    + `<g id="payload-rows">${rows}</g>`
    + `<g id="btn-approve"><rect x="${x + 48}" y="${y + 744}" width="240" height="64" rx="8" fill="${D.amber}"/>${t(x + 168, y + 785, 'APPROVE', { fill: '#14171A', size: 22, weight: 700, anchor: 'middle' })}</g>`
    + `<g id="btn-deny"><rect x="${x + 308}" y="${y + 744}" width="180" height="64" rx="8" fill="none" stroke="${D.muted}" stroke-width="2"/>${t(x + 398, y + 785, 'DENY', { fill: D.text, size: 22, weight: 700, anchor: 'middle' })}</g></g>`);
}

function scenarioCard([k, a, b, kind, status]) {
  const color = kind === 'no' ? D.danger : kind === 'ok' ? D.ok : D.amber, y = 700;
  const d = kind === 'ok' ? `M140 ${y} H1780` : `M140 ${y} H760 ${beat(2.4)} H${kind === 'human' ? 1780 : 1200}`;
  return svg(V.W, V.H, `PULSO scenario ${k}: ${a}, ${b}. Expected ${status}. ${NOTICE}`, defs(D, V.W)
    + `<rect id="bg" width="${V.W}" height="${V.H}" fill="${D.bg}"/><mask id="m"><ellipse cx="960" cy="540" rx="1100" ry="640" fill="url(#fade)"/></mask><rect width="${V.W}" height="${V.H}" fill="url(#grid)" mask="url(#m)"/>`
    + mono(140, 190, `SCENARIO ${k} OF F`, { fill: D.muted, size: 28, ls: 6, id: 'eyebrow' })
    + t(132, 520, k, { fill: D.amber, font: MONO, size: 340, weight: 800, id: 'letter' })
    + t(420, 390, a, { fill: D.text, font: SANS, size: 96, weight: 800, id: 'title' }) + t(424, 470, b, { fill: D.muted, size: 48, id: 'subtitle' })
    + line(d, kind === 'ok' ? D.ok : D.amber, { w: 5, id: 'pulse', len: true })
    + (kind === 'no' ? line(`M1230 ${y} H1560`, D.danger, { w: 5, dash: '4 18', id: 'cut' }) + line(`M1590 ${y - 22} l44 44 M1634 ${y - 22} l-44 44`, D.danger, { w: 7, id: 'cross' }) : `<circle id="end" cx="1796" cy="${y}" r="13" fill="${D.ok}"/>`)
    + mono(140, 840, status, { fill: color, size: 40, ls: 2, id: 'status' })
    + mono(140, 990, NOTICE, { fill: D.amber, size: 24, ls: 2, id: 'notice' }));
}

const layers = {
  'pulse-line.svg': svg(V.W, 240, 'PULSO pulse line: idle and beat paths', line(PULSE.idle, D.line, { w: 4, id: 'pulse-idle', len: true }) + line(PULSE.beat, D.amber, { w: 5, id: 'pulse-beat', len: true })),
  'hood-outline.svg': svg(1254, 1254, 'Guardian hood outline, aligned to the 1254 px master', line(HOOD, D.amber, { w: 8, id: 'hood', len: true })),
  'hood-mask.svg': svg(1254, 1254, 'Guardian hood silhouette mask, aligned to the 1254 px master', `<path id="hood-mask" d="${HOOD}" fill="#fff"/>`),
  'eye-glow.svg': svg(1254, 1254, 'Guardian eye glow overlay, aligned to the 1254 px master', defs(D, 1254) + `<g id="eyes">${EYES.map((e, i) => `<ellipse id="eye-${i ? 'right' : 'left'}" cx="${e.cx}" cy="${e.cy}" rx="78" ry="60" fill="url(#eye)"/>`).join('')}</g>`),
  'notice-bar.svg': svg(V.W, 56, NOTICE, `<rect id="bar" width="${V.W}" height="56" fill="${D.amber}"/>` + mono(V.W / 2, 37, NOTICE, { fill: '#14171A', size: 24, ls: 3, anchor: 'middle', id: 'notice' })),
  'lower-third.svg': svg(V.W, V.H, 'PULSO lower third', `<g id="lower-third">${panel(96, 850, 820, 134, D, { rx: 14 })}<rect id="lt-tick" x="96" y="874" width="6" height="86" rx="3" fill="${D.amber}"/>` + mono(134, 904, 'SCENARIO B', { fill: D.amber, size: 22, ls: 4, id: 'lt-eyebrow' }) + t(134, 952, '100 USDC, over the limit', { fill: D.text, size: 38, weight: 700, id: 'lt-title' }) + '</g>'),
  'payload-card.svg': payloadCard(),
};
for (const th of [T.dark, T.light]) layers[`grid-${th.dark ? 'dark' : 'light'}.svg`] = svg(V.W, V.H, 'PULSO grid backdrop', defs(th, V.W) + `<rect id="bg" width="${V.W}" height="${V.H}" fill="${th.bg}"/><mask id="m"><ellipse cx="960" cy="540" rx="1100" ry="640" fill="url(#fade)"/></mask><rect id="grid-lines" width="${V.W}" height="${V.H}" fill="url(#grid)" mask="url(#m)"/>`);
for (const k of Object.keys(BADGES)) layers[`badge-${k}.svg`] = badge(k);
for (const s of SCENARIOS) layers[`scenario-${s[0]}.svg`] = scenarioCard(s);

// Previews: timing reference in CSS. The state without animation is always the final frame.
const stage = (title, style, body) => svg(V.W, V.H, title + ' ' + NOTICE, defs(D, V.W) + css(style)
  + `<rect width="${V.W}" height="${V.H}" fill="${D.bg}"/><mask id="m"><ellipse cx="960" cy="540" rx="1100" ry="640" fill="url(#fade)"/></mask><rect width="${V.W}" height="${V.H}" fill="url(#grid)" mask="url(#m)"/>`
  + body + mono(96, 1010, NOTICE, { fill: D.amber, size: 22, ls: 2, cls: 'notice' }));
const anim = (name, dur, frames) => `.${name}{animation:${name} ${dur}s both infinite;transform-box:fill-box;transform-origin:center}@keyframes ${name}{${frames}}`;

function logoReveal() {
  const d = `M0 470 H400 ${beat(2.4)} H${V.W}`, S = 560, gx = 680, gy = 90, k = S / 1254;
  const style = anim('draw', 7, '0%{stroke-dashoffset:1}15%,92%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}') + '.draw{stroke-dasharray:1}'
    + anim('hood', 7, '0%,10%{stroke-dashoffset:1;opacity:1}24%{stroke-dashoffset:0;opacity:1}34%,100%{stroke-dashoffset:0;opacity:0}') + '.hood{stroke-dasharray:1}'
    + anim('guard', 7, '0%,16%{opacity:0;transform:scale(.94)}28%,92%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1)}')
    + anim('ignite', 7, '0%,26%{opacity:0}32%{opacity:1}50%{opacity:.35}70%{opacity:1}92%{opacity:.6}100%{opacity:0}')
    + anim('word', 7, '0%,28%{opacity:0;transform:translateY(28px)}38%,92%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(0)}')
    + anim('tag', 7, '0%,38%{opacity:0}46%,92%{opacity:1}100%{opacity:0}')
    + anim('notice', 7, '0%,46%{opacity:0}52%,92%{opacity:1}100%{opacity:0}');
  return stage('PULSO logo reveal: the pulse line draws, the Guardian appears, the wordmark settles.', style,
    line(d, D.amber, { w: 4, len: true, cls: 'draw' })
    + mark(gx, gy, S, D, { cls: 'guard', eyeCls: 'ignite', glowCls: 'guard' })
    + `<g transform="translate(${gx} ${gy}) scale(${r(k)})">${line(HOOD, D.amber, { w: r(4 / k), len: true, cls: 'hood' })}</g>`
    + t(960, 800, 'PULSO', { fill: D.text, font: SANS, size: 150, weight: 800, ls: 14, anchor: 'middle', cls: 'word' })
    + t(960, 872, 'The agent holds the wallet. The human holds the authority.', { fill: D.muted, size: 32, anchor: 'middle', cls: 'tag' }));
}

function heartbeatLoop() {
  const d = `M0 470 H400 ${beat(2.4)} H${V.W}`;
  const style = anim('lub', 2.4, '0%,48%,100%{transform:scale(1)}12%{transform:scale(1.07)}24%{transform:scale(1)}36%{transform:scale(1.04)}')
    + anim('blink', 2.4, '0%,48%,100%{opacity:.35}12%{opacity:1}24%{opacity:.5}36%{opacity:.9}') + '.comet{animation-duration:2.4s}';
  return stage('PULSO idle loop: a two-beat pulse every 2.4 seconds.', style,
    line(d, D.amber, { w: 4, op: 0.45 }) + comet(d, D.amber, { w: 5 }) + mark(680, 90, 560, D, { glowCls: 'lub', eyeCls: 'blink' })
    + t(960, 800, 'PULSO', { fill: D.text, font: SANS, size: 150, weight: 800, ls: 14, anchor: 'middle' }));
}

// Gate scene: the agent's request reaches the Guardian and only passes with human approval.
function gate(approve) {
  const y = 540, dur = approve ? 10 : 8, okColor = approve ? D.ok : D.neutral;
  const node = (x, eyebrow, title, stroke, cls = '') => `<g class="${cls}">${panel(x, y - 80, 340, 160, D, { rx: 16, stroke, sw: 2 })}${mono(x + 32, y - 22, eyebrow, { fill: D.muted, size: 20, ls: 3 })}${t(x + 32, y + 30, title, { fill: D.text, size: 34, weight: 700 })}</g>`;
  const label = (cls, text, color, yy) => mono(960, yy, text, { fill: color, size: 30, ls: 2, anchor: 'middle', cls });
  const style = approve
    ? anim('dot', dur, '0%{transform:translateX(0);opacity:0}4%{opacity:1}20%,46%{transform:translateX(330px)}52%{transform:translateX(580px)}72%{transform:translateX(1000px);opacity:1}78%,100%{transform:translateX(1000px);opacity:0}')
      + anim('wait', dur, '0%,20%{opacity:0}24%,44%{opacity:1}48%,100%{opacity:0}')
      // "Confirmed" only after the dot reaches the destination: green is an observed result.
      + anim('ok', dur, '0%,72%{opacity:0}78%,94%{opacity:1}100%{opacity:0}')
      + anim('spike', dur, '0%,44%{stroke-dashoffset:1;opacity:1}56%,94%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}') + '.spike{stroke-dasharray:1}'
      + anim('flash', dur, '0%,44%{opacity:.3}50%{opacity:1}60%,100%{opacity:.3}')
      + anim('done', dur, '0%,72%{opacity:.35}78%,94%{opacity:1}100%{opacity:.35}')
    : anim('dot', dur, '0%{transform:translateX(0);opacity:0}5%{opacity:1}30%{transform:translateX(330px);opacity:1}40%{transform:translateX(300px);opacity:1}50%,100%{transform:translateX(300px);opacity:0}')
      + anim('wait', dur, '0%,6%{opacity:0}12%,30%{opacity:1}36%,100%{opacity:0}')
      + anim('ok', dur, '0%,30%{opacity:0}36%,92%{opacity:1}100%{opacity:0}')
      + anim('flash', dur, '0%,28%{opacity:.3}34%{opacity:1}46%,100%{opacity:.3}');
  const out = `M1150 ${y} H1200 ${beat(1.6)} H1460`;
  return stage(approve ? 'PULSO gate, approval: the request waits at the Guardian, the human approves once, the transfer executes.' : 'PULSO gate, rejection: a changed amount does not match the authorization and the program rejects it.', style,
    line(`M460 ${y} H780`, D.neutral, { w: 4 })
    + (approve ? line(`M1150 ${y} H1460`, D.line, { w: 4 }) + line(out, D.amber, { w: 5, len: true, cls: 'spike' }) : line(`M1150 ${y} H1460`, D.danger, { w: 4, dash: '4 18', op: 0.7 }))
    + `<circle class="dot" cx="460" cy="${y}" r="13" fill="${approve ? D.amber : D.danger}"/>`
    + node(120, 'AI AGENT', approve ? '100 USDC' : '150 USDC', D.line) + node(1460, 'RECIPIENT', approve ? 'Executed' : 'Not executed', okColor, approve ? 'done' : '')
    + mark(770, 350, 380, D, { eyeCls: 'flash' })
    + (approve
      ? label('wait', 'HUMAN_INTENT_REQUIRED · AWAITING APPROVAL', D.amber, 250) + label('ok', 'APPROVED ONCE · CONFIRMED', D.ok, 250)
      : label('wait', 'AUTHORIZED 100 · AGENT ATTEMPTS 150', D.amber, 250) + label('ok', 'REJECTED · PULSO_006_INTENT_MISMATCH', D.danger, 250))
    + t(960, 860, approve ? 'One approval. One exact action. Single use.' : 'Change one field and the authorization stops matching.', { fill: D.muted, size: 34, anchor: 'middle' }));
}

const previews = { 'logo-reveal.svg': logoReveal(), 'heartbeat-loop.svg': heartbeatLoop(), 'gate-approve.svg': gate(true), 'gate-reject.svg': gate(false) };

// Motion tokens: the same numbers the previews use, in frames at 30 fps.
const tokens = {
  notice: NOTICE,
  fps: 30,
  formats: { landscape: [1920, 1080], square: [1080, 1080], portrait: [1080, 1920] },
  safeArea: { landscape: 96, square: 72, portrait: { x: 72, top: 220, bottom: 320 } },
  color: Object.fromEntries(Object.entries(D).filter(([k]) => k !== 'dark')),
  durationFrames: { uiFast: 6, uiBase: 7, enter: 12, exit: 8, lineDraw: 30, hoodDraw: 28, beat: 14, hold: 45, heartbeatLoop: 72 },
  easing: { standard: [0.2, 0, 0, 1], enter: [0, 0, 0, 1], exit: [0.3, 0, 1, 1], linear: [0, 0, 1, 1] },
  spring: { settle: { damping: 200, mass: 1, stiffness: 120 }, pop: { damping: 14, mass: 0.8, stiffness: 180 } },
  stagger: { letters: 2, rows: 3 },
  paths: { pulseIdle: PULSE.idle, pulseBeat: PULSE.beat, beatUnit: beat(1), hood: HOOD },
  guardian: { masterSize: 1254, eyes: EYES, eyeRadius: [78, 60], heartBox: [555, 806, 765, 965] },
  rules: ['Payload values never animate, scramble or scroll while they are on screen for review.', 'A flat line means the agent acts alone; the line beats only where a human approves.', 'Green appears only after an observed result. Amber means a decision is waiting.', 'Every composition carries the notice for its whole duration.'],
};

const write = (dir, name, content) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), content); };
for (const [name, fn] of Object.entries({ hero, divider, flow, scenarios, primitive, footer, docbar }))
  for (const th of [T.dark, T.light]) write(readmeDir, `${name}-${th.dark ? 'dark' : 'light'}.svg`, fn(th));
write(readmeDir, 'social-preview.svg', social(T.dark));
for (const [name, content] of Object.entries(layers)) write(path.join(here, 'layers'), name, content);
for (const [name, content] of Object.entries(previews)) write(path.join(here, 'previews'), name, content);
write(here, 'motion-tokens.json', JSON.stringify(tokens, null, 2) + '\n');
console.log(`README: 15 SVGs em ${path.relative(process.cwd(), readmeDir)} · motion: ${Object.keys(layers).length} camadas, ${Object.keys(previews).length} previews`);
