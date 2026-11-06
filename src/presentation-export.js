import pptxgen from 'pptxgenjs';
import {themes,validateDeck} from '../dist/workspace/presentation-model.mjs';
import {presentationTemplateStyle} from '../dist/workspace/presentation-design-system.mjs';

// Base export uses native PowerPoint text and shapes, so edits remain possible.
// A generated PPTX is saved separately; this is the editable editor's layout.
export function createPresentation(deck,coverData=null){
 validateDeck(deck);const pptx=new pptxgen();pptx.layout='LAYOUT_WIDE';pptx.author=deck.author||'PaperKnow 用户';pptx.subject='用户核对后的学术演示';pptx.title=deck.title;pptx.lang=deck.language==='英文'?'en-US':'zh-CN';pptx.theme={headFontFace:'Microsoft YaHei',bodyFontFace:'Microsoft YaHei',lang:pptx.lang};
 const style=presentationTemplateStyle(deck.theme),p=Object.fromEntries(Object.entries(style.palette).map(([k,v])=>[k,v.slice(1)])),hex=v=>v.slice(1),family=style.family;
 for(const [i,s]of deck.slides.entries()){
  const slide=pptx.addSlide(),cover=s.layout==='cover',closing=s.layout==='closing',text=cover?hex(style.coverText):p.text,muted=cover?hex(style.coverMuted):p.muted;
  slide.background={color:cover?hex(style.coverSurface):p.background};
  const shape=(type,x,y,w,h,fill,line='none',extra={})=>slide.addShape(type,{x,y,w,h,line:line==='none'?{color:fill==='none'?p.background:fill,transparency:100}:{color:line,width:.8},fill:fill==='none'?{color:p.background,transparency:100}:{color:fill},...extra});
  if(cover){
   if(coverData){slide.addImage({data:coverData,x:0,y:0,w:13.333333,h:7.5});shape(pptx.ShapeType.rect,0,0,style.coverTextWidth/96,7.5,hex(style.coverSurface),'none',{fill:{color:hex(style.coverSurface),transparency:100-style.coverOverlay*100}});}
   else shape(pptx.ShapeType.rect,9.2,1.65,3.3,3.9,p.secondary);
   shape(pptx.ShapeType.rect,.875,.54,.833,.052,p.accent);
  }else if(family==='academic')shape(pptx.ShapeType.rect,.54,.54,.042,.48,p.accent);
  else if(family==='technology'){shape(pptx.ShapeType.rect,.75,.27,1.67,.042,p.accent);shape(pptx.ShapeType.line,11.14,.27,1.44,0,'none',p.divider);}
  else if(family==='report'){shape(pptx.ShapeType.rect,0,0,.208,7.5,p.accent);shape(pptx.ShapeType.rect,.75,.27,.584,.042,p.accent);}
  else{shape(pptx.ShapeType.rect,.3125,.25,12.708,7,'none',p.divider);shape(pptx.ShapeType.line,.875,.3125,1.313,0,'none',p.accent);}
  slide.addText('PaperKnow · '+deck.scenario,{x:.875,y:.42,w:7,h:.25,fontSize:10,color:muted,margin:0,fit:'shrink'});
  const titleY=cover?1.3:closing?1.1:.65,titleH=cover?1.72:closing?1.4:1.05;
  slide.addText(s.title,{x:.875,y:titleY,w:cover?7.4:11.5,h:titleH,fontSize:cover?34:closing?32:27,bold:true,color:text,fit:'shrink',margin:0,valign:'mid'});
  const opts={fontSize:cover||closing?20:18,color:text,fit:'shrink',paraSpaceAfterPt:14,margin:0,valign:'top'},rows=s.body.split('\n').filter(t=>t.trim()),top=cover?3.4:closing?3.0:2.05;
  if(cover||closing){
   slide.addText(s.body,{...opts,x:.875,y:top,w:cover?7.4:10.4,h:cover?2.65:2.8});
   if(closing)shape(pptx.ShapeType.line,.875,top-.28,2.5,0,'none',p.accent);
  }else if(/目录|汇报结构|报告结构|agenda|contents/i.test(s.title)){
   const h=4.3/Math.max(1,rows.length);rows.forEach((row,j)=>{const y=top+j*h;shape(pptx.ShapeType.rect,.875,y+.14,.06,.06,p.accent);slide.addText(row,{...opts,x:1.13,y,w:11.1,h:h-.18});shape(pptx.ShapeType.line,1.13,y+h-.12,11.1,0,'none',p.divider);});
  }else{
   const measure=rows.map(row=>row.match(/^([^：:\n]{1,40})[：:]\s*(\d+(?:\.\d+)?)\s*(%|％|ms|s|秒|毫秒|个|次|人|MB|GB|分|分数)(?:\s*\[\d+\])?$/u));
   const chart=rows.length>=2&&rows.length<=6&&measure.every(Boolean)&&new Set(measure.map(m=>m?.[3].replace('％','%'))).size===1&&measure.some(m=>Number(m[2])>0)&&(!['%','％'].includes(measure[0]?.[3])||measure.every(m=>Number(m[2])<=100));
   if(chart){const max=['%','％'].includes(measure[0][3])?100:Math.max(...measure.map(m=>Number(m[2]))),h=4.25/rows.length;rows.forEach((row,j)=>{const y=top+j*h;slide.addText(row,{...opts,x:.875,y,w:11.4,h:h-.3});shape(pptx.ShapeType.rect,.875,y+h-.25,11.4,.12,p.secondary);const width=11.4*Number(measure[j][2])/max;if(width>0)shape(pptx.ShapeType.rect,.875,y+h-.25,width,.12,p.accent);});}
   else if(rows.length>=2&&rows.length<=6){
    const process=/流程|步骤|技术路线|工作流|pipeline|workflow|steps|procedure/i.test(s.title),comparison=s.layout==='twoColumn'||/对比|比较|差异|优势|contrast|compar|versus/i.test(s.title),cols=process?1:comparison?2:rows.length===4?2:Math.min(rows.length,3),n=Math.ceil(rows.length/cols),gap=.3,w=(11.6-gap*(cols-1))/cols,h=(4.3-.22*(n-1))/n;
    rows.forEach((row,j)=>{const x=.875+(j%cols)*(w+gap),y=top+Math.floor(j/cols)*(h+.22);if(process)shape(style.cardRadius?pptx.ShapeType.roundRect:pptx.ShapeType.rect,x,y,w,h,p.secondary,p.divider);else if(comparison&&j%cols)shape(pptx.ShapeType.line,x-.15,y,0,h,'none',p.divider);shape(pptx.ShapeType.rect,x+.1,y+.13,.34,.035,p.accent);slide.addText(row,{...opts,x:x+.12,y:y+.36,w:w-.24,h:h-.5});if(!process)shape(pptx.ShapeType.line,x+.1,y+h-.08,w-.2,0,'none',p.divider);if(process&&j<rows.length-1)shape(pptx.ShapeType.downArrow,x+w/2-.04,y+h+.02,.08,.16,p.accent);});
   }else slide.addText(s.body,{...opts,x:.875,y:top,w:11.5,h:4.3});
  }
  if(cover&&deck.author)slide.addText('作者：'+deck.author,{x:.875,y:6.38,w:7.4,h:.34,fontSize:13,color:muted,fit:'shrink',margin:0});
  shape(pptx.ShapeType.line,.875,6.67,11.7,0,'none',p.divider);
  slide.addText(`${String(i+1).padStart(2,'0')} / ${String(deck.slides.length).padStart(2,'0')}`,{x:11.55,y:7,w:1,h:.22,fontSize:10,color:muted,align:'right',margin:0});
  if(s.notes)slide.addNotes(s.notes);
 }
 return pptx;
}
export async function exportPresentation(deck){
 let coverData=null;
 if(typeof window!=='undefined'&&Object.hasOwn(themes,deck.theme)){
  const response=await fetch('/workspace/assets/ppt-templates/'+encodeURIComponent(deck.theme)+'.png');
  if(!response.ok)throw Error('模板图片加载失败，请稍后重试');
  const blob=await response.blob();
  if(blob.size>4*1024*1024||blob.type!=='image/png')throw Error('模板图片无法读取，请稍后重试');
  coverData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('模板图片无法读取，请稍后重试'));reader.readAsDataURL(blob);});
 }
 return createPresentation(deck,coverData).write({outputType:'uint8array',compression:true});
}
