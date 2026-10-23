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
 const lines=[];let line='',width=0;
 for(const char of value){const weight=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}]/u.test(char)?size:/\s/u.test(char)?size*.3:size*.58;if(line&&width+weight>maxWidth){lines.push(line.trim());line='';width=0;}line+=char;width+=weight;}
 if(line)lines.push(line.trim());return lines.length?lines:[''];
}
const textLines=(lines,x,y,{size=17,color='#203659',weight=400,anchor='middle',step=size*1.4}={})=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${lines.map((line,index)=>`<tspan x="${x}" dy="${index?step:0}">${escape(line)}</tspan>`).join('')}</text>`;
export function renderThesisFigureSvg(input){
 const figure=normalizeThesisFigure(input),width=1000,columns=Math.min(3,figure.nodes.length),nodeWidth=250,gap=76,left=(width-(columns*nodeWidth+(columns-1)*gap))/2;
 const nodeLines=figure.nodes.map(node=>wrap(node.label,nodeWidth-38,18)),nodeHeight=Math.max(102,...nodeLines.map(lines=>lines.length*25+38)),rows=Math.ceil(figure.nodes.length/columns),rowGap=84;
 const titleLines=wrap(figure.title,width-100,24),top=48+titleLines.length*33+84,graphBottom=top+rows*nodeHeight+(rows-1)*rowGap;
 const positioned=figure.nodes.map((node,index)=>{const row=Math.floor(index/columns),position=index%columns,column=figure.kind==='flowchart'&&row%2?columns-1-position:position;return {...node,lines:nodeLines[index],row,column,x:left+column*(nodeWidth+gap),y:top+row*(nodeHeight+rowGap)};}),byId=new Map(positioned.map(node=>[node.id,node]));
 const labelled=figure.edges.map((edge,index)=>({...edge,index:index+1})).filter(edge=>edge.label),legendWidth=(width-136)/2,legendRows=[];for(let index=0;index<labelled.length;index+=2){const pair=labelled.slice(index,index+2).map(edge=>({...edge,lines:wrap(`${edge.index}. ${edge.label}`,legendWidth-24,16)}));legendRows.push(pair);}
 const legendHeight=legendRows.reduce((sum,pair)=>sum+Math.max(...pair.map(edge=>edge.lines.length))*23+16,0),height=Math.ceil(graphBottom+44+(labelled.length?legendHeight+30:0));
 const markerId=`pkfigure-${figure.id}-arrow`,titleId=`pkfigure-${figure.id}-title`,descriptionId=`pkfigure-${figure.id}-desc`,parts=[];
 parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId} ${descriptionId}" font-family="Noto Sans CJK SC, Microsoft YaHei, PingFang SC, Arial, sans-serif"><title id="${titleId}">${escape(figure.title)}</title><desc id="${descriptionId}">${escape([figure.caption,...figure.nodes.map(node=>node.label),...figure.edges.map(edge=>`${byId.get(edge.from).label} → ${byId.get(edge.to).label}${edge.label?`：${edge.label}`:''}`)].filter(Boolean).join('；'))}</desc><defs><marker id="${markerId}" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L9 4.5 L0 9 Z" fill="#55779e"/></marker></defs><rect width="${width}" height="${height}" fill="#ffffff"/>`);
 parts.push(textLines(titleLines,width/2,41,{size:24,weight:600,step:33}));
 for(const [index,edge]of figure.edges.entries()){
  const from=byId.get(edge.from),to=byId.get(edge.to),forward=to.column>from.column||to.column===from.column&&to.row>from.row,sourceX=forward?from.x+nodeWidth:from.x,targetX=forward?to.x:to.x+nodeWidth,sourceY=from.y+nodeHeight/2,targetY=to.y+nodeHeight/2,side=forward?1:-1,track=16+(index%3)*9,outX=sourceX+side*track,inX=targetX-side*track;
  let points,labelX,labelY;
  if(from.row===to.row&&Math.abs(from.column-to.column)===1){points=`${sourceX},${sourceY} ${targetX},${targetY}`;labelX=(sourceX+targetX)/2;labelY=sourceY-13;}
  else if(from.column===to.column){const x=Math.min(width-18,Math.max(18,from.x+nodeWidth+track));points=`${from.x+nodeWidth},${sourceY} ${x},${sourceY} ${x},${targetY} ${to.x+nodeWidth},${targetY}`;labelX=x;labelY=(sourceY+targetY)/2-8;}
  else{const channel=from.row<to.row?to.y-24-(index%3)*13:from.y-24-(index%3)*13;points=`${sourceX},${sourceY} ${outX},${sourceY} ${outX},${channel} ${inX},${channel} ${inX},${targetY} ${targetX},${targetY}`;labelX=(outX+inX)/2;labelY=channel-8;}
  parts.push(`<polyline points="${points}" fill="none" stroke="#55779e" stroke-width="2" stroke-linejoin="round" marker-end="url(#${markerId})"/>`);
  if(edge.label)parts.push(`<circle cx="${labelX}" cy="${labelY-5}" r="12" fill="#ffffff" stroke="#d5e0ed"/>${textLines([String(index+1)],labelX,labelY,{size:13,color:'#315781',weight:600})}`);
 }
 for(const [index,node]of positioned.entries()){const highlight=figure.kind==='concept'?index===0:index===0||index===positioned.length-1;parts.push(`<rect x="${node.x}" y="${node.y}" width="${nodeWidth}" height="${nodeHeight}" rx="${figure.kind==='concept'?18:10}" fill="${highlight?'#edf4fc':'#ffffff'}" stroke="${highlight?'#6b91bd':'#a7bbd1'}" stroke-width="2"/>`);parts.push(textLines(node.lines,node.x+nodeWidth/2,node.y+nodeHeight/2-(node.lines.length-1)*12.5+6,{size:18,weight:highlight?600:400,step:25}));}
 if(labelled.length){let y=graphBottom+40;parts.push(`<line x1="60" y1="${y-12}" x2="940" y2="${y-12}" stroke="#e3eaf3"/>`);for(const pair of legendRows){for(const [column,edge]of pair.entries())parts.push(textLines(edge.lines,68+column*(legendWidth+24),y+15,{size:16,anchor:'start',step:23}));y+=Math.max(...pair.map(edge=>edge.lines.length))*23+16;}}
 parts.push('</svg>');return {svg:parts.join(''),width,height,figure};
}
export async function rasterizeThesisFigure(input){
 const {svg,width,height}=renderThesisFigureSvg(input);
 if(typeof document==='undefined'||typeof Image==='undefined'||typeof URL?.createObjectURL!=='function')throw Error('当前环境无法生成论文图片，请在浏览器中重新导出。');
 const scale=Math.min(1.5,4096/width,4096/height),canvas=document.createElement('canvas');canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);const context=canvas.getContext('2d');if(!context)throw Error('浏览器暂时无法绘制论文图片，请刷新后重试。');
 const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));let timer;
 try{
  const image=new Image();await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('论文图片生成超时，请刷新后重试。')),15000);image.onload=resolve;image.onerror=()=>reject(Error('论文图片生成失败，请刷新后重试。'));image.src=url;});clearTimeout(timer);
  context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('论文图片保存失败，请刷新后重试。')),'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
 }finally{clearTimeout(timer);URL.revokeObjectURL(url);canvas.width=0;canvas.height=0;}
}
