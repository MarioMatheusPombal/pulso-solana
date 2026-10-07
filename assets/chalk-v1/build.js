#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const here = __dirname;
const notice = 'NOT AUDITED · DEVNET DEMONSTRATION ONLY';
const palette = {
  slate: '#1C211E', panel: '#242A25', raised: '#2A302B', chalk: '#EEE8D8',
  muted: '#B8B7A9', line: '#586057', amber: '#E6B04B', coral: '#E97968',
  success: '#A7BE91', danger: '#EE8F7D',
};
const fonts = {
  chalk: 'Caveat', editorial: 'Crimson Pro', technical: 'JetBrains Mono',
};

const ensure = file => fs.mkdirSync(path.dirname(file), { recursive: true });
const write = (file, value) => { ensure(file); fs.writeFileSync(file, value); };
const copy = (from, to) => { ensure(to); fs.copyFileSync(from, to); };
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[char]);
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const uri = file => `data:${file.endsWith('.webp') ? 'image/webp' : 'image/png'};base64,${fs.readFileSync(file).toString('base64')}`;

function fontCss(prefix = '../fonts') {
  return `<style>
@font-face{font-family:'${fonts.chalk}';src:url('${prefix}/Caveat.ttf') format('truetype');font-weight:400 700}
@font-face{font-family:'${fonts.editorial}';src:url('${prefix}/CrimsonPro.ttf') format('truetype');font-weight:400 700}
@font-face{font-family:'${fonts.technical}';src:url('${prefix}/JetBrainsMono.ttf') format('truetype');font-weight:400 700}
.chalk{font-family:'${fonts.chalk}',cursive}.editorial{font-family:'${fonts.editorial}',Georgia,serif}.technical{font-family:'${fonts.technical}',monospace}
</style>`;
}

function svg(w, h, title, body, fontPrefix = '../fonts') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}. ${notice}"><title>${esc(title)}</title><desc>${notice}</desc>${fontCss(fontPrefix)}${body}</svg>`;
}

function base(w, h, textureHref = '../masters/slate-texture.webp') {
  return `<defs><pattern id="grain" width="${w}" height="${h}" patternUnits="userSpaceOnUse"><image href="${textureHref}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" opacity=".26"/></pattern><filter id="chalk"><feTurbulence baseFrequency=".8" numOctaves="1" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale=".7"/></filter></defs><rect width="${w}" height="${h}" fill="${palette.slate}"/><rect width="${w}" height="${h}" fill="url(#grain)"/><path d="M28 34 Q${Math.round(w*.48)} 24 ${w-30} 39" fill="none" stroke="${palette.line}" stroke-width="2" stroke-dasharray="4 10" opacity=".65"/>`;
}

const text = (value, x, y, size, className = 'editorial', fill = palette.chalk, extra = '') => `<text x="${x}" y="${y}" class="${className}" fill="${fill}" font-size="${size}" ${extra}>${esc(value)}</text>`;
const multiline = (values, x, y, size, leading, className = 'editorial', fill = palette.chalk, extra = '') => `<text x="${x}" y="${y}" class="${className}" fill="${fill}" font-size="${size}" ${extra}>${values.map((value, i) => `<tspan x="${x}" dy="${i ? leading : 0}">${esc(value)}</tspan>`).join('')}</text>`;
const noticeText = (w, h, size = 15) => text(notice, 38, h - 30, size, 'technical', palette.amber, 'font-weight="700" letter-spacing="1"');
const guardian = (x, y, w, h, href = '../masters/guardian-chalk.webp') => `<image href="${href}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
const pulse = (w, y, color = palette.amber) => `<path d="M0 ${y} H${Math.round(w*.42)} l16 0 10 -10 13 10 21 0 13 -42 13 62 13 -30 16 10 H${w}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#chalk)"/>`;

function card({ name, w, h, headline, subhead, format }) {
  const portrait = h > w * 1.25;
  const square = Math.abs(w - h) < 100;
  const artW = portrait ? w * .8 : square ? w * .52 : w * .42;
  const artH = portrait ? h * .46 : square ? h * .52 : h * .82;
  const artX = portrait ? w * .1 : square ? w * .48 : w - artW - w * .035;
  const artY = portrait ? h * .43 : square ? h * .33 : h * .08;
  const headlineSize = portrait ? 86 : square ? 74 : 66;
  const titleY = portrait ? 250 : square ? 250 : h * .38;
  const body = base(w, h) +
    text('PULSO', w * .06, portrait ? 105 : 82, portrait ? 54 : 42, 'chalk', palette.chalk, 'font-weight="700" letter-spacing="3"') +
    text('HUMAN AUTHORIZATION FOR AI AGENTS', w * .062, portrait ? 145 : 116, portrait ? 19 : 16, 'technical', palette.muted, 'font-weight="700" letter-spacing="2"') +
    multiline(headline, w * .06, titleY, headlineSize, headlineSize * .93, 'chalk', palette.chalk, 'font-weight="650"') +
    multiline(subhead, w * .062, titleY + headline.length * headlineSize * .96 + 35, portrait ? 32 : 25, portrait ? 40 : 32, 'editorial', palette.muted, 'font-weight="600"') +
    guardian(artX, artY, artW, artH) + pulse(w, h - (portrait ? 180 : 105)) + noticeText(w, h, portrait ? 20 : 15);
  write(path.join(here, format, `${name}.svg`), svg(w, h, `PULSO ${name}`, body));
}

function adaptReadmeAssets() {
  const sourceDir = path.join(root, 'public/assets/readme');
  const targetDir = path.join(here, 'readme');
  for (const sourceName of ['flow-dark.svg', 'primitive-dark.svg', 'scenarios-dark.svg']) {
    let value = fs.readFileSync(path.join(sourceDir, sourceName), 'utf8');
    value = value
      .replaceAll('#0A0E13', palette.slate).replaceAll('#10161D', palette.panel)
      .replaceAll('#131C25', palette.line).replaceAll('#F6F4EF', palette.chalk)
      .replaceAll('#C0C4C8', palette.muted).replaceAll('#FFB020', palette.amber)
      .replaceAll('#55D38F', palette.success).replaceAll('#FF7D72', palette.danger)
      .replaceAll("Arial,Helvetica,sans-serif", `'${fonts.chalk}',cursive`)
      .replaceAll("system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif", `'${fonts.editorial}',Georgia,serif`)
      .replaceAll('ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', `'${fonts.technical}',monospace`)
      .replace(/<image href="data:image\/png;base64,[^"]+"([^>]*)\/>/, '<image href="../masters/guardian-chalk.webp"$1 preserveAspectRatio="xMidYMid meet"/>')
      .replace('<defs>', `<defs>${fontCss('../fonts')}`);
    write(path.join(targetDir, sourceName.replace('-dark', '')), value);
  }
}

function brandAssets() {
  const horizontal = base(1600, 500) + guardian(30, 25, 460, 450) +
    text('PULSO', 515, 205, 120, 'chalk', palette.chalk, 'font-weight="700" letter-spacing="5"') +
    text('Human authorization for AI agents', 525, 270, 38, 'editorial', palette.muted, 'font-weight="600"') +
    text('The agent holds the wallet. The human holds the authority.', 525, 325, 28, 'editorial', palette.chalk, 'font-weight="650"') +
    pulse(1600, 400) + noticeText(1600, 500, 16);
  write(path.join(here, 'brand/guardian-horizontal.svg'), svg(1600, 500, 'PULSO chalkboard horizontal lockup', horizontal));

  const avatar = base(512, 512) + guardian(34, 34, 444, 444) + `<circle cx="256" cy="256" r="228" fill="none" stroke="${palette.amber}" stroke-width="5" stroke-dasharray="5 13"/>`;
  write(path.join(here, 'brand/guardian-avatar.svg'), svg(512, 512, 'PULSO Guardian avatar', avatar));

  const favicon = `<rect width="512" height="512" rx="92" fill="${palette.slate}"/>${guardian(22, 22, 468, 468, '../masters/guardian-chalk.webp')}`;
  write(path.join(here, 'brand/favicon.svg'), svg(512, 512, 'PULSO Guardian favicon', favicon));
  for (const size of [16,32,48,64,180,192,512]) {
    const scale = size / 512;
    const body = `<rect width="512" height="512" rx="92" fill="${palette.slate}"/>${guardian(22, 22, 468, 468, '../masters/guardian-chalk.webp')}`;
    write(path.join(here, `brand/favicon-${size}.svg`), svg(size, size, `PULSO Guardian favicon ${size}px`, `<g transform="scale(${scale})">${body}</g>`));
  }
}

function readmeAssets() {
  const hero = base(1200, 400) +
    text('PULSO', 54, 164, 120, 'chalk', palette.chalk, 'font-weight="700" letter-spacing="5"') +
    text('The agent holds the wallet.', 62, 220, 28, 'editorial', palette.muted, 'font-weight="600"') +
    text('The human holds the authority.', 62, 258, 31, 'editorial', palette.chalk, 'font-weight="700"') +
    guardian(800, 20, 360, 360) + pulse(1200, 326) + noticeText(1200, 400, 13);
  write(path.join(here, 'readme/hero.svg'), svg(1200, 400, 'PULSO human authorization layer for AI agents', hero));

  const docbar = base(1200, 96) + text('PULSO', 28, 54, 44, 'chalk', palette.chalk, 'font-weight="700" letter-spacing="3"') +
    text('Human authorization for AI agents', 190, 51, 22, 'editorial', palette.muted, 'font-weight="600"') +
    text(notice, 1170, 28, 11, 'technical', palette.amber, 'text-anchor="end" font-weight="700" letter-spacing="1"') + pulse(1200, 78);
  write(path.join(here, 'readme/docbar.svg'), svg(1200, 96, 'PULSO documentation header', docbar));

  const footer = base(1000, 240) + multiline(['Give agents money', 'without giving them unlimited power.'], 36, 86, 42, 48, 'chalk', palette.chalk, 'font-weight="650"') +
    guardian(750, 8, 220, 220) + noticeText(1000, 240, 13);
  write(path.join(here, 'readme/footer.svg'), svg(1000, 240, 'PULSO footer', footer));
}

function pitchAssets() {
  card({ name:'cover', w:1920, h:1080, headline:['The agent holds', 'the wallet.'], subhead:['The human holds the authority.'], format:'pitch' });
  const divider = base(1920, 420) + text('PULSO', 90, 120, 54, 'chalk', palette.chalk, 'font-weight="700" letter-spacing="3"') +
    multiline(['A human authorization layer', 'for AI agents on Solana.'], 90, 225, 54, 60, 'editorial', palette.chalk, 'font-weight="650"') +
    guardian(1450, 20, 400, 390) + pulse(1920, 360) + noticeText(1920, 420, 16);
  write(path.join(here, 'pitch/section-divider.svg'), svg(1920, 420, 'PULSO pitch section divider', divider));
}

function contactSheet() {
  const body = base(1600, 1040) + text('PULSO · CHALKBOARD KIT', 54, 92, 64, 'chalk', palette.chalk, 'font-weight="700"') +
    text('Masters and exports · review before external publication', 58, 135, 24, 'editorial', palette.muted) +
    [['brand/guardian-horizontal.png',60,190,700,220],['social/social-preview.png',840,190,700,368],['social/square.png',60,485,430,430],['social/story.png',560,485,242,430],['pitch/cover.png',870,620,670,377]].map(([href,x,y,w,h]) => `<image href="../${href}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`).join('') +
    noticeText(1600, 1040, 16);
  write(path.join(here, 'contact/contact-sheet.svg'), svg(1600, 1040, 'PULSO chalkboard asset contact sheet', body));
}

function findBrowser() {
  const candidates = process.platform === 'win32'
    ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    : ['google-chrome', 'chromium', 'chromium-browser'];
  return candidates.find(candidate => candidate.includes('/') ? fs.existsSync(candidate) : spawnSync('which', [candidate]).status === 0);
}

function rasterize() {
  const browser = findBrowser();
  if (!browser) throw new Error('Chrome/Edge not found; SVG masters were generated, PNG exports were not.');
  const exports = [
    ['brand/guardian-horizontal.svg',1600,500],['brand/guardian-avatar.svg',512,512],['brand/favicon.svg',512,512],
    ...[16,32,48,64,180,192,512].map(size => [`brand/favicon-${size}.svg`,size,size]),
    ['social/social-preview.svg',1200,630],['social/banner.svg',1500,500],['social/square.svg',1080,1080],['social/story.svg',1080,1920],
    ['pitch/cover.svg',1920,1080],['pitch/section-divider.svg',1920,420],['contact/contact-sheet.svg',1600,1040],
    ['readme/hero.svg',1200,400],['readme/docbar.svg',1200,96],['readme/footer.svg',1000,240],
    ['readme/flow.svg',1000,520],['readme/primitive.svg',1000,340],['readme/scenarios.svg',1000,420],
  ];
  for (const [relative,w,h] of exports) {
    const input = path.join(here, relative);
    const output = input.replace(/\.svg$/, '.png');
    const result = spawnSync(browser, ['--headless=new','--disable-gpu','--hide-scrollbars','--force-device-scale-factor=1',`--window-size=${w},${h}`,`--screenshot=${output}`,`file:///${input.replaceAll('\\','/')}`], { encoding:'utf8' });
    if (result.status !== 0 || !fs.existsSync(output)) throw new Error(`Raster export failed for ${relative}: ${result.stderr}`);
  }
  const sizes = [16,32,48];
  const images = sizes.map(size => fs.readFileSync(path.join(here, `brand/favicon-${size}.png`)));
  let offset = 6 + images.length * 16;
  const directory = images.map((image, index) => {
    const size=sizes[index], entry=Buffer.alloc(16);
    entry.writeUInt8(size,0); entry.writeUInt8(size,1); entry.writeUInt16LE(1,4); entry.writeUInt16LE(32,6);
    entry.writeUInt32LE(image.length,8); entry.writeUInt32LE(offset,12); offset += image.length;
    return entry;
  });
  fs.writeFileSync(path.join(here, 'brand/favicon.ico'), Buffer.concat([Buffer.from([0,0,1,0,images.length,0]), ...directory, ...images]));
}

function inventory() {
  const extensions = new Set(['.svg','.png','.webp','.gif','.mp4','.ico','.srt']);
  const roots = [path.join(root, 'public/assets'), path.join(root, 'app/public/assets')];
  const files = [];
  const visit = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes:true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) visit(file); else if (extensions.has(path.extname(file).toLowerCase())) files.push(file); } };
  roots.forEach(visit);
  const records = files.sort().map(file => {
    const relative = path.relative(root, file).replaceAll('\\','/');
    const current = relative.startsWith('public/assets/chalk-v1/');
    const appChalk = relative.startsWith('app/public/assets/chalk-v1/');
    const video = /\.(gif|mp4|srt)$/i.test(relative) || relative.startsWith('public/assets/motion-v1/');
    const appSurface = relative.startsWith('app/public/') && !appChalk;
    let status = 'superseded'; let replacement = 'public/assets/chalk-v1/README.md'; let ownerIssue = 255;
    if (current) { status='current'; replacement=relative; }
    else if (appChalk) { status='source'; replacement='public/assets/chalk-v1/masters/'; ownerIssue=248; }
    else if (video) { status='preserved-external-scope'; replacement='Issue #188'; ownerIssue=188; }
    else if (appSurface) { status='preserved-external-scope'; replacement='Issue #248'; ownerIssue=248; }
    return { path:relative, origin: current ? 'Issue #255 build' : 'repository inventory', surface: relative.includes('/readme/') ? 'documentation' : relative.includes('/social/') || relative.includes('/campaign') ? 'social' : relative.includes('/pitch/') ? 'pitch' : relative.includes('motion') || video ? 'motion/video' : relative.startsWith('app/') ? 'app' : 'brand', version: current ? 'chalk-v1' : appChalk ? 'chalk-v1 source' : 'legacy', replacement, status, ownerIssue, bytes:fs.statSync(file).size, sha256:sha256(file) };
  });
  write(path.join(here, 'inventory.json'), JSON.stringify({ generatedAt:'2026-10-02', notice, records }, null, 2) + '\n');
}

function copySources() {
  const app = path.join(root, 'app');
  for (const file of ['guardian-chalk.webp','slate-texture.webp']) copy(path.join(app, 'public/assets/chalk-v1', file), path.join(here, 'masters', file));
  for (const file of ['authority-arrow.svg','authority-flow.svg','authority-orbit.svg','crosshatch.svg','margin-note.svg','signal-wave.svg']) copy(path.join(app, 'public/assets/chalk-v1', file), path.join(here, 'masters', file));
  for (const file of ['Caveat.ttf','CrimsonPro.ttf','JetBrainsMono.ttf','Caveat-OFL.txt','CrimsonPro-OFL.txt','JetBrainsMono-OFL.txt']) copy(path.join(app, 'app/fonts', file), path.join(here, 'fonts', file));
  copy(path.join(app, 'public/assets/chalk-v1/image-prompts.md'), path.join(here, 'masters/image-prompts.md'));
}

copySources();
brandAssets();
readmeAssets();
adaptReadmeAssets();
card({ name:'social-preview', w:1200, h:630, headline:['The agent holds the wallet.'], subhead:['The human holds the authority.'], format:'social' });
card({ name:'banner', w:1500, h:500, headline:['Human authority,', 'enforced on-chain.'], subhead:['Scoped · expiring · counted · non-reusable'], format:'social' });
card({ name:'square', w:1080, h:1080, headline:['Give agents money'], subhead:['without giving them unlimited power.'], format:'social' });
card({ name:'story', w:1080, h:1920, headline:['The agent holds', 'the wallet.'], subhead:['The human holds the authority.'], format:'social' });
pitchAssets();
contactSheet();
if (process.argv.includes('--raster')) rasterize();
inventory();
console.log(`Built PULSO chalk-v1${process.argv.includes('--raster') ? ' SVG + PNG' : ' SVG'} assets.`);
