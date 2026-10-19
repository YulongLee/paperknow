import {mathjax} from 'mathjax-full/js/mathjax.js';
import {TeX} from 'mathjax-full/js/input/tex.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';
import {STATE} from 'mathjax-full/js/core/MathItem.js';
import {SerializedMmlVisitor} from 'mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js';
import {Configuration} from 'mathjax-full/js/input/tex/Configuration.js';
import {CharacterMap} from 'mathjax-full/js/input/tex/SymbolMap.js';
import ParseMethodsModule from 'mathjax-full/js/input/tex/ParseMethods.js';
import {TEXCLASS} from 'mathjax-full/js/core/MmlTree/MmlNode.js';
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/mhchem/MhchemConfiguration.js';
import 'mathjax-full/js/input/tex/cancel/CancelConfiguration.js';
import 'mathjax-full/js/input/tex/gensymb/GensymbConfiguration.js';
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import {validateFormulaCode} from '../dist/workspace/research-delivery-model.mjs';
const adaptor=liteAdaptor();RegisterHTMLHandler(adaptor);
// These two fixed operators fill a gap in MathJax 3's bundled TeX font. Their
// MathML remains the actual Unicode operator; only their local SVG glyphs are
// constructed from existing TeX integral paths and an original enclosing ring.
new CharacterMap('paperknow-contour-integrals',ParseMethodsModule.default.mathchar0mo,{
 oiint:['\u222F',{texClass:TEXCLASS.OP,largeop:true,movablelimits:false}],
 oiiint:['\u2230',{texClass:TEXCLASS.OP,largeop:true,movablelimits:false}]
});
Configuration.create('paperknow-contour-integrals',{handler:{macro:['paperknow-contour-integrals']}});
function contourRing(cx,rx,ry,thickness){
 const cy=250,k=.5522847498,n=value=>Number(value.toFixed(3));
 const ellipse=(x,y,reverse)=>{const left=n(cx-x),right=n(cx+x),top=n(cy+y),bottom=n(cy-y),kx=n(k*x),ky=n(k*y);
  return reverse?`M${right} ${cy}C${right} ${n(cy-ky)} ${n(cx+kx)} ${bottom} ${cx} ${bottom}C${n(cx-kx)} ${bottom} ${left} ${n(cy-ky)} ${left} ${cy}C${left} ${n(cy+ky)} ${n(cx-kx)} ${top} ${cx} ${top}C${n(cx+kx)} ${top} ${right} ${n(cy+ky)} ${right} ${cy}Z`:`M${right} ${cy}C${right} ${n(cy+ky)} ${n(cx+kx)} ${top} ${cx} ${top}C${n(cx-kx)} ${top} ${left} ${n(cy+ky)} ${left} ${cy}C${left} ${n(cy-ky)} ${n(cx-kx)} ${bottom} ${cx} ${bottom}C${n(cx+kx)} ${bottom} ${right} ${n(cy-ky)} ${right} ${cy}Z`;
 };
 return ellipse(rx,ry,true)+ellipse(rx-thickness,ry-thickness,false);
}
function addContourIntegralGlyphs(font){
 for(const [variant,ring]of [['-largeop',{firstCenter:500,step:518,rx:270,ry:270,stroke:40}],['-smallop',{firstCenter:333,step:347,rx:185,ry:185,stroke:38}]]){
  const chars={};
  for(const [code,source,count]of [[0x222F,0x222C,2],[0x2230,0x222D,3]]){
   const glyph=font.getChar(variant,source),extension=(count-1)*ring.step/2;
   if(!glyph?.[3]?.p)throw Error('本地积分字形未载入。');
   chars[code]=[...glyph.slice(0,3),{...glyph[3],p:glyph[3].p+contourRing(ring.firstCenter+extension,ring.rx+extension,ring.ry,ring.stroke)}];
  }
  font.defineChars(variant,chars);
 }
}
let formulaFont,formulaSvgSequence=0;
function formulaDocument(){
 // Font construction dominates small previews. Reuse only the trusted glyph
 // data; fresh parsers, output caches and documents keep each conversion isolated.
 const input=new TeX({packages:['base','ams','mhchem','cancel','gensymb','boldsymbol','paperknow-contour-integrals'],maxBuffer:4000,maxMacros:100,formatError:(_jax,error)=>{throw Error(error.message||'公式语法有误。');}}),output=new SVG({fontCache:'local',localID:'paperknow-'+(++formulaSvgSequence),...(formulaFont?{font:formulaFont}:{})});
 if(!formulaFont){addContourIntegralGlyphs(output.font);formulaFont=output.font;}
 return mathjax.document('',{InputJax:input,OutputJax:output});
}
export function unwrapFormulaDelimiters(value){
 const latex=validateFormulaCode(value),pairs=[['$$','$$'],['\\[','\\]'],['\\(','\\)'],['$','$']];
 for(const character of latex){const point=character.codePointAt(0);if(point>=0xD800&&point<=0xDFFF||point===0xFFFE||point===0xFFFF)throw Error('公式包含无法安全排版的字符。');}
 for(const [open,close]of pairs)if(latex.startsWith(open)){
  if(!latex.endsWith(close)||latex.length<open.length+close.length||open==='$'&&latex.endsWith('$$'))throw Error('公式最外层定界符不匹配，请检查 $、括号或方括号。');
  const inner=validateFormulaCode(latex.slice(open.length,-close.length));
  if(pairs.some(([start,end])=>inner.startsWith(start)||inner.endsWith(end)&&!(end==='$'&&inner.endsWith('\\$'))))throw Error('公式仅支持一层最外部定界符，请移除重复包裹。');
  return inner;
 }
 if(latex.endsWith('\\)')||latex.endsWith('\\]')||latex.endsWith('$$')||latex.endsWith('$')&&!latex.endsWith('\\$'))throw Error('公式最外层定界符不匹配，请检查 $、括号或方括号。');
 return latex;
}
export function formulaSvgMarkup(value){const latex=validateFormulaCode(value),container=formulaDocument().convert(unwrapFormulaDelimiters(latex),{display:true}),html=adaptor.outerHTML(container),match=html.match(/<svg\b[\s\S]*<\/svg>/);if(!match)throw Error('公式排版未返回图形。');return {latex,markup:match[0]};}

const mathMLKinds=new Set(['math','mrow','mi','mn','mo','mtext','mspace','ms','mfrac','msqrt','mroot','mstyle','mpadded','mphantom','mfenced','menclose','msub','msup','msubsup','munder','mover','munderover','mmultiscripts','mprescripts','none','mtable','mlabeledtr','mtr','mtd','maligngroup','malignmark','TeXAtom','inferredMrow','text']);
const mathMLAttributes=new Set(['xmlns','display','mathvariant','mathsize','mathcolor','mathbackground','dir','displaystyle','scriptlevel','scriptsizemultiplier','scriptminsize','linethickness','numalign','denomalign','bevelled','notation','stretchy','symmetric','fence','separator','accent','accentunder','largeop','movablelimits','minsize','maxsize','form','lspace','rspace','width','height','depth','voffset','rowalign','columnalign','columnspacing','rowspacing','align','side','minlabelspacing','equalrows','equalcolumns','framespacing','frame','rowlines','columnlines','rowspan','columnspan','groupalign','subscriptshift','superscriptshift','alignmentscope','decimalpoint']);
class SafeMathMLVisitor extends SerializedMmlVisitor{
 getDataAttributes(){return {};}
 getAttributes(node){
  const values={...(SerializedMmlVisitor.defaultAttributes[node.kind]||{}),...(node.attributes?.getAllAttributes()||{})},attributes=[];
  for(const [name,raw]of Object.entries(values)){
   if(/^(?:on|href$|src$|style$|class$|id$)/i.test(name))throw Error('公式 MathML 不可包含外部资源或交互样式。');
   if(!mathMLAttributes.has(name))continue;
   let value=String(raw);if(name==='mathvariant')value=SerializedMmlVisitor.variants[value]||value;
   if(value.length>2048||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)||/(?:javascript:|data:|url\s*\(|@import)/i.test(value))throw Error('公式 MathML 属性无法安全导出。');
   if(name==='xmlns'&&value!=='http://www.w3.org/1998/Math/MathML')throw Error('公式 MathML 命名空间无效。');
   attributes.push(name+'="'+this.quoteHTML(value)+'"');
  }
  return attributes.length?' '+attributes.join(' '):'';
 }
}
export function formulaMathMLMarkup(value){
 const latex=validateFormulaCode(value),tree=formulaDocument().convert(unwrapFormulaDelimiters(latex),{display:true,end:STATE.COMPILED});
 if(tree.kind!=='math')throw Error('公式未返回数学结构。');
 let count=0;tree.walkTree(node=>{if(++count>12000||!mathMLKinds.has(node.kind))throw Error('公式 MathML 结构超出可导出范围。');});
 const markup=new SafeMathMLVisitor().visitTree(tree);
 if(markup.length>512000||!/^<math\b[^>]*\bxmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML"/.test(markup))throw Error('公式 MathML 导出未完成。');
 return{latex,markup};
}
