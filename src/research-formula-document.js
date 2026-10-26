import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';

const mathNS='http://www.w3.org/1998/Math/MathML',ommlNS='http://schemas.openxmlformats.org/officeDocument/2006/math',wordNS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
const supported=new Set(['math','mrow','mi','mn','mo','mtext','ms','mspace','mfrac','msqrt','mroot','mstyle','mpadded','mphantom','mfenced','menclose','msub','msup','msubsup','munder','mover','munderover','mmultiscripts','mprescripts','none','mtable','mtr','mtd']);
const attributes=new Set(['display','mathvariant','mathsize','mathcolor','mathbackground','dir','displaystyle','scriptlevel','scriptsizemultiplier','scriptminsize','linethickness','numalign','denomalign','bevelled','notation','stretchy','symmetric','fence','separator','accent','accentunder','largeop','movablelimits','minsize','maxsize','form','lspace','rspace','width','height','depth','voffset','rowalign','columnalign','columnspacing','rowspacing','align','side','minlabelspacing','equalrows','equalcolumns','framespacing','frame','rowlines','columnlines','rowspan','columnspan','groupalign','subscriptshift','superscriptshift','alignmentscope','decimalpoint','open','close','separators']);
const unsupported=detail=>Error('此公式的 '+detail+' 暂不支持导出为可编辑 Word 公式，请改用 MathML 或 SVG。');
const children=node=>Array.from(node.childNodes||[]).filter(child=>child.nodeType===1);
const value=node=>node.getAttribute?.('mathvariant')||undefined;
const atom=node=>node.textContent||'';
const arity=(node,count)=>{const items=children(node);if(items.length!==count)throw unsupported(node.localName+' 结构');return items;};
const zero=value=>value==='0'||value==='0em'||value==='0px'||value==='0pt';
function safeText(value){if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)||[...value].some(char=>{const cp=char.codePointAt(0);return cp>=0xd800&&cp<=0xdfff;}))throw Error('公式包含不可导出的文本字符。');return value;}
function parseMathML(source){
 if(typeof source!=='string'||!source.trim()||source.length>512000)throw Error('公式 MathML 为空或超出 Word 导出范围。');
 if(/<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(source))throw Error('公式不可包含文档类型、实体定义或处理指令。');
 safeText(source);let parsed;
 try{parsed=new DOMParser({onError:()=>{throw Error('invalid XML');}}).parseFromString(source,'application/xml');}catch{throw Error('公式 MathML 无法解析，请先修正公式。');}
 const root=parsed.documentElement;if(root?.localName!=='math'||root.namespaceURI!==mathNS)throw Error('公式必须使用标准 MathML 命名空间。');
 let count=0;
 function validate(node,depth=0){
  if(++count>12000||depth>80)throw Error('公式结构过于复杂，请分段导出。');
  if(node.nodeType===3||node.nodeType===4){safeText(node.data);if(node.data.trim()&&!['mi','mn','mo','mtext','ms'].includes(node.parentNode?.localName))throw Error('公式文本必须放在有效的 MathML 文本节点中。');return;}
  if(node.nodeType!==1)throw Error('公式包含不可导出的节点。');
  if(node.namespaceURI!==mathNS||!supported.has(node.localName))throw unsupported(node.localName||'未知节点');
  for(const attribute of Array.from(node.attributes||[])){
   if(attribute.namespaceURI==='http://www.w3.org/2000/xmlns/'){if(attribute.value!==mathNS)throw Error('公式不可包含外部命名空间。');continue;}
   if(attribute.namespaceURI||!attributes.has(attribute.name)||/^(?:on|href$|src$|style$)/i.test(attribute.name))throw Error('公式不可包含外部资源、事件或未知属性。');
   if(attribute.value.length>2048||/javascript:|data:|url\s*\(|@import/i.test(attribute.value))throw Error('公式包含不可导出的属性值。');
  }
  if(node.getAttribute('dir')&&node.getAttribute('dir')!=='ltr')throw unsupported('从右向左排版');
  if(['mspace','none','mprescripts'].includes(node.localName)&&children(node).length)throw unsupported(node.localName+' 子节点');
  if(node.localName==='mtr'&&node.parentNode?.localName!=='mtable'||node.localName==='mtd'&&node.parentNode?.localName!=='mtr')throw unsupported('矩阵结构');
  for(const child of Array.from(node.childNodes||[]))validate(child,depth+1);
 }
 validate(root);if(!children(root).length&&!root.textContent.trim())throw Error('请先填写公式再导出。');return root;
}
function run(text,style={},plain=false){
 if(!text)return '';safeText(text);const variant=style.variant||'',bold=/bold/.test(variant),italic=variant==='italic'||/italic/.test(variant)||(!variant&&!plain),scr=variant.includes('double-struck')?'double-struck':variant.includes('fraktur')?'fraktur':variant.includes('script')?'script':variant.includes('sans-serif')?'sans-serif':variant==='monospace'?'monospace':'roman';
 const properties=plain?'<m:nor/>':`<m:scr m:val="${scr}"/><m:sty m:val="${bold&&italic?'bi':bold?'b':italic?'i':'p'}"/>`;
 const color=style.color?`<w:color w:val="${escape(style.color)}"/>`:'';
 return `<m:r><m:rPr>${properties}</m:rPr><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:eastAsia="宋体"/>${color}<w:sz w:val="${style.size||28}"/></w:rPr><m:t xml:space="preserve">${escape(text)}</m:t></m:r>`;
}
const part=(name,content)=>`<m:${name}>${content}</m:${name}>`;
function chemicalLayoutAnchor(node){
 let phantom=false,padding=false,visible='';
 function scan(value,hidden=false){if(value.nodeType===3||value.nodeType===4){if(!hidden)visible+=value.data;return;}if(value.nodeType!==1)return;hidden=hidden||value.localName==='mphantom';if(value.localName==='mphantom'&&value.textContent.trim()==='A')phantom=true;if(value.localName==='mpadded'&&zero(value.getAttribute('width')))padding=true;for(const child of Array.from(value.childNodes||[]))scan(child,hidden);}
 scan(node);return phantom&&padding&&!visible.trim();
}
function converter(options){
 const baseStyle={size:Math.round(options.fontSize*2),color:options.color};
 // MathJax emits TeX absolute values/norms as sibling operators (including a
 // scripted closing bar), rather than mfenced. Give Word a native delimiter
 // object so its importer cannot reinterpret the bars as incomplete operators.
 function bar(node){
  if(['mrow','mstyle'].includes(node?.localName)&&children(node).length===1)return bar(children(node)[0]);
  if(node?.localName==='mo'&&/^[|‖]$/.test(atom(node)))return {mark:atom(node),node};
  if(['msub','msup','msubsup'].includes(node?.localName)){const base=children(node)[0];if(base?.localName==='mo'&&/^[|‖]$/.test(atom(base)))return {mark:atom(base),node:base,script:node};}
  return null;
 }
 function delimited(nodes,from,to,style){
  const opening=bar(nodes[from]),closing=bar(nodes[to]),holder=nodes[from].ownerDocument.createElementNS(mathNS,'mrow');
  for(const node of nodes.slice(from+1,to))holder.appendChild(node.cloneNode(true));
  let result=`<m:d><m:dPr><m:begChr m:val="${escape(opening.mark)}"/><m:endChr m:val="${escape(closing.mark)}"/><m:grow m:val="${opening.node.getAttribute('stretchy')==='false'&&closing.node.getAttribute('stretchy')==='false'?'0':'1'}"/></m:dPr>${part('e',convertMany(holder,style))}</m:d>`;
  if(closing.script){const parts=arity(closing.script,closing.script.localName==='msubsup'?3:2),sub=closing.script.localName!=='msup',sup=closing.script.localName!=='msub',tag=sub&&sup?'sSubSup':sub?'sSub':'sSup';result=`<m:${tag}>${part('e',result)}${sub?part('sub',convert(parts[1],style)):''}${sup?part('sup',convert(parts[sub?2:1],style)):''}</m:${tag}>`;}
  return result;
 }
 function closingBar(nodes,start,mark){
  const brackets=[];
  for(let index=start+1;index<nodes.length;index++){
   const node=nodes[index],token=node.localName==='mo'?atom(node):'';
   if('([{'.includes(token)&&token)brackets.push(token);
   else if(')]}'.includes(token)&&token){if(!brackets.length)return -1;brackets.pop();}
   if(index>start+1&&!brackets.length&&bar(node)?.mark===mark)return index;
  }
  return -1;
 }
 function convertMany(node,style){
  const result=[],nodes=Array.from(node.childNodes||[]).filter(child=>child.nodeType===1||child.data?.trim());
  for(let index=0;index<nodes.length;index++){
   const child=nodes[index];
   if(child.nodeType!==1){const markup=convert(child,style);if(markup)result.push({node:child,markup});continue;}
   const opening=bar(child);
   if(opening&&!opening.script){const end=closingBar(nodes,index,opening.mark);if(end>=0){result.push({node:child,markup:delimited(nodes,index,end,style)});index=end;continue;}}
   const parts=children(child),script=['msub','msup','msubsup'].includes(child.localName),next=nodes[index+1];
   const emptyBase=value=>value?.nodeType===1&&['mrow','mstyle','mi'].includes(value.localName)&&!value.textContent.trim()&&children(value).every(emptyBase);
   // TeX nuclear notation places scripts on an empty group immediately before
   // an element. Convert it to native left scripts instead of a blank base.
   if(script&&emptyBase(parts[0])&&next?.nodeType===1&&['mi','mrow'].includes(next.localName)&&next.textContent.trim()){
    arity(child,child.localName==='msubsup'?3:2);const sub=child.localName==='msup'?'':convert(parts[1],style),sup=child.localName==='msub'?'':convert(parts[child.localName==='msup'?1:2],style);
    result.push({node:next,markup:`<m:sPre>${part('sub',sub)}${part('sup',sup)}${part('e',convert(next,style))}</m:sPre>`});index++;continue;
   }
   const previous=result.at(-1),attach=script&&parts[0]&&chemicalLayoutAnchor(parts[0])&&previous&&(['mi','mn','mrow','msub','msup','msubsup'].includes(previous.node.localName)||previous.node.localName==='mo'&&/^[)\]}]$/.test(previous.node.textContent));
   if(attach){result.pop();result.push({node:child,markup:convert(child,style,previous.markup)});}else{const markup=convert(child,style);if(markup)result.push({node:child,markup});}
  }
  return result.map(item=>item.markup).join('');
 }
 function convert(node,inherited=baseStyle,scriptBase=null){
  if(node.nodeType===3||node.nodeType===4){if(!node.data.trim())return '';return run(node.data,inherited,true);}
  const name=node.localName,style={...inherited,variant:value(node)||inherited.variant};
  const color=node.getAttribute('mathcolor');if(color){if(!/^#[0-9a-f]{6}$/i.test(color))throw unsupported('自定义数学颜色');style.color=color.slice(1);}
  const items=children(node),build=child=>convert(child,style),all=()=>convertMany(node,style);
  if(['math','mrow','mstyle'].includes(name))return all();
  if(['mi','mn','mo','mtext','ms'].includes(name)){if(items.length)throw unsupported('嵌套文本');const variant=style.variant||((name==='mi'&&[...atom(node)].length===1)?'italic':'normal');return run(name==='ms'?'"'+atom(node)+'"':atom(node),{...style,variant},name==='mtext'||name==='ms'||name==='mi'&&variant==='normal'||name==='mo'&&/^[|‖]$/.test(atom(node)));}
  if(name==='mspace'){
   const width=node.getAttribute('width')||'0';if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:em|ex|px|pt|mu)?$/.test(width))throw unsupported('自定义间距');const n=parseFloat(width);if(Math.abs(n)>100)throw unsupported('过大的间距');return n>0?run(n>=1?'\u2003':'\u2009',{...style,variant:'normal'},true):'';
  }
  if(name==='mfrac'){
   const [numerator,denominator]=arity(node,2),thickness=node.getAttribute('linethickness'),type=zero(thickness)?'noBar':node.getAttribute('bevelled')==='true'?'skw':'bar';
   if(thickness&&!zero(thickness)&&!['thin','medium','thick'].includes(thickness)&&!/^(?:\d+(?:\.\d+)?|\.\d+)(?:em|ex|px|pt)?$/.test(thickness))throw unsupported('分数线');
   return `<m:f><m:fPr><m:type m:val="${type}"/></m:fPr>${part('num',build(numerator))}${part('den',build(denominator))}</m:f>`;
  }
  if(name==='msqrt')return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${part('e',all())}</m:rad>`;
  if(name==='mroot'){const [body,index]=arity(node,2);return `<m:rad><m:radPr><m:degHide m:val="0"/></m:radPr>${part('deg',build(index))}${part('e',build(body))}</m:rad>`;}
  if(['msub','msup','msubsup'].includes(name)){
   const parts=arity(node,name==='msubsup'?3:2),tag=name==='msub'?'sSub':name==='msup'?'sSup':'sSubSup',upper=name==='msup'?parts[1]:parts[2],charge=upper?atom(upper).replace(/\s+/g,''):'';
   // Ion charges are literal suffixes, not incomplete binary expressions such
   // as “2 +”. Native Word/Writer importers must not invent a missing operand.
   const upperMarkup=upper?(/^[0-9]*[+−-]+$/.test(charge)?run(charge,{...style,variant:'normal'},true):build(upper)):'';
   return `<m:${tag}>${part('e',scriptBase===null?build(parts[0]):scriptBase)}${name==='msup'?'':part('sub',build(parts[1]))}${name==='msub'?'':part('sup',upperMarkup)}</m:${tag}>`;
  }
  if(name==='mphantom')return `<m:phant><m:phantPr><m:show m:val="0"/>${style.zeroWidth?'<m:zeroWid m:val="1"/>':''}</m:phantPr>${part('e',all())}</m:phant>`;
  if(name==='mpadded'){
   const lspace=node.getAttribute('lspace')||'',width=node.getAttribute('width')||'';
   if(/-.*width|%/.test(lspace+width))throw unsupported('重叠字符定位');
   return convertMany(node,{...style,zeroWidth:style.zeroWidth||zero(width)});
  }
  if(name==='none')return '';
  if(name==='mmultiscripts'){
   if(!items.length)throw unsupported('多重上下标');const marker=items.findIndex(item=>item.localName==='mprescripts'),posts=items.slice(1,marker<0?undefined:marker),pres=marker<0?[]:items.slice(marker+1);
   if(posts.length%2||pres.length%2||items.filter(item=>item.localName==='mprescripts').length>1)throw unsupported('多重上下标');
   let result=build(items[0]);for(let i=0;i<posts.length;i+=2)result=`<m:sSubSup>${part('e',result)}${part('sub',build(posts[i]))}${part('sup',build(posts[i+1]))}</m:sSubSup>`;
   for(let i=pres.length-2;i>=0;i-=2)result=`<m:sPre>${part('sub',build(pres[i]))}${part('sup',build(pres[i+1]))}${part('e',result)}</m:sPre>`;return result;
  }
  if(name==='mfenced'){
   const open=node.getAttribute('open')??'(',close=node.getAttribute('close')??')',separators=node.getAttribute('separators')??',';
   if([...open].length>1||[...close].length>1||[...separators].length>1)throw unsupported('多字符括号');
   return `<m:d><m:dPr><m:begChr m:val="${escape(open)}"/><m:sepChr m:val="${escape(separators)}"/><m:endChr m:val="${escape(close)}"/></m:dPr>${items.map(item=>part('e',build(item))).join('')}</m:d>`;
  }
  if(['munder','mover','munderover'].includes(name)){
   const parts=arity(node,name==='munderover'?3:2),over=name!=='munder',mark=atom(parts[1]).trim();let result=build(parts[0]);
   if(name!=='munderover'&&parts[1].localName==='mo'&&['―','¯','‾','_'].includes(mark))return `<m:bar><m:barPr><m:pos m:val="${over?'top':'bot'}"/></m:barPr>${part('e',result)}</m:bar>`;
   if(name==='mover'&&parts[1].localName==='mo'&&['^','ˆ','~','˜','˙','¨','→','⃗'].includes(mark)&&(parts[1].getAttribute('accent')==='true'||['^','ˆ','~','˜','˙','¨','⃗'].includes(mark)))return `<m:acc><m:accPr><m:chr m:val="${escape({'^':'̂','ˆ':'̂','~':'̃','˜':'̃','˙':'̇','¨':'̈','⃗':'⃗','→':'⃗'}[mark])}"/></m:accPr>${part('e',result)}</m:acc>`;
   if(name!=='munderover'&&parts[1].localName==='mo'&&['⏞','⏟'].includes(mark))return `<m:groupChr><m:groupChrPr><m:chr m:val="${escape(mark)}"/><m:pos m:val="${over?'top':'bot'}"/><m:vertJc m:val="${over?'bot':'top'}"/></m:groupChrPr>${part('e',result)}</m:groupChr>`;
   if(name==='munder'||name==='munderover')result=`<m:limLow>${part('e',result)}${part('lim',build(parts[1]))}</m:limLow>`;
   if(name==='mover'||name==='munderover')result=`<m:limUpp>${part('e',result)}${part('lim',build(parts[name==='munderover'?2:1]))}</m:limUpp>`;return result;
  }
  if(name==='menclose'){
   const notations=(node.getAttribute('notation')||'longdiv').split(/\s+/),allowed=new Set(['box','top','bottom','left','right','horizontalstrike','verticalstrike','updiagonalstrike','downdiagonalstrike']);if(notations.some(value=>!allowed.has(value)))throw unsupported('封闭符号 '+notations.join(' '));
   const box=notations.includes('box'),props=[['hideTop',!box&&!notations.includes('top')],['hideBot',!box&&!notations.includes('bottom')],['hideLeft',!box&&!notations.includes('left')],['hideRight',!box&&!notations.includes('right')],['strikeH',notations.includes('horizontalstrike')],['strikeV',notations.includes('verticalstrike')],['strikeBLTR',notations.includes('updiagonalstrike')],['strikeTLBR',notations.includes('downdiagonalstrike')]].filter(([,on])=>on).map(([key])=>`<m:${key} m:val="1"/>`).join('');return `<m:borderBox><m:borderBoxPr>${props}</m:borderBoxPr>${part('e',all())}</m:borderBox>`;
  }
  if(name==='mtable'){
   if(items.some(item=>item.localName!=='mtr')||!items.length||items.length>100)throw unsupported('矩阵行');
   for(const key of ['frame','rowlines','columnlines'])if(node.getAttribute(key)&&node.getAttribute(key).split(/\s+/).some(value=>value!=='none'))throw unsupported('矩阵分隔线');
   const rows=items.map(row=>children(row)),columns=Math.max(...rows.map(row=>row.length)),align=(node.getAttribute('columnalign')||'center').split(/\s+/);if(!columns||columns>50||rows.some(row=>row.some(cell=>cell.localName!=='mtd')))throw unsupported('非矩形矩阵');
   for(const row of rows)for(const cell of row)for(const key of ['rowspan','columnspan'])if(cell.getAttribute(key)&&cell.getAttribute(key)!=='1')throw unsupported('合并矩阵单元格');
   const aligned=node.getAttribute('displaystyle')==='true'&&align.length>1&&align.every((value,index)=>value===(index%2?'left':'right'));
   if(aligned){
    return `<m:eqArr><m:eqArrPr><m:baseJc m:val="center"/></m:eqArrPr>${rows.map(row=>part('e',row.map((cell,index)=>{let content=build(cell);if(index%2)content=content.replace('</m:rPr>','<m:aln/></m:rPr>');return (index>0&&index%2===0?run('\u2003',style,true):'')+content;}).join(''))).join('')}</m:eqArr>`;
   }
   const columnProps=Array.from({length:columns},(_,index)=>{const alignment=align[index]||align.at(-1);if(!['left','center','right'].includes(alignment))throw unsupported('矩阵对齐');return `<m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="${alignment}"/></m:mcPr></m:mc>`;}).join('');
   return `<m:m><m:mPr><m:baseJc m:val="center"/><m:mcs>${columnProps}</m:mcs></m:mPr>${rows.map(row=>`<m:mr>${Array.from({length:columns},(_,index)=>part('e',row[index]?build(row[index]):'')).join('')}</m:mr>`).join('')}</m:m>`;
  }
  if(name==='mtd')return all();
  throw unsupported(name);
 }
 return root=>convert(root,baseStyle);
}
function documentOptions(options={}){
 if(!options||typeof options!=='object'||Array.isArray(options))throw Error('Word 导出选项无效。');
 const title=options.title===undefined?'科研公式':options.title,fontSize=options.fontSize===undefined?14:options.fontSize,color=options.color===undefined?'203659':String(options.color).replace(/^#/,'');
 if(typeof title!=='string'||title.length>200||!Number.isFinite(fontSize)||fontSize<8||fontSize>72||!/^[0-9a-f]{6}$/i.test(color))throw Error('Word 导出选项超出范围。');safeText(title);return{title,fontSize,color};
}
export function mathmlToOmml(mathml,options={}){
 const settings=documentOptions(options),root=parseMathML(mathml),content=converter(settings)(root);if(content.length>3000000)throw Error('公式超出 Word 导出范围。');return `<m:oMath xmlns:m="${ommlNS}" xmlns:w="${wordNS}">${content}</m:oMath>`;
}
export async function createFormulaDocx(mathml,options={}){
 const settings=documentOptions(options),formula=mathmlToOmml(mathml,settings),zip=new JSZip(),xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',date=new Date('2000-01-01T00:00:00Z');
 const add=(name,content)=>zip.file(name,xml+content,{date,createFolders:false});
 add('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
 add('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 add('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
 add('word/styles.xml',`<w:styles xmlns:w="${wordNS}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:eastAsia="宋体"/><w:sz w:val="${Math.round(settings.fontSize*2)}"/></w:rPr></w:style></w:styles>`);
 add('word/document.xml',`<w:document xmlns:w="${wordNS}" xmlns:m="${ommlNS}"><w:body>${settings.title?`<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escape(settings.title)}</w:t></w:r></w:p>`:''}<w:p><m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${formula}</m:oMathPara></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`);
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
