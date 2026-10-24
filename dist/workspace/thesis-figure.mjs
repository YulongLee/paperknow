// Scientific figures are a deliberately small data format. Model-authored SVG,
// HTML, styles, image URLs and executable chart specifications are never used.
const limits=Object.freeze({nodes:8,edges:12,label:80,title:200,caption:500,figures:128});
const idPattern=/^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const fail=message=>{throw new TypeError(`论文图片结构无效：${message}。`);};
const own=(value,keys,label)=>{if(!value||typeof value!=='object'||Array.isArray(value))fail(`${label}须为对象`);if(Object.keys(value).some(key=>!keys.includes(key)))fail(`${label}包含不支持的字段`);};
function identifier(value,label){if(typeof value!=='string'||!idPattern.test(value))fail(`${label}不符合标识符要求`);return value;}
function text(value,max,label,{optional=false}={}){
 if(optional&&(value===undefined||value===null))return '';
 if(typeof value!=='string')fail(`${label}须为文字`);
 // XML 1.0 control characters, lone surrogates and bidi overrides are not
 // permitted even though the normal text path would escape XML metacharacters.
 if([...value].some(char=>{const n=char.codePointAt(0);return n<32&&!['\n','\r','\t'].includes(char)||n>=0xd800&&n<=0xdfff||n===0xfffe||n===0xffff||n>=0x202a&&n<=0x202e||n>=0x2066&&n<=0x2069;}))fail(`${label}包含不支持的字符`);
 const normalized=value.replace(/\s+/gu,' ').trim();
 if(!normalized&&!optional)fail(`${label}不能为空`);
 if([...normalized].length>max)fail(`${label}过长`);
 if(/<\s*\/?\s*(?:script|svg|img|image|iframe|object|embed|foreignObject)\b|<\s*\/?\s*[a-z!?][^<>]{0,500}>|(?:https?|data|javascript|file|ftp):|\bwww\.|\[(?:source|figure)\s*:/iu.test(normalized))fail(`${label}不能包含网页、链接或正文索引标记`);
 return normalized;
}
export function normalizeThesisFigure(input){
 own(input,['id','title','kind','nodes','edges','caption'],'图片');
 const id=identifier(input.id,'图片编号'),title=text(input.title,limits.title,'图片标题'),caption=text(input.caption,limits.caption,'图片说明',{optional:true});
 if(!['flowchart','concept'].includes(input.kind))fail('仅支持流程图和概念关系图');
 if(!Array.isArray(input.nodes)||input.nodes.length<2||input.nodes.length>limits.nodes)fail('节点数量须为 2 至 8 个');
 if(!Array.isArray(input.edges)||input.edges.length>limits.edges)fail('连接数量不能超过 12 条');
 const ids=new Set(),nodes=input.nodes.map(node=>{own(node,['id','label'],'节点');const nodeId=identifier(node.id,'节点编号');if(ids.has(nodeId))fail('节点编号不能重复');ids.add(nodeId);return {id:nodeId,label:text(node.label,limits.label,'节点文字')};});
 const seen=new Set(),edges=input.edges.map(edge=>{own(edge,['from','to','label'],'连接');const from=identifier(edge.from,'连接起点'),to=identifier(edge.to,'连接终点'),label=text(edge.label,limits.label,'连接文字',{optional:true});if(!ids.has(from)||!ids.has(to))fail('连接引用了不存在的节点');if(from===to)fail('请将自连过程拆为两个节点');const key=JSON.stringify([from,to,label]);if(seen.has(key))fail('连接不能完全重复');seen.add(key);return {from,to,...(label?{label}:{})};});
 return {id,title,kind:input.kind,nodes,edges,caption};
}
export function normalizeThesisFigures(input){
 if(input===undefined||input===null)return [];
 if(!Array.isArray(input)||input.length>limits.figures)fail('图片集合须为不超过 128 张的数组');
 const ids=new Set();return input.map(value=>{const figure=normalizeThesisFigure(value);if(ids.has(figure.id))fail('图片编号不能重复');ids.add(figure.id);return figure;});
}
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function pngCrc(bytes,start,end){let crc=0xffffffff;for(let index=start;index<end;index++)crc=crcTable[(crc^bytes[index])&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export function inspectThesisFigurePng(value){
 const invalid=()=>{throw Error('论文图片不是完整有效的 PNG，已停止导出。');};
 if(!(value instanceof Uint8Array)||value.byteLength<57||value.byteLength>3*1024*1024||![137,80,78,71,13,10,26,10].every((n,index)=>value[index]===n))invalid();
 const view=new DataView(value.buffer,value.byteOffset,value.byteLength);let offset=8,count=0,width=0,height=0,dataBytes=0,dataEnded=false,ended=false;const seen=new Set();
 while(offset<value.byteLength){
  if(++count>256||value.byteLength-offset<12)invalid();const length=view.getUint32(offset);if(length>value.byteLength-offset-12)invalid();const end=offset+12+length,type=String.fromCharCode(...value.slice(offset+4,offset+8));if(!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)||pngCrc(value,offset+4,offset+8+length)!==view.getUint32(offset+8+length))invalid();
  if(count===1&&type!=='IHDR')invalid();
  if(type==='IHDR'){
   if(count!==1||length!==13)invalid();width=view.getUint32(offset+8);height=view.getUint32(offset+12);if(!width||!height||width>4096||height>4096||width*height>12000000)throw Error('论文图片尺寸超出导出范围。');
   if(value[offset+16]!==8||![0,2,4,6].includes(value[offset+17])||value[offset+18]!==0||value[offset+19]!==0||value[offset+20]!==0)invalid();
  }else if(type==='IDAT'){if(dataEnded)invalid();dataBytes+=length;}
  else if(type==='IEND'){if(length!==0||!dataBytes||end!==value.byteLength)invalid();ended=true;}
  else{
   // Canvas emits a static non-palette PNG. Animation, text payloads and
   // arbitrary application chunks are outside this generated-image format.
   const sizes={sRGB:1,gAMA:4,cHRM:32,pHYs:9};if(!Object.hasOwn(sizes,type)||seen.has(type)||length!==sizes[type]||dataBytes)invalid();
  }
  if(type!=='IDAT'&&dataBytes)dataEnded=true;seen.add(type);offset=end;if(ended)break;
 }
 if(!ended||offset!==value.byteLength||!seen.has('IHDR')||!seen.has('IDAT'))invalid();return {width,height};
}
function wrap(value,maxWidth,size){
 const weight=char=>/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}]/u.test(char)?size:/\s/u.test(char)?size*.3:size*.56;
 const measure=value=>[...value].reduce((sum,char)=>sum+weight(char),0),tokens=(value.match(/[A-Za-z0-9_]+|[^A-Za-z0-9_]/gu)||[]).flatMap(token=>measure(token)>maxWidth?[...token]:[token]),opening=/[（([{《「『【]$/,closing=/^[，。！？：；、）》」』】)\]},.!?:;%]/;
 const best=Array(tokens.length+1);best[tokens.length]={cost:0,lines:[]};
 for(let from=tokens.length-1;from>=0;from--){let line='';for(let to=from;to<tokens.length;to++){line+=tokens[to];const clean=line.trim(),width=measure(clean);if(width>maxWidth)break;if(!clean||opening.test(clean)||to+1<tokens.length&&closing.test(tokens[to+1]))continue;const rest=best[to+1];if(!rest)continue;const cost=4*maxWidth*maxWidth+(maxWidth-width)**2*(to===tokens.length-1?.5:1)+rest.cost;if(!best[from]||cost<best[from].cost)best[from]={cost,lines:[clean,...rest.lines]};}}
 // A label consisting solely of punctuation is valid data too.
 if(best[0])return best[0].lines;const lines=[];let line='',width=0;for(const char of value){const next=weight(char);if(line&&width+next>maxWidth){lines.push(line.trim());line='';width=0;}line+=char;width+=next;}if(line)lines.push(line.trim());return lines.length?lines:[''];
}
const textLines=(lines,x,y,{size=22,anchor='middle',step=29,halo=false}={})=>`<text x="${x}" y="${y}" fill="#111111" font-size="${size}" font-weight="400" text-anchor="${anchor}"${halo?' paint-order="stroke" stroke="#ffffff" stroke-width="7" stroke-linejoin="round"':''}>${lines.map((line,index)=>`<tspan x="${x}" dy="${index?step:0}">${escape(line)}</tspan>`).join('')}</text>`;
// Rank by actual dependencies. Only DFS back edges use outside return lanes;
// unrelated nodes and parallel alternatives never become a serpentine sequence.
export function layoutThesisFigure(input){
 const figure=normalizeThesisFigure(input),width=1000,ids=figure.nodes.map(node=>node.id),out=new Map(ids.map(id=>[id,[]])),state=new Map(),feedback=new Set();
 figure.edges.forEach((edge,index)=>out.get(edge.from).push({...edge,index}));
 const visit=id=>{state.set(id,1);for(const edge of out.get(id)){if(state.get(edge.to)===1)feedback.add(edge.index);else if(!state.has(edge.to))visit(edge.to);}state.set(id,2);};
 ids.forEach(id=>{if(!state.has(id))visit(id);});
 const forward=figure.edges.map((edge,index)=>({...edge,index})).filter(edge=>!feedback.has(edge.index)),indegree=new Map(ids.map(id=>[id,0])),rank=new Map(ids.map(id=>[id,0]));
 forward.forEach(edge=>indegree.set(edge.to,indegree.get(edge.to)+1));const queue=ids.filter(id=>!indegree.get(id));
 for(let index=0;index<queue.length;index++){const id=queue[index];for(const edge of out.get(id)){if(feedback.has(edge.index))continue;rank.set(edge.to,Math.max(rank.get(edge.to),rank.get(id)+1));indegree.set(edge.to,indegree.get(edge.to)-1);if(!indegree.get(edge.to))queue.push(edge.to);}}
 const layers=Array.from({length:Math.max(...rank.values())+1},()=>[]);ids.forEach(id=>layers[rank.get(id)].push(id));
 // A bounded barycentre sweep reduces crossings without changing graph edges.
 for(let pass=0;pass<4;pass++)for(const down of [true,false]){const rows=down?layers:layers.slice().reverse(),position=new Map(layers.flatMap(layer=>layer.map((id,index)=>[id,index])));for(const layer of rows){const original=new Map(layer.map((id,index)=>[id,index])),score=id=>{const neighbours=forward.filter(edge=>down?edge.to===id:edge.from===id).map(edge=>position.get(down?edge.from:edge.to));return neighbours.length?neighbours.reduce((sum,n)=>sum+n,0)/neighbours.length:original.get(id);};layer.sort((a,b)=>score(a)-score(b)||original.get(a)-original.get(b));layer.forEach((id,index)=>position.set(id,index));}}
 const rows=layers.flatMap(layer=>Array.from({length:Math.ceil(layer.length/3)},(_,index)=>layer.slice(index*3,index*3+3))),columns=Math.max(...rows.map(row=>row.length)),nodeWidth=columns===3?240:columns===2?300:380,gapX=columns===3?64:90;
 const byId=new Map(figure.nodes.map(node=>{const lines=wrap(node.label,nodeWidth-32,22);return[node.id,{...node,lines,width:nodeWidth,height:Math.max(68,lines.length*29+28)}];}));
 const rowOf=new Map(rows.flatMap((row,index)=>row.map(id=>[id,index]))),labelLines=figure.edges.map(edge=>edge.label?wrap(edge.label,156,18):[]),gaps=rows.map(()=>58);
 figure.edges.forEach((edge,index)=>{if(labelLines[index].length)gaps[rowOf.get(edge.from)]=Math.max(gaps[rowOf.get(edge.from)],labelLines[index].length*24+52);});
 let y=40;const bands=rows.map((row,index)=>{const height=Math.max(...row.map(id=>byId.get(id).height)),span=row.length*nodeWidth+(row.length-1)*gapX,left=(width-span)/2,band={top:y,bottom:y+height,gap:gaps[index]};row.forEach((id,column)=>Object.assign(byId.get(id),{row:index,x:left+column*(nodeWidth+gapX),y:y+(height-byId.get(id).height)/2}));y+=height+gaps[index];return band;});
 const edges=figure.edges.map((edge,index)=>{
  const from=byId.get(edge.from),to=byId.get(edge.to),sourceX=from.x+nodeWidth/2,targetX=to.x+nodeWidth/2,sourceY=from.y+from.height,targetY=to.y,lines=labelLines[index],sameX=sourceX===targetX;
  let points,labelX,labelY;const adjacent=to.row===from.row+1&&!feedback.has(index),middle=(bands[from.row].bottom+bands[to.row]?.top)/2;
  if(adjacent){points=[[sourceX,sourceY],[sourceX,middle],[targetX,middle],[targetX,targetY]];labelX=sameX?sourceX+100:targetX;labelY=middle-(lines.length-1)*12+6;}
  else{const right=sourceX+targetX>width||sourceX+targetX===width&&index%2===0,track=20+index*4,outerX=right?width-track:track,leave=bands[from.row].bottom+12+index%3*7,enter=bands[to.row].top-12-index%3*7;points=[[sourceX,sourceY],[sourceX,leave],[outerX,leave],[outerX,enter],[targetX,enter],[targetX,targetY]];labelX=right?outerX-96:outerX+96;labelY=leave+28;}
  return {...edge,points,labelLines:lines,labelX,labelY,feedback:feedback.has(index)};
 });
 return {figure,width,height:Math.ceil(y),nodes:ids.map(id=>byId.get(id)),edges};
}
export function renderThesisFigureSvg(input){
 const {figure,width,height,nodes,edges}=layoutThesisFigure(input),byId=new Map(nodes.map(node=>[node.id,node])),markerId=`pkfigure-${figure.id}-arrow`,titleId=`pkfigure-${figure.id}-title`,descriptionId=`pkfigure-${figure.id}-desc`;
 const parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId} ${descriptionId}" font-family="Times New Roman, Noto Serif CJK SC, Songti SC, SimSun, serif"><title id="${titleId}">${escape(figure.title)}</title><desc id="${descriptionId}">${escape([figure.caption,...figure.nodes.map(node=>node.label),...figure.edges.map(edge=>`${byId.get(edge.from).label} → ${byId.get(edge.to).label}${edge.label?`：${edge.label}`:''}`)].filter(Boolean).join('；'))}</desc><defs><marker id="${markerId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L8 4 L0 8 Z" fill="#111111"/></marker></defs><rect width="${width}" height="${height}" fill="#ffffff"/>`];
 for(const edge of edges)parts.push(`<polyline points="${edge.points.map(point=>point.join(',')).join(' ')}" fill="none" stroke="#111111" stroke-width="1.5" stroke-linejoin="miter" marker-end="url(#${markerId})"/>`);
 for(const node of nodes)parts.push(`<g data-node-id="${node.id}"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="#ffffff" stroke="#111111" stroke-width="1.5"/>${textLines(node.lines,node.x+node.width/2,node.y+(node.height-node.lines.length*29)/2+22)}</g>`);
 for(const edge of edges)if(edge.labelLines.length)parts.push(textLines(edge.labelLines,edge.labelX,edge.labelY,{size:18,step:24,halo:true}));
 parts.push('</svg>');return {svg:parts.join(''),width,height,figure};
}
export async function rasterizeThesisFigure(input){
 const {svg,width,height}=renderThesisFigureSvg(input);
 if(typeof document==='undefined'||typeof Image==='undefined'||typeof URL?.createObjectURL!=='function')throw Error('当前环境无法生成论文图片，请在浏览器中重新导出。');
 const scale=Math.min(2,4096/width,4096/height,Math.sqrt(12000000/(width*height))),canvas=document.createElement('canvas');canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);const context=canvas.getContext('2d');if(!context)throw Error('浏览器暂时无法绘制论文图片，请刷新后重试。');
 const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));let timer;
 try{
  const image=new Image();await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('论文图片生成超时，请刷新后重试。')),15000);image.onload=resolve;image.onerror=()=>reject(Error('论文图片生成失败，请刷新后重试。'));image.src=url;});clearTimeout(timer);
  context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('论文图片保存失败，请刷新后重试。')),'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
 }finally{clearTimeout(timer);URL.revokeObjectURL(url);canvas.width=0;canvas.height=0;}
}
