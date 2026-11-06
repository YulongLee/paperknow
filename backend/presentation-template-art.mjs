import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';

// Only repository-owned assets are accepted: no model- or user-supplied paths.
const themes=new Set(['academic','formal','focus','slate','indigo','sand','cobalt','crimson','forest','teal','ink','amber']);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist/workspace/assets/ppt-templates');
export async function loadTemplateArtwork(theme){
 if(!themes.has(theme))return null;
 try{
  const bytes=await readFile(path.join(root,theme+'.png'));
  if(bytes.length>4*1024*1024||bytes.length<32||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw Error('bad template artwork');
  return bytes;
 }catch(e){throw Object.assign(Error('模板图片暂不可用，请稍后重试'),{code:'presentation_template_unavailable',status:503});}
}

// Input is already validated by PPT Master. Add exactly one trusted bitmap
// behind editable shapes, with no outside relationships. Never accept a URL.
export async function addTemplateArtwork(pptx,bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||bytes.length>4*1024*1024)throw Error('Invalid template artwork');
 const zip=await JSZip.loadAsync(pptx),slide=zip.file('ppt/slides/slide1.xml'),rel=zip.file('ppt/slides/_rels/slide1.xml.rels'),types=zip.file('[Content_Types].xml');
 if(!slide||!rel||!types||zip.file('ppt/media/paperknow-template.png'))throw Error('Unexpected presentation package');
 let xml=await slide.async('string'),rels=await rel.async('string'),ct=await types.async('string');
 const match=xml.match(/<\/p:grpSpPr>/);if(!match||rels.includes('Id="rIdPaperKnowArtwork"'))throw Error('Unexpected cover layout');
 const ids=[...xml.matchAll(/<p:cNvPr\s+id="(\d+)"/g)].map(m=>Number(m[1]));const id=Math.max(1,...ids)+1;
 const picture=`<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="PaperKnow Template Background"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdPaperKnowArtwork"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
 xml=xml.replace('</p:grpSpPr>','</p:grpSpPr>'+picture);
 rels=rels.replace('</Relationships>','<Relationship Id="rIdPaperKnowArtwork" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/paperknow-template.png"/></Relationships>');
 if(!/Extension="png"/i.test(ct))ct=ct.replace('</Types>','<Default Extension="png" ContentType="image/png"/></Types>');
 zip.file('ppt/slides/slide1.xml',xml);zip.file('ppt/slides/_rels/slide1.xml.rels',rels);zip.file('[Content_Types].xml',ct);zip.file('ppt/media/paperknow-template.png',bytes);
 const out=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
 if(out.length>20*1024*1024)throw Error('Presentation exceeds size limit');
 return out;
}
