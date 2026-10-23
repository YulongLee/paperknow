import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {createWritingDocx,inspectThesisDocxTemplate} from '../src/writing-document.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const rangeFor=(text,needle,number)=>{const location=text.indexOf(needle);assert.ok(location>=0,needle);const offset=needle.indexOf('['+number+']');assert.ok(offset>=0);const start=location+offset;return {start,end:start+String(number).length+2,number};};
const sample='合成论文题目\n摘要\n摘要全文保留标记。\n第一章 绪论\n1.1 研究背景\n1.1.1 具体问题\n正文中的中文、English 123 和 $E=mc^2$ 应当保留。\n|组别|数量|\n|---|---|\n|实验组|12|\n第二章 讨论\n全部结论原样保留。\n参考文献\n[1] 真实来源待核对。';
const docx=options=>createWritingDocx(sample,{documentKind:'thesis',metadata:{title:'合成论文题目',level:'本科',major:'计算机科学'},...options});
const read=async bytes=>{const zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');return {zip,xml,document:new DOMParser().parseFromString(xml,'application/xml')};};
test('default thesis exports have real cover, editable three-level headings, TOC and separate Roman/Arabic page sections',async()=>{
 const {zip,xml,document}=await read(await docx());assert.equal(document.getElementsByTagNameNS(W,'sectPr').length,3);assert.match(xml,/w:fmt="upperRoman" w:start="1"/);assert.match(xml,/w:fmt="decimal" w:start="1"/);assert.match(xml,/TOC \\o &quot;1-3&quot;|TOC \\o "1-3"/);assert.match(xml,/PKHeading3/);assert.match(xml,/w:bookmarkStart/);assert.match(xml,/w:hyperlink w:anchor="PK_/);assert.ok(zip.file('word/pk-footer.xml'));assert.match(await zip.file('word/settings.xml').async('string'),/updateFields[^>]+true/);
 const styles=await zip.file('word/styles.xml').async('string');assert.match(styles,/w:firstLineChars="200"/);assert.match(styles,/w:eastAsia="宋体"/);assert.match(styles,/w:styleId="PKReferences"/);assert.doesNotMatch(styles.match(/<w:style[^>]+styleId="PKNormal"[^>]*>[\s\S]*?<\/w:style>/)[0],/<w:basedOn/);assert.match(xml,/w:top="1701"/);assert.match(xml,/w:bottom="1417"/);
 const content=[...document.getElementsByTagNameNS(W,'t')].map(n=>n.textContent).join('');for(const marker of ['摘要全文保留标记。','全部结论原样保留。','[1] 真实来源待核对。','实验组'])assert.ok(content.includes(marker),marker);assert.equal(document.getElementsByTagNameNS(W,'tbl').length,1);assert.ok(document.getElementsByTagName('m:oMath').length>0);
});
test('a real uploaded DOCX controls body and heading formatting and margins; its sample text is not reused',async()=>{
 const template=await read(await createWritingDocx('模板示例题目\n第一章 模板样例\n正文模板样例。'));
 template.zip.file('word/styles.xml',(await template.zip.file('word/styles.xml').async('string')).replace('w:eastAsia="宋体"','w:eastAsia="仿宋"').replace('w:val="24"','w:val="28"'));
 template.zip.file('word/document.xml',template.xml.replace('w:left="1440"','w:left="2000"'));
 const bytes=await template.zip.generateAsync({type:'uint8array'}),{zip,xml}=await read(await docx({template:{status:'ready',bytes}}));const styles=await zip.file('word/styles.xml').async('string');assert.match(styles,/w:styleId="PKNormal"[^]*?w:eastAsia="仿宋"/);assert.match(styles,/w:styleId="PKNormal"[^]*?w:sz w:val="28"/);assert.match(xml,/w:left="2000"/);assert.doesNotMatch(xml,/模板样例|模板示例题目/);assert.match(xml,/全部结论原样保留/);
});
test('explicit content slots retain actual template cover and headers while replacing content and known metadata only',async()=>{
 const reference=await read(await createWritingDocx('{{论文题目}}\n学校封面布局\n{{正文}}\n封底固定说明'));
 reference.zip.file('word/header1.xml',`<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>合成学校页眉</w:t></w:r></w:p></w:hdr>`);
 reference.zip.file('word/document.xml',reference.xml.replace('<w:sectPr>','<w:sectPr><w:headerReference xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" w:type="default" r:id="rIdHeader"/>'));
 reference.zip.file('word/_rels/document.xml.rels',(await reference.zip.file('word/_rels/document.xml.rels').async('string')).replace('</Relationships>','<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>'));
 reference.zip.file('[Content_Types].xml',(await reference.zip.file('[Content_Types].xml').async('string')).replace('</Types>','<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'));
 const bytes=await reference.zip.generateAsync({type:'uint8array'}),{zip,xml}=await read(await docx({template:{bytes,status:'ready'}}));assert.match(xml,/学校封面布局/);assert.match(xml,/封底固定说明/);assert.match(xml,/摘要全文保留标记/);assert.match(xml,/合成论文题目/);assert.doesNotMatch(xml,/\{\{正文\}\}|\{\{论文题目\}\}/);assert.equal(await zip.file('word/header1.xml').async('string'),await reference.zip.file('word/header1.xml').async('string'));assert.match(await zip.file('word/_rels/document.xml.rels').async('string'),/settings/);
});
test('a selected missing, corrupt or unsafe template never silently falls back to defaults',async()=>{
 await assert.rejects(docx({template:{status:'unavailable'}}),/不可用/);await assert.rejects(docx({template:{status:'ready'}}),/不可用/);await assert.rejects(docx({template:{bytes:new Uint8Array([1,2]),status:'ready'}}));
});
test('downloadable default template can be reuploaded and roundtrips its editable role styles',async()=>{
 const bytes=await createWritingDocx('{{论文题目}}\n{{正文}}',{documentKind:'thesis',metadata:{title:'{{论文题目}}'}}),profile=await inspectThesisDocxTemplate(bytes);assert.ok(profile.recognized.includes('styles.Normal.eastAsia'));assert.equal(profile.rules.styles.Normal.size,24);assert.equal(profile.rules.styles.Title.size,44);const {xml}=await read(await docx({template:{bytes,status:'ready'}}));assert.match(xml,/合成论文题目/);assert.match(xml,/摘要全文保留标记/);assert.match(xml,/全部结论原样保留/);assert.doesNotMatch(xml,/\{\{正文\}\}/);
});

test('slot metadata replacement never rewrites literal tokens inside the generated paper',async()=>{
 const template=await createWritingDocx('{{论文题目}}\n学校封面中的{{作者}}\n{{PAPERKNOW_CONTENT}}');
 const text='合成论文题目\n第一章 模板语法研究\n正文{{作者}}保留，正文{{学校}}保留，正文{{论文题目}}保留。';
 const {xml,document}=await read(await createWritingDocx(text,{documentKind:'thesis',metadata:{title:'合成论文题目',author:'封面真实作者',institution:'封面真实学校'},template:{status:'ready',bytes:template}}));
 const content=[...document.getElementsByTagNameNS(W,'t')].map(node=>node.textContent).join('');
 assert.match(content,/学校封面中的封面真实作者/);assert.ok(content.includes('正文{{作者}}保留，正文{{学校}}保留，正文{{论文题目}}保留。'));assert.doesNotMatch(xml,/\{\{PAPERKNOW_CONTENT\}\}/);
});

test('explicit unnumbered chapter titles end the abstract and become actual body headings and TOC entries',async()=>{
 const chapterTitles=['研究对象的复杂情境','访谈文本的编码路径'],text='合成论文题目\n摘要\n摘要段落保留。\n'+chapterTitles[0]+'\n正文甲保留。\n'+chapterTitles[1]+'\n正文乙保留。';
 const {document}=await read(await createWritingDocx(text,{documentKind:'thesis',metadata:{title:'合成论文题目',chapterTitles}}));
 const paragraphs=[...document.getElementsByTagNameNS(W,'p')].map(node=>({text:[...node.getElementsByTagNameNS(W,'t')].map(part=>part.textContent).join(''),style:node.getElementsByTagNameNS(W,'pStyle')[0]?.getAttributeNS(W,'val')}));
 for(const title of chapterTitles){assert.ok(paragraphs.some(row=>row.text===title&&row.style==='PKHeading1'),title+' must be a body chapter');assert.ok(paragraphs.some(row=>row.text.trim()===title&&row.style==='PKTOC1'),title+' must be in the TOC');}
 for(const text of ['正文甲保留。','正文乙保留。'])assert.equal(paragraphs.find(row=>row.text===text)?.style,'PKNormal');assert.equal(paragraphs.find(row=>row.text==='摘要段落保留。')?.style,'PKAbstract');
});

const packageRelationships='http://schemas.openxmlformats.org/package/2006/relationships',officeRelationships='http://schemas.openxmlformats.org/officeDocument/2006/relationships',contentTypes='http://schemas.openxmlformats.org/package/2006/content-types';
async function headerTemplate({slot=false,prefixed=false}={}){
 const input=await read(await createWritingDocx(slot?'学校模板\n{{PAPERKNOW_CONTENT}}':'学校模板\n普通样例正文'));
 input.zip.file('word/document.xml',input.xml.replace('<w:document ',`<w:document xmlns:r="${officeRelationships}" `).replace('<w:sectPr>','<w:sectPr><w:headerReference w:type="default" r:id="templateHeader"/>'));
 input.zip.file('word/header1.xml',`<w:hdr xmlns:w="${W}" xmlns:r="${officeRelationships}"><w:p><w:hyperlink r:id="schoolLink"><w:r><w:t>合成学校官网</w:t></w:r></w:hyperlink></w:p></w:hdr>`);
 const headerRels=`<Relationships xmlns="${packageRelationships}"><Relationship Id="schoolLink" Type="${officeRelationships}/hyperlink" Target="https://example.test/school" TargetMode="External"/><Relationship Id="mailLink" Type="${officeRelationships}/hyperlink" Target="mailto:school@example.test" TargetMode="External"/></Relationships>`;
 input.zip.file('word/_rels/header1.xml.rels',headerRels);
 let relations=(await input.zip.file('word/_rels/document.xml.rels').async('string')).replace('</Relationships>',`<Relationship Id="templateHeader" Type="${officeRelationships}/header" Target="header1.xml"/></Relationships>`),types=(await input.zip.file('[Content_Types].xml').async('string')).replace('</Types>','<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>');
 if(prefixed){relations=relations.replace(/<(\/?)(Relationships|Relationship)\b/g,'<$1r:$2').replace(`xmlns="${packageRelationships}"`,`xmlns:r="${packageRelationships}"`);types=types.replace(/<(\/?)(Types|Default|Override)\b/g,'<$1ct:$2').replace(`xmlns="${contentTypes}"`,`xmlns:ct="${contentTypes}"`);}
 input.zip.file('word/_rels/document.xml.rels',relations);input.zip.file('[Content_Types].xml',types);return {bytes:await input.zip.generateAsync({type:'uint8array',compression:'DEFLATE'}),headerRels};
}

test('legal external header hyperlinks remain ordinary links without fetching or copying the remote destination',async()=>{
 const {bytes,headerRels}=await headerTemplate(),old=globalThis.fetch;let requests=0;globalThis.fetch=()=>{requests++;throw Error('remote access is prohibited');};
 try{const {zip,xml}=await read(await createWritingDocx('合成论文题目\n第一章 背景\n正文保留。',{documentKind:'thesis',template:{status:'ready',bytes}}));assert.match(xml,/headerReference/);assert.equal(await zip.file('word/_rels/header1.xml.rels').async('string'),headerRels);assert.match(await zip.file('word/header1.xml').async('string'),/合成学校官网/);assert.equal(requests,0);assert.equal(Object.keys(zip.files).some(path=>path.includes('https:')||path.includes('mailto:')),false);}finally{globalThis.fetch=old;}
});

test('static hyperlink and page fields survive both template export modes without accessing their targets',async()=>{
 const old=globalThis.fetch;let requests=0;globalThis.fetch=()=>{requests++;throw Error('remote access prohibited');};
 try{for(const slot of [false,true]){
  const base=await headerTemplate({slot}),input=await read(base.bytes),header=`<w:hdr xmlns:w="${W}"><w:p><w:fldSimple w:instr='HYPERLINK "https://example.edu.cn/rules" \\o "学校 LINK 说明"'><w:r><w:t>合成学校规范</w:t></w:r></w:fldSimple><w:fldSimple w:instr='HYPERLINK \\l "_Toc123"'><w:r><w:t>目录跳转</w:t></w:r></w:fldSimple><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:hdr>`;
  input.zip.file('word/header1.xml',header);const source=await input.zip.generateAsync({type:'uint8array'}),unchanged=new Uint8Array(source),{zip,xml}=await read(await docx({template:{status:'ready',bytes:source}}));
  const exported=await zip.file('word/header1.xml').async('string');assert.equal(exported,header);assert.match(exported,/HYPERLINK/);assert.match(exported,/PAGE/);assert.match(xml,/全部结论原样保留/);assert.deepEqual(source,unchanged);
 }}finally{globalThis.fetch=old;}assert.equal(requests,0);
});

test('cached picture imports become embedded static images in the exported copy while the template original stays unchanged',async()=>{
 const old=globalThis.fetch;let requests=0;globalThis.fetch=()=>{requests++;throw Error('remote access prohibited');};
 const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRWQAAAAASUVORK5CYII=','base64'));
 try{for(const slot of [false,true]){
  const base=await headerTemplate({slot}),input=await read(base.bytes),header=`<w:hdr xmlns:w="${W}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${officeRelationships}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> INCLUDEPICTURE "C:\\obsolete\\logo.png" \\d \\* MERGEFORMATINET </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:b/></w:rPr><w:drawing><a:blip r:embed="cachedLogo"/></w:drawing></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>`;
  input.zip.file('word/header1.xml',header);input.zip.file('word/media/cached-logo.png',png);input.zip.file('word/_rels/header1.xml.rels',`<Relationships xmlns="${packageRelationships}"><Relationship Id="cachedLogo" Type="${officeRelationships}/image" Target="media/cached-logo.png"/></Relationships>`);input.zip.file('[Content_Types].xml',(await input.zip.file('[Content_Types].xml').async('string')).replace('</Types>','<Default Extension="png" ContentType="image/png"/></Types>'));
  const source=await input.zip.generateAsync({type:'uint8array'}),unchanged=new Uint8Array(source),{zip,xml}=await read(await docx({template:{status:'ready',bytes:source}})),exported=await zip.file('word/header1.xml').async('string');
  assert.doesNotMatch(exported,/INCLUDEPICTURE|obsolete|fldChar/);assert.match(exported,/r:embed="cachedLogo"/);assert.match(exported,/w:jc w:val="center"/);assert.match(exported,/<w:b/);assert.deepEqual(await zip.file('word/media/cached-logo.png').async('uint8array'),png);assert.match(xml,/全部结论原样保留/);assert.deepEqual(source,unchanged);assert.match(await (await read(source)).zip.file('word/header1.xml').async('string'),/INCLUDEPICTURE/);
 }}finally{globalThis.fetch=old;}assert.equal(requests,0);
});

test('prefixed package content types and relationships retain header typing and do not introduce duplicate overrides or relations',async()=>{
 for(const slot of [false,true]){
  const {bytes}=await headerTemplate({slot,prefixed:true}),{zip}=await read(await createWritingDocx('合成论文题目\n第一章 背景\n正文保留。',{documentKind:'thesis',template:{status:'ready',bytes}}));
  const typeDoc=new DOMParser().parseFromString(await zip.file('[Content_Types].xml').async('string'),'application/xml'),overrides=[...typeDoc.getElementsByTagNameNS(contentTypes,'Override')].map(node=>node.getAttribute('PartName'));
  assert.equal(new Set(overrides).size,overrides.length,'every part has one content type');assert.ok(overrides.includes('/word/header1.xml'));assert.ok(typeDoc.getElementsByTagNameNS(contentTypes,'Default').length>=2);
  const relationDoc=new DOMParser().parseFromString(await zip.file('word/_rels/document.xml.rels').async('string'),'application/xml'),relations=[...relationDoc.getElementsByTagNameNS(packageRelationships,'Relationship')];
  for(const type of ['styles','settings','header'])assert.equal(relations.filter(node=>node.getAttribute('Type')===officeRelationships+'/'+type).length,1,type+' relation must be unique');
  assert.ok(zip.file('word/header1.xml'));assert.match(await zip.file('word/document.xml').async('string'),/正文保留/);
 }
});

test('slot insertion preserves existing bookmarks and allocates unique ids and names to generated headings',async()=>{
 const input=await read(await createWritingDocx('学校封面\n{{PAPERKNOW_CONTENT}}'));
 input.zip.file('word/document.xml',input.xml.replace('</w:pPr>','</w:pPr><w:bookmarkStart w:id="1" w:name="SchoolCover"/><w:bookmarkStart w:id="5" w:name="PK_2"/>').replace('</w:p>','<w:bookmarkEnd w:id="5"/><w:bookmarkEnd w:id="1"/></w:p>'));
 const {document}=await read(await createWritingDocx('合成论文题目\n第一章 背景\n正文甲。\n第二章 结果\n正文乙。',{documentKind:'thesis',template:{status:'ready',bytes:await input.zip.generateAsync({type:'uint8array',compression:'DEFLATE'})}}));
 const starts=[...document.getElementsByTagNameNS(W,'bookmarkStart')],ids=starts.map(node=>node.getAttributeNS(W,'id')),names=starts.map(node=>node.getAttributeNS(W,'name')),endIds=[...document.getElementsByTagNameNS(W,'bookmarkEnd')].map(node=>node.getAttributeNS(W,'id'));
 assert.equal(new Set(ids).size,ids.length);assert.equal(new Set(names).size,names.length);assert.ok(starts.some(node=>node.getAttributeNS(W,'id')==='1'&&node.getAttributeNS(W,'name')==='SchoolCover'));assert.ok(starts.some(node=>node.getAttributeNS(W,'id')==='5'&&node.getAttributeNS(W,'name')==='PK_2'));assert.deepEqual([...ids].sort(),endIds.sort());
});

test('slot-managed styles and settings relationships allocate ids without colliding with existing headers or hyperlinks',async()=>{
 const input=await read((await headerTemplate({slot:true})).bytes);
 input.zip.file('word/document.xml',input.xml.replaceAll('templateHeader','pksettings'));
 const relationXml=(await input.zip.file('word/_rels/document.xml.rels').async('string')).replaceAll('templateHeader','pksettings').replace(/<Relationship\b(?=[^>]*Type="[^"]*\/styles")[^>]*\/>/g,'').replace('</Relationships>',`<Relationship Id="pkstyles" Type="${officeRelationships}/hyperlink" Target="https://example.test/source" TargetMode="External"/></Relationships>`);
 input.zip.file('word/_rels/document.xml.rels',relationXml);
 const {zip,document}=await read(await createWritingDocx('合成论文题目\n第一章 背景\n正文保留。',{documentKind:'thesis',template:{status:'ready',bytes:await input.zip.generateAsync({type:'uint8array',compression:'DEFLATE'})}})),relationDoc=new DOMParser().parseFromString(await zip.file('word/_rels/document.xml.rels').async('string'),'application/xml'),relations=[...relationDoc.getElementsByTagNameNS(packageRelationships,'Relationship')],ids=relations.map(node=>node.getAttribute('Id'));
 assert.equal(new Set(ids).size,ids.length);assert.equal(relations.find(node=>node.getAttribute('Id')==='pksettings')?.getAttribute('Type'),officeRelationships+'/header');assert.equal(relations.find(node=>node.getAttribute('Id')==='pkstyles')?.getAttribute('Type'),officeRelationships+'/hyperlink');assert.equal(document.getElementsByTagNameNS(W,'headerReference')[0].getAttributeNS(officeRelationships,'id'),'pksettings');
 for(const type of ['styles','settings'])assert.equal(relations.filter(node=>node.getAttribute('Type')===officeRelationships+'/'+type).length,1);
});

test('slot templates update the actual noncanonical styles and settings parts selected by package relationships',async()=>{
 const input=await read((await headerTemplate({slot:true})).bytes),stylePart='word/layout/school-styles.xml',settingsPart='word/layout/school-settings.xml';
 input.zip.file(stylePart,(await input.zip.file('word/styles.xml').async('string')).replace('w:eastAsia="宋体"','w:eastAsia="仿宋"'));input.zip.remove('word/styles.xml');input.zip.file(settingsPart,`<w:settings xmlns:w="${W}"><w:evenAndOddHeaders/></w:settings>`);
 input.zip.file('word/_rels/document.xml.rels',(await input.zip.file('word/_rels/document.xml.rels').async('string')).replace('Target="styles.xml"','Target="layout/school-styles.xml"').replace('</Relationships>',`<Relationship Id="schoolSettings" Type="${officeRelationships}/settings" Target="layout/school-settings.xml"/></Relationships>`));
 input.zip.file('[Content_Types].xml',(await input.zip.file('[Content_Types].xml').async('string')).replace('/word/styles.xml','/'+stylePart).replace('</Types>',`<Override PartName="/${settingsPart}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`));
 const {zip}=await read(await createWritingDocx('合成论文题目\n第一章 背景\n正文保留。',{documentKind:'thesis',template:{status:'ready',bytes:await input.zip.generateAsync({type:'uint8array',compression:'DEFLATE'})}}));
 assert.match(await zip.file(stylePart).async('string'),/w:styleId="PKNormal"[^]*?w:eastAsia="仿宋"/);assert.match(await zip.file(settingsPart).async('string'),/updateFields[^>]+true/);assert.match(await zip.file(settingsPart).async('string'),/evenAndOddHeaders/);
 const relations=new DOMParser().parseFromString(await zip.file('word/_rels/document.xml.rels').async('string'),'application/xml');for(const [type,target]of [['styles','layout/school-styles.xml'],['settings','layout/school-settings.xml']])assert.equal([...relations.getElementsByTagNameNS(packageRelationships,'Relationship')].find(node=>node.getAttribute('Type')===officeRelationships+'/'+type)?.getAttribute('Target'),target);
});

test('thesis citations link only to unique numbered bibliography entries and remain superscript without altering ordinary indices',async()=>{
 const text='引用排版测试\n第一章 绪论\n这里引用了已确认的文献[2]以及相邻来源[1][2]，未知编号[9]保持原文。\n|索引|内容|\n|---|---|\n|[1]|表格编号不应推断为文献引用|\n$$x_{[1]}=2$$\n参考文献\n[1] 张三. 合成研究来源一. 2024.\n[2] 李四. 合成研究来源二. 2025.\n待引用文献（尚未在正文引用）\n[待引用1] 未使用的来源[9]。';
 const {document,xml}=await read(await createWritingDocx(text,{documentKind:'thesis',metadata:{citationRanges:[rangeFor(text,'文献[2]',2),rangeFor(text,'来源[1]',1),rangeFor(text,'][2]',2)]}}));
 const starts=[...document.getElementsByTagNameNS(W,'bookmarkStart')].filter(node=>node.getAttributeNS(W,'name').startsWith('PKRef_')),targets=new Set(starts.map(node=>node.getAttributeNS(W,'name'))),links=[...document.getElementsByTagNameNS(W,'hyperlink')].filter(node=>targets.has(node.getAttributeNS(W,'anchor')));
 assert.equal(starts.length,2);assert.equal(links.length,3);assert.deepEqual(links.map(node=>node.textContent),['[2]','[1]','[2]']);for(const link of links)assert.equal(link.getElementsByTagNameNS(W,'vertAlign')[0]?.getAttributeNS(W,'val'),'superscript');
 assert.equal(document.getElementsByTagNameNS(W,'tbl')[0].getElementsByTagNameNS(W,'hyperlink').length,0);assert.match(xml,/未知编号\[9\]保持原文/);assert.match(xml,/未使用的来源\[9\]/);
 const duplicate=await read(await createWritingDocx('重复编号\n第一章 绪论\n重复编号引用[1]不应任意跳转。\n参考文献\n[1] 来源甲。\n[1] 来源乙。',{documentKind:'thesis'}));assert.equal([...duplicate.document.getElementsByTagNameNS(W,'bookmarkStart')].filter(node=>node.getAttributeNS(W,'name').startsWith('PKRef_')).length,0);
});

test('narrow template page regions constrain both TOC tabs and generated table geometry',async()=>{
 const base=await read(await createWritingDocx('模板\n普通示例正文'));
 base.zip.file('word/document.xml',base.xml.replace('w:left="1440"','w:left="2600"').replace('w:right="1440"','w:right="2600"'));
 const bytes=await base.zip.generateAsync({type:'uint8array',compression:'DEFLATE'}),{document}=await read(await docx({template:{status:'ready',bytes}})),available=11906-5200;
 for(const tab of document.getElementsByTagNameNS(W,'tab'))if(tab.hasAttributeNS(W,'pos'))assert.ok(Number(tab.getAttributeNS(W,'pos'))<available);
 const table=document.getElementsByTagNameNS(W,'tbl')[0];assert.equal(Number(table.getElementsByTagNameNS(W,'tblW')[0].getAttributeNS(W,'w')),available);assert.ok([...table.getElementsByTagNameNS(W,'gridCol')].reduce((sum,node)=>sum+Number(node.getAttributeNS(W,'w')),0)<=available+1);
});

test('slot tables use their actual insertion section width rather than the template last section',async()=>{
 const base=await read(await createWritingDocx('学校封面\n{{正文}}\n后置横向说明'));
 const section='<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="2600" w:right="2600" w:gutter="0"/></w:sectPr>';
 base.zip.file('word/document.xml',base.xml.replace('</w:t></w:r></w:p><w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:t xml:space="preserve">后置横向说明','</w:t></w:r></w:p><w:p><w:pPr>'+section+'</w:pPr></w:p><w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:t xml:space="preserve">后置横向说明'));
 const bytes=await base.zip.generateAsync({type:'uint8array',compression:'DEFLATE'}),{document,xml}=await read(await docx({template:{status:'ready',bytes}}));assert.equal(document.getElementsByTagNameNS(W,'sectPr').length,2,'test fixture retains distinct insertion and final sections');const table=document.getElementsByTagNameNS(W,'tbl')[0];assert.equal(Number(table.getElementsByTagNameNS(W,'tblW')[0].getAttributeNS(W,'w')),11906-5200);assert.match(xml,/学校封面/);assert.match(xml,/后置横向说明/);
});

test('Markdown headings become clean semantic Word headings while dated and numbered prose stay normal',async()=>{
 const text='标题层级测试\n## 摘要\n摘要内容。\n# 第一章 绪论\n2026 年的研究描述应当保持正文。\n1 这个段落是完整的叙述句，不应被错误识别为章标题。\n## 1.1 研究背景\n正文引用[1]，代码`array[1]`保持字面量。\n## 参考文献\n[1] 合成真实对应题录。\n待引用文献（尚未在正文引用）\n[待引用1] 候选中出现[1]也不应连接。\n参考文献整理原文（待核对）\n整理原文[1]和原编号信息保留。';
 const {document}=await read(await createWritingDocx(text,{documentKind:'thesis',metadata:{citationRanges:[rangeFor(text,'正文引用[1]',1)]}}));
 const paras=[...document.getElementsByTagNameNS(W,'p')],paragraphText=node=>[...node.getElementsByTagNameNS(W,'t')].map(n=>n.textContent).join('');
 for(const marker of ['第一章 绪论','1.1 研究背景','参考文献'])assert.ok(paras.some(node=>paragraphText(node)===marker&&node.getElementsByTagNameNS(W,'pStyle')[0]?.getAttributeNS(W,'val').startsWith('PKHeading')),marker);
 for(const marker of ['2026 年的研究描述应当保持正文。','1 这个段落是完整的叙述句，不应被错误识别为章标题。'])assert.equal(paras.find(node=>paragraphText(node)===marker)?.getElementsByTagNameNS(W,'pStyle')[0]?.getAttributeNS(W,'val'),'PKNormal');
 const referenceLinks=[...document.getElementsByTagNameNS(W,'hyperlink')].filter(node=>node.getAttributeNS(W,'anchor').startsWith('PKRef_'));assert.equal(referenceLinks.length,1);assert.equal(referenceLinks[0].textContent,'[1]');
 assert.equal(paras.some(node=>/^#{1,3}\s/.test(paragraphText(node))),false);
});

test('a last-section chapter-only header follows the actual exported chapter instead of repeating its stale sample label',async()=>{
 const reference=await headerTemplate(),input=await read(reference.bytes);
 input.zip.file('word/header1.xml',`<w:hdr xmlns:w="${W}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>致 谢</w:t></w:r></w:p></w:hdr>`);
 const source=await input.zip.generateAsync({type:'uint8array',compression:'DEFLATE'}),{zip}=await read(await createWritingDocx('合成论文\n第一章 绪论\n正文甲。\n第二章 设计\n正文乙。',{documentKind:'thesis',template:{status:'ready',bytes:source}})),header=await zip.file('word/header1.xml').async('string');
 assert.match(header,/STYLEREF/);assert.match(header,/PaperKnow Heading1/);assert.match(header,/第一章 绪论/);assert.doesNotMatch(header,/致 谢/);assert.match(header,/w:jc w:val="center"/);assert.equal(await input.zip.file('word/header1.xml').async('string'),`<w:hdr xmlns:w="${W}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>致 谢</w:t></w:r></w:p></w:hdr>`);
});

test('unproven bracketed indices remain literal even when matching bibliography numbers exist',async()=>{
 const text='引用来源验证\n第一章 绪论\narray[1]和中文符号端点[1]、真正文献[1]都不能仅凭数字猜测。\n参考文献\n[1] 合成文献信息。';
 for(const metadata of [{},{citationRanges:[]},{citationRanges:[{start:text.indexOf('[1]'),end:text.indexOf('[1]')+3,number:2}]}]){
  const {document}=await read(await createWritingDocx(text,{documentKind:'thesis',metadata}));assert.equal([...document.getElementsByTagNameNS(W,'hyperlink')].filter(node=>node.getAttributeNS(W,'anchor').startsWith('PKRef_')).length,0);assert.equal([...document.getElementsByTagNameNS(W,'bookmarkStart')].filter(node=>node.getAttributeNS(W,'name').startsWith('PKRef_')).length,1);
 }
});

test('provenance offsets survive UTF16 text, normalized lines, tab expansion and native or fallback inline formulas',async()=>{
 for(const formula of ['$E=mc^2$','$\\notARealCommand{x}$']){
  const raw='精确引用验证\r\n第一章 绪论\r\n😀\t首个真实来源[1]、数组array[1]、中文端点[1]。公式'+formula+'后引文[2]。\u0001\r\n参考文献\r\n[1] 资料甲。\r\n[2] 资料乙。',text=raw.replace(/\r\n?/g,'\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,''),metadata={citationRanges:[rangeFor(text,'真实来源[1]',1),rangeFor(text,'后引文[2]',2)]};
  const {document}=await read(await createWritingDocx(raw,{documentKind:'thesis',metadata})),links=[...document.getElementsByTagNameNS(W,'hyperlink')].filter(node=>node.getAttributeNS(W,'anchor').startsWith('PKRef_'));
  assert.deepEqual(links.map(node=>node.textContent),['[1]','[2]']);const textContent=[...document.getElementsByTagNameNS(W,'t')].map(node=>node.textContent).join('');assert.match(textContent,/array\[1\]/);assert.match(textContent,/中文端点\[1\]/);
 }
});
