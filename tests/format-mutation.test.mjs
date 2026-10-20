import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {defaultRules,checkFormatting} from '../dist/workspace/format-model.mjs';
globalThis.DOMParser=DOMParser;globalThis.XMLSerializer=XMLSerializer;
const {exampleDocx,parseDocx,applyDocx}=await import('../src/format-document.js');
const NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const parse=text=>new DOMParser().parseFromString(text,'application/xml');
const serialize=node=>new XMLSerializer().serializeToString(node);
async function documentFixture(transform){const zip=await JSZip.loadAsync(await exampleDocx());zip.file('word/document.xml',transform(await zip.file('word/document.xml').async('string')));zip.file('word/untouched-test.xml',`<w:document xmlns:w="${NS}"><w:p><w:r><w:t>未编辑包内内容 -3 mg [1]</w:t></w:r></w:p></w:document>`);return zip.generateAsync({type:'uint8array'});}
async function documentXml(bytes){return parse(await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string'));}
async function assertOtherPartsUnchanged(before,after){const a=await JSZip.loadAsync(before),b=await JSZip.loadAsync(after);for(const name of Object.keys(a.files).filter(name=>!a.files[name].dir&&name!=='word/document.xml'))assert.deepEqual(await b.file(name).async('uint8array'),await a.file(name).async('uint8array'),name);}

test('format inspection and mutation ignore a drawing-only container run while retaining real paragraph text',async()=>{
 const shape='<w:r><w:rPr><w:rFonts w:eastAsia="Arial"/><w:sz w:val="40"/></w:rPr><w:pict><v:shape id="Box1" style="width:160pt;height:45pt"><v:textbox><w:txbxContent><w:p><w:r><w:t>图内文字 -3 mg [1]</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r>';
 const input=await documentFixture(xml=>xml.replace('<w:document ', '<w:document xmlns:v="urn:schemas-microsoft-com:vml" ').replace('</w:p>',shape+'</w:p>')),doc=await parseDocx(input);
 assert.equal(doc.paragraphs[0].text,'第一章 绪论');assert.deepEqual(doc.paragraphs[0].format.font,['宋体']);assert.deepEqual(doc.paragraphs[0].format.size,[10.5]);
 const output=await applyDocx(input,doc,defaultRules()),before=await documentXml(input),after=await documentXml(output),originalContainer=before.getElementsByTagNameNS(NS,'pict')[0].parentNode,outputContainer=after.getElementsByTagNameNS(NS,'pict')[0].parentNode;
 assert.equal(serialize(outputContainer),serialize(originalContainer),'A drawing-only run and its properties remain unchanged');assert.equal(outputContainer.getElementsByTagNameNS(NS,'rFonts')[0].getAttributeNS(NS,'eastAsia'),'Arial');assert.equal(outputContainer.getElementsByTagNameNS(NS,'sz')[0].getAttributeNS(NS,'val'),'40');
 assert.equal(checkFormatting(await parseDocx(output),defaultRules()).length,0);await assertOtherPartsUnchanged(input,output);
});

test('a mixed run with actual direct text remains a formatting target even when it also contains a drawing',async()=>{
 const input=await documentFixture(xml=>xml.replace('</w:t></w:r>','</w:t><w:pict><w:txbxContent><w:p><w:r><w:t>嵌入对象文字</w:t></w:r></w:p></w:txbxContent></w:pict></w:r>')),doc=await parseDocx(input),output=await applyDocx(input,doc,defaultRules());assert.equal(doc.paragraphs[0].text,'第一章 绪论');const after=await documentXml(output),run=after.getElementsByTagNameNS(NS,'body')[0].getElementsByTagNameNS(NS,'r')[0];assert.equal(run.getElementsByTagNameNS(NS,'rFonts')[0].getAttributeNS(NS,'eastAsia'),'黑体');assert.equal(checkFormatting(await parseDocx(output),defaultRules()).length,0);await assertOtherPartsUnchanged(input,output);
});

for(const [name,properties,expected]of [
 ['page size followed by columns','<w:type w:val="nextPage"/><w:pgSz w:w="11906" w:h="16838"/><w:cols w:num="2"/><w:docGrid w:linePitch="360"/>',['type','pgSz','pgMar','cols','docGrid']],
 ['only properties after margins','<w:cols w:num="2"/><w:titlePg/><w:docGrid w:linePitch="360"/>',['pgMar','cols','titlePg','docGrid']],
 ['only page size','<w:pgSz w:w="11906" w:h="16838"/>',['pgSz','pgMar']],
 ['existing margins','<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="1440" w:right="1440" w:top="1440" w:bottom="1440"/><w:cols w:num="2"/>',['pgSz','pgMar','cols']]
])test('section margin insertion preserves valid relative ordering: '+name,async()=>{
 const input=await documentFixture(xml=>xml.replace(/<w:sectPr>[\s\S]*?<\/w:sectPr>/,'<w:sectPr>'+properties+'</w:sectPr>')),doc=await parseDocx(input),output=await applyDocx(input,doc,defaultRules()),a=(await documentXml(input)).getElementsByTagNameNS(NS,'sectPr')[0],b=(await documentXml(output)).getElementsByTagNameNS(NS,'sectPr')[0],elements=node=>Array.from(node.childNodes).filter(child=>child.nodeType===1);
 assert.deepEqual(elements(b).map(child=>child.localName),expected);assert.deepEqual(elements(b).filter(child=>child.localName!=='pgMar').map(serialize),elements(a).filter(child=>child.localName!=='pgMar').map(serialize),'Other section nodes retain their relative order and complete XML');assert.equal(b.getElementsByTagNameNS(NS,'pgMar').length,1);assert.equal(checkFormatting(await parseDocx(output),defaultRules()).length,0);await assertOtherPartsUnchanged(input,output);
});

test('nonblank source mapping is exact while original empty and whitespace paragraphs remain valid',async()=>{
 const input=await documentFixture(xml=>xml.replace('<w:body>','<w:body><w:p/><w:p><w:r><w:t xml:space="preserve">   </w:t></w:r></w:p>').replaceAll('</w:p>','</w:p><w:p/>')),doc=await parseDocx(input),before=await documentXml(input),body=before.getElementsByTagNameNS(NS,'body')[0],source=Array.from(body.childNodes).filter(child=>child.nodeType===1&&child.namespaceURI===NS&&child.localName==='p'),blankIndices=source.flatMap((paragraph,index)=>Array.from(paragraph.getElementsByTagNameNS(NS,'t')).map(node=>node.textContent).join('').trim()?[]:[index]);
 assert.ok(blankIndices.length>0);assert.ok(doc.paragraphs.every(row=>!blankIndices.includes(row.sourceIndex)));const output=await applyDocx(input,doc,defaultRules()),after=await documentXml(output),afterSource=Array.from(after.getElementsByTagNameNS(NS,'body')[0].childNodes).filter(child=>child.nodeType===1&&child.namespaceURI===NS&&child.localName==='p');
 for(const index of blankIndices)assert.equal(serialize(afterSource[index]),serialize(source[index]),'Omitted blank source paragraphs stay intact');assert.deepEqual((await parseDocx(output)).paragraphs.map(row=>row.text),doc.paragraphs.map(row=>row.text));
 const missing=structuredClone(doc);missing.paragraphs.pop();missing.paragraphs.push({sourceIndex:blankIndices[0],text:'',level:0,format:{}});await assert.rejects(()=>applyDocx(input,missing,defaultRules()),/段落记录不完整/);
 const explicitBlanks=structuredClone(doc);for(const index of blankIndices.slice(0,3))explicitBlanks.paragraphs.push({sourceIndex:index,text:Array.from(source[index].getElementsByTagNameNS(NS,'t')).map(node=>node.textContent).join(''),level:0,excluded:true,format:{}});const valid=await applyDocx(input,explicitBlanks,defaultRules());assert.deepEqual((await parseDocx(valid)).paragraphs.map(row=>row.text),doc.paragraphs.map(row=>row.text));await assertOtherPartsUnchanged(input,valid);
});
