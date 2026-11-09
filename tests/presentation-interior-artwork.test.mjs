import test from 'node:test';
import assert from 'node:assert/strict';
import {realpathSync} from 'node:fs';
import JSZip from 'jszip';
import {addPresentationArtwork,addTemplateArtwork,loadTemplateArtwork} from '../backend/presentation-template-art.mjs';
import {createPptMasterRuntime,getPptMasterRuntimeStatus,validatePptMasterPackage} from '../backend/ppt-master-runtime.mjs';

const pml='http://schemas.openxmlformats.org/presentationml/2006/main';
const drawing='http://schemas.openxmlformats.org/drawingml/2006/main';
const packageRels='http://schemas.openxmlformats.org/package/2006/relationships';
const officeRels='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const contentTypes='http://schemas.openxmlformats.org/package/2006/content-types';
const interior='ppt/slides/slide2.xml';
const interiorRels='ppt/slides/_rels/slide2.xml.rels';
const interiorMedia='ppt/media/paperknow-illustration-2.png';
const slideTexts=['Cover','Methods','Conclusion'];
const slides=slideTexts.map(title=>({title,notes:'Preserved speaker notes',svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><text x="80" y="160" font-size="32" fill="#123456">${title}</text></svg>`}));

async function nativeFixture(){
 const zip=new JSZip();
 zip.file('[Content_Types].xml',`<Types xmlns="${contentTypes}"/>`);
 zip.file('_rels/.rels',`<Relationships xmlns="${packageRels}"><Relationship Id="rId1" Type="${officeRels}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
 zip.file('ppt/presentation.xml',`<p:presentation xmlns:p="${pml}"/>`);
 for(const [index,title] of slideTexts.entries()){
  zip.file(`ppt/slides/slide${index+1}.xml`,`<p:sld xmlns:p="${pml}" xmlns:a="${drawing}" xmlns:r="${officeRels}"><p:cSld><p:spTree><p:grpSpPr></p:grpSpPr><p:sp><p:cNvPr id="4" name="title"/><a:t>${title}</a:t></p:sp></p:spTree></p:cSld></p:sld>`);
  zip.file(`ppt/slides/_rels/slide${index+1}.xml.rels`,`<Relationships xmlns="${packageRels}"/>`);
 }
 return zip.generateAsync({type:'nodebuffer'});
}

async function withArtwork(base){
 const cover=await loadTemplateArtwork('academic');
 const art={page:2,bytes:await loadTemplateArtwork('formal'),x:800,y:180,w:400,h:340,alt:'方法图 & 比较 "A" < B'};
 const pptx=await addPresentationArtwork(await addTemplateArtwork(base,cover),[art]);
 return {pptx,art,options:{slideCount:3,slides,trustedBackground:cover,trustedArtwork:[art]}};
}

test('native deck embeds one trusted illustration in the specified interior position alongside cover art',async()=>{
 const {pptx,art,options}=await withArtwork(await nativeFixture());
 const result=await validatePptMasterPackage(pptx,options);
 assert.equal(result.nativeShapeCount,3);
 const zip=await JSZip.loadAsync(pptx),xml=await zip.file(interior).async('string');
 assert.match(xml,/<a:t>Methods<\/a:t>/);
 assert.match(xml,/<a:off x="7620000" y="1714500"\/><a:ext cx="3810000" cy="3238500"\/>/);
 assert.match(xml,/方法图 &amp; 比较 &quot;A&quot; &lt; B/);
 assert.ok(xml.indexOf('<p:sp>')<xml.indexOf('<p:pic>'));
 assert.deepEqual(await zip.file(interiorMedia).async('nodebuffer'),art.bytes);
 assert.doesNotMatch(await zip.file('ppt/slides/slide3.xml').async('string'),/<p:pic>/);
});

test('trusted picture gate rejects unauthorized media, placement, pictures, duplicate or redirected links',async()=>{
 const {pptx,art,options}=await withArtwork(await nativeFixture());
 const invalid=error=>error.code==='ppt_master_package_invalid';
 async function mutate(part,modify){
  const zip=await JSZip.loadAsync(pptx),old=zip.file(part);
  zip.file(part,modify(old?await old.async('string'):''));
  return zip.generateAsync({type:'nodebuffer'});
 }
 for(const [part,modify] of [
  ['ppt/other.png',()=>art.bytes],
  [interiorMedia,()=>Buffer.from('replaced image')],
  [interior,text=>text.replace('x="7620000"','x="7620010"')],
  [interior,text=>text.replace('r:embed=','r:link=')],
  [interior,text=>text.replace('id="5" name="PaperKnow','id="4" name="PaperKnow')],
  [interiorRels,text=>text.replace('../media/paperknow-illustration-2.png','../media/paperknow-template.png')],
  [interiorRels,text=>text.replace('Target="','TargetMode="External" Target="')],
  [interiorRels,text=>text.replace('</Relationships>',`${text.match(/<Relationship Id=[^>]+\/>/)[0]}</Relationships>`)],
 ])await assert.rejects(validatePptMasterPackage(await mutate(part,modify),options),invalid);
 await assert.rejects(validatePptMasterPackage(pptx,{...options,trustedArtwork:[]}),invalid);
 await assert.rejects(addPresentationArtwork(pptx,[{...art,x:900}]),/placement/);
 await assert.rejects(addPresentationArtwork(pptx,[art,art]),/artwork/);
});

let nativeConfig;
try{nativeConfig={runtimeRoot:realpathSync(new URL('../.data/ppt-master',import.meta.url))};}catch{nativeConfig={};}
test('pinned compiler packages actual slides and still accepts the embedded image', {skip:!getPptMasterRuntimeStatus(nativeConfig).ready},async()=>{
 const baseline=await createPptMasterRuntime(nativeConfig).render({slides});
 const {pptx,options}=await withArtwork(baseline.pptx);
 const result=await validatePptMasterPackage(pptx,options);
 assert.equal(result.slideCount,slides.length);
 assert.ok(result.nativeShapeCount>=slides.length);
 const zip=await JSZip.loadAsync(pptx);
 assert.match(await zip.file('ppt/notesSlides/notesSlide2.xml').async('string'),/Preserved speaker notes/);
});
