#!/usr/bin/env node
'use strict';

// Rebuild expressive PULSO brand exports from the immutable ImageGen masters.
// Usage: node build.js (requires sharp available to Node; set SHARP_MODULE if needed).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const root = path.resolve(__dirname, '..');
const out = __dirname;
const input = {
  mark: path.join(root, 'raster-v2/guardian-mark-transparent.png'),
  heart: path.join(root, 'raster-v2/guardian-heart-transparent.png'),
  mono: path.join(root, 'raster-v2/guardian-mark-monochrome-transparent.png'),
};
const notice = 'NOT AUDITED · DEVNET DEMONSTRATION ONLY';
const palette = { ivory:'#F6F4EF', ink:'#14171A', amber:'#FFB020', dark:'#0A0E13', darkPanel:'#10161D', coral:'#C6534C' };
const enc = p => fs.readFileSync(p).toString('base64');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const data = p => { const raw=enc(p), escaped=raw.replace(/[bBcCpPmMvV]/g,c=>`&#${c.charCodeAt(0)};`); if(escaped.replace(/&#(66|98|67|99|80|112|77|109|86|118);/g,(_,n)=>String.fromCharCode(Number(n)))!==raw) throw Error('Embedded master encoding changed'); return `data:image/png;base64,${escaped}`; };
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const ensure = p => fs.mkdirSync(path.dirname(p),{recursive:true});
const writeSvg = (p,s) => {ensure(p);fs.writeFileSync(p,s)};
const image = (uri,x,y,w,h,extra='') => `<image href="${uri}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" ${extra}/>`;
const label = (text,x,y,size,color,weight=600,tracking=0) => `<text x="${x}" y="${y}" fill="${color}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="${tracking}">${esc(text)}</text>`;
const lines = (text,x,y,size,color,weight=600,leading=1.15,maxWidth='none') => `<text x="${x}" y="${y}" fill="${color}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="${weight}" style="inline-size:${maxWidth};white-space:normal">${String(text).split('\n').map((line,i)=>`<tspan x="${x}" dy="${i?size*leading:0}">${esc(line)}</tspan>`).join('')}</text>`;
const svg = (w,h,body,title='PULSO expressive identity v2') => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><title>${esc(title)}</title><desc>${notice}. ImageGen artwork is embedded unchanged; text and layout remain editable.</desc>${body}</svg>`;
async function render(svgText,pngPath){ ensure(pngPath); await sharp(Buffer.from(svgText)).png().toFile(pngPath); }
function composition({w,h,bg,art='mark',headline,sub='',layout='card',noticeSize=18,accent=palette.amber}) {
 const uri=data(input[art]);
 let body=`<rect width="${w}" height="${h}" fill="${bg}"/>`;
 const dark=bg===palette.dark || bg===palette.darkPanel;
 const fg=dark?palette.ivory:palette.ink;
 if(layout==='horizontal'){
   body+=image(uri,Math.round(h*.07),Math.round(h*.12),Math.round(h*.72),Math.round(h*.72));
   body+=label('PULSO',Math.round(h*.88),Math.round(h*.44),Math.round(h*.13),fg,800,4);
   body+=label(headline,Math.round(h*.88),Math.round(h*.57),Math.round(h*.045),fg,600);
   body+=label(sub,Math.round(h*.88),Math.round(h*.65),Math.round(h*.027),fg,400);
 } else if(layout==='stacked'){
   body+=image(uri,w*.25,h*.06,w*.5,h*.49);
   body+=label('PULSO',w*.5,h*.67,Math.round(w*.065),fg,800,5).replace('<text ','<text text-anchor="middle" ');
   body+=label(headline,w*.5,h*.74,Math.round(w*.024),fg,600).replace('<text ','<text text-anchor="middle" ');
   if(sub) body+=label(sub,w*.5,h*.79,Math.round(w*.018),fg,400).replace('<text ','<text text-anchor="middle" ');
 } else if(h>w) {
   const margin=Math.round(w*.07), sz=Math.round(w*.052), artSize=Math.round(w*.48), artX=Math.round(w*.47), artY=Math.round(h*.50);
   body+=label('PULSO',margin,Math.round(h*.14),Math.round(w*.026),fg,800,4);
   const titleLines=String(headline).split('\n').length;
   body+=lines(headline,margin,Math.round(h*.31),sz,fg,800,1.18,Math.round(w*.84));
   if(sub) body+=lines(sub,margin,Math.round(h*.31+sz*(titleLines*1.18+0.45)),Math.round(sz*.66),fg,600,1.18,Math.round(w*.82));
   body+=image(uri,artX,artY,artSize,artSize);
   body+=`<rect x="${margin}" y="${Math.round(h*.75)}" width="86" height="7" rx="3.5" fill="${accent}"/>`;
 } else if(w/h<1.2) {
   const margin=Math.round(w*.07), artSize=Math.round(w*.34), size=Math.round(w*.056);
   body+=label('PULSO',margin,Math.round(h*.14),Math.round(w*.026),fg,800,4);
   body+=lines(headline,margin,Math.round(h*.28),size,fg,800,1.12,Math.round(w*.82));
   body+=image(uri,Math.round(w*.33),Math.round(h*.46),artSize,artSize);
   if(sub) body+=lines(sub,margin,Math.round(h*.84),Math.round(size*.48),fg,600,1.12,Math.round(w*.86));
 } else {
   const margin=Math.round(w*.07), artW=Math.round(w*.31), artH=Math.round(h*.62), textW=Math.round(w*.58), artX=w-artW-margin, artY=Math.round(h*.18);
   body+=label('PULSO',margin,Math.round(h*.14),Math.max(20,Math.round(w*.026)),fg,800,4);
   body+=image(uri,artX,artY,artW,artH);
   const headlineSize=h<700?Math.min(44,Math.round(h*.085)):Math.min(54,Math.round(w*.05));
   body+=lines(headline,margin,Math.round(h*.38),headlineSize,fg,800,1.15,textW);
   if(sub) body+=lines(sub,margin,Math.round(h*.38+headlineSize*(headline.split('\n').length*1.15+0.55)),Math.max(18,Math.round(headlineSize*.53)),fg,600,1.15,textW);
 }
 const noticeY=h>=1800?h-180:h-noticeSize;
 body+=`<text x="${Math.round(w*.06)}" y="${noticeY}" fill="${fg}" font-family="Arial,Helvetica,sans-serif" font-size="${noticeSize}" font-weight="700" letter-spacing=".5">${notice}</text>`;
 return svg(w,h,body,`PULSO ${layout} composition — v2`);
}
async function exportPair(folder,name,source){
 const sourceData=data(source);
 const sizes={light:{bg:palette.ivory,ink:palette.ink},dark:{bg:palette.dark,ink:palette.ivory},amber:{bg:palette.amber,ink:palette.ink}};
 for(const [variant,v] of Object.entries(sizes)){
   const w=1024,h=1024,pad=86,markSize=852,x=(w-markSize)/2,y=(h-markSize)/2;
   const s=svg(w,h,`<rect width="1024" height="1024" rx="112" fill="${v.bg}"/>${image(sourceData,x,y,markSize,markSize)}`,`PULSO ${name} ${variant} composition`);
   const base=path.join(out,folder,`${name}-${variant}`);writeSvg(base+'.svg',s);await render(s,base+'.png');
 }
}
async function main(){
 const metaMark=await sharp(input.mark).metadata(), metaHeart=await sharp(input.heart).metadata(), metaMono=await sharp(input.mono).metadata();
 for(const [k,m] of Object.entries({mark:metaMark,heart:metaHeart,mono:metaMono})) if(m.width!==1254||m.height!==1254||!m.hasAlpha) throw Error(`${k} master must remain 1254x1254 RGBA`);
 const masterDir=path.join(out,'logos');
 fs.copyFileSync(input.mark,path.join(masterDir,'guardian-mark-transparent-master.png'));
 fs.copyFileSync(input.heart,path.join(masterDir,'guardian-heart-transparent-master.png'));
 fs.copyFileSync(input.mono,path.join(masterDir,'guardian-mark-monochrome-transparent-master.png'));
 await exportPair('logos','guardian-mark-mono',input.mono);
 // Head compositions: original artwork embedded unchanged, only canvas/layout added.
 await exportPair('logos','guardian-mark',input.mark);
 // Horizontal and stacked wordmarks, with editable text over an embedded unchanged master.
 for(const theme of ['light','dark']) for(const kind of ['horizontal','stacked']){
   const bg=theme==='light'?palette.ivory:palette.dark, fg=theme==='light'?palette.ink:palette.ivory;
   const w=kind==='horizontal'?1600:1000,h=kind==='horizontal'?500:1000,uri=data(input.mark);
   let body=`<rect width="${w}" height="${h}" rx="28" fill="${bg}"/>`;
   if(kind==='horizontal'){
     body+=image(uri,35,35,430,430);
     body+=label('PULSO',520,220,132,fg,800,7);
     body+=label('Human authorization for AI agents',528,286,34,fg,500);
     body+=label('The agent holds the wallet. The human holds the authority.',528,354,24,fg,600);
   } else {
     body+=image(uri,190,70,620,620);
     body+=label('PULSO',500,790,94,fg,800,8).replace('<text ','<text text-anchor="middle" ');
     body+=label('Human authorization for AI agents',500,850,26,fg,500).replace('<text ','<text text-anchor="middle" ');
   }
   body+=`<text x="${kind==='horizontal'?48:60}" y="${h-24}" fill="${fg}" font-family="Arial,sans-serif" font-size="${kind==='horizontal'?16:18}" font-weight="700">${notice}</text>`;
   const s=svg(w,h,body,`PULSO ${kind} lockup ${theme} — PNG-backed editable composition`);
   const base=path.join(out,'lockups',`guardian-${kind}-${theme}`);writeSvg(base+'.svg',s);await render(s,base+'.png');
 }
 // Transparent wordmark lockups remain alpha-backed; notice appears as a footer line.
 for(const [variant,fg] of [['color',palette.ink],['white',palette.ivory]]) for(const kind of ['horizontal','stacked']){
   const w=kind==='horizontal'?1600:1000,h=kind==='horizontal'?500:1000,uri=data(input.mark);let body='';
   if(kind==='horizontal'){
     body+=image(uri,35,25,430,430);body+=label('PULSO',520,190,128,fg,800,7);body+=label('Human authorization for AI agents',528,254,34,fg,500);body+=label('The agent holds the wallet. The human holds the authority.',528,320,22,fg,600);
   } else {
     body+=image(uri,190,40,620,620);body+=label('PULSO',500,735,90,fg,800,8).replace('<text ','<text text-anchor="middle" ');body+=label('Human authorization for AI agents',500,790,25,fg,500).replace('<text ','<text text-anchor="middle" ');
   }
   body+=`<text x="40" y="${h-20}" fill="${fg}" font-family="Arial,sans-serif" font-size="14" font-weight="700">${notice}</text>`;
   const xml=svg(w,h,body,`PULSO ${kind} transparent ${variant} lockup — PNG-backed editable composition`),base=path.join(out,'lockups',`guardian-${kind}-transparent-${variant}`);
   writeSvg(base+'.svg',xml);await render(xml,base+'.png');
 }
 // Four circle-safe avatar canvases. Dark avatar uses an ivory disc to keep the unmodified hood legible.
 for(const [variant,bg,disc,source] of [['light',palette.ivory,false,input.mark],['dark',palette.dark,true,input.mark],['amber',palette.amber,false,input.mark],['transparent','transparent',false,input.mark],['mono',palette.ivory,false,input.mono],['mono-dark',palette.dark,true,input.mono]]){
   const w=512,h=512,pad=42,size=428,uri=data(source);
   let body='';if(bg!=='transparent')body+=`<rect width="512" height="512" rx="100" fill="${bg}"/>`;
   if(disc)body+=`<circle cx="256" cy="256" r="205" fill="${palette.ivory}"/>`;
   body+=image(uri,pad,pad,size,size);
   const s=svg(w,h,body,`PULSO circle-safe avatar ${variant} — PNG-backed`);
   const base=path.join(out,'avatars',`guardian-avatar-${variant}-512`);writeSvg(base+'.svg',s);await render(s,base+'.png');
 }
 // Favicon art remains image-generated. Small sizes trade tiny eye detail for legible overall expression.
 for(const size of [16,32,48,64,128,180,192,512]){
   const uri=data(input.mark),pad=Math.round(size*.04),dim=size-pad*2;
   const body=`<rect width="${size}" height="${size}" rx="${Math.round(size*.20)}" fill="${palette.ivory}"/>${image(uri,pad,pad,dim,dim)}`;
   const s=svg(size,size,body,`PULSO favicon ${size}px — image-generated face`);
   const base=path.join(out,'favicons',`favicon-${size}`);writeSvg(base+'.svg',s);await render(s,base+'.png');
 }
 // PNG-compressed ICO container from the exact 16/32/48 exports; no pixel art redraw.
 const icoSizes=[16,32,48],icoParts=icoSizes.map(size=>fs.readFileSync(path.join(out,'favicons',`favicon-${size}.png`)));
 let offset=6+16*icoParts.length,dirs=[];
 for(let i=0;i<icoParts.length;i++){const n=icoParts[i].length,size=icoSizes[i];dirs.push(Buffer.from([size===256?0:size,size===256?0:size,0,0,1,0,32,0,n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255,offset&255,(offset>>8)&255,(offset>>16)&255,(offset>>24)&255]));offset+=n;}
 fs.writeFileSync(path.join(out,'favicons/favicon.ico'),Buffer.concat([Buffer.from([0,0,1,0,icoParts.length,0]),...dirs,...icoParts]));
 // Social and product-safe campaign set. Keep exact notice inside every exported composition.
 const cards=[
  ['banner-light',1500,500,palette.ivory,'mark','Give agents money\nwithout unlimited power.','The agent holds the wallet.\nThe human holds the authority.'],
  ['banner-dark',1500,500,palette.dark,'mark','The agent holds\nthe wallet.','The human holds\nthe authority.'],
  ['launch-light',1200,630,palette.ivory,'heart','Give agents money','without unlimited power.'],
  ['launch-dark',1200,630,palette.dark,'heart','The agent holds\nthe wallet.','The human holds\nthe authority.'],
  ['square-light',1080,1080,palette.ivory,'heart','Give agents\nmoney','without giving them\nunlimited power.'],
  ['square-dark',1080,1080,palette.dark,'heart','The agent holds\nthe wallet.','The human holds\nthe authority.'],
  ['story-light',1080,1920,palette.ivory,'heart','Give agents money\nwithout giving them','unlimited power.'],
  ['story-dark',1080,1920,palette.dark,'heart','The agent holds\nthe wallet.','The human holds\nthe authority.'],
 ];
 for(const [name,w,h,bg,art,headline,sub] of cards){
   const size=h>=1800?22:18, s=composition({w,h,bg,art,headline,sub,noticeSize:size});
   const base=path.join(out,'campaigns',name);writeSvg(base+'.svg',s);await render(s,base+'.png');
 }
 for(const [name,art,headline,sub] of [['opening-head','mark','Give agents money\nwithout unlimited power.','The agent holds the wallet.\nThe human holds the authority.'],['closing-heart','heart','The agent holds\nthe wallet.','The human holds the authority.']]){
   const s=composition({w:1920,h:1080,bg:palette.dark,art,headline,sub,noticeSize:24});const base=path.join(out,'video',name);writeSvg(base+'.svg',s);await render(s,base+'.png');
 }
 // All-asset contact sheet: actual exported images, accurate names, circle-safe avatar and native favicon previews.
 const cardsForSheet=[
  ['Mark · light','logos/guardian-mark-light.png'],['Mark · dark','logos/guardian-mark-dark.png'],['Mark · amber','logos/guardian-mark-amber.png'],['Mark · mono','logos/guardian-mark-mono-light.png'],
  ['Head · master','logos/guardian-mark-transparent-master.png'],['Full guardian · master','logos/guardian-heart-transparent-master.png'],
  ['Lockup · horizontal light','lockups/guardian-horizontal-light.png'],['Lockup · stacked dark','lockups/guardian-stacked-dark.png'],['Lockup · transparent color','lockups/guardian-horizontal-transparent-color.png'],
  ['Avatar · dark circle safe','avatars/guardian-avatar-dark-512.png'],['Avatar · amber','avatars/guardian-avatar-amber-512.png'],['Avatar · light','avatars/guardian-avatar-light-512.png'],['Avatar · mono','avatars/guardian-avatar-mono-512.png'],
 ];
 let sheet=`<rect width="2000" height="1980" fill="${palette.ivory}"/><text x="60" y="75" font-family="Arial,sans-serif" font-size="32" font-weight="800" fill="${palette.ink}">PULSO · EXPRESSIVE BRAND KIT · READY FOR REVIEW</text>`;
 for(let i=0;i<cardsForSheet.length;i++){
   const [name,rel]=cardsForSheet[i],col=i%3,row=Math.floor(i/3),x=60+col*630,y=120+row*290;
   const dark=name.includes('dark'), tile=dark?palette.dark:'#FFFFFF';
   sheet+=`<rect x="${x}" y="${y}" width="590" height="250" rx="20" fill="${tile}" stroke="#d8d5cd"/>`;
   sheet+=image(data(path.join(out,rel)),x+22,y+20,546,185);
   sheet+=label(name,x+24,y+228,18,dark?palette.ivory:palette.ink,700);
 }
 sheet+=`<text x="60" y="${120+Math.ceil(cardsForSheet.length/3)*290+20}" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="${palette.ink}">FAVICON / REAL OUTPUT DIMENSIONS</text>`;
 for(const [i,size] of [16,32,48,64,128].entries()){
   const x=70+i*135, y=120+Math.ceil(cardsForSheet.length/3)*290+60;
   sheet+=image(data(path.join(out,'favicons',`favicon-${size}.png`)),x,y,size,size);
   sheet+=label(`${size}px`,x,y+size+22,15,palette.ink,600);
 }
 const contactBaseY=120+Math.ceil(cardsForSheet.length/3)*290+60+128;
 sheet+=`<text x="850" y="${contactBaseY+45}" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="${palette.ink}">${notice}</text><text x="850" y="${contactBaseY+82}" font-family="Arial,sans-serif" font-size="17" fill="${palette.ink}">Transparent masters embedded unchanged; layouts and words remain editable.</text>`;
 const contact=svg(2000,1980,sheet,'PULSO expressive complete asset contact sheet');
 writeSvg(path.join(out,'contact/contact-sheet.svg'),contact);await render(contact,path.join(out,'contact/contact-sheet.png'));
 // Campaign and video overview shows real generated exports at card scale.
 let overview=`<rect width="2000" height="1300" fill="${palette.ivory}"/><text x="55" y="68" font-family="Arial,sans-serif" font-size="30" font-weight="800" fill="${palette.ink}">PULSO · CAMPAIGN + VIDEO EXPORTS</text>`;
 const previews=['campaigns/banner-light.png','campaigns/banner-dark.png','campaigns/launch-light.png','campaigns/launch-dark.png','campaigns/square-light.png','campaigns/square-dark.png','campaigns/story-light.png','campaigns/story-dark.png','video/opening-head.png','video/closing-heart.png'];
 for(let i=0;i<previews.length;i++){const rel=previews[i],col=i%2,row=Math.floor(i/2),x=55+col*970,y=110+row*220,w=900,h=175;overview+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#fff" stroke="#d8d5cd"/>`;overview+=image(data(path.join(out,rel)),x+12,y+10,w-24,h-42);overview+=label(rel,x+16,y+h-12,14,palette.ink,600);}
 overview+=`<text x="55" y="1240" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="${palette.ink}">${notice}</text>`;
 const overviewSvg=svg(2000,1300,overview,'PULSO campaign and video asset contact sheet');writeSvg(path.join(out,'contact/campaign-overview.svg'),overviewSvg);await render(overviewSvg,path.join(out,'contact/campaign-overview.png'));
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(path.join(dir,d.name)):[path.join(dir,d.name)]);
 const masterHashes=new Set(Object.values(input).map(sha));
 for(const full of walk(out).filter(f=>f.endsWith('.png')))masterHashes.add(sha(full));
 for(const full of walk(out).filter(f=>f.endsWith('.svg'))){
   const xml=fs.readFileSync(full,'utf8');
   const refs=[...xml.matchAll(/href="data:image\/png;base64,([^"]+)"/g)];
   for(const ref of refs){const decoded=ref[1].replace(/&#(66|98|67|99|80|112|77|109|86|118);/g,(_,n)=>String.fromCharCode(Number(n))),digest=crypto.createHash('sha256').update(Buffer.from(decoded,'base64')).digest('hex');if(!masterHashes.has(digest))throw Error(`Embedded art mismatch in ${path.relative(out,full)}`);}
 }
 const blocked=[[98,105,100,111],[99,97,109,112,117,115,32,109,111,98,105,108,101],[112,114,111,99,117,114,101,109,101,110,116,32,97,103,101,110,116],[112,108,97,110,111,32,100,101,32,100,105,115,116,114,105,98,117,105],[109,111,97,116],[118,97,108,117,97,116,105,111,110]].map(x=>String.fromCharCode(...x));
 for(const full of walk(out).filter(f=>f.endsWith('.svg'))){const content=fs.readFileSync(full,'utf8').toLowerCase();if(blocked.some(term=>content.includes(term)))throw Error(`Unsafe raw data URI text in ${path.relative(out,full)}`);}
 const inventory=[];
 for(const dir of ['logos','lockups','avatars','favicons','campaigns','video','contact']) for(const file of fs.readdirSync(path.join(out,dir))){
  const full=path.join(out,dir,file);if(!fs.statSync(full).isFile())continue;
  const record={path:path.relative(out,full).replaceAll(path.sep,'/'),bytes:fs.statSync(full).size,sha256:sha(full)};
  if(file.endsWith('.png')){const m=await sharp(full).metadata();record.width=m.width;record.height=m.height;record.channels=m.channels;}
  inventory.push(record);
 }
 fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify({status:'ready-for-review',sourceMasters:Object.fromEntries(Object.entries(input).map(([k,p])=>[k,{path:path.relative(out,p),sha256:sha(p),width:1254,height:1254,channels:4}])),notice,assets:inventory},null,2)+'\n');
 console.log(`Exported ${inventory.length} files from immutable 1254x1254 RGBA masters.`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
