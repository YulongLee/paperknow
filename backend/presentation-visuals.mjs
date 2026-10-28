import {DOMParser} from '@xmldom/xmldom';
// Visualize accepted content; no synthetic measurements, percentages or labels.
const paragraphs=slide=>slide.body.split(/\r?\n/).map(text=>text.trim()).filter(Boolean);
export function presentationChartRows(slide){
 const rows=paragraphs(slide).map(text=>{const match=text.match(/^([^：:\n]{1,40})[：:]\s*(\d+(?:\.\d+)?)\s*(%|％|ms|s|秒|毫秒|个|次|人|MB|GB|分|分数)?(?:\s*\[\d+\])?$/u);return match?{text,label:match[1],value:Number(match[2]),unit:match[3]||''}:null;});
 if(rows.length<2||rows.length>6||rows.some(row=>!row||!Number.isFinite(row.value)||row.value<0)||new Set(rows.map(row=>row.unit.replace('％','%'))).size!==1||rows.every(row=>row.value===0))return null;
 if(['%','％'].includes(rows[0].unit)&&rows.some(row=>row.value>100))return null;return rows;
}
export function presentationVisualKind(slide){
 const n=paragraphs(slide).length;if(slide.layout==='cover')return 'cover';if(slide.layout==='closing')return 'closing';
 if(!n)return null;if(n===1||n>6)return 'illustration';if(presentationChartRows(slide))return 'bars';
 if(/流程|步骤|技术路线|工作流|pipeline|workflow|steps|procedure/i.test(slide.title))return 'process';
 if(/架构|系统结构|组成|模块|framework|architecture|components/i.test(slide.title))return 'architecture';
 if(/对比|比较|差异|优势|contrast|compar|versus/i.test(slide.title)||slide.layout==='twoColumn')return 'comparison';
 return 'concepts';
}
// Topic glyphs are editable vectors; they express the adjacent supplied text,
// never a measured result, a photograph, or an externally fetched asset.
function glyph(text,x,y,size,p){
 text=text.split(/[：:]/u)[0];
 const scale=size/64,n=value=>Number(value.toFixed(2)),rect=(a,b,w,h,fill,stroke=p.accent)=>`<rect x="${n(x+a*scale)}" y="${n(y+b*scale)}" width="${n(w*scale)}" height="${n(h*scale)}" rx="${n(4*scale)}" fill="${fill}" stroke="${stroke}" stroke-width="${n(2*scale)}"/>`,line=(a,b,c,d)=>`<line x1="${n(x+a*scale)}" y1="${n(y+b*scale)}" x2="${n(x+c*scale)}" y2="${n(y+d*scale)}" stroke="${p.accent}" stroke-width="${n(2*scale)}"/>`,circle=(a,b,r,fill=p.background)=>`<circle cx="${n(x+a*scale)}" cy="${n(y+b*scale)}" r="${n(r*scale)}" fill="${fill}" stroke="${p.accent}" stroke-width="${n(2*scale)}"/>`;
 if(/处理|清洗|筛选|优化|process|filter|optim/i.test(text))return [8,24,40].map((a,i)=>rect(a,12+i*8,16,40-i*8,i===1?p.accent:p.secondary)).join('');
 if(/模型|网络|特征|算法|学习|network|model|learn|algorithm/i.test(text))return [[12,16,32,12],[12,16,32,32],[12,48,32,32],[12,48,32,52],[32,12,54,24],[32,32,54,24],[32,32,54,48],[32,52,54,48]].map(a=>line(...a)).join('')+[[12,16],[12,48],[32,12],[32,32],[32,52],[54,24],[54,48]].map(a=>circle(...a,4)).join('');
 if(/图像|识别|视觉|采集|image|vision|camera/i.test(text))return rect(6,15,52,36,p.background)+rect(17,8,16,8,p.secondary)+circle(32,33,12)+circle(32,33,5,p.accent);

 if(/数据|样本|数据库|data|sample/i.test(text))return rect(9,12,46,42,p.secondary)+[22,34,46].map(b=>line(16,b,48,b)).join('')+[20,32,44].map(a=>circle(a,14,2,p.accent)).join('');
 if(/评价|评估|验证|结果|指标|eval|valid|result|metric/i.test(text))return circle(32,32,25)+circle(32,32,16)+circle(32,32,6,p.accent)+line(32,32,57,7);

 if(/调查|问卷|文献|资料|研究|survey|paper|research/i.test(text))return rect(12,6,40,52,p.background)+[20,32,44].map(b=>line(22,b,43,b)).join('')+line(18,20,19,20)+line(18,32,19,32);
 return rect(8,8,19,19,p.secondary)+rect(37,8,19,19,p.background)+rect(8,37,19,19,p.background)+rect(37,37,19,19,p.accent);
}
function arrow(x1,y1,x2,y2,p){return `<line x1="${x1}" y1="${y1}" x2="${x2-8}" y2="${y2}" stroke="${p.accent}" stroke-width="3"/><polygon points="${x2-10},${y2-7} ${x2},${y2} ${x2-10},${y2+7}" fill="${p.accent}"/>`;}
export function presentationVisualArrangement(slide,plan,bodySize,titleSize,wrap){
 const kind=presentationVisualKind(slide);if(!kind||kind==='closing')return null;
 const page=plan.slides.find(row=>row.id===slide.id),p=plan.palette,titleLines=wrap(slide.title,titleSize,kind==='cover'?712:1112),titleHeight=titleLines.length*titleSize*1.5+16,top=kind==='cover'?86:44,bodyTop=top+titleHeight+32,bottom=620;
 if(bodyTop+80>=bottom)return null;
 const rows=paragraphs(slide).map((text,index)=>({id:'content-'+(index+1),text,role:'body'}));
 if(kind==='cover'&&plan.metadata?.author)rows.push({id:'presentation-author',text:'作者：'+plan.metadata.author,role:'body'});
 const blocks=[{id:'slide-title',text:slide.title,role:'title',x:72,y:top,w:kind==='cover'?744:1136,h:titleHeight,size:titleSize,lines:titleLines}];let art='';
 const wrapBody=(text,space)=>{const at=text.search(/[：:]/u);return at>0&&at<30&&wrap(text.slice(0,at+1),bodySize,space).length===1?[text.slice(0,at+1),...wrap(text.slice(at+1),bodySize,space)]:wrap(text,bodySize,space);};
 const add=(row,x,y,w,h)=>{const wrapped=wrapBody(row.text,w-24);if(wrapped.length*bodySize*1.5+16>h)return false;blocks.push({...row,x,y,w,h,size:bodySize,lines:wrapped,boldFirst:/[：:]$/.test(wrapped[0])});return true;};
 if(kind==='cover'||kind==='illustration'){
  let y=bodyTop;for(const row of rows){const h=wrapBody(row.text,688).length*bodySize*1.5+16;if(!add(row,72,y,712,h)||y+h>bottom)return null;y+=h+16;}
  art=`<circle cx="1045" cy="355" r="159" fill="${p.secondary}"/><circle cx="1045" cy="355" r="128" fill="none" stroke="${p.divider}" stroke-width="2"/>`+glyph(slide.title+' '+slide.body,936,246,218,p)+`<rect x="940" y="540" width="210" height="6" fill="${p.accent}"/>`;
 }else if(kind==='bars'){
  const chart=presentationChartRows(slide),max=['%','％'].includes(chart[0].unit)?100:Math.max(...chart.map(row=>row.value)),height=(bottom-bodyTop)/rows.length;
  if(height<bodySize*1.5+34)return null;
  rows.forEach((row,i)=>{const y=bodyTop+i*height;art+=`<rect x="84" y="${y+height-20}" width="1088" height="12" rx="6" fill="${p.secondary}"/>${chart[i].value>0?`<rect x="84" y="${y+height-20}" width="${Number((1088*chart[i].value/max).toFixed(2))}" height="12" rx="6" fill="${i===chart.length-1?p.primary:p.accent}"/>`:''}`;});
  for(const [i,row]of rows.entries())if(!add(row,72,bodyTop+i*height,1136,height-28))return null;
 }else{
  const horizontal=kind==='process'&&rows.length<=4,cols=horizontal?rows.length:kind==='process'?1:rows.length===2?2:rows.length===4?2:3,count=Math.ceil(rows.length/cols),gap=kind==='process'?38:24,w=(1136-gap*(cols-1))/cols,available=(bottom-bodyTop-24*(count-1))/count,desired=horizontal?Math.max(...rows.map(row=>wrapBody(row.text,w-48).length*bodySize*1.5+118)):cols>1?Math.max(...rows.map(row=>wrapBody(row.text,w-48).length*bodySize*1.5+102)):available,h=Math.min(available,Math.max(count===1?270:190,desired)),offset=count===1?Math.max(0,(available-h)/3):0;
  for(const [i,row]of rows.entries()){
   const col=i%cols,r=Math.floor(i/cols),x=72+col*(w+gap),y=bodyTop+offset+r*(h+24),vertical=kind==='process'&&!horizontal;
   art+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${p.secondary}" stroke="${p.divider}" stroke-width="1"/>`;
   const iconSize=vertical?Math.min(48,h-12):horizontal?64:48,ix=x+20,iy=vertical?y+(h-iconSize)/2:y+18;art+=glyph(row.text,ix,iy,iconSize,p);
   const bx=vertical?x+88:x+12,by=vertical?y+4:y+iconSize+30,bw=vertical?w-108:w-24,bh=vertical?h-8:h-iconSize-38;
   if(!add(row,bx,by,bw,bh))return null;
   if(kind==='process'&&horizontal&&i<rows.length-1)art+=arrow(Number((x+w+5).toFixed(2)),Number((y+52).toFixed(2)),Number((x+w+gap-5).toFixed(2)),Number((y+52).toFixed(2)),p);
   if(kind==='process'&&vertical&&i<rows.length-1)art+=`<line x1="112" y1="${y+h}" x2="112" y2="${y+h+18}" stroke="${p.accent}" stroke-width="2"/><polygon points="106,${y+h+15} 112,${y+h+23} 118,${y+h+15}" fill="${p.accent}"/>`;
  }
  if(kind==='architecture')art=`<rect x="60" y="${bodyTop-12}" width="1160" height="${bottom-bodyTop+24}" rx="22" fill="none" stroke="${p.accent}" stroke-width="2"/>`+art;
 }
 blocks.push({id:'page-number',role:'footer',text:page.page+' / '+plan.slides.length,x:1032,y:656,w:176,h:32,size:16,lines:[page.page+' / '+plan.slides.length]});
 return{blocks,decoration:`<g id="visual-${kind}">${art}</g>`,kind};
}
export function presentationVisualRetained(svg,kind){
 if(!kind)return true;
 const doc=new DOMParser().parseFromString(svg,'image/svg+xml'),group=Array.from(doc.getElementsByTagName('g')).find(node=>node.getAttribute('id')==='visual-'+kind);if(!group)return false;
 const visible=Array.from(group.getElementsByTagName('*')).filter(node=>{
  if(!['path','circle','rect','polygon','polyline','ellipse','line'].includes(node.tagName))return false;
  for(let current=node;current?.nodeType===1;current=current.parentNode)if(current.hasAttribute('opacity')&&Number(current.getAttribute('opacity'))<0.5)return false;
  if(node.tagName==='rect'&&(Number(node.getAttribute('width'))<4||Number(node.getAttribute('height'))<4))return false;
  if(node.tagName==='circle'&&Number(node.getAttribute('r'))<2)return false;
  return true;
 });return visible.length>=(kind==='cover'?4:kind==='bars'?3:6);
}
