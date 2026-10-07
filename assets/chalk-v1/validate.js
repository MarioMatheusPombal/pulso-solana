#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const here = __dirname;
const notice = 'NOT AUDITED · DEVNET DEMONSTRATION ONLY';
const expectedPng = {
  'brand/guardian-horizontal.png':[1600,500], 'brand/guardian-avatar.png':[512,512], 'brand/favicon.png':[512,512],
  ...Object.fromEntries([16,32,48,64,180,192,512].map(size => [`brand/favicon-${size}.png`,[size,size]])),
  'social/social-preview.png':[1200,630], 'social/banner.png':[1500,500], 'social/square.png':[1080,1080], 'social/story.png':[1080,1920],
  'pitch/cover.png':[1920,1080], 'pitch/section-divider.png':[1920,420], 'contact/contact-sheet.png':[1600,1040],
  'readme/hero.png':[1200,400], 'readme/docbar.png':[1200,96], 'readme/footer.png':[1000,240],
  'readme/flow.png':[1000,520], 'readme/primitive.png':[1000,340], 'readme/scenarios.png':[1000,420],
};
const compositionSvgs = [
  'brand/guardian-horizontal.svg','social/social-preview.svg','social/banner.svg','social/square.svg','social/story.svg',
  'pitch/cover.svg','pitch/section-divider.svg','contact/contact-sheet.svg','readme/hero.svg','readme/docbar.svg','readme/flow.svg',
  'readme/primitive.svg','readme/scenarios.svg','readme/footer.svg',
];
const errors = [];
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pngSize = file => { const value=fs.readFileSync(file); return [value.readUInt32BE(16), value.readUInt32BE(20)]; };

for (const [relative, size] of Object.entries(expectedPng)) {
  const file = path.join(here, relative);
  if (!fs.existsSync(file)) errors.push(`missing ${relative}`);
  else if (pngSize(file).join('x') !== size.join('x')) errors.push(`${relative}: expected ${size.join('x')}, found ${pngSize(file).join('x')}`);
}
for (const relative of compositionSvgs) {
  const file = path.join(here, relative);
  if (!fs.existsSync(file)) errors.push(`missing ${relative}`);
  else if (!fs.readFileSync(file, 'utf8').includes(notice)) errors.push(`${relative}: public notice missing`);
}
if (!fs.existsSync(path.join(here, 'masters/image-prompts.md'))) errors.push('missing masters/image-prompts.md');
if (!fs.existsSync(path.join(here, 'brand/favicon.ico'))) errors.push('missing brand/favicon.ico');

const visitSvg = dir => { for (const entry of fs.readdirSync(dir,{withFileTypes:true})) { const file=path.join(dir,entry.name); if(entry.isDirectory()) visitSvg(file); else if(file.endsWith('.svg')) { const value=fs.readFileSync(file,'utf8'); const refs=[...value.matchAll(/href=["']([^"']+)/g)].map(match=>match[1]); for(const ref of refs) if(!/^(?:data:|https?:|#)/.test(ref) && !fs.existsSync(path.resolve(path.dirname(file),ref))) errors.push(`${path.relative(here,file)}: broken reference ${ref}`); } } };
visitSvg(here);

for (const file of ['guardian-chalk.webp','slate-texture.webp']) {
  const master = path.join(here, 'masters', file);
  const source = path.join(root, 'app/public/assets/chalk-v1', file);
  if (sha(master) !== sha(source)) errors.push(`masters/${file}: differs from approved app source`);
}
if (!fs.readFileSync(path.join(here, 'masters/guardian-chalk.webp')).includes(Buffer.from('ALPH'))) errors.push('masters/guardian-chalk.webp: alpha channel missing');

const inventory = JSON.parse(fs.readFileSync(path.join(here, 'inventory.json'), 'utf8'));
if (inventory.records.length < 350) errors.push(`inventory incomplete: ${inventory.records.length} records`);
for (const record of inventory.records) {
  const file = path.join(root, record.path);
  if (!fs.existsSync(file)) errors.push(`inventory missing file: ${record.path}`);
  else if (sha(file) !== record.sha256) errors.push(`inventory stale hash: ${record.path}`);
}

const docs = ['README.md','public/README.md','app/README.md','sdk/README.md','agent-demo/README.md',
  'public/docs/AGENT_WALLET.md','public/docs/ONCHAIN_ARCHITECTURE.md','public/docs/POLICY_AND_INTENT_SPEC.md','public/docs/SECURITY_MODEL.md'];
for (const relative of docs) {
  const value = fs.readFileSync(path.join(root, relative), 'utf8');
  if (/assets\/readme\/(?:hero|flow|primitive|scenarios|footer|docbar)-(?:dark|light)\.svg/.test(value)) errors.push(`${relative}: legacy embed remains`);
  if (/chalk-v1\/readme\/[^"\s]+\.svg/.test(value)) errors.push(`${relative}: SVG embed must use PNG for image-mode rendering`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Validated ${inventory.records.length} inventoried assets and ${Object.keys(expectedPng).length} PNG exports.`);
