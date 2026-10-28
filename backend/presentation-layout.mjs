import {pptMasterVisibleContent,validatePptMasterVisibleText} from './ppt-master-model.mjs';
import {validatePptMasterSvg} from './ppt-master-runtime.mjs';

const xml=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
const width=(value,size)=>Array.from(value).reduce((sum,ch)=>sum+(ch===' '?0.3:/[\u2E80-\uFFFF]/u.test(ch)?1:/[MW@#%]/.test(ch)?0.85:/[ilI.,:;'!|]/.test(ch)?0.3:0.56)*size,0);
function lines(text,size,space){
 const result=[];let line='';
 for(const ch of Array.from(text.replace(/\s+/gu,' ').trim())){if(line&&width(line+ch,size)>space){result.push(line);line='';}line+=ch;}
 if(line)result.push(line);return result;
}
function arrangement(slide,plan,composition,bodySize,titleSize){
 const content=pptMasterVisibleContent(slide,plan),title=content[0],footer=content.at(-1),body=content.slice(1,-1),titleLines=lines(title.text,titleSize,1112),titleHeight=titleLines.length*titleSize*1.5+16;
 const top=composition==='cover'||composition==='ending'?92:44,bodyTop=top+titleHeight+24,bottom=624;
 if(bodyTop>=bottom)return null;
 const blocks=[{...title,x:72,y:top,w:1136,h:titleHeight,size:titleSize,lines:titleLines}],split=composition==='split',columns=split?2:1,cut=Math.ceil(body.length/columns),gap=split?48:0,w=split?544:1136;
 for(let col=0;col<columns;col++){
  const group=body.slice(col*cut,(col+1)*cut),prepared=group.map((row,index)=>{const size=composition==='spotlight'&&col===0&&index===0?Math.max(bodySize,30):bodySize,wrapped=lines(row.text,size,w-24);return{...row,size,lines:wrapped,h:wrapped.length*size*1.5+16};}),space=bottom-bodyTop,total=prepared.reduce((n,row)=>n+row.h,0),gaps=prepared.length>1?Math.min(22,Math.max(12,(space-total)/(prepared.length-1))):0;
  if(total+gaps*Math.max(0,prepared.length-1)>space)return null;
  let y=bodyTop;for(const row of prepared){blocks.push({...row,x:72+col*(w+gap),y,w});y+=row.h+gaps;}
 }
 blocks.push({...footer,x:1032,y:656,w:176,h:32,size:16,lines:[footer.text]});return blocks;
}

// This path formats only content already accepted against the authorized
// sources. It neither invents facts nor spends another model call. Its output
// still passes the same geometry, exact-text and SVG security gates.
export function validatedPresentationLayout(value,slide,plan){
 const page=plan.slides.find(row=>row.id===slide.id);if(!page)throw Error('页面设计计划缺失');
 let blocks;
 for(const composition of [...new Set([page.composition,'editorial'])]){
  for(const [bodySize,titleSize] of [[26,page.role==='cover'?52:44],[24,38],[22,32]]){blocks=arrangement(slide,plan,composition,bodySize,titleSize);if(blocks)break;}
  if(blocks)break;
 }
 if(!blocks)throw Object.assign(Error('当前页文字过密，无法在可读字号下完成排版；已保存内容保留'),{code:'ppt_layout_capacity',status:422});
 const p=plan.palette,font=xml(plan.typography.fontFamily),ending=page.role==='ending',body=blocks.filter(row=>row.role==='body');
 let decoration=page.role==='cover'?`<rect id="theme-panel" data-pptx-role="decoration" x="988" y="0" width="292" height="720" fill="${p.secondary}"/><rect id="theme-rule" data-pptx-role="decoration" x="0" y="0" width="24" height="720" fill="${p.primary}"/><rect id="theme-bar" data-pptx-role="decoration" x="72" y="52" width="96" height="8" fill="${p.accent}"/>`:`<rect id="theme-bar" data-pptx-role="decoration" x="40" y="48" width="8" height="64" fill="${ending?'#FFFFFF':p.accent}"/>`;
 if(page.composition==='split'&&body.length>1)decoration+=`<line id="column-divider" data-pptx-role="decoration" x1="640" y1="${body[0].y}" x2="640" y2="624" stroke="${p.divider}" stroke-width="2"/>`;
 if(page.composition==='spotlight'&&body.length){const row=body[0];decoration+=`<rect id="highlight-field" data-pptx-role="decoration" x="${row.x}" y="${row.y}" width="${row.w}" height="${row.h}" fill="${p.secondary}"/>`;}
 if(page.composition==='sequence')for(const [index,row]of body.entries())decoration+=`<circle id="sequence-node-${index}" data-pptx-role="decoration" cx="52" cy="${row.y+row.size}" r="4" fill="${p.accent}"/>`;
 if(page.composition==='editorial')for(const [index,row]of body.slice(0,-1).entries())decoration+=`<line id="editorial-rule-${index}" data-pptx-role="decoration" x1="84" y1="${row.y+row.h+5}" x2="1196" y2="${row.y+row.h+5}" stroke="${p.divider}" stroke-width="1"/>`;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" data-pptx-page-role="${page.role}"><rect id="background" data-pptx-role="background" x="0" y="0" width="1280" height="720" fill="${ending?p.primary:p.background}"/>${decoration}${blocks.map(row=>`<g id="${row.id}" data-pptx-bounds="${row.x} ${row.y} ${row.w} ${row.h}">${row.lines.map((text,index)=>`<text x="${row.x+12}" y="${row.y+row.size+8+index*row.size*1.5}" font-family="${font}" font-size="${row.size}"${row.role==='title'?' font-weight="700"':''} fill="${ending?'#FFFFFF':row.role==='footer'?p.muted:p.text}">${xml(text)}</text>`).join('')}</g>`).join('')}</svg>`;
 const checked=validatePptMasterSvg(svg);validatePptMasterVisibleText(checked,slide,plan);
 return {...Object.fromEntries(['id','title','body','layout','notes'].map(key=>[key,slide[key]??''])),svg:checked,sourceIds:[...plan.sourceIds],evidenceSourceIds:[...plan.sourceIds],authorSourceIds:[],composition:page.composition,layoutMethod:'validated',requiresReview:true};
}
