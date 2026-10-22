import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {defaultThesisTemplateProfile,inspectThesisDocxTemplate} from '../src/thesis-template-profile.js';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',R='http://schemas.openxmlformats.org/package/2006/relationships';
const rel=(target='word/document.xml',type='officeDocument',mode='')=>`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${mode?` TargetMode="${mode}"`:''}/>`;
const normal=`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="正文"/><w:pPr><w:jc w:val="both"/><w:spacing w:line="400" w:lineRule="exact" w:before="0" w:after="0"/><w:ind w:firstLineChars="200"/><w:pageBreakBefore w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="仿宋"/><w:sz w:val="24"/><w:b w:val="0"/></w:rPr></w:style>`;
const page='<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1800" w:bottom="1400" w:left="1700" w:right="1450" w:header="800" w:footer="900" w:gutter="100"/></w:sectPr>';
const para=(text,p='',r='')=>`<w:p><w:pPr>${p}</w:pPr><w:r><w:rPr>${r}</w:rPr><w:t>${text}</w:t></w:r></w:p>`;
async function fixture({styles=normal,body=para('合成模板正文，用于识别真实样式。'),sections=page,extra={},type='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',compression='DEFLATE',omitStyles=false}={}){
 const zip=new JSZip();zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${type}"/></Types>`);zip.file('_rels/.rels',`<Relationships xmlns="${R}">${rel()}</Relationships>`);zip.file('word/document.xml',`<w:document xmlns:w="${W}"><w:body>${body}${sections}</w:body></w:document>`);if(!omitStyles)zip.file('word/styles.xml',`<w:styles xmlns:w="${W}">${styles}</w:styles>`);for(const[name,value]of Object.entries(extra))zip.file(name,value);return zip.generateAsync({type:'uint8array',compression});
}

test('default thesis profile is complete, independent, bounded and JSON serializable',()=>{
 const a=defaultThesisTemplateProfile(),b=defaultThesisTemplateProfile();assert.equal(a.version,1);assert.deepEqual(Object.keys(a.rules.styles),['Normal','Title','Heading1','Heading2','Heading3','Abstract','References','TableText']);assert.equal(a.rules.styles.Normal.firstLineChars,200);assert.equal(a.rules.styles.Normal.size,24);assert.equal(a.rules.styles.Title.size,44);assert.equal(a.rules.styles.Heading1.pageBreakBefore,true);assert.equal(a.rules.styles.TableText.firstLineChars,0);for(const value of Object.values(a.rules.page))assert.ok(Number.isInteger(value));a.rules.styles.Normal.size=400;assert.equal(b.rules.styles.Normal.size,24);assert.deepEqual(JSON.parse(JSON.stringify(b)),b);
});

test('reads actual fonts, half-point sizes, exact spacing and all page settings',async()=>{
 const result=await inspectThesisDocxTemplate(await fixture());assert.equal(result.rules.styles.Normal.eastAsia,'仿宋');assert.equal(result.rules.styles.Normal.ascii,'Times New Roman');assert.equal(result.rules.styles.Normal.line,400);assert.equal(result.rules.styles.Normal.lineRule,'exact');assert.equal(result.rules.styles.Normal.bold,false);assert.equal(result.rules.page.top,1800);assert.equal(result.rules.page.gutter,100);assert.ok(result.recognized.includes('styles.Normal.eastAsia'));assert.ok(result.unresolved.includes('styles.Heading3.eastAsia'));assert.ok(result.warnings.some(text=>text.includes('未识别')));assert.equal(JSON.stringify(result).includes('合成模板正文'),false);
});

test('resolves basedOn, partial docDefaults and Chinese or English heading names',async()=>{
 const defaults='<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="33"/></w:pPr></w:pPrDefault></w:docDefaults>',styles=defaults+normal+'<w:style w:type="paragraph" w:styleId="SchoolBase"><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:eastAsia="黑体"/><w:sz w:val="34"/><w:b/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="schoolone"><w:name w:val="标题 1"/><w:basedOn w:val="SchoolBase"/><w:pPr><w:jc w:val="left"/><w:pageBreakBefore/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="second"><w:name w:val="Heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="28"/></w:rPr></w:style>';
 const result=await inspectThesisDocxTemplate(await fixture({styles}));assert.equal(result.rules.styles.Heading1.eastAsia,'黑体');assert.equal(result.rules.styles.Heading1.size,34);assert.equal(result.rules.styles.Heading1.alignment,'left');assert.equal(result.rules.styles.Heading1.pageBreakBefore,true);assert.equal(result.rules.styles.Heading2.size,28);assert.equal(result.rules.styles.Heading2.line,400);
});

test('representative paragraphs and direct outline level override inherited heading styles',async()=>{
 const body=para('明确的三级标题','<w:outlineLvl w:val="2"/><w:jc w:val="right"/><w:ind w:firstLine="360"/><w:spacing w:line="275" w:lineRule="atLeast"/>','<w:rFonts w:eastAsia="楷体" w:ascii="Arial"/><w:sz w:val="26"/><w:b/>');
 const result=await inspectThesisDocxTemplate(await fixture({body}));assert.equal(result.rules.styles.Heading3.eastAsia,'楷体');assert.equal(result.rules.styles.Heading3.size,26);assert.equal(result.rules.styles.Heading3.alignment,'right');assert.equal(result.rules.styles.Heading3.lineRule,'atLeast');assert.equal(result.rules.styles.Heading3.firstLine,360);assert.equal(result.rules.styles.Heading3.firstLineChars,0);assert.equal(result.rules.styles.Heading3.bold,true);
});

test('abstract, references and table content receive separate paragraph roles',async()=>{
 const body=para('摘要')+para('合成摘要内容','', '<w:sz w:val="22"/>')+para('参考文献')+para('[1] 合成题录','<w:ind w:hanging="420"/>','<w:rFonts w:eastAsia="楷体"/>')+'<w:tbl><w:tr><w:tc>'+para('合成表格文字','','<w:sz w:val="20"/>')+'</w:tc></w:tr></w:tbl>';
 const result=await inspectThesisDocxTemplate(await fixture({body}));assert.equal(result.rules.styles.Abstract.size,22);assert.equal(result.rules.styles.References.eastAsia,'楷体');assert.equal(result.rules.styles.References.hanging,420);assert.equal(result.rules.styles.References.firstLineChars,0);assert.equal(result.rules.styles.TableText.size,20);
});

test('theme fonts are resolved when actual theme faces are present',async()=>{
 const styles='<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:rFonts w:eastAsiaTheme="minorEastAsia" w:asciiTheme="minorAscii"/></w:rPr></w:style>',theme='<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="school"><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:font script="Hans" typeface="等线"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>';
 const result=await inspectThesisDocxTemplate(await fixture({styles,extra:{'word/theme/theme1.xml':theme}}));assert.equal(result.rules.styles.Normal.ascii,'Calibri');assert.equal(result.rules.styles.Normal.eastAsia,'等线');
});

test('actual internal relationships select noncanonical styles, settings and theme part names',async()=>{
 const styles=`<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:rFonts w:asciiTheme="majorAscii" w:eastAsiaTheme="majorEastAsia"/><w:sz w:val="26"/></w:rPr></w:style></w:styles>`,theme='<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="school"><a:majorFont><a:latin typeface="Georgia"/><a:ea typeface="楷体"/></a:majorFont></a:fontScheme></a:themeElements></a:theme>',rels=rel('alternate/styles2.xml','styles')+rel('config/settings2.xml','settings').replace('rId1','rId2')+rel('assets/theme8.xml','theme').replace('rId1','rId3');
 const result=await inspectThesisDocxTemplate(await fixture({omitStyles:true,extra:{'word/_rels/document.xml.rels':`<Relationships xmlns="${R}">${rels}</Relationships>`,'word/alternate/styles2.xml':styles,'word/config/settings2.xml':`<w:settings xmlns:w="${W}"><w:mirrorMargins/></w:settings>`,'word/assets/theme8.xml':theme}}));assert.equal(result.rules.styles.Normal.size,26);assert.equal(result.rules.styles.Normal.eastAsia,'楷体');assert.equal(result.rules.styles.Normal.ascii,'Georgia');assert.ok(result.warnings.some(text=>text.includes('镜像')));assert.ok(!result.warnings.some(text=>text.includes('没有 styles.xml')));
});

test('PaperKnow canonical styles retain distinct cover title, normal body and direct indentation',async()=>{
 const styles=normal+'<w:style w:type="paragraph" w:styleId="PKTitle"><w:name w:val="PaperKnow Title"/><w:rPr><w:sz w:val="44"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="PKHeading1"><w:name w:val="PaperKnow Heading1"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="PKNormal"><w:name w:val="PaperKnow Normal"/><w:basedOn w:val="Normal"/></w:style>';
 const body=para('合成封面题目','<w:pStyle w:val="PKTitle"/>')+para('合成章节','<w:pStyle w:val="PKHeading1"/><w:ind w:firstLine="360"/>')+para('真正的合成论文正文，与封面标题样式应当区分。','<w:pStyle w:val="PKNormal"/>');
 const result=await inspectThesisDocxTemplate(await fixture({styles,body}));assert.equal(result.rules.styles.Title.size,44);assert.equal(result.rules.styles.Normal.size,24);assert.equal(result.rules.styles.Heading1.firstLine,360);assert.equal(result.rules.styles.Heading1.firstLineChars,0);
});

test('front display headings and cached TOC rows cannot overwrite the normal style of an empty template',async()=>{
 const styles=normal+'<w:style w:type="paragraph" w:styleId="PKNormal"><w:name w:val="PaperKnow Normal"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="PKFrontHeading"><w:name w:val="PaperKnow Front Heading"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:sz w:val="32"/><w:b/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="PKTOC1"><w:name w:val="PaperKnow TOC 1"/><w:rPr><w:sz w:val="40"/></w:rPr></w:style>';
 const body=para('较长封面标题不得作为正文格式样本','<w:pStyle w:val="PKFrontHeading"/>')+para('较长的目录示例条目不得当作正文样式','<w:pStyle w:val="PKTOC1"/>')+para('{{正文}}','<w:pStyle w:val="PKNormal"/>');
 const result=await inspectThesisDocxTemplate(await fixture({styles,body}));assert.equal(result.rules.styles.Normal.size,24);assert.equal(result.rules.styles.Normal.eastAsia,'仿宋');assert.equal(result.rules.styles.Normal.bold,false);
});

test('unstyled large centered cover cannot replace the declared 11pt Kai body format',async()=>{
 const styles='<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="楷体"/><w:sz w:val="22"/></w:rPr></w:style>';
 const body=para('学校格式样例','<w:jc w:val="center"/><w:spacing w:after="120"/>','<w:b/><w:sz w:val="36"/>')+para('{{正文}}','<w:spacing w:after="120"/>');
 const result=await inspectThesisDocxTemplate(await fixture({styles,body}));assert.equal(result.rules.styles.Normal.eastAsia,'楷体');assert.equal(result.rules.styles.Normal.size,22);assert.equal(result.rules.styles.Normal.bold,false);assert.equal(result.rules.styles.Normal.alignment,'both');assert.ok(result.unresolved.includes('styles.Normal.bold'));assert.ok(result.unresolved.includes('styles.Normal.alignment'));
});

test('named Normal properties take precedence while credible body formatting can fill undefined fields',async()=>{
 const styles='<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:eastAsia="楷体"/><w:sz w:val="22"/></w:rPr></w:style>',body=para('这是合成正文内容，采用学校正文样式。直接格式不应覆盖已有学校字号。','<w:pStyle w:val="Normal"/><w:jc w:val="left"/><w:spacing w:line="300" w:lineRule="exact"/>','<w:sz w:val="24"/>');
 const result=await inspectThesisDocxTemplate(await fixture({styles,body}));assert.equal(result.rules.styles.Normal.size,22);assert.equal(result.rules.styles.Normal.eastAsia,'楷体');assert.equal(result.rules.styles.Normal.alignment,'left');assert.equal(result.rules.styles.Normal.line,300);assert.equal(result.rules.styles.Normal.lineRule,'exact');
});

test('missing styles and multi-section layouts remain explicit, without fabricated full recognition',async()=>{
 const body=para('合成正文','<w:sectPr><w:pgSz w:w="16838" w:h="11906"/><w:pgMar w:top="1600"/></w:sectPr>'),result=await inspectThesisDocxTemplate(await fixture({omitStyles:true,body}));assert.equal(result.rules.page.width,11906);assert.equal(result.rules.page.top,1800);assert.ok(result.unresolved.includes('styles.Normal.eastAsia'));assert.ok(result.warnings.some(text=>text.includes('多个分节')));assert.ok(result.warnings.some(text=>text.includes('没有 styles.xml')));
});

test('safe header/footer/image relationships and ordinary hyperlinks are accepted without network',async()=>{
 const extra={'word/_rels/document.xml.rels':`<r:Relationships xmlns:r="${R}">${rel('header1.xml','header')}</r:Relationships>`,'word/header1.xml':`<w:hdr xmlns:w="${W}">${para('合成页眉')}<w:p><w:fldSimple w:instr="PAGE"/></w:p></w:hdr>`,'word/_rels/header1.xml.rels':`<Relationships xmlns="${R}">${rel('media/logo.png','image')}${rel('https://example.test/school','hyperlink','External').replace('rId1','rId2')}</Relationships>`,'word/media/logo.png':new Uint8Array([1,2,3])};let calls=0;const previous=globalThis.fetch;globalThis.fetch=()=>{calls++;throw Error('network prohibited');};try{const value=await inspectThesisDocxTemplate(await fixture({extra}));assert.ok(value.warnings.some(text=>text.includes('超链接')));assert.equal(calls,0);}finally{globalThis.fetch=previous;}
});

test('rejects DTD, malformed XML, and external fields even in headers or split instruction runs',async()=>{
 for(const header of [`<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><w:hdr xmlns:w="${W}"/>`,`<w:hdr xmlns:w="${W}"><w:p></w:hdr>`,`<w:hdr xmlns:w="${W}"><w:p><w:r><w:instrText>INCLUDE</w:instrText></w:r><w:r><w:instrText>TEXT</w:instrText></w:r></w:p></w:hdr>`])await assert.rejects(()=>fixture({extra:{'word/header1.xml':header}}).then(inspectThesisDocxTemplate),/DTD|XML|字段/);
});

test('rejects macros, embedded objects, activeX and unsafe external relationships',async()=>{
 const attacks=[{type:'application/vnd.ms-word.document.macroEnabled.main+xml'},{extra:{'word/vbaProject.bin':new Uint8Array([0])}},{extra:{'word/embeddings/object1.bin':new Uint8Array([0])}},{body:`<w:object xmlns:w="${W}"/>`},{extra:{'word/_rels/document.xml.rels':`<Relationships xmlns="${R}">${rel('https://example.test/logo.png','image','External')}</Relationships>`}},{extra:{'word/_rels/document.xml.rels':`<Relationships xmlns="${R}">${rel('javascript:alert(1)','hyperlink','External')}</Relationships>`}}];for(const attack of attacks)await assert.rejects(()=>fixture(attack).then(inspectThesisDocxTemplate),/宏|活动|嵌入|外部/);
});

test('rejects traversal, missing relationship targets, oversized directories and declared zip bombs',async()=>{
 await assert.rejects(()=>fixture({extra:{'../escape.xml':'<x/>'}}).then(inspectThesisDocxTemplate),/路径/);
 await assert.rejects(()=>fixture({extra:{'word/_rels/document.xml.rels':`<Relationships xmlns="${R}">${rel('../../outside.xml','header')}</Relationships>`}}).then(inspectThesisDocxTemplate),/范围/);
 await assert.rejects(()=>fixture({extra:{'word/_rels/document.xml.rels':`<Relationships xmlns="${R}">${rel('missing.xml','header')}</Relationships>`}}).then(inspectThesisDocxTemplate),/缺失/);
 await assert.rejects(()=>fixture({extra:Object.fromEntries(Array.from({length:201},(_,i)=>['word/x'+i+'.xml','<x/>']))}).then(inspectThesisDocxTemplate),/200/);
 const bytes=await fixture(),view=new DataView(bytes.buffer);let central=0;while(view.getUint32(central,true)!==0x02014b50)central++;view.setUint32(central+24,26*1024*1024,true);await assert.rejects(()=>inspectThesisDocxTemplate(bytes),/25 MB/);
});

test('actual inflation cannot exceed a forged small declared size, and encrypted flags are rejected',async()=>{
 const bytes=await fixture(),view=new DataView(bytes.buffer);let central=0;while(view.getUint32(central,true)!==0x02014b50)central++;view.setUint32(central+24,1,true);await assert.rejects(()=>inspectThesisDocxTemplate(bytes),/安全范围/);
 const encrypted=await fixture(),ev=new DataView(encrypted.buffer);let e=0;while(ev.getUint32(e,true)!==0x02014b50)e++;ev.setUint16(e+8,ev.getUint16(e+8,true)|1,true);await assert.rejects(()=>inspectThesisDocxTemplate(encrypted),/加密/);
 await assert.rejects(()=>inspectThesisDocxTemplate(new Uint8Array(2*1024*1024+1)),/2 MB/);
});
