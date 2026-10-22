import JSZip from 'jszip';
import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {applyThesisDocumentTemplate} from './thesis-document.js';
export {inspectThesisDocxTemplate,defaultThesisTemplateProfile} from './thesis-template-profile.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function documentLines(value){const text=String(value);if(!text.trim())throw Error('请先填写或生成需要导出的内容。');if(text.length>500000)throw Error('正文超过 500,000 字符，请分章节导出。');if([...text].some(char=>{const point=char.codePointAt(0);return point>=0xd800&&point<=0xdfff||point===0xfffe||point===0xffff;}))throw Error('正文包含无法安全导出的字符，请修正后重试。');let sourceStart=0;return text.replace(/\r\n?/g,'\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').split('\n').map((text,i)=>{const row={text,sourceStart,level:i===0?0:/^\s*第.{1,12}章|^\s*参考文献/.test(text)?1:/^\s*\d+\.\d+(?:\.\d+)?\s/.test(text)?2:3};sourceStart+=text.length+1;return row;});}
const escaped=(text,index)=>{let count=0;while(index>0&&text[--index]==='\\')count++;return count%2===1;};
// Delimiters are parsed conservatively. Unmatched math, currency and fenced
// code remain literal text, and unsupported TeX is never removed from exports.
function inlineParts(text){
 const result=[];let start=0,index=0;
 while(index<text.length){
  if(text[index]==='`'&&!escaped(text,index)){let count=1;while(text[index+count]==='`')count++;const close=text.indexOf('`'.repeat(count),index+count);if(close>=0){index=close+count;continue;}}
  let open,close;
  if(!escaped(text,index)){if(text.startsWith('\\(',index)){open='\\(';close='\\)';}else if(text.startsWith('$$',index)){open='$$';close='$$';}else if(text[index]==='$'&&!/\s/.test(text[index+1]||' ')){open='$';close='$';}}
  if(!open){index++;continue;}
  let end=text.indexOf(close,index+open.length);while(end>=0&&(escaped(text,end)||close==='$'&&(/\s/.test(text[end-1]||' ')||/\d/.test(text[end+1]||''))))end=text.indexOf(close,end+close.length);
  if(end<0){index+=open.length;continue;}
  const raw=text.slice(index,end+close.length),source=text.slice(index+open.length,end);
  if(!source.trim()){index=end+close.length;continue;}
  if(index>start)result.push({text:text.slice(start,index)});result.push({text:raw,formula:raw});index=end+close.length;start=index;
 }
 if(start<text.length)result.push({text:text.slice(start)});return result.length?result:[{text}];
}
function tableCells(text){
 const ranges=[];let cursor=0;for(const part of inlineParts(text)){if(part.formula)ranges.push([cursor,cursor+part.text.length]);cursor+=part.text.length;}
 const cells=[];let current='',code=0,hasPipe=false;
 for(let index=0;index<text.length;index++){const char=text[index];if(char==='`'&&!escaped(text,index)){let length=1;while(text[index+length]==='`')length++;code=code===length?0:code||length;current+='`'.repeat(length);index+=length-1;continue;}if(char==='|'&&!code&&!escaped(text,index)&&!ranges.some(([start,end])=>index>=start&&index<end)){cells.push(current.trim());current='';hasPipe=true;}else current+=char;}
 if(!hasPipe)return null;cells.push(current.trim());if(text.trim().startsWith('|'))cells.shift();if(text.trim().endsWith('|')&&!escaped(text.trim(),text.trim().length-1))cells.pop();return cells.map(value=>value.replace(/\\\|/g,'|'));
}
function documentBlocks(value){
 const lines=documentLines(value),blocks=[];let fence=null;
 for(let index=0;index<lines.length;index++){
  const line=lines[index],marker=line.text.match(/^\s*(`{3,}|~{3,})/);
  if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;blocks.push({...line,literal:true});continue;}
  if(fence){blocks.push({...line,literal:true});continue;}
  const trimmed=line.text.trim(),delimiters=trimmed.startsWith('$$')?['$$','$$']:trimmed.startsWith('\\[')?['\\[','\\]']:null;
  if(delimiters){let end=index,raw=trimmed,closing=raw.indexOf(delimiters[1],delimiters[0].length);while(closing<0&&end+1<lines.length&&raw.length<=4000){raw+='\n'+lines[++end].text;closing=raw.indexOf(delimiters[1],delimiters[0].length);}if(closing>=0&&!raw.slice(closing+delimiters[1].length).trim()&&raw.slice(delimiters[0].length,closing).trim()){blocks.push({type:'formula',text:raw,level:3});index=end;continue;}}
  const header=tableCells(line.text),separator=lines[index+1]&&tableCells(lines[index+1].text);
  if(header?.length&&header.length<=20&&separator?.length===header.length&&separator.every(cell=>/^:?-{3,}:?$/.test(cell))){const rows=[header],align=separator.map(cell=>cell.startsWith(':')&&cell.endsWith(':')?'center':cell.endsWith(':')?'right':'left');index++;while(index+1<lines.length){const row=tableCells(lines[index+1].text);if(!row||row.length!==header.length)break;rows.push(row);index++;}blocks.push({type:'table',rows,align});continue;}
  blocks.push(line);
 }
 return blocks.map(block=>{if(block.literal||block.type==='formula'||block.type==='table')return block;let sourceOffset=0;const inlineSegments=inlineParts(block.text).map(part=>{const segment={text:part.text,sourceOffset,formula:Boolean(part.formula)};sourceOffset+=part.text.length;return segment;});return {...block,inlineSegments};});
}
let formulaPromise;
async function formulaRenderer(){if(!formulaPromise){const url=new URL('./research-formula.js',import.meta.url).href;formulaPromise=import(url).catch(error=>{formulaPromise=null;throw error;});}return formulaPromise;}
function columnWidths(rows,total){const count=rows[0].length,minimum=Math.min(48,total/count/2),weights=Array.from({length:count},(_,index)=>{let weight=6;for(const row of rows)weight=Math.max(weight,Math.min(30,[...row[index]].length));return weight;}),sum=weights.reduce((n,value)=>n+value,0);return weights.map(weight=>minimum+(total-minimum*count)*weight/sum);}
const wordRun=(text,properties='')=>`<w:r>${properties?`<w:rPr>${properties}</w:rPr>`:''}<w:t xml:space="preserve">${text.replace(/\t/g,'    ').split('\n').map(esc).join('</w:t><w:br/><w:t xml:space="preserve">')}</w:t></w:r>`;
export async function createWritingDocx(text,options={}){
 if(options.documentKind==='thesis')return applyThesisDocumentTemplate(await createWritingDocx(text),{...options,blocks:documentBlocks(text)});
 const zip=new JSZip(),blocks=documentBlocks(text),formulas=new Map();
 // The current OMML converter emits vertical-bar fences as operator runs. Keep
 // their TeX until native delimiter semantics are verified across Word readers.
 async function math(raw){if(formulas.has(raw))return formulas.get(raw);let markup;try{const renderer=await formulaRenderer();const mathml=renderer.renderFormulaMathML(raw);if(/<mo\b[^>]*>(?:\||‖|&#x(?:7c|2016);)<\/mo>/i.test(mathml))throw Error('unverified Word fence');markup=renderer.mathmlToOmml(mathml,{fontSize:12,color:'203659'});}catch{markup=wordRun(raw);}formulas.set(raw,markup);return markup;}
 async function runs(value,literal=false,properties=''){if(literal)return wordRun(value,properties);const result=[];for(const part of inlineParts(value))result.push(part.formula?await math(part.formula):wordRun(part.text,properties));return result.join('');}
 async function paragraph({text,level=3,literal=false},extra=''){return `<w:p><w:pPr>${level===0?'<w:jc w:val="center"/>':level<3?`<w:pStyle w:val="Heading${level}"/>`:''}<w:spacing w:after="120"/>${extra}</w:pPr>${await runs(text,literal,level===0?'<w:b/><w:sz w:val="36"/>':'')}</w:p>`;}
 const body=[];for(const block of blocks){
  if(block.type==='table'){const widths=columnWidths(block.rows,9026).map(Math.round),rows=[];for(const [index,row]of block.rows.entries()){const cells=[];for(const [column,value]of row.entries())cells.push(`<w:tc><w:tcPr><w:tcW w:w="${widths[column]}" w:type="dxa"/><w:vAlign w:val="center"/>${index===0?'<w:shd w:fill="E8EFF7"/>':''}</w:tcPr>${await paragraph({text:value},`<w:jc w:val="${block.align[column]}"/>`)}</w:tc>`);rows.push(`<w:tr>${index===0?'<w:trPr><w:tblHeader/></w:trPr>':''}${cells.join('')}</w:tr>`);}body.push(`<w:tbl><w:tblPr><w:tblW w:w="9026" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(edge=>`<w:${edge} w:val="single" w:sz="4" w:color="B8C5D4"/>`).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(width=>`<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`);}
  else if(block.type==='formula'){const value=await math(block.text);body.push(value.startsWith('<m:oMath ')?`<w:p><w:pPr><w:spacing w:after="180"/></w:pPr><m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${value}</m:oMathPara></w:p>`:await paragraph({...block,literal:true}));}
  else body.push(await paragraph(block));
 }
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');zip.file('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');zip.file('word/styles.xml',`<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr></w:style>${[1,2].map(level=>`<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="${level-1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${level===1?30:26}"/></w:rPr></w:style>`).join('')}</w:styles>`);zip.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`);return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
export async function createWritingPdf(text,fontBytes){
 // Localized glyph substitutions and ligatures can break the full font's
 // Unicode map; preserve literal scientific identifiers and consecutive digits.
 const blocks=documentBlocks(text),pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);const font=await pdf.embedFont(fontBytes,{features:{locl:false,liga:false,clig:false}}),supported=new Set(font.getCharacterSet());for(const line of documentLines(text))for(const char of line.text){if(!/[\s]/u.test(char)&&!supported.has(char.codePointAt(0)))throw Error(`PDF 字体暂不支持“${char}”，请先使用 DOCX 导出或替换该字符。`);}
 const pages=[];let page,y;const bottom=64,width=469,padding=6,tableSize=10,tableStep=15;
 function addPage(){page=pdf.addPage([595.28,841.89]);pages.push(page);y=778;}
 const wordSegmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'word'}):null,cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
 function wrap(text,size,maxWidth){
  const wrapped=[],measure=value=>font.widthOfTextAtSize(value,size);
  for(const paragraph of text.replace(/\t/g,'    ').split('\n')){
   let line='';const segments=wordSegmenter?Array.from(wordSegmenter.segment(paragraph),part=>part.segment):paragraph.match(/\s+|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)||[];
   for(const segment of segments)for(const token of cjk.test(segment)?Array.from(segment):[segment]){
    if(/^\s+$/u.test(token)){if(measure(line+token)<=maxWidth)line+=token;else if(line){wrapped.push(line);line='';}continue;}
    // Keep complete words on a fresh line whenever possible. Only a token
    // wider than the entire column may fall back to codepoint-sized breaks.
    if(measure(token)<=maxWidth){if(line&&measure(line+token)>maxWidth){wrapped.push(line);line='';}line+=token;continue;}
    if(line){wrapped.push(line);line='';}
    for(const char of token){if(measure(char)>maxWidth)throw Error('PDF 栏宽不足以显示原文字符，请先使用 DOCX 导出。');if(line&&measure(line+char)>maxWidth){wrapped.push(line);line='';}line+=char;}
   }
   wrapped.push(line);
  }
  return wrapped;
 }
 function drawLines(lines,size,level=3){const step=size*1.65;if(level<3&&y-step*2<bottom)addPage();for(const row of lines){if(y-step<bottom)addPage();if(row)page.drawText(row,{x:level===0?Math.max(63,(595.28-font.widthOfTextAtSize(row,size))/2):63,y,size,font,color:rgb(.12,.15,.2)});y-=step;}y-=6;}
 addPage();for(const block of blocks){
  if(block.type!=='table'){const size=block.level===0?18:block.level===1?15:block.level===2?13:12;drawLines(wrap(block.text,size,width),size,block.level);continue;}
  const widths=columnWidths(block.rows,width),wrapped=block.rows.map(row=>row.map((cell,index)=>wrap(cell,tableSize,widths[index]-padding*2))),height=row=>Math.max(...row.map(cell=>cell.length))*tableStep+padding*2,header=wrapped[0],repeatHeader=height(header)<=180;
  function fragment(row,start,count,isHeader){const rowHeight=count*tableStep+padding*2;let x=63;for(const [column,lines]of row.entries()){page.drawRectangle({x,y:y-rowHeight,width:widths[column],height:rowHeight,borderWidth:.5,borderColor:rgb(.72,.77,.83),...(isHeader?{color:rgb(.91,.94,.97)}:{})});for(let index=0;index<count;index++){const value=lines[start+index];if(!value)continue;const measured=font.widthOfTextAtSize(value,tableSize),align=block.align[column],offset=align==='right'?widths[column]-padding-measured:align==='center'?(widths[column]-measured)/2:padding;page.drawText(value,{x:x+offset,y:y-padding-tableSize-index*tableStep,size:tableSize,font,color:rgb(.12,.15,.2)});}x+=widths[column];}y-=rowHeight;}
  function newTablePage(withHeader){addPage();if(withHeader&&repeatHeader)fragment(header,0,Math.max(...header.map(cell=>cell.length)),true);}
  for(const [index,row]of wrapped.entries()){const total=Math.max(...row.map(cell=>cell.length)),whole=height(row),freshSpace=778-bottom-(index&&repeatHeader?height(header):0);if(whole<=freshSpace&&y-whole<bottom)newTablePage(index>0);let start=0;while(start<total){let count=Math.floor((y-bottom-padding*2)/tableStep);if(count<1){newTablePage(index>0);count=Math.floor((y-bottom-padding*2)/tableStep);}count=Math.min(count,total-start);fragment(row,start,count,index===0);start+=count;if(start<total)newTablePage(index>0);}}
  y-=12;
 }
 pages.forEach((page,index)=>{const label=`${index+1} / ${pages.length}`;page.drawText(label,{x:(595.28-font.widthOfTextAtSize(label,9))/2,y:32,size:9,font,color:rgb(.45,.45,.45)});});return pdf.save();
}
