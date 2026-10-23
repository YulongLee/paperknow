import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {staticizeCachedPictureFields} from '../src/thesis-template-static-fields.js';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships',P='http://schemas.openxmlformats.org/package/2006/relationships',A='http://schemas.openxmlformats.org/drawingml/2006/main';
const esc=value=>String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const declaration='<?xml version="1.0" encoding="UTF-8"?>';
const run=value=>`<w:r><w:t>${esc(value)}</w:t></w:r>`;
const control=type=>`<w:r><w:rPr><w:color w:val="123456"/></w:rPr><w:fldChar w:fldCharType="${type}"/></w:r>`;
const code=value=>`<w:r><w:rPr><w:b/></w:rPr><w:instrText xml:space="preserve">${esc(value)}</w:instrText></w:r>`;
const picture=(attrs='r:embed="image1"')=>`<w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:drawing><a:blip ${attrs}/></w:drawing></w:r>`;
const image=picture();
const instruction='INCLUDEPICTURE \\d "C:\\\\Users\\\\Author\\\\Temp\\\\cached.png" \\* MERGEFORMATINET';
const complex=(value=instruction,result=image)=>control('begin')+code(value)+control('separate')+result+control('end');
const simple=(value=instruction,result=image)=>`<w:fldSimple w:instr="${esc(value)}">${result}</w:fldSimple>`;
const paragraph=content=>`<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${content}</w:p>`;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=','base64');
function fixture(content,{relationship='',imageExists=true,part='word/document.xml',encoding='UTF-8'}={}){
 const zip=new JSZip(),xml=declaration.replace('UTF-8',encoding)+`<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:a="${A}" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>${content}</w:body></w:document>`;
 const rel=declaration+`<Relationships xmlns="${P}">${relationship||`<Relationship Id="image1" Type="${R}/image" Target="media/image1.png"/>`}</Relationships>`,relationPart=part.replace(/(^|\/)([^/]+)$/,'$1_rels/$2.rels');
 zip.file(part,xml);zip.file(relationPart,rel);zip.file('word/styles.xml',declaration+`<w:styles xmlns:w="${W}"><w:style w:styleId="Keep"/></w:styles>`);if(imageExists)zip.file('word/media/image1.png',png);
 const parser=new DOMParser(),docs=new Map([[part,parser.parseFromString(xml,'application/xml')],[relationPart,parser.parseFromString(rel,'application/xml')]]);
 // The normal caller supplies already parsed documents. Do not depend on JSZip internals.
 docs.set('word/styles.xml',parser.parseFromString(declaration+`<w:styles xmlns:w="${W}"><w:style w:styleId="Keep"/></w:styles>`,'application/xml'));
 return {zip,docs,part,xml,rel,relationPart};
}
const serialize=doc=>new XMLSerializer().serializeToString(doc);

test('complete complex INCLUDEPICTURE becomes its embedded cached drawing with all surrounding content and formatting intact',async()=>{
 const f=fixture(paragraph(run('Before')+complex()+run('After'))),styles=await f.zip.file('word/styles.xml').async('string'),media=await f.zip.file('word/media/image1.png').async('uint8array');
 assert.equal(staticizeCachedPictureFields(f.docs,f.zip),1);const result=await f.zip.file(f.part).async('string');
 assert.doesNotMatch(result,/INCLUDEPICTURE|fldChar|instrText|Author|Temp/);assert.match(result,/Before/);assert.match(result,/After/);assert.match(result,/w:jc w:val="center"/);assert.match(result,/w:sz w:val="28"/);assert.match(result,/a:blip r:embed="image1"/);
 assert.equal(await f.zip.file('word/styles.xml').async('string'),styles);assert.equal(await f.zip.file(f.relationPart).async('string'),f.rel);assert.deepEqual(await f.zip.file('word/media/image1.png').async('uint8array'),media);
 assert.equal(staticizeCachedPictureFields(f.docs,f.zip),0);assert.equal(await f.zip.file(f.part).async('string'),result);
});

test('simple INCLUDEPICTURE unwraps only the field and preserves its cached text, drawing, run properties and siblings',async()=>{
 const f=fixture(paragraph(run('Before')+simple(instruction,run('Cached label')+image)+run('After')));
 assert.equal(staticizeCachedPictureFields(f.docs,f.zip),1);const result=await f.zip.file(f.part).async('string');
 assert.doesNotMatch(result,/fldSimple|INCLUDEPICTURE/);assert.match(result,/Cached label/);assert.match(result,/Before/);assert.match(result,/After/);assert.match(result,/w:sz w:val="28"/);
});

test('split instructions and multiple independent fields in the same paragraph are supported',async()=>{
 const split=control('begin')+code('INCLUDE')+code('PICTURE "old.png" \\d ')+control('separate')+image+control('end');
 const f=fixture(paragraph(split+run('Between')+complex()));assert.equal(staticizeCachedPictureFields(f.docs,f.zip),2);assert.equal(f.docs.get(f.part).getElementsByTagNameNS(W,'drawing').length,2);assert.match(await f.zip.file(f.part).async('string'),/Between/);
});

test('cached VML image references also require a real internal image part',()=>{
 const vml='<w:r><w:pict><v:shape><v:imagedata r:id="image1"/></v:shape></w:pict></w:r>',f=fixture(paragraph(simple('INCLUDEPICTURE "old.png"',vml)));
 assert.equal(staticizeCachedPictureFields(f.docs,f.zip),1);assert.equal(f.docs.get(f.part).getElementsByTagNameNS(W,'pict').length,1);
});

test('missing, external, linked, wrong-type and non-image cached references leave the import field unchanged',async()=>{
 const cases=[{imageExists:false},{relationship:`<Relationship Id="image1" Type="${R}/image" Target="https://example.org/image.png" TargetMode="External"/>`},{relationship:`<Relationship Id="image1" Type="${R}/hyperlink" Target="media/image1.png"/>`},{relationship:`<Relationship Id="image1" Type="${R}/image" Target="media/image1.xml"/>`},{result:picture('r:link="image1"')},{result:picture('r:embed="missing"')},{result:picture('r:embed="image1" src="https://example.org/image.png"')},{result:image+'<w:r><w:pict><v:image src="https://example.org/external.png"/></w:pict></w:r>'},{result:run('no cached image')}];
 for(const options of cases){const f=fixture(paragraph(complex(instruction,options.result||image)),options),before=serialize(f.docs.get(f.part));assert.equal(staticizeCachedPictureFields(f.docs,f.zip),0);assert.equal(serialize(f.docs.get(f.part)),before);assert.equal(await f.zip.file(f.part).async('string'),f.xml);}
});

test('DDE, INCLUDETEXT, unknown switches and malformed picture instruction syntax are never removed',async()=>{
 for(const value of ['DDEAUTO excel data','INCLUDETEXT "old.docx"','LINK Word.Document old.docx','INCLUDEPICTURE "old.png" DDEAUTO excel','INCLUDEPICTURE "old.png" \\unknown value','INCLUDEPICTURE "old.png" \\* UNKNOWN','INCLUDEPICTURE "old.png','INCLUDEPICTURE']){
  const f=fixture(paragraph(complex(value))),before=serialize(f.docs.get(f.part));assert.equal(staticizeCachedPictureFields(f.docs,f.zip),0,value);assert.equal(serialize(f.docs.get(f.part)),before);assert.equal(await f.zip.file(f.part).async('string'),f.xml);
 }
});

test('nested fields, cross-paragraph fields, missing controls and ambiguous marker runs stay untouched',()=>{
 const nested=complex(instruction,complex('PAGE')+image),nestedSimple=simple(instruction,simple(instruction,image)),simpleInside=complex(instruction,simple(instruction,image));
 const cases=[paragraph(nested),paragraph(nestedSimple),paragraph(simpleInside),paragraph(control('begin')+code('INCLUDETEXT \"old.docx\"'))+paragraph(simple())+paragraph(control('end')),paragraph(control('begin')+code(instruction))+paragraph(control('separate')+image+control('end')),paragraph(control('begin')+code(instruction)+image+control('end')),paragraph(control('begin')+code(instruction)+control('separate')+image),paragraph(control('begin')+code(instruction)+control('separate')+image+control('end')+control('end')),paragraph('<w:r><w:fldChar w:fldCharType="begin"/><w:t>mixed</w:t></w:r>'+complex())];
 for(const body of cases){const f=fixture(body),before=serialize(f.docs.get(f.part));assert.equal(staticizeCachedPictureFields(f.docs,f.zip),0);assert.equal(serialize(f.docs.get(f.part)),before);}
});

test('ordinary navigation and page fields outside a flattened picture remain byte content in the changed XML',async()=>{
 const ordinary='<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>',f=fixture(paragraph(ordinary)+paragraph(complex())+paragraph(simple('HYPERLINK "https://example.org"',run('School'))));
 assert.equal(staticizeCachedPictureFields(f.docs,f.zip),1);const result=await f.zip.file(f.part).async('string');assert.match(result,/w:instr="PAGE"/);assert.match(result,/HYPERLINK/);assert.match(result,/School/);
});

test('changed UTF-16-declared XML is serialized as correctly declared UTF-8 while untouched parts remain identical',async()=>{
 const f=fixture(paragraph(complex()),{encoding:'UTF-16'}),styles=await f.zip.file('word/styles.xml').async('string');assert.equal(staticizeCachedPictureFields(f.docs,f.zip),1);const bytes=await f.zip.file(f.part).async('uint8array'),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);assert.match(text,/encoding="UTF-8"/);assert.doesNotMatch(text,/UTF-16/);assert.equal(await f.zip.file('word/styles.xml').async('string'),styles);
});

test('normalizing an independently parsed package never mutates original bytes or calls the network',async()=>{
 const original=await fixture(paragraph(complex())).zip.generateAsync({type:'uint8array'}),saved=new Uint8Array(original),zip=await JSZip.loadAsync(original),docs=new Map();for(const [path,part]of Object.entries(zip.files))if(/\.(?:xml|rels)$/.test(path))docs.set(path,new DOMParser().parseFromString(await part.async('string'),'application/xml'));
 const oldFetch=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('network forbidden');};
 try{assert.equal(staticizeCachedPictureFields(docs,zip),1);const normalized=await zip.generateAsync({type:'uint8array'});assert.notDeepEqual(normalized,original);assert.deepEqual(original,saved);assert.equal(calls,0);}finally{globalThis.fetch=oldFetch;}
});
