export const thesisFigureKinds=Object.freeze(['flowchart','concept','architecture','comparison','bar','line','scatter']);
export const thesisChartKinds=Object.freeze(['bar','line','scatter']);

export function normalizeThesisChart(data,kind,{own,text,fail}){
 own(data,['xLabel','yLabel','unit','series'],'统计图数据');
 const xLabel=text(data.xLabel,60,'横轴标题'),yLabel=text(data.yLabel,60,'纵轴标题'),unit=text(data.unit,30,'数据单位',{optional:true});
 if(!Array.isArray(data.series)||!data.series.length||data.series.length>3)fail('统计图须有 1～3 组数据');
 let count=0;const names=new Set(),categories=new Set();
 const series=data.series.map(row=>{
  own(row,['name','points'],'数据组');const name=text(row.name,40,'数据组名称');if(names.has(name))fail('数据组名称不能重复');names.add(name);
  if(!Array.isArray(row.points)||!row.points.length||row.points.length>24)fail('每组须有 1～24 个数据点');
  const seen=new Set(),points=row.points.map(point=>{
   own(point,['x','y','sourceId','quote'],'数据点');count++;
   const number=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e12;
   if(!number(point.y))fail('统计图数值须为有限数字');
   if(kind==='scatter'&&!number(point.x))fail('散点图横坐标须为有限数字');
   const x=typeof point.x==='string'?text(point.x,30,'横坐标'):number(point.x)?point.x:fail('横坐标格式无效');
   const key=String(x);if(seen.has(key)&&kind!=='scatter')fail('同一数据组的横坐标不能重复');seen.add(key);categories.add(key);
   if(typeof point.sourceId!=='string'||!point.sourceId.trim()||point.sourceId.length>100||/[\u0000-\u001f<>]/.test(point.sourceId))fail('每个统计图数据点须关联已提供的资料');
   if(typeof point.quote!=='string'||point.quote.trim().length<4||point.quote.length>160||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(point.quote))fail('每个数据点须有 4～160 字符的原始记录摘录');
   return {x,y:point.y,sourceId:point.sourceId,quote:point.quote.trim()};
  });return {name,points};
 });
 if(count>24||kind!=='scatter'&&categories.size>12)fail('单张统计图最多 24 个数据点、12 个类别，请保留核心指标');
 const result={xLabel,yLabel,unit,series};if(JSON.stringify(result).length>5500)fail('单张统计图的数据依据过长，请缩短逐点摘录');
 return result;
}

const center=node=>[node.x+node.width/2,node.y+node.height/2];
function endpoint(node,towards){const [x,y]=center(node),dx=towards[0]-x,dy=towards[1]-y,k=Math.min(dx?node.width/2/Math.abs(dx):Infinity,dy?node.height/2/Math.abs(dy):Infinity);return[x+dx*k,y+dy*k];}
function connection(a,b,nodes,width,height){
 const xs=[...new Set([12,width-12,a[0],b[0],...nodes.flatMap(n=>[n.x-14,n.x+n.width+14])].filter(x=>x>=0&&x<=width))].sort((x,y)=>x-y),ys=[...new Set([12,height-12,a[1],b[1],...nodes.flatMap(n=>[n.y-14,n.y+n.height+14])].filter(y=>y>=0&&y<=height))].sort((x,y)=>x-y),key=(x,y)=>x+'|'+y;
 const inside=(x,y)=>nodes.some(n=>x>n.x+.001&&x<n.x+n.width-.001&&y>n.y+.001&&y<n.y+n.height-.001),clear=(p,q)=>!nodes.some(n=>p[1]===q[1]?p[1]>n.y+.001&&p[1]<n.y+n.height-.001&&Math.max(p[0],q[0])>n.x+.001&&Math.min(p[0],q[0])<n.x+n.width-.001:p[0]>n.x+.001&&p[0]<n.x+n.width-.001&&Math.max(p[1],q[1])>n.y+.001&&Math.min(p[1],q[1])<n.y+n.height-.001);
 const start=key(...a),target=key(...b),distance=new Map([[start,0]]),previous=new Map(),open=[a],seen=new Set();
 while(open.length){open.sort((p,q)=>distance.get(key(...p))-distance.get(key(...q)));const point=open.shift(),id=key(...point);if(seen.has(id))continue;seen.add(id);if(id===target)break;const xi=xs.indexOf(point[0]),yi=ys.indexOf(point[1]);
  for(const next of [[xs[xi-1],point[1]],[xs[xi+1],point[1]],[point[0],ys[yi-1]],[point[0],ys[yi+1]]]){if(next.some(value=>value===undefined)||inside(...next)||!clear(point,next))continue;const nextId=key(...next),cost=distance.get(id)+Math.abs(next[0]-point[0])+Math.abs(next[1]-point[1]);if(cost<(distance.get(nextId)??Infinity)){distance.set(nextId,cost);previous.set(nextId,point);open.push(next);}}
 }
 if(!distance.has(target))throw Error('插图节点过密，无法清晰连接，请缩短节点文字或减少关系。');
 const points=[b];while(key(...points[0])!==start)points.unshift(previous.get(key(...points[0])));
 return points.filter((point,i)=>i===0||i===points.length-1||!(points[i-1][0]===point[0]&&point[0]===points[i+1][0]||points[i-1][1]===point[1]&&point[1]===points[i+1][1]));
}
export function richThesisGraphLayout(figure,wrap){
 if(!['concept','architecture','comparison'].includes(figure.kind))return null;
 const width=1000,frames=[],nodes=[];let height;
 if(figure.kind==='concept'){
  height=1100;const cx=500,cy=550;
  figure.nodes.forEach((row,index)=>{const lines=wrap(row.label,196,18),w=index?220:240,h=Math.max(74,lines.length*24+30),angle=-Math.PI/2+(index-1)*2*Math.PI/(figure.nodes.length-1),x=index?cx+330*Math.cos(angle):cx,y=index?cy+385*Math.sin(angle):cy;nodes.push({...row,lines,x:x-w/2,y:y-h/2,width:w,height:h,fontSize:18,lineStep:24});});
 }else if(figure.kind==='comparison'){
  const columns=Math.min(3,figure.nodes.length),rows=Math.ceil(figure.nodes.length/columns),w=(900-(columns-1)*28)/columns;
  const prepared=figure.nodes.map(row=>({...row,lines:wrap(row.label,w-36,21),detailLines:(row.details||[]).flatMap(value=>wrap('• '+value,w-36,18))}));
  const rowHeights=Array.from({length:rows},(_,i)=>Math.max(...prepared.slice(i*columns,(i+1)*columns).map(row=>row.lines.length*27+row.detailLines.length*25+70)));let y=40;
  for(let r=0;r<rows;r++){prepared.slice(r*columns,(r+1)*columns).forEach((row,c)=>nodes.push({...row,x:50+c*(w+28),y,width:w,height:rowHeights[r],fontSize:21,lineStep:27}));y+=rowHeights[r]+30;}height=y+10;
 }else{
  const groups=new Map();for(const row of figure.nodes){const label=row.group||'系统组成';if(!groups.has(label))groups.set(label,[]);groups.get(label).push(row);}
  let y=25;for(const [label,members]of groups){const top=y,columns=Math.min(3,members.length),w=(840-(columns-1)*28)/columns;const heading=wrap(label,830,19);y+=heading.length*24+32;
   for(let start=0;start<members.length;start+=columns){const batch=members.slice(start,start+columns).map(row=>({...row,lines:wrap(row.label,w-30,20)})),h=Math.max(76,...batch.map(row=>row.lines.length*26+30));batch.forEach((row,c)=>nodes.push({...row,x:80+c*(w+28),y,width:w,height:h,fontSize:20,lineStep:26}));y+=h+30;}
   frames.push({label,lines:heading,x:45,y:top,width:910,height:y-top});y+=35;
  }height=y;
 }
 const byId=new Map(nodes.map(row=>[row.id,row])),edges=figure.edges.map(edge=>{const from=byId.get(edge.from),to=byId.get(edge.to),a=endpoint(from,center(to)),b=endpoint(to,center(from)),points=connection(a,b,nodes,width,height),middle=points[Math.floor(points.length/2)];return {...edge,points,labelLines:edge.label?wrap(edge.label,180,16):[],labelX:middle[0],labelY:middle[1]-10};});
 return {figure,width,height:Math.ceil(height),nodes,edges,frames};
}

export function renderThesisChartSvg(figure,{escape,textLines,wrap}){
 const {data}=figure,{series}=data,width=1000,height=800,L=140,R=940,B=560,W=R-L,titleLines=wrap(data.yLabel+(data.unit?'（'+data.unit+'）':''),850,18),legendLines=series.map(row=>wrap(row.name,205,16)),legendY=titleLines.length*22+35,T=Math.max(130,titleLines.length*22+45+Math.max(...legendLines.map(row=>row.length))*20),H=B-T;
 const values=series.flatMap(row=>row.points.map(point=>point.y)),low=Math.min(0,...values),high=Math.max(0,...values),span=high-low||1,y=value=>B-(value-low)/span*H,format=value=>Math.abs(value)>=1e6||value!==0&&Math.abs(value)<1e-4?value.toExponential(2):Number(value.toPrecision(6)).toString(),numericX=figure.kind==='scatter'||figure.kind==='line'&&series.every(row=>row.points.every(point=>typeof point.x==='number'));
 const xs=series.flatMap(row=>row.points.map(point=>point.x)),categories=[...new Set(xs.map(String))],xMin=numericX?Math.min(...xs):0,xMax=numericX?Math.max(...xs):0,x=value=>numericX?L+20+(Number(value)-xMin)/(xMax-xMin||1)*(W-40):L+(categories.indexOf(String(value))+.5)*W/categories.length;
 const desc=[data.xLabel,data.yLabel,data.unit,...series.flatMap(row=>[row.name,...row.points.map(point=>point.x+'：'+point.y)])].filter(Boolean).join('；'),parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" font-family="Times New Roman, Noto Serif CJK SC, Songti SC, SimSun, serif"><title>${escape(figure.title)}</title><desc>${escape(desc)}</desc><rect width="1000" height="800" fill="#ffffff"/>`];
 const line=(x1,y1,x2,y2,extra='')=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#222222" stroke-width="1.4" ${extra}/>`;
 parts.push(textLines(titleLines,L,35,{size:18,step:22,anchor:'start'}));
 for(let i=0;i<=5;i++){const value=low+span*i/5,yy=y(value);parts.push(line(L,yy,R,yy,'stroke-dasharray="2 6"'),textLines([format(value)],L-15,yy+6,{size:17,anchor:'end'}));}
 parts.push(line(L,T,L,B),line(L,y(0),R,y(0)));
 const labels=numericX?Array.from({length:6},(_,i)=>xMin+(xMax-xMin||1)*i/5):categories;
 labels.forEach(value=>{const xx=numericX?L+20+(Number(value)-xMin)/(xMax-xMin||1)*(W-40):x(value),label=numericX?format(value):String(value),font=numericX||categories.length<=8?16:12,lines=wrap(label,numericX?110:Math.min(110,W/categories.length-8),font);parts.push(line(xx,B,xx,B+7),textLines(lines,xx,B+28,{size:font,step:font+4}));});
 parts.push(textLines(wrap(data.xLabel,850,20),(L+R)/2,730,{size:20,step:24}));
 const fills=['#3f3f3f','#999999','#dddddd'],dashes=['','8 5','2 5'];
 const symbol=(index,x,y)=>index===1?`<rect x="${x-4}" y="${y-4}" width="8" height="8" fill="#ffffff" stroke="#111111" stroke-width="1.5"/>`:index===2?`<polygon points="${x},${y-5} ${x-5},${y+4} ${x+5},${y+4}" fill="#777777" stroke="#111111"/>`:`<circle cx="${x}" cy="${y}" r="4" fill="#111111"/>`;
 series.forEach((row,index)=>{
  const lx=160+index*255;if(figure.kind==='bar')parts.push(`<rect x="${lx}" y="${legendY-14}" width="22" height="16" fill="${fills[index]}" stroke="#111111"/>`);else parts.push(...(figure.kind==='line'?[line(lx,legendY-6,lx+24,legendY-6,dashes[index]?`stroke-dasharray="${dashes[index]}"`:'')]:[]),symbol(index,lx+12,legendY-6));parts.push(textLines(legendLines[index],lx+32,legendY,{size:16,step:20,anchor:'start'}));
  const points=row.points.slice();if(numericX)points.sort((a,b)=>Number(a.x)-Number(b.x));
  if(figure.kind==='line')parts.push(`<polyline points="${points.map(point=>x(point.x)+','+y(point.y)).join(' ')}" fill="none" stroke="#111111" stroke-width="2"${dashes[index]?` stroke-dasharray="${dashes[index]}"`:''}/>`);
  points.forEach(point=>{const xx=x(point.x),yy=y(point.y);
   if(figure.kind==='bar'){const group=W/categories.length,bw=Math.min(55,group*.72/series.length),left=xx+(index-(series.length-1)/2)*bw-bw/2;parts.push(`<rect x="${left}" y="${Math.min(yy,y(0))}" width="${Math.max(1,bw-3)}" height="${Math.max(.6,Math.abs(yy-y(0)))}" fill="${fills[index]}" stroke="#111111" stroke-width="1"/>`);if(String(point.y).length*8<=bw)parts.push(textLines([String(point.y)],left+bw/2,yy-9,{size:15,halo:true}));}
   else parts.push(symbol(index,xx,yy));
  });
 });
 parts.push('</svg>');return {svg:parts.join(''),width,height,figure};
}
