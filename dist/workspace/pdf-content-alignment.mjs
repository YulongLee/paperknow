// Align the existing PDF text locally. No translation/model request or billing.
// Page count alone is never evidence that two paragraphs correspond.
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number(v)||0));
const normalize=text=>String(text||'').normalize('NFKC').replace(/\s+/g,' ').trim();
const names=[['abstract',/^(?:abstract|摘要|摘\s*要)$/i],['references',/^(?:references|bibliography|参考文献)$/i],['acknowledgments',/^(?:acknowledg(?:e)?ments?|致谢)$/i]];
function heading(text){
 const value=normalize(text).replace(/[：:]$/,'');
 for(const [name,re]of names)if(re.test(value))return name;
 const match=value.match(/^(\d{1,2}(?:\.\d{1,2}){0,4})[.、．]?\s+[^\d\s].{1,100}$/);return match?'section:'+match[1]:null;
}
export function pdfTextLines(content,viewport,page){
 const lines=[];let line=null;
 for(const item of content.items||[]){
  if(typeof item.str!=='string'||!item.str.trim()||!Array.isArray(item.transform)||Math.abs(item.transform[1])>Math.abs(item.transform[0])*2)continue;
  const [left,baseline]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]),height=Math.max(1,Math.abs(item.height||item.transform[3]||10)),x=clamp(left/viewport.width),y=clamp((baseline-height)/viewport.height),h=height/viewport.height,w=Math.max(0,(item.width||0)/viewport.width),text=normalize(item.str);
  if(/^\d{1,3}$/.test(text)&&(y>.92||y<.025))continue;
  if(line&&Math.abs(line.y-y)<Math.max(h,line.h)*.6&&x>=line.right-.015&&x-line.right<.08){line.text+=(/\s$/.test(line.text)||/^[,.;:!?，。；：！？)]/.test(text)?'':' ')+text;line.right=Math.max(line.right,x+w);line.h=Math.max(h,line.h);}
  else{line={page,x,y,h,right:clamp(x+w),text};lines.push(line);}
  // Font runs may report EOL before another run on the same visual line.
  // Geometry, rather than that flag, determines whether the line continues.
 }
 return lines;
}
export function pdfTextSegments(lines){
 const segments=[];let paragraph=null,previous=null,total=0;const repeated=new Map();for(const line of lines||[]){if(line.y<.12||line.y>.9){const text=normalize(line.text);if(text.length<200){const pages=repeated.get(text)||new Set();pages.add(line.page);repeated.set(text,pages);}}}
 function finish(){
  if(!paragraph)return;const text=paragraph.text,spans=[];let start=0;
  if(heading(text.trim()))spans.push([0,text.length]);else{for(let i=0;i<text.length;i++){const c=text[i],tail=text.slice(i+1);if(/[。！？!?]/.test(c)||c==='.'&&/^\s+[A-Z\u3400-\u9fff]/.test(tail)&&/[a-z]{2,}\.$/i.test(text.slice(Math.max(start,i-30),i+1))){spans.push([start,i+1]);start=i+1;}}if(start<text.length)spans.push([start,text.length]);}
  for(let [from,to]of spans){while(from<to&&/\s/.test(text[from]))from++;while(to>from&&/\s/.test(text[to-1]))to--;if(to-from<2)continue;const before=[...paragraph.points].reverse().find(p=>p.offset<=from)||paragraph.points[0],points=[{...before,offset:0},...paragraph.points.filter(p=>p.offset>from&&p.offset<to).map(p=>({...p,offset:p.offset-from}))],value=text.slice(from,to);segments.push({text:value,points,length:Math.max(1,value.replace(/\s/g,'').length),heading:heading(value)});}
  paragraph=null;
 }
 for(const line of lines||[]){
  const text=normalize(line.text);if((line.y<.12||line.y>.9)&&repeated.get(text)?.size>=2)continue;if(!text||total>1500000||segments.length>=6000)continue;total+=text.length;
  const special=heading(text)||/^(?:figure|fig\.?|table|图|表)\s*\d+/i.test(text),separate=previous&&(line.page===previous.page&&(Math.abs(line.x-previous.x)>.12||line.y-previous.y>Math.max(line.h,previous.h)*2.2)||line.page!==previous.page&&/[.!?。！？]\s*$/.test(previous.text));
  if(special||separate)finish();if(!paragraph)paragraph={text:'',points:[]};
  const offset=paragraph.text.length+(paragraph.text?1:0);paragraph.points.push({page:line.page,x:line.x,y:line.y,h:line.h,offset});paragraph.text+=(paragraph.text?' ':'')+text;previous=line;
  // Sentence ends provide useful boundaries even when translated line wrapping
  // differs. Decimal points and list labels are kept inside a sentence.
  if(special||/[.!?。！？][”’"')\]]?\s*$/.test(text)||paragraph.text.length>1800)finish();
 }
 finish();return segments;
}
function signatures(segment){
 const text=normalize(segment.text),keys=[];if(segment.heading)keys.push(['heading:'+segment.heading,12]);
 for(const m of text.matchAll(/(?:figure|fig\.?|图)\s*(\d+(?:\.\d+)*)|(?:table|表)\s*(\d+(?:\.\d+)*)/gi))keys.push([(m[1]?'figure:':'table:')+(m[1]||m[2]),8]);
 for(const m of text.matchAll(/\b(?:[A-Z][a-z]+[A-Z][A-Za-z0-9-]*|[A-Z]{2,}[A-Za-z0-9-]*|\d+\.\d{1,5}|10\.\d{4,9}\/[^\s]+)\b/g))keys.push(['token:'+m[0].toLowerCase(),3]);
 if(text.length>15&&text.length<300)keys.push(['exact:'+text.toLowerCase().replace(/\s/g,''),10]);
 return [...new Map(keys.map(([key,weight])=>[key,weight])).entries()];
}
function structuralAnchors(source,target){
 const index=list=>{const map=new Map();list.forEach((segment,i)=>{for(const [key,weight]of signatures(segment)){const value=map.get(key)||{indices:[],weight};value.indices.push(i);map.set(key,value);}});return map;},a=index(source),b=index(target),pairs=new Map();
 for(const [key,value]of a){const other=b.get(key);if(value.indices.length!==1||other?.indices.length!==1)continue;const i=value.indices[0],j=other.indices[0],id=i+':'+j,pair=pairs.get(id)||{i,j,weight:0};pair.weight+=value.weight;pairs.set(id,pair);}
 const candidates=[...pairs.values()].sort((a,b)=>b.weight-a.weight).slice(0,1000).sort((a,b)=>a.i-b.i||a.j-b.j),scores=[],prev=[];let best=-1;
 // A weighted monotone chain rejects repeated captions, reordered headers and
 // isolated false number matches instead of dragging the reader backwards.
 for(let n=0;n<candidates.length;n++){scores[n]=candidates[n].weight;prev[n]=-1;for(let k=0;k<n;k++)if(candidates[k].i<candidates[n].i&&candidates[k].j<candidates[n].j&&scores[k]+candidates[n].weight>scores[n]){scores[n]=scores[k]+candidates[n].weight;prev[n]=k;}if(best<0||scores[n]>scores[best])best=n;}
 const selected=[];while(best>=0){selected.push(candidates[best]);best=prev[best];}return selected.reverse();
}
function paragraphPairs(source,target,a0,a1,b0,b1){
 const n=a1-a0,m=b1-b0;if(!n||!m)return[];
 if(n*m>160000)return[]; // Avoid long main-thread stalls on unstructured scans.
 const ratio=target.slice(b0,b1).reduce((v,p)=>v+p.length,0)/Math.max(1,source.slice(a0,a1).reduce((v,p)=>v+p.length,0)),cols=m+1,cost=new Float64Array((n+1)*cols).fill(Infinity),trace=new Uint8Array(cost.length);cost[0]=0;
 const transitions=[[1,1,1],[1,2,2],[2,1,3],[1,0,4],[0,1,5],[1,3,6],[3,1,7],[2,2,8]];
 for(let i=0;i<=n;i++)for(let j=0;j<=m;j++){
  const at=i*cols+j;if(!Number.isFinite(cost[at]))continue;
  for(const [di,dj,kind]of transitions){if(i+di>n||j+dj>m)continue;let delta=3;
   if(di&&dj){let sl=0,tl=0;for(let x=0;x<di;x++)sl+=source[a0+i+x].length;for(let y=0;y<dj;y++)tl+=target[b0+j+y].length;delta=Math.abs(Math.log((tl+8)/(sl*ratio+8)))*2+(di+dj-2)*.65;}
   const next=(i+di)*cols+j+dj;if(cost[at]+delta<cost[next]){cost[next]=cost[at]+delta;trace[next]=kind;}
  }
 }
 const pairs=[];let i=n,j=m;while(i||j){const step=transitions.find(t=>t[2]===trace[i*cols+j]);if(!step)break;const [di,dj]=step;if(di&&dj)pairs.push({a:source.slice(a0+i-di,a0+i),b:target.slice(b0+j-dj,b0+j),strong:false});i-=di;j-=dj;}return pairs.reverse();
}
function groupPoints(segments){let offset=0;const points=[];for(const segment of segments){for(const point of segment.points)points.push({...point,offset:offset+point.offset});offset+=segment.text.length+1;}return{points,length:Math.max(1,offset)};}
export function createPdfContentAlignment(sourceLines,targetLines){
 const source=pdfTextSegments(sourceLines),target=pdfTextSegments(targetLines);if(!source.length||!target.length)return{mode:'approximate',pairs:[],map:()=>null};
 const anchors=structuralAnchors(source,target),paired=[];let ai=0,bi=0;
 for(const anchor of anchors){paired.push(...paragraphPairs(source,target,ai,anchor.i,bi,anchor.j),{a:[source[anchor.i]],b:[target[anchor.j]],strong:true});ai=anchor.i+1;bi=anchor.j+1;}
 // Without a reliable structural anchor, a length-only match is too weak to
 // claim corresponding content (e.g. unrelated or image-only PDFs).
 if(anchors.length)paired.push(...paragraphPairs(source,target,ai,source.length,bi,target.length));
 const pairs=paired.map(pair=>({...pair,a:groupPoints(pair.a),b:groupPoints(pair.b)})),lookup={a:new Map(),b:new Map()};for(const pair of pairs)for(const side of ['a','b'])pair[side].points.forEach((point,index)=>{const list=lookup[side].get(point.page)||[];list.push({pair,index,point});lookup[side].set(point.page,list);});
 function map(view,direction='forward'){
  const from=direction==='reverse'?'b':'a',to=from==='a'?'b':'a',page=Number(view.page)||1,y=clamp(view.fraction),x=Number.isFinite(view.readingX)?view.readingX:.2;let found=null;
  for(const {pair,index,point}of lookup[from].get(page)||[]){const dy=y-point.y,score=Math.abs(dy)+(dy<-.015?.04:0)+Math.abs(x-point.x)*.25;if(!found||score<found.score)found={pair,index,point,score};}
  if(!found||found.score>.28)return null;const group=found.pair[from],other=found.pair[to],point=found.point,next=group.points[found.index+1];let offset=point.offset,residual=y-point.y;
  if(next&&next.page===point.page&&Math.abs(next.x-point.x)<.15&&next.y>point.y&&y>=point.y&&y<=next.y){offset+=clamp((y-point.y)/(next.y-point.y))*(next.offset-point.offset);residual=0;}
  const wanted=offset/group.length*other.length;let index=0;while(index+1<other.points.length&&other.points[index+1].offset<=wanted)index++;
  const position=other.points[index],after=other.points[index+1];let fraction=position.y;
  if(after&&after.page===position.page&&Math.abs(after.x-position.x)<.15&&after.y>position.y)fraction+=clamp((wanted-position.offset)/Math.max(1,after.offset-position.offset))*(after.y-position.y);
  return{...view,page:position.page,fraction:clamp(fraction+(Number.isFinite(view.pageHeight)?0:residual)),anchorGap:Number.isFinite(view.pageHeight)?residual*view.pageHeight+(Number(view.pageOffset)||0):0,readingX:position.x,pageCount:undefined};
 }
 return{mode:anchors.length&&pairs.length?'content':'approximate',anchors:anchors.length,pairs,map};
}
