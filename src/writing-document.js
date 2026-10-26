import {writingDefaultTemplateSpec,writingDefaultTemplateMetadata} from '../dist/workspace/writing-template-catalog.mjs';
import JSZip from 'jszip';
import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {applyThesisDocumentTemplate} from './thesis-document.js';
import {DOMParser} from '@xmldom/xmldom';
import {normalizeThesisFigures,thesisFigureTitle,rasterizeThesisFigure,inspectThesisFigurePng} from '../dist/workspace/thesis-figure.mjs';
export {runThesisLayoutAgent,inspectThesisLayout} from './thesis-layout-agent.js';
export {auditThesisExport,auditThesisSubmission} from './thesis-export-check.js';
export {inspectThesisDocxTemplate,defaultThesisTemplateProfile,defaultWritingTemplateProfile} from './thesis-template-profile.js';
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
function documentBlocks(value,figures=[],{thesis=false}={}){
 const lines=documentLines(value),blocks=[],byId=new Map(figures.map(figure=>[figure.id,figure])),usedFigures=new Set();let fence=null;
 for(let index=0;index<lines.length;index++){
  const line=lines[index],marker=line.text.match(/^\s*(`{3,}|~{3,})/);
  if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;blocks.push({...line,...(thesis?{text:'',codeBoundary:true}:{}),literal:true});continue;}
  if(fence){blocks.push({...line,literal:true});continue;}
  const figureMatch=line.text.trim().match(/^\[figure:([A-Za-z][A-Za-z0-9_-]{0,39})\]$/);
  if(figureMatch){const id=figureMatch[1],figure=byId.get(id);if(!figure)throw Error('正文中的图片未找到对应结构，请重新生成该节图片后导出。');if(usedFigures.has(id))throw Error('正文图片标记重复，请为每张图片保留一个位置。');usedFigures.add(id);blocks.push({...line,type:'figure',figure,number:usedFigures.size});continue;}
  if(/\[figure:[^\]]*\]/.test(line.text))throw Error('论文图片标记须独立一行，请调整后重新导出。');
  const trimmed=line.text.trim(),delimiters=trimmed.startsWith('$$')?['$$','$$']:trimmed.startsWith('\\[')?['\\[','\\]']:null;
  if(delimiters){let end=index,raw=trimmed,closing=raw.indexOf(delimiters[1],delimiters[0].length);while(closing<0&&end+1<lines.length&&raw.length<=4000){raw+='\n'+lines[++end].text;closing=raw.indexOf(delimiters[1],delimiters[0].length);}if(closing>=0&&!raw.slice(closing+delimiters[1].length).trim()&&raw.slice(delimiters[0].length,closing).trim()){blocks.push({type:'formula',text:raw,level:3});index=end;continue;}}
  const header=tableCells(line.text),separator=lines[index+1]&&tableCells(lines[index+1].text);
  if(header?.length&&header.length<=20&&separator?.length===header.length&&separator.every(cell=>/^:?-{3,}:?$/.test(cell))){const rows=[header],align=separator.map(cell=>cell.startsWith(':')&&cell.endsWith(':')?'center':cell.endsWith(':')?'right':'left');index++;while(index+1<lines.length){const row=tableCells(lines[index+1].text);if(!row||row.length!==header.length)break;rows.push(row);index++;}blocks.push({type:'table',rows,align});continue;}
  blocks.push(line);
 }
 return blocks.map(block=>{if(block.literal||block.type==='formula'||block.type==='table'||block.type==='figure')return block;let sourceOffset=0;const inlineSegments=inlineParts(block.text).map(part=>{const segment={text:part.text,sourceOffset,formula:Boolean(part.formula)};sourceOffset+=part.text.length;return segment;});return {...block,inlineSegments};});
}
let formulaPromise;
async function formulaRenderer(){if(!formulaPromise){const url=new URL('./research-formula.js',import.meta.url).href;formulaPromise=import(url).catch(error=>{formulaPromise=null;throw error;});}return formulaPromise;}
function columnWidths(rows,total){const count=rows[0].length,minimum=Math.min(48,total/count/2),weights=Array.from({length:count},(_,index)=>{let weight=6;for(const row of rows)weight=Math.max(weight,Math.min(30,[...row[index]].length));return weight;}),sum=weights.reduce((n,value)=>n+value,0);return weights.map(weight=>minimum+(total-minimum*count)*weight/sum);}
const wordRun=(text,properties='')=>`<w:r>${properties?`<w:rPr>${properties}</w:rPr>`:''}<w:t xml:space="preserve">${text.replace(/\t/g,'    ').split('\n').map(esc).join('</w:t><w:br/><w:t xml:space="preserve">')}</w:t></w:r>`;
function figureCaption(block){return `图 ${block.number} ${thesisFigureTitle(block.figure.title)}${block.figure.caption?' — '+block.figure.caption:''}`;}
const inspectFigurePng=inspectThesisFigurePng;
export async function createWritingDocx(text,options={}){
 const figures=normalizeThesisFigures(options.metadata?.figures??options.figures);
 if(['thesis','writing'].includes(options.documentKind))return applyThesisDocumentTemplate(await createWritingDocx(text,{figures,figureRasterizer:options.figureRasterizer,thesisSource:true}),{...options,academicReport:options.documentKind==='writing',blocks:documentBlocks(text,figures,{thesis:true})});
 const zip=new JSZip(),blocks=documentBlocks(text,figures,{thesis:options.thesisSource===true}),formulas=new Map(),images=[];let imageBytes=0;
 // The current OMML converter emits vertical-bar fences as operator runs. Keep
 // their TeX until native delimiter semantics are verified across Word readers.
 async function math(raw){if(formulas.has(raw))return formulas.get(raw);let markup;try{const renderer=await formulaRenderer();const mathml=renderer.renderFormulaMathML(raw);if(/<mo\b[^>]*>(?:\||‖|&#x(?:7c|2016);)<\/mo>/i.test(mathml))throw Error('unverified Word fence');markup=renderer.mathmlToOmml(mathml,{fontSize:12,color:'203659'});}catch{markup=wordRun(raw);}formulas.set(raw,markup);return markup;}
 async function runs(value,literal=false,properties=''){if(literal)return wordRun(value,properties);const result=[];for(const part of inlineParts(value))result.push(part.formula?await math(part.formula):wordRun(part.text,properties));return result.join('');}
 async function paragraph({text,level=3,literal=false},extra=''){return `<w:p><w:pPr>${level===0?'<w:jc w:val="center"/>':level<3?`<w:pStyle w:val="Heading${level}"/>`:''}<w:spacing w:after="120"/>${extra}</w:pPr>${await runs(text,literal,level===0?'<w:b/><w:sz w:val="36"/>':'')}</w:p>`;}
 const body=[];for(const block of blocks){
  if(block.type==='figure'){const result=await (options.figureRasterizer||rasterizeThesisFigure)(block.figure),data=result?.bytes??result,dimensions=inspectFigurePng(data);imageBytes+=data.byteLength;if(imageBytes>8*1024*1024)throw Error('论文图片较多，请分章节导出。');const number=images.length+1,id='pkFigure'+number,name='pkfigure-'+number+'.png';images.push({id,name,bytes:data});const ratio=Math.min(9026/dimensions.width,9000/dimensions.height),cx=Math.round(dimensions.width*ratio*635),cy=Math.round(dimensions.height*ratio*635),caption=figureCaption(block);body.push(`<w:p><w:pPr><w:jc w:val="center"/><w:keepLines/><w:spacing w:after="180"/></w:pPr><w:r><w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${number}" name="PKFigure_${block.figure.id}" descr="${esc(thesisFigureTitle(block.figure.title))}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r><w:r><w:br/><w:t xml:space="preserve">${esc(caption)}</w:t></w:r></w:p>`);continue;}
  if(block.type==='table'){const widths=columnWidths(block.rows,9026).map(Math.round),rows=[];for(const [index,row]of block.rows.entries()){const cells=[];for(const [column,value]of row.entries())cells.push(`<w:tc><w:tcPr><w:tcW w:w="${widths[column]}" w:type="dxa"/><w:vAlign w:val="center"/>${index===0?'<w:shd w:fill="E8EFF7"/>':''}</w:tcPr>${await paragraph({text:value},`<w:jc w:val="${block.align[column]}"/>`)}</w:tc>`);rows.push(`<w:tr>${index===0?'<w:trPr><w:tblHeader/></w:trPr>':''}${cells.join('')}</w:tr>`);}body.push(`<w:tbl><w:tblPr><w:tblW w:w="9026" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(edge=>`<w:${edge} w:val="single" w:sz="4" w:color="B8C5D4"/>`).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(width=>`<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`);}
  else if(block.type==='formula'){const value=await math(block.text);body.push(value.startsWith('<m:oMath ')?`<w:p><w:pPr><w:spacing w:after="180"/></w:pPr><m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${value}</m:oMathPara></w:p>`:await paragraph({...block,literal:true}));}
  else body.push(await paragraph(block));
 }
 for(const image of images)zip.file('word/media/'+image.name,image.bytes);
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+(images.length?'<Default Extension="png" ContentType="image/png"/>':'')+'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');zip.file('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'+images.map(image=>`<Relationship Id="${image.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.name}"/>`).join('')+'</Relationships>');zip.file('word/styles.xml',`<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr></w:style>${[1,2].map(level=>`<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="${level-1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${level===1?30:26}"/></w:rPr></w:style>`).join('')}</w:styles>`);zip.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`);return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
export async function inspectThesisExportContent(bytes,text,options={}){
 const zip=await JSZip.loadAsync(bytes),part=zip.file('word/document.xml');if(!part)throw Error('论文导出文件缺少正文。');
 const doc=new DOMParser().parseFromString(await part.async('string'),'application/xml'),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',M='http://schemas.openxmlformats.org/officeDocument/2006/math',normalize=value=>String(value).replace(/\s/g,''),read=node=>normalize([...node.getElementsByTagName('*')].filter(n=>n.localName==='t'&&[W,M].includes(n.namespaceURI)).map(n=>n.textContent).join(''));
 const all=[...doc.getElementsByTagName('*')],positions=new Map(all.map((node,index)=>[node,index])),ends=new Map();for(const node of doc.getElementsByTagNameNS(W,'bookmarkEnd')){const id=node.getAttributeNS(W,'id');if(!ends.has(id))ends.set(id,[]);ends.get(id).push(node);}
 const anchors=new Map(),order=[];for(const node of doc.getElementsByTagNameNS(W,'bookmarkStart')){const name=node.getAttributeNS(W,'name'),match=/^PKInput_(\d+)$/.exec(name);if(!match)continue;const index=Number(match[1]);if(anchors.has(index))throw Error('论文正文定位标记重复，已停止导出。');let paragraph=node.parentNode;while(paragraph&&!(paragraph.namespaceURI===W&&paragraph.localName==='p'))paragraph=paragraph.parentNode;const matching=ends.get(node.getAttributeNS(W,'id'))||[],end=matching[0];if(!paragraph||matching.length!==1||end.parentNode!==node.parentNode||positions.get(end)<=positions.get(node))throw Error('论文正文定位标记无效，已停止导出。');const actual=normalize(all.slice(positions.get(node)+1,positions.get(end)).filter(n=>n.localName==='t'&&[W,M].includes(n.namespaceURI)).map(n=>n.textContent).join(''));anchors.set(index,{paragraph,actual});order.push(index);}
 const figures=normalizeThesisFigures(options.metadata?.figures??options.figures),blocks=documentBlocks(text,figures,{thesis:true}),expectedOrder=[];let checkedSegments=0,formulaSegments=0,figureSegments=0;const missing=[];
 const relationships=new Map(zip.file('word/_rels/document.xml.rels')?[...new DOMParser().parseFromString(await zip.file('word/_rels/document.xml.rels').async('string'),'application/xml').getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/relationships','Relationship')].map(node=>[node.getAttribute('Id'),node]):[]);
 for(const [index,block]of blocks.entries()){
  if(!String(block.text||'').trim()&&block.type!=='table')continue;
  const anchor=index?anchors.get(index):null;let container=index?anchor?.paragraph:doc.documentElement;
  if(index){expectedOrder.push(index);if(!container){missing.push(index);continue;}}
  if(block.type==='figure'){const expectedName='PKFigure_'+block.figure.id,drawing=[...container.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','docPr')].filter(node=>node.getAttribute('name')===expectedName);if(drawing.length!==1)throw Error('论文图片完整性核对未通过，已停止下载。');const blips=[...container.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main','blip')];if(blips.length!==1)throw Error('论文图片关联异常，已停止下载。');const relationship=relationships.get(blips[0].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','embed')),target=relationship?.getAttribute('Target');if(!relationship||relationship.getAttribute('TargetMode')==='External'||!relationship.getAttribute('Type').endsWith('/image')||!/^media\/[A-Za-z0-9_-]+\.png$/.test(target||'')||!zip.file('word/'+target))throw Error('论文图片文件缺失，已停止下载。');inspectFigurePng(await zip.file('word/'+target).async('uint8array'));if(!read(container).includes(normalize(figureCaption(block))))throw Error('论文图片标题或说明缺失，已停止下载。');figureSegments++;checkedSegments++;continue;}
  if(block.type==='table'){while(container&&!(container.namespaceURI===W&&container.localName==='tbl'))container=container.parentNode;if(!container){missing.push(index);continue;}}
  const actual=block.type==='table'||!index?read(container):anchor.actual,segments=block.type==='formula'?[{text:block.text,formula:true}]:block.type==='table'?block.rows.flat().flatMap(value=>inlineParts(value)):block.literal?[{text:block.text}]:block.inlineSegments||[{text:block.text}];let cursor=0;
  for(const segment of segments){if(segment.formula){formulaSegments++;continue;}const expected=normalize(segment.text.replace(/^\s*#{1,3}\s+/,''));if(!expected)continue;checkedSegments++;const found=actual.indexOf(expected,cursor);if(found<0){if(!index)throw Error('导出文件中的论文题目未与当前题目对应，已停止下载；请核对模板封面题名，将示例题名改为空白或 {{论文题目}} 后重新上传。');missing.push(index);}else cursor=found+expected.length;}
 }
 if(missing.length||JSON.stringify(order)!==JSON.stringify(expectedOrder))throw Error('导出文件正文完整性核对未通过，已停止下载；请核对模板正文区域后重试。');
 // Inspect final rendered document text too: template regions can introduce
 // explicit pending items that were absent from the manuscript input. Keep
 // same-paragraph runs together so formatting splits cannot hide a marker.
 let visible='',priorParagraph=null;for(const node of all.filter(n=>n.localName==='t'&&[W,M].includes(n.namespaceURI))){let paragraph=node.parentNode;while(paragraph&&!(paragraph.namespaceURI===W&&paragraph.localName==='p'))paragraph=paragraph.parentNode;if(paragraph!==priorParagraph&&visible)visible+='\n';visible+=node.textContent;priorParagraph=paragraph;}
 const unresolvedPlaceholders=[...visible.matchAll(/(?:【|〔|\[|\{\{)\s*(?:待补充|待核对|待完善|请补充|待填写|来源待核对|文献信息待补全|草稿说明|To be supplied\b|To be verified\b|Draft note\b|TODO\b|TBD\b)[^\n\]】〕}]{0,500}(?:】|〕|\]|\}\})/giu)].length;
 return {status:'passed',checkedSegments,formulaSegments,figureSegments,checkedBlocks:expectedOrder.length,unresolvedPlaceholders,scope:'ordered_block_text_segments'};
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

export async function createWritingTemplateDocx(kind){
 const spec=writingDefaultTemplateSpec(kind);if(!spec)throw Error('未找到对应的通用写作模板。');
 const metadata=writingDefaultTemplateMetadata(kind);
 return createWritingDocx(metadata.title+'\n{{正文}}',{documentKind:spec.kind==='writing'?'thesis':'writing',writingKind:spec.kind,metadata});
}
