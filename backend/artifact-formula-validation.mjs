import {DOMParser} from '@xmldom/xmldom';
import {formulaMathMLMarkup} from '../src/research-formula-core.js';

const fail=message=>{throw Object.assign(Error(message),{status:400});};
const namespace='http://www.w3.org/1998/Math/MathML';
const elements=new Set(['math','mrow','mi','mn','mo','mtext','ms','mspace','mfrac','msqrt','mroot','mstyle','mpadded','mphantom','mfenced','menclose','msub','msup','msubsup','munder','mover','munderover','mmultiscripts','mprescripts','none','mtable','mlabeledtr','mtr','mtd','maligngroup','malignmark']);
const tokens=new Set(['mi','mn','mo','mtext','ms']);
const attributes=new Set(['display','mathvariant','mathsize','mathcolor','mathbackground','dir','displaystyle','scriptlevel','scriptsizemultiplier','scriptminsize','linethickness','numalign','denomalign','bevelled','notation','stretchy','symmetric','fence','separator','accent','accentunder','largeop','movablelimits','minsize','maxsize','form','lspace','rspace','width','height','depth','voffset','rowalign','columnalign','columnspacing','rowspacing','align','side','minlabelspacing','equalrows','equalcolumns','framespacing','frame','rowlines','columnlines','rowspan','columnspan','groupalign','subscriptshift','superscriptshift','alignmentscope','decimalpoint','open','close','separators']);
function decode(buffer,limit){
 if(buffer.length>limit)fail('公式文件超出可保存范围。');
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{fail('公式文件必须是有效的 UTF-8 文本。');}
 if(!text.trim()||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(text)||[...text].some(char=>{const code=char.codePointAt(0);return code>=0xD800&&code<=0xDFFF;}))fail('公式文件包含不可保存的文本字符。');
 return text;
}
export function validateFormulaArtifact(kind,buffer){
 if(kind==='tex'){
  const source=decode(buffer,8000);try{formulaMathMLMarkup(source);}catch{fail('LaTeX 公式未通过校验，请先修正公式后重新导出。');}return;
 }
 if(kind!=='mml')return;
 const source=decode(buffer,2*1024*1024);if(source.length>512000||/<!DOCTYPE|<!ENTITY|<\?/i.test(source))fail('MathML 文件不可包含文档类型、实体定义或处理指令。');
 let document;try{document=new DOMParser({onError:()=>{throw Error('invalid XML');}}).parseFromString(source,'application/xml');}catch{fail('MathML 文件无法解析，请先修正公式。');}
 const root=document.documentElement;if(root?.localName!=='math'||root.namespaceURI!==namespace)fail('公式必须使用标准 MathML 命名空间。');
 const roots=Array.from(document.childNodes).filter(node=>node.nodeType===1);if(roots.length!==1||Array.from(document.childNodes).some(node=>node.nodeType!==1&&(node.nodeType!==3||node.data.trim())))fail('MathML 文件只能包含一个数学文档。');
 let count=0;
 function validate(node,depth=0){
  if(++count>12000||depth>80)fail('MathML 结构过于复杂，请分段导出。');
  if(node.nodeType===3||node.nodeType===4){if(node.data.trim()&&!tokens.has(node.parentNode?.localName))fail('MathML 文本必须位于有效的数学文本节点内。');return;}
  if(node.nodeType!==1||node.namespaceURI!==namespace||!elements.has(node.localName))fail('MathML 包含不可保存的元素或命名空间。');
  for(const attr of Array.from(node.attributes||[])){
   if(attr.namespaceURI==='http://www.w3.org/2000/xmlns/'){if(attr.name!=='xmlns'||attr.value!==namespace)fail('MathML 不可声明外部命名空间。');continue;}
   if(attr.namespaceURI||!attributes.has(attr.name)||/^(?:on|href$|src$|style$|class$|id$)/i.test(attr.name)||attr.value.length>2048||/javascript:|data:|url\s*\(|@import/i.test(attr.value))fail('MathML 不可包含外部资源、事件或交互样式。');
  }
  for(const child of Array.from(node.childNodes||[]))validate(child,depth+1);
 }
 validate(root);if(!root.textContent.trim()&&!Array.from(root.childNodes).some(node=>node.nodeType===1))fail('MathML 公式内容为空。');
}
