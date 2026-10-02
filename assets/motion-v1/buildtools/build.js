#!/usr/bin/env node
'use strict';
// Deterministic SVG and loop exports. Requires the bundled Sharp module and Pillow for GIF encoding.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sharp=require(process.env.SHARP_MODULE||'sharp');
const root=path.resolve(__dirname,'..'),brand=path.resolve(__dirname,'../../brand-v1/raster-v2/guardian-mark-transparent.png');
const C={amber:'#FFB020',ivory:'#F6F4EF',ink:'#0A0E13',coral:'#C6534C',muted:'#66717D'};
const notice='NOT AUDITED · DEVNET DEMONSTRATION ONLY',T=6,W=640,H=360;
const mkdir=p=>fs.mkdirSync(path.dirname(p),{recursive:true});
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function embed(p){const b=fs.readFileSync(p).toString('base64');return b.replace(/[bBmMvV]/g,c=>`&#${c.charCodeAt(0)};`)}
function frameWrap(body,bg='none',opts={}){const w=opts.w||W,h=opts.h||H,rect=bg==='none'?'':`<rect width="${w}" height="${h}" fill="${bg}"/>`,footY=h>1500?h-180:(h>=1000?h-72:h-28),noticeSize=opts.noticeSize||(w>=1080?18:11);let still=body.replace(/<animate(?:Transform)?\b[^>]*\/>/g,'').replace(/<animate(?:Transform)?\b[^>]*>[\s\S]*?<\/animate(?:Transform)?>/g,'');still=still.replace(/\bid="([^"]+)"/g,(_,id)=>`id="${id}-static"`).replace(/url\(#([^)]*)\)/g,(_,id)=>`url(#${id}-static)`).replace(/href="#([^"]+)"/g,(_,id)=>`href="#${id}-static"`);return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><title>${esc(opts.title||'PULSO motion design')}</title><desc>${notice}. Editable code-native animation. A static layer appears when reduced motion is requested.</desc><style>@media (prefers-reduced-motion: reduce){.motion{display:none!important}.still{display:inline!important}}</style>${rect}<g class="motion">${body}</g><g class="still" display="none">${still}</g>${opts.notice?`<text x="${Math.round(w*.035)}" y="${footY}" fill="${opts.noticeColor||C.ivory}" font-family="Arial,sans-serif" font-size="${noticeSize}" font-weight="700">${notice}</text>`:''}</svg>`}
function anim(node,attr,vals,dur=T,extra=''){return node.replace('/>',`><animate attributeName="${attr}" values="${vals}" dur="${dur}s" repeatCount="indefinite" ${extra}/></${node.match(/^<([\w:]+)/)[1]}>`)}
function translate(node,values,dur=T){return node.replace('/>',`><animateTransform attributeName="transform" type="translate" values="${values}" dur="${dur}s" repeatCount="indefinite"/></${node.match(/^<([\w:]+)/)[1]}>`)}
const specs=[];
const cp=require('node:child_process'),swiftc=process.env.SWIFTC||'swiftc';
const encoder=path.join(require('node:os').tmpdir(),'pulso-motion-h264-encoder');
const swiftCache=process.env.SWIFT_MODULE_CACHE||'/tmp/pulso-motion-swift-cache',sdk=process.env.MACOS_SDK||'/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk',target=process.env.MACOS_TARGET||'arm64-apple-macosx26.5';
let videoEncoder=null;
const skipMp4=process.env.SKIP_MP4==='1';
if(!skipMp4){
 const version=cp.spawnSync(swiftc,['--version'],{encoding:'utf8'});
 if(version.error||version.status!==0)throw new Error(`MP4 export requires Swift compiler "${swiftc}"; set SKIP_MP4=1 only for an explicitly incomplete GIF-only build. ${version.error?.message||version.stderr||''}`);
 const compiled=cp.spawnSync(swiftc,['-module-cache-path',swiftCache,'-sdk',sdk,'-target',target,path.join(__dirname,'encode-video.swift'),'-o',encoder],{encoding:'utf8'});
 if(compiled.status!==0)throw new Error(`H.264 encoder compilation failed; set SKIP_MP4=1 only for an explicitly incomplete GIF-only build. ${(compiled.stderr||compiled.stdout||'Swift compilation failed').trim()}`);
 videoEncoder=encoder;
}
for(const folder of ['effects','backgrounds','loops']){fs.rmSync(path.join(root,folder),{recursive:true,force:true});fs.mkdirSync(path.join(root,folder),{recursive:true})}
fs.rmSync(path.join(root,'assets.json'),{force:true});
function loopMotif(w,h,kind,t=null){
 const duration=4, cx=w*.78, cy=h*.52, orbit=Math.min(w,h)*.20;
 const times=Array.from({length:49},(_,i)=>i/48);
 const n=(v)=>Number(v.toFixed(2));
 const at=(progress)=>({x:n(cx+orbit*Math.cos(progress*Math.PI*2)),y:n(cy+orbit*.48*Math.sin(progress*Math.PI*2)),r:n(orbit*(.84+.16*Math.sin(progress*Math.PI*2))),opacity:n(.46+.34*(.5+.5*Math.sin(progress*Math.PI*2)))});
 const points=times.map(at), idx=t===null?0:Math.round(((t%duration)/duration)*48), p=points[idx];
 const values=(key)=>points.map(v=>v[key]).join(';'), keyTimes=times.map(v=>v.toFixed(4)).join(';');
 const anim=(attribute,key)=>t===null?`<animate attributeName="${attribute}" values="${values(key)}" keyTimes="${keyTimes}" dur="4s" repeatCount="indefinite"/>`:'';
 const colors=kind==='field'?[C.coral,C.amber]:kind==='pulse'?[C.coral,C.ivory]:[C.amber,C.coral];
 const ringR=t===null?points[0].r:p.r, x=t===null?points[0].x:p.x, y=t===null?points[0].y:p.y, opacity=t===null?points[0].opacity:p.opacity;
 const ring=`<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="${colors[0]}" stroke-width="${Math.max(2,Math.round(Math.min(w,h)*.006))}" opacity=".46">${anim('r','r')}</circle>`;
 const satellite=`<circle cx="${x}" cy="${y}" r="${Math.max(5,Math.min(w,h)*.014)}" fill="${colors[1]}" opacity="${opacity}">${anim('cx','x')}${anim('cy','y')}${anim('opacity','opacity')}</circle>`;
 const pulseR=Math.min(w,h)*(.045+.025*(.5+.5*Math.sin((t===null?0:t/4)*Math.PI*2)));
 const pulse=`<circle cx="${w*.22}" cy="${h*.72}" r="${pulseR}" fill="${colors[0]}" opacity=".18">${t===null?`<animate attributeName="r" values="${times.map(q=>n(Math.min(w,h)*(.045+.025*(.5+.5*Math.sin(q*Math.PI*2))))).join(';')}" keyTimes="${keyTimes}" dur="4s" repeatCount="indefinite"/>`:''}<animate attributeName="opacity" values=".12;.3;.12" dur="4s" repeatCount="indefinite"/></circle>`;
 let extra='';
 if(kind==='field'){
  for(let j=0;j<5;j++){const offset=t===null?0:-Math.round(360*(t/4)),opacity=.16+j*.025,d=`M${w*.04} ${h*(.28+j*.10)} C${w*.23} ${h*(.10+j*.10)} ${w*.36} ${h*(.46+j*.07)} ${w*.55} ${h*(.30+j*.08)} S${w*.82} ${h*(.18+j*.10)} ${w*.98} ${h*(.34+j*.08)}`;extra+=`<path d="${d}" fill="none" stroke="${j%2?C.coral:C.amber}" stroke-width="${Math.max(2,h*.004)}" stroke-opacity="${opacity}" stroke-dasharray="140 85" stroke-dashoffset="${offset}">${t===null?`<animate attributeName="stroke-dashoffset" values="0;-360" dur="4s" repeatCount="indefinite"/>`:''}</path>`;}
 } else if(kind==='pulse'){
  const scale=t===null?1+0.08*Math.sin(2*Math.PI*(t||0)/4):1+0.08*Math.sin(2*Math.PI*t/4), hx=w*.22,hy=h*.57,hs=Math.min(w,h)*.12;
  const d=`M${hx} ${hy+hs*.48} C${hx-hs*.72} ${hy-hs*.02} ${hx-hs*.62} ${hy-hs*.70} ${hx} ${hy-hs*.34} C${hx+hs*.62} ${hy-hs*.70} ${hx+hs*.72} ${hy-hs*.02} ${hx} ${hy+hs*.48}Z`;
  extra+=`<path d="${d}" fill="none" stroke="${C.coral}" stroke-width="${Math.max(3,h*.008)}" stroke-linejoin="round" transform="translate(${hx*(1-scale)} ${hy*(1-scale)}) scale(${scale})">${t===null?`<animateTransform attributeName="transform" type="scale" values="1;1.08;1;0.94;1" keyTimes="0;.25;.5;.75;1" dur="4s" repeatCount="indefinite"/>`:''}</path><path d="M${w*.45} ${h*.60}H${w*.60}l${w*.025} ${-h*.07}l${w*.035} ${h*.14}l${w*.03} ${-h*.07}H${w*.92}" fill="none" stroke="${C.ivory}" stroke-width="${Math.max(2,h*.004)}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${w*.5}" stroke-dashoffset="${t===null?0:-w*.5}">${t===null?`<animate attributeName="stroke-dashoffset" values="0;-${w*.5}" dur="4s" repeatCount="indefinite"/>`:''}</path>`;
 } else if(kind==='orbits'){
  for(let j=0;j<3;j++){const rotation=t===null?0:360*t/4+j*38;extra+=`<ellipse cx="${cx}" cy="${cy}" rx="${orbit*(1+j*.28)}" ry="${orbit*(.28+j*.12)}" fill="none" stroke="${j===1?C.coral:C.amber}" stroke-width="${Math.max(2,h*.003)}" stroke-opacity="${.52-j*.1}" transform="rotate(${rotation} ${cx} ${cy})">${t===null?`<animateTransform attributeName="transform" type="rotate" values="${j*38} ${cx} ${cy};${360+j*38} ${cx} ${cy}" dur="4s" repeatCount="indefinite"/>`:''}</ellipse>`;}
 } else {
  const halo=Math.min(w,h)*.30, haloOpacity=.14+.08*(.5+.5*Math.sin((t||0)/4*Math.PI*2));
  extra+=`<circle cx="${w*.79}" cy="${h*.48}" r="${halo}" fill="none" stroke="${C.amber}" stroke-width="${Math.max(3,h*.007)}" opacity="${haloOpacity}">${t===null?`<animate attributeName="r" values="${halo*.92};${halo*1.08};${halo*.92}" dur="4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".12;.28;.12" dur="4s" repeatCount="indefinite"/>`:''}</circle>`;
 }
 return ring+satellite+pulse+extra;
}
function add(family,name,title,draw,background=family==='backgrounds'){specs.push({family,name,title,draw,background})}
// Distinct particles: dust, sparks, ember arcs, firefly points, constellation drift, snowfall, pollen and signal motes.
for(let i=0;i<8;i++){
 const families=['dust','sparks','embers','fireflies','constellation','snow','pollen','signal-motes'];
 const family=families[i],count=family==='constellation'?12:18;
 add('particles',family,`${family.replaceAll('-',' ')} · ${i+1}`,()=>{
  let s='';for(let j=0;j<count;j++){
   const x=22+((j*83+i*41)%596),y=28+((j*53+i*67)%285),r=family==='sparks'?1.2+(j%4)*.7:1.3+(j%3)*1.1;
   const col=j%5===0?C.coral:(j%3===0?C.ivory:C.amber),dx=((j%5)-2)*13,dy=(family==='snow'?18:((j%7)-3)*12);
   const shape=family==='sparks'?`<path d="M${x} ${y-5-r}L${x+1} ${y}L${x} ${y+5+r}L${x-1} ${y}Z" fill="${col}"/>`:`<circle cx="${x}" cy="${y}" r="${r}" fill="${col}"/>`;
   s+=`<g opacity=".18">${shape}<animateTransform attributeName="transform" type="translate" values="0 0;${dx} ${dy};0 0" dur="${4+(j%4)}s" begin="-${j%6}s" repeatCount="indefinite"/><animate attributeName="opacity" values=".18;.95;.18" dur="${4+(j%4)}s" begin="-${j%4}s" repeatCount="indefinite"/></g>`;
  }return s;
 });
}
// Ribbons and trails with different geometry, dash behavior and paired streams.
for(let i=0;i<8;i++){
 const names=['pulse-trail','silk-ribbon','orbit-trail','comet-arc','double-current','wave-ribbon','beacon-path','heart-trace'];
 const name=names[i], paths=[`M40 ${180+i*5} C170 40 310 320 600 145`,`M38 ${100+i*12} C190 330 410 10 602 240`,`M30 250 Q180 ${20+i*8} 340 190 T610 100`];
 add('trails',name,`${name.replaceAll('-',' ')} · ${i+1}`,()=>{let s='';for(let k=0;k<((i%3)+1);k++){let d=paths[(i+k)%paths.length],color=k%2?C.coral:C.amber,w=2+(i%4);s+=`<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" opacity=".76" stroke-dasharray="${70+i*9} ${48+i*4}"><animate attributeName="stroke-dashoffset" values="0;-${220+i*35}" dur="${4+(i%3)}s" repeatCount="indefinite"/></path>`}return s});
}
// Orbital marks and rings, varied radii / orbit counts / orientation.
for(let i=0;i<8;i++){
 const names=['quiet-orbit','double-orbit','elliptic-guard','crossing-rings','satellite-ring','dashed-orbit','halo-gate','orbiting-heart'];
 add('orbits',names[i],`${names[i].replaceAll('-',' ')} · ${i+1}`,()=>{
  const cx=320,cy=180,rx=95+(i%4)*25,ry=40+(i%3)*24,stroke=i%2?C.coral:C.amber;
  let s=`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${stroke}" stroke-width="${2+i%3}" opacity=".72" transform="rotate(${i*13} ${cx} ${cy})"><animateTransform attributeName="transform" type="rotate" values="${i*13} ${cx} ${cy};${i*13+360} ${cx} ${cy}" dur="${6+i%3}s" repeatCount="indefinite"/></ellipse>`;
  for(let j=0;j<1+i%3;j++){let a=j*360/(1+i%3),x=cx+rx*Math.cos(a*Math.PI/180),y=cy+ry*Math.sin(a*Math.PI/180);s+=`<circle cx="${x}" cy="${y}" r="${5+j%3}" fill="${j%2?C.ivory:C.amber}"><animate attributeName="opacity" values=".45;1;.45" dur="${4+j}s" repeatCount="indefinite"/></circle>`}return s;
 });
}
// Pulse motifs: heart outlines are geometric and intentionally abstract, no medical claims.
for(let i=0;i<8;i++){
 const names=['soft-pulse','heart-outline','double-heartbeat','authority-beat','contained-pulse','ripple-heart','steady-signal','heart-window'];
 add('pulse-motifs',names[i],`${names[i].replaceAll('-',' ')} · ${i+1}`,()=>{
  const x=320,y=180,size=48+(i%4)*13,col=i%2?C.coral:C.amber;
  const heart=`M${x} ${y+size*.42} C${x-size*.7} ${y-size*.05},${x-size*.62} ${y-size*.72},${x} ${y-size*.34} C${x+size*.62} ${y-size*.72},${x+size*.7} ${y-size*.05},${x} ${y+size*.42}Z`;
  let s=`<path d="${heart}" fill="none" stroke="${col}" stroke-width="${3+i%3}" stroke-linejoin="round"><animate attributeName="opacity" values=".35;1;.35" dur="${4+i%3}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="scale" additive="sum" values="1;1.08;1" dur="${4+i%3}s" repeatCount="indefinite"/></path>`;
  if(i%2===0)s+=`<path d="M60 180H220L246 180L260 150L278 215L300 180H580" fill="none" stroke="${C.ivory}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="560" stroke-dashoffset="560"><animate attributeName="stroke-dashoffset" values="560;0;-560" dur="5s" repeatCount="indefinite"/></path>`;
  if(i%3===1)s+=`<circle cx="320" cy="180" r="${size+25}" fill="none" stroke="${col}" stroke-width="2" opacity=".5"><animate attributeName="r" values="${size+15};${size+70};${size+15}" dur="5s" repeatCount="indefinite"/><animate attributeName="opacity" values=".6;0;.6" dur="5s" repeatCount="indefinite"/></circle>`;
  return s;
 });
}
// Atmospheric glow fields built from radial gradients and gentle movement.
for(let i=0;i<8;i++){
 const names=['amber-aura','coral-aura','split-glow','slow-bloom','moving-lantern','warm-horizon','soft-focus','guardian-halo'];
 add('light-fields',names[i],`${names[i].replaceAll('-',' ')} · ${i+1}`,()=>{
  const cx=100+((i*97)%440),cy=70+((i*43)%220),r=110+(i%4)*28,col=i%3===1?C.coral:C.amber,id=`g${i}`;
  return `<defs><radialGradient id="${id}"><stop stop-color="${col}" stop-opacity=".48"><animate attributeName="stop-opacity" values=".3;.62;.3" dur="${5+i%3}s" repeatCount="indefinite"/></stop><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient></defs><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"><animate attributeName="r" values="${r};${r+25};${r}" dur="${6+i%2}s" repeatCount="indefinite"/><animate attributeName="cx" values="${cx};${cx+(i%2?28:-28)};${cx}" dur="${6+i%3}s" repeatCount="indefinite"/></circle>`;
 });
}
// Patterned motion backgrounds: each is an independent repeatable surface.
for(let i=0;i<8;i++){
 const names=['quiet-grid','amber-aurora','halftone-drift','contour-waves','soft-diagonal','dot-matrix','slow-tide','crosshatch-flow'];
 add('backgrounds',names[i],`${names[i].replaceAll('-',' ')} · ${i+1}`,()=>{
  if(i===0||i===5){let dots='';for(let x=20;x<W;x+=24)for(let y=20;y<H;y+=24){if(i===0)dots+=`<path d="M${x} 0V${H}M0 ${y}H${W}" stroke="${C.ivory}" stroke-opacity=".08" stroke-width="1"/>`;else dots+=`<circle cx="${x}" cy="${y}" r="2" fill="${C.amber}" opacity=".25"><animate attributeName="opacity" values=".08;.38;.08" dur="${4+(x+y)%4}s" repeatCount="indefinite"/></circle>`}return i===0?`<g opacity=".62">${dots}<animate attributeName="opacity" values=".54;.70;.54" dur="6s" repeatCount="indefinite"/></g>`:dots}
  if(i===2||i===7){let s='';for(let j=0;j<18;j++){let y=j*22;s+=`<path d="M-80 ${y} Q160 ${y-60} 350 ${y} T760 ${y+20}" fill="none" stroke="${j%3?C.amber:C.coral}" stroke-opacity=".${12+j%3*5}" stroke-width="${j%4===0?2:1}" stroke-dasharray="${70+j*8} ${30+j*4}"><animate attributeName="stroke-dashoffset" values="0;-500" dur="${6+j%3}s" repeatCount="indefinite"/></path>`}return s}
  if(i===1)return `<defs><linearGradient id="aur" x1="0" y1="1" x2="1" y2="0"><stop stop-color="${C.amber}" stop-opacity=".04"/><stop offset=".5" stop-color="${C.coral}" stop-opacity=".25"/><stop offset="1" stop-color="${C.amber}" stop-opacity=".03"/></linearGradient></defs><path d="M0 230 Q180 90 320 210 T640 100V360H0Z" fill="url(#aur)"><animateTransform attributeName="transform" type="translate" values="-25 0;25 0;-25 0" dur="8s" repeatCount="indefinite"/></path>`;
  let s='';for(let j=0;j<7;j++){const y=45+j*45;s+=`<path d="M0 ${y} C150 ${y-30} 200 ${y+30} 330 ${y} S510 ${y-25} 640 ${y}" fill="none" stroke="${j%2?C.coral:C.amber}" stroke-opacity=".23" stroke-width="2"><animate attributeName="d" values="M0 ${y} C150 ${y-30} 200 ${y+30} 330 ${y} S510 ${y-25} 640 ${y};M0 ${y+8} C150 ${y+38} 200 ${y-22} 330 ${y+8} S510 ${y+3} 640 ${y+8};M0 ${y} C150 ${y-30} 200 ${y+30} 330 ${y} S510 ${y-25} 640 ${y}" dur="${6+j%3}s" repeatCount="indefinite"/></path>`}return s;
 });
}
// Transitions/masks: 8 distinct reveal geometries for use between scenes.
for(let i=0;i<8;i++){
 const names=['amber-wipe','soft-curtain','radial-open','iris-gate','split-reveal','ripple-reveal','diagonal-sweep','pulse-reveal'];
 add('transitions',names[i],`${names[i].replaceAll('-',' ')} · ${i+1}`,()=>{
  if(i===0)return `<rect x="0" y="0" width="0" height="360" fill="${C.amber}"><animate attributeName="width" values="0;640;0" keyTimes="0;.5;1" dur="6s" repeatCount="indefinite"/></rect>`;
  if(i===1||i===4||i===6){const path=i===1?'M0 0H320Q420 180 320 360H0Z':i===4?'M0 0H320V360H0ZM640 0H320V360H640Z':'M0 360L220 0H420L200 360Z';return `<path d="${path}" fill="${C.amber}" opacity=".8"><animateTransform attributeName="transform" type="translate" values="-700 0;700 0;-700 0" dur="6s" repeatCount="indefinite"/></path>`}
  if(i===2||i===3||i===5||i===7){const cx=i===3?320:((i%2)*640),cy=180;return `<circle cx="${cx}" cy="${cy}" r="0" fill="${i%2?C.coral:C.amber}" opacity=".75"><animate attributeName="r" values="0;480;0" dur="6s" repeatCount="indefinite"/></circle>`}
  return '';
 });
}
// Stable distinct asset inventory, posters, and editable SMIL sources.
async function main(){
 const art=embed(brand),brandHash=sha(fs.readFileSync(brand));
 for(const spec of specs){
  const folder=spec.background?'backgrounds':'effects',bg=spec.background?C.ink:'none';
  const svg=frameWrap(spec.draw(),bg,{title:`PULSO ${spec.title}`,notice:spec.background});
  const base=path.join(root,folder,spec.name);mkdir(base+'.svg');fs.writeFileSync(base+'.svg',svg);
  await sharp(Buffer.from(svg)).png().toFile(base+'-poster.png');
 }
 // Eight composed practical loops, including a guardian hero using unmodified embedded PNG artwork.
 const ratios=[['approval-landscape',1280,720,'hero'],['quiet-landscape',1280,720,'field'],['signal-landscape',1280,720,'pulse'],['closing-landscape',1280,720,'guardian'],['identity-square',1080,1080,'guardian'],['orbit-square',1080,1080,'orbits'],['story-portrait',1080,1920,'guardian'],['approval-portrait',1080,1920,'pulse']];
 const pathText=`The agent holds the wallet. The human holds the authority.`;
 for(const [name,w,h,kind] of ratios){
  const body=kind==='hero'?`<rect width="${w}" height="${h}" fill="${C.ink}"/><circle cx="${w*.77}" cy="${h*.5}" r="${Math.min(w,h)*.22}" fill="${C.amber}" opacity=".12"><animate attributeName="r" values="${Math.min(w,h)*.18};${Math.min(w,h)*.24};${Math.min(w,h)*.18}" dur="4s" repeatCount="indefinite"/></circle><image href="data:image/png;base64,${art}" x="${w*.61}" y="${h*.16}" width="${Math.min(w,h)*.66}" height="${Math.min(w,h)*.66}" preserveAspectRatio="xMidYMid meet"/><path d="M${w*.06} ${h*.64}H${w*.38}" stroke="${C.amber}" stroke-width="8" stroke-linecap="round"><animate attributeName="stroke-dasharray" values="0 400;280 400;0 400" dur="4s" repeatCount="indefinite"/></path><text x="${w*.06}" y="${h*.3}" fill="${C.ivory}" font-family="Arial,sans-serif" font-size="${Math.round(h*.075)}" font-weight="800">Human authority</text><text x="${w*.06}" y="${h*.4}" fill="${C.ivory}" font-family="Arial,sans-serif" font-size="${Math.round(h*.04)}">The agent holds the wallet.</text><text x="${w*.06}" y="${h*.47}" fill="${C.ivory}" font-family="Arial,sans-serif" font-size="${Math.round(h*.04)}">The human holds the authority.</text>`
  : `<rect width="${w}" height="${h}" fill="${C.ink}"/>${kind==='guardian'?`<image href="data:image/png;base64,${art}" x="${w*.28}" y="${h*.30}" width="${Math.min(w,h)*.48}" height="${Math.min(w,h)*.48}" preserveAspectRatio="xMidYMid meet"/>`:''}<text x="${w*.08}" y="${h*.18}" fill="${C.ivory}" font-family="Arial,sans-serif" font-size="${Math.round(Math.min(w,h)*.055)}" font-weight="800">PULSO · human approval</text><text x="${w*.08}" y="${h*.83}" fill="${C.ivory}" font-family="Arial,sans-serif" font-size="${Math.round(Math.min(w,h)*.027)}">${esc(pathText)}</text>`;
  const motif=loopMotif(w,h,kind);
  const backdrop=`<rect width="${w}" height="${h}" fill="${C.ink}"/>`;
  const composed=motif+body.replace(backdrop,'');
  const svg=frameWrap(composed,C.ink,{title:`PULSO ${name}`,notice:true,noticeColor:C.ivory,w,h});
  const base=path.join(root,'loops',name);mkdir(base+'.svg');fs.writeFileSync(base+'.svg',svg);await sharp(Buffer.from(svg)).png().toFile(base+'-poster.png');
  const frames=[];for(let f=0;f<48;f++){const t=f/12,frameSvg=svg.replace(/<animateTransform/g,'<animateTransform').replace(/values="([^"]+)"/g,(all,vals)=>{
    // For complex SMIL values, leave Sharp at stable poster frame. Add a deterministic phase overlay for loop previews.
    return all;
   });
   const basePng=await sharp(Buffer.from(svg.replace(motif,loopMotif(w,h,kind,t)))).png().toBuffer();
   frames.push(basePng);
  }
  const tmp=path.join(root,'loops',`${name}-frames`);fs.mkdirSync(tmp,{recursive:true});for(let i=0;i<frames.length;i++)fs.writeFileSync(path.join(tmp,`${String(i).padStart(3,'0')}.png`),frames[i]);
  const py=path.join(root,'buildtools','encode-gif.py'),pybin=process.env.PYTHON||'python3',gif=cp.spawnSync(pybin,[py,tmp,base+'.gif'],{encoding:'utf8'});if(gif.status!==0)throw Error(gif.stderr||'GIF encoding failed');
  if(videoEncoder){const mp4=base+'.mp4',video=cp.spawnSync(videoEncoder,[tmp,mp4],{encoding:'utf8'});if(video.status!==0||!fs.existsSync(mp4)||fs.statSync(mp4).size===0){fs.rmSync(mp4,{force:true});fs.rmSync(tmp,{recursive:true,force:true});throw new Error(`H.264 encoding failed for ${name}: ${(video.stderr||video.stdout||`encoder exited ${video.status}`).trim()}`)}}
  fs.rmSync(tmp,{recursive:true,force:true});
 }
 const assets=[];
 for(const folder of ['effects','backgrounds','loops']){
  for(const file of fs.readdirSync(path.join(root,folder))){
   if(!(file.endsWith('-poster.png')||file.endsWith('.svg')||file.endsWith('.gif')||file.endsWith('.mp4')))continue;
   const full=path.join(root,folder,file),isGif=file.endsWith('.gif'),isPng=file.endsWith('.png'),isVideo=file.endsWith('.mp4');
   const baseName=path.basename(file).replace(/-poster\.png$/,'').replace(/\.(svg|gif|png|mp4)$/,'');
   const spec=specs.find(x=>x.name===baseName);
   let width=W,height=H;
   if(folder==='loops'){
    if(baseName.includes('portrait')){width=1080;height=1920}else if(baseName.includes('square')){width=height=1080}else{width=1280;height=720}
   }
   if(isGif||isPng){const m=await sharp(full).metadata();width=m.width;height=m.pageHeight||m.height}
   let periods=[];
   if(file.endsWith('.svg'))periods=[...fs.readFileSync(full,'utf8').matchAll(/\bdur="([0-9.]+)s"/g)].map(match=>Number(match[1]));
   if(isPng&&file.endsWith('-poster.png')){const src=path.join(root,folder,baseName+'.svg');if(fs.existsSync(src))periods=[...fs.readFileSync(src,'utf8').matchAll(/\bdur="([0-9.]+)s"/g)].map(match=>Number(match[1]))}
   const record={path:path.relative(root,full).replaceAll(path.sep,'/'),title:spec?.title||baseName.replaceAll('-',' '),family:spec?.family||folder,type:isVideo?'mp4-h264':isGif?'gif-loop':isPng?'poster-png':'animated-svg',width,height,durationSeconds:folder==='loops'?4:(periods.length?Math.max(...periods):6),bytes:fs.statSync(full).size,sha256:sha(fs.readFileSync(full))};
   if(periods.length)record.motionPeriodSeconds={min:Math.min(...periods),max:Math.max(...periods)};
   if(folder==='loops'){record.frames=48;record.frameRate=12}
   assets.push(record);
  }
 }
 fs.writeFileSync(path.join(root,'assets.json'),JSON.stringify({status:skipMp4?'incomplete-explicit-mp4-skip':'ready-for-review',brandArtworkSha256:brandHash,notice,assetCount:assets.length,assets},null,2)+'\n');
 console.log(`Rendered ${specs.length} standalone SVG/poster pairs and ${ratios.length} loop sets.`);
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
