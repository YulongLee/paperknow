import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {loadTemplateArtwork,addTemplateArtwork} from '../backend/presentation-template-art.mjs';

test('template background is selected from the fixed catalog and embedded behind editable content',async()=>{
 const artwork=await loadTemplateArtwork('academic');assert.ok(artwork.length>32);assert.equal(await loadTemplateArtwork('../academic'),null);
 const zip=new JSZip();zip.file('ppt/slides/slide1.xml','<p:sld><p:spTree><p:grpSpPr></p:grpSpPr><p:sp><p:cNvPr id="4" name="title"/><a:t>editable</a:t></p:sp></p:spTree></p:sld>');zip.file('ppt/slides/_rels/slide1.xml.rels','<Relationships></Relationships>');zip.file('[Content_Types].xml','<Types></Types>');
 const result=await addTemplateArtwork(await zip.generateAsync({type:'nodebuffer'}),artwork),out=await JSZip.loadAsync(result),xml=await out.file('ppt/slides/slide1.xml').async('string'),rels=await out.file('ppt/slides/_rels/slide1.xml.rels').async('string');
 assert.ok(xml.indexOf('<p:pic>')<xml.indexOf('<p:sp>'));assert.match(xml,/<a:t>editable<\/a:t>/);assert.match(rels,/Target="\.\.\/media\/paperknow-template.png"/);assert.deepEqual(await out.file('ppt/media/paperknow-template.png').async('nodebuffer'),artwork);
 await assert.rejects(addTemplateArtwork(result,artwork));await assert.rejects(addTemplateArtwork(result,Buffer.from('not png')));
});

test('final PPTX accepts only the exact trusted image and rejects extra media, changed image or external links',async()=>{
 const {validatePptMasterPackage}=await import('../backend/ppt-master-runtime.mjs');const bg=await loadTemplateArtwork('academic');const zip=new JSZip();
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>');zip.file('ppt/presentation.xml','<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');zip.file('ppt/slides/_rels/slide1.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');zip.file('ppt/slides/slide1.xml','<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:grpSpPr></p:grpSpPr><p:sp><p:cNvPr id="4" name="title"/><a:t>editable</a:t></p:sp></p:spTree></p:cSld></p:sld>');
 const result=await addTemplateArtwork(await zip.generateAsync({type:'nodebuffer'}),bg);await validatePptMasterPackage(result,{slideCount:1,trustedBackground:bg});
 async function mutate(fn){const z=await JSZip.loadAsync(result);await fn(z);return z.generateAsync({type:'nodebuffer'});}
 const cases=[await mutate(z=>z.file('ppt/media/paperknow-template.png',Buffer.from('bad'))),await mutate(z=>z.file('ppt/media/extra.png',bg)),await mutate(async z=>{const f='ppt/slides/_rels/slide1.xml.rels';z.file(f,(await z.file(f).async('string')).replace('Target="../media/paperknow-template.png"','TargetMode="External" Target="https://example.test/a.png"'));})];
 for(const malformed of cases)await assert.rejects(validatePptMasterPackage(malformed,{slideCount:1,trustedBackground:bg}),e=>e.code==='ppt_master_package_invalid');
});
