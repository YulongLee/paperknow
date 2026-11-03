import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
export const WORD='http://schemas.openxmlformats.org/wordprocessingml/2006/main',MATH='http://schemas.openxmlformats.org/officeDocument/2006/math',REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships',DRAW='http://schemas.openxmlformats.org/drawingml/2006/main',WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const esc=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export const serializeWordObject=node=>new XMLSerializer().serializeToString(node);
export function parseWordObject(markup,kind){
 if(typeof markup!=='string'||markup.length>200000||/<!DOCTYPE|<!ENTITY|<\?/i.test(markup))throw Error('原稿对象的文档结构无效。');
 let invalid=false;const root=new DOMParser({onError:()=>invalid=true}).parseFromString(markup,'application/xml').documentElement;
 if(invalid||!root||kind==='formula'&&(root.namespaceURI!==MATH||!['oMath','oMathPara'].includes(root.localName))||kind==='image'&&(root.namespaceURI!==WORD||!['drawing','pict'].includes(root.localName)))throw Error('原稿对象类型不匹配。');
 const allowed=new Set([WORD,MATH,DRAW,WP,'http://schemas.openxmlformats.org/drawingml/2006/picture','urn:schemas-microsoft-com:vml','urn:schemas-microsoft-com:office:office','http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing','http://schemas.microsoft.com/office/drawing/2010/main','http://schemas.openxmlformats.org/markup-compatibility/2006']);
 for(const node of [root,...root.getElementsByTagName('*')]){
  if(!allowed.has(node.namespaceURI)||kind==='formula'&&![WORD,MATH].includes(node.namespaceURI)||['object','altChunk','fldSimple','instrText','hyperlink','OLEObject','script','audioFile','videoFile','chart','hlinkClick','hlinkHover'].includes(node.localName))throw Error('原稿对象含有暂不支持的外部或嵌入内容。');
  for(const attribute of node.attributes)if(attribute.namespaceURI!== 'http://www.w3.org/2000/xmlns/'&&(attribute.namespaceURI===REL&&!['embed','id'].includes(attribute.localName)||/^(?:href|src|action)$/i.test(attribute.localName)||/url\s*\(/i.test(attribute.value)))throw Error('原稿对象不能包含外部链接。');
 }
 return root;
}
export function ommlMathML(root){
 const elements=node=>[...node.childNodes].filter(row=>row.nodeType===1),child=(node,name)=>elements(node).find(row=>row.namespaceURI===MATH&&row.localName===name),value=(node,name,fallback='')=>child(node,name)?.getAttributeNS(MATH,'val')||fallback;
 function render(node){
  if(node.namespaceURI===WORD)return node.localName==='t'?'<mtext>'+esc(node.textContent)+'</mtext>':elements(node).map(render).join('');
  if(node.namespaceURI!==MATH||/Pr$/.test(node.localName))return '';
  const part=name=>'<mrow>'+elements(child(node,name)||{childNodes:[]}).map(render).join('')+'</mrow>',all=()=>elements(node).map(render).join(''),props=child(node,node.localName+'Pr');
  switch(node.localName){
   case 't':return '<mi mathvariant="normal">'+esc(node.textContent)+'</mi>';
   case 'f':return '<mfrac>'+part('num')+part('den')+'</mfrac>';
   case 'sSup':return '<msup>'+part('e')+part('sup')+'</msup>';
   case 'sSub':return '<msub>'+part('e')+part('sub')+'</msub>';
   case 'sSubSup':return '<msubsup>'+part('e')+part('sub')+part('sup')+'</msubsup>';
   case 'sPre':return '<mmultiscripts>'+part('e')+'<mprescripts/>'+part('sub')+part('sup')+'</mmultiscripts>';
   case 'rad':return value(props||node,'degHide')==='1'||!child(node,'deg')?'<msqrt>'+part('e')+'</msqrt>':'<mroot>'+part('e')+part('deg')+'</mroot>';
   case 'd':return '<mrow><mo stretchy="true">'+esc(value(props||node,'begChr','('))+'</mo>'+elements(node).filter(row=>row.localName==='e').map(render).join('<mo>'+esc(value(props||node,'sepChr','|'))+'</mo>')+'<mo stretchy="true">'+esc(value(props||node,'endChr',')'))+'</mo></mrow>';
   case 'nary':{const op='<mo largeop="true">'+esc(value(props||node,'chr','∫'))+'</mo>';return '<mrow><munderover>'+op+part('sub')+part('sup')+'</munderover>'+part('e')+'</mrow>';}
   case 'limLow':return '<munder>'+part('e')+part('lim')+'</munder>';
   case 'limUpp':return '<mover>'+part('e')+part('lim')+'</mover>';
   case 'acc':return '<mover accent="true">'+part('e')+'<mo>'+esc(value(props||node,'chr','̂'))+'</mo></mover>';
   case 'bar':return value(props||node,'pos','top')==='bot'?'<munder accentunder="true">'+part('e')+'<mo>_</mo></munder>':'<mover accent="true">'+part('e')+'<mo>¯</mo></mover>';
   case 'm':return '<mtable>'+elements(node).filter(row=>row.localName==='mr').map(row=>'<mtr>'+elements(row).filter(cell=>cell.localName==='e').map(cell=>'<mtd>'+render(cell)+'</mtd>').join('')+'</mtr>').join('')+'</mtable>';
   case 'eqArr':return '<mtable>'+elements(node).filter(row=>row.localName==='e').map(row=>'<mtr><mtd>'+render(row)+'</mtd></mtr>').join('')+'</mtable>';
   default:return '<mrow>'+all()+'</mrow>';
  }
 }
 return '<math xmlns="http://www.w3.org/1998/Math/MathML">'+render(root)+'</math>';
}
