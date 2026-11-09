import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';

// Only repository-owned assets are accepted: no model- or user-supplied paths.
const themes=new Set(['academic','formal','focus','slate','indigo','sand','cobalt','crimson','forest','teal','ink','amber']);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist/workspace/assets/ppt-templates');
const pngSignature=Buffer.from('89504e470d0a1a0a','hex');
const maxImageBytes=4*1024*1024;
export const presentationImageRelationship='http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

function isPng(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<45||bytes.length>maxImageBytes||!bytes.subarray(0,8).equals(pngSignature)||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')return false;
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 return width>0&&width<=4096&&height>0&&height<=4096&&bytes.toString('ascii',bytes.length-8,bytes.length-4)==='IEND';
}

export function presentationArtworkParts(artworks=[],slideCount=40){
 if(!Array.isArray(artworks)||artworks.length>=40)throw Error('Invalid presentation artwork');
 const pages=new Set();let totalBytes=0;
 return artworks.map(({page,bytes,x,y,w,h,alt=''})=>{
  if(!Number.isInteger(page)||page<2||page>slideCount||pages.has(page)||!isPng(bytes)||(totalBytes+=bytes.length)>16*1024*1024)throw Error('Invalid presentation artwork');
  if(![x,y,w,h].every(Number.isInteger)||x<0||y<0||w<1||h<1||x+w>1280||y+h>720)throw Error('Invalid presentation artwork placement');
  if(typeof alt!=='string'||alt.length>160||/[\x00-\x1f\x7f\ufffe\uffff]/u.test(alt)||Buffer.from(alt).toString()!==alt)throw Error('Invalid presentation artwork description');
  pages.add(page);
  return {page,bytes,x,y,w,h,alt,fileName:`paperknow-illustration-${page}.png`,relId:'rIdPaperKnowIllustration',name:'PaperKnow Slide Illustration'};
 });
}

export function presentationCoverArtworkPart(bytes){
 if(!isPng(bytes))throw Error('Invalid template artwork');
 return {page:1,bytes,x:0,y:0,w:1280,h:720,alt:'',fileName:'paperknow-template.png',relId:'rIdPaperKnowArtwork',name:'PaperKnow Template Background'};
}

const escapeXml=value=>value.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));

export function presentationArtworkPicture(artwork,id){
 const {name,relId,alt,x,y,w,h}=artwork,description=alt?` descr="${escapeXml(alt)}"`:'';
 // PowerPoint's drawing units at the compiler's 96 DPI.
 const emu=value=>value*9525;
 return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}"${description}/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

export async function loadTemplateArtwork(theme){
 if(!themes.has(theme))return null;
 try{
  const bytes=await readFile(path.join(root,theme+'.png'));
  if(!isPng(bytes))throw Error('bad template artwork');
  return bytes;
 }catch(e){throw Object.assign(Error('模板图片暂不可用，请稍后重试'),{code:'presentation_template_unavailable',status:503});}
}

function appendXmlChild(xml,tag,child){
 const end=`</${tag}>`;
 if(xml.includes(end))return xml.replace(end,()=>child+end);
 const empty=new RegExp(`(<${tag}(?:\\s[^<>]*?)?)\\s*/>`);
 if(!empty.test(xml))throw Error('Unexpected presentation package');
 return xml.replace(empty,(_,opening)=>`${opening}>${child}${end}`);
}

// The compiler package has already passed validation. The injected bitmap is
// server-owned and every part name and relationship is derived from its page.
async function addArtworkParts(pptx,parts){
 if(!parts.length)return pptx;
 const zip=await JSZip.loadAsync(pptx),types=zip.file('[Content_Types].xml');
 if(!types)throw Error('Unexpected presentation package');
 for(const artwork of parts){
  const {page,bytes,fileName,relId}=artwork;
  const slideName=`ppt/slides/slide${page}.xml`,relName=`ppt/slides/_rels/slide${page}.xml.rels`,mediaName=`ppt/media/${fileName}`;
  const slide=zip.file(slideName),rel=zip.file(relName);
  if(!slide||!rel||zip.file(mediaName))throw Error('Unexpected presentation package');
  const [xml,rels]=await Promise.all([slide.async('string'),rel.async('string')]);
  if(rels.includes(`Id="${relId}"`)||xml.includes('<p:pic>'))throw Error('Unexpected presentation artwork');
  const ids=[...xml.matchAll(/<p:cNvPr\s+id="(\d+)"/g)].map(m=>Number(m[1])),id=Math.max(1,...ids)+1;
  const picture=presentationArtworkPicture(artwork,id);
  // Cover art is a background. Interior illustrations sit in a reserved area
  // above the slide surface and are individually selectable in PowerPoint.
  if(page===1&&!xml.includes('</p:grpSpPr>'))throw Error('Unexpected cover layout');
  zip.file(slideName,page===1?xml.replace('</p:grpSpPr>',()=>'</p:grpSpPr>'+picture):appendXmlChild(xml,'p:spTree',picture));
  zip.file(relName,appendXmlChild(rels,'Relationships',`<Relationship Id="${relId}" Type="${presentationImageRelationship}" Target="../media/${fileName}"/>`));
  zip.file(mediaName,bytes);
 }
 const ct=await types.async('string');
 if(!/Extension="png"/i.test(ct))zip.file('[Content_Types].xml',appendXmlChild(ct,'Types','<Default Extension="png" ContentType="image/png"/>'));
 const out=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
 if(out.length>20*1024*1024)throw Error('Presentation exceeds size limit');
 return out;
}

export async function addTemplateArtwork(pptx,bytes){
 return addArtworkParts(pptx,[presentationCoverArtworkPart(bytes)]);
}

export async function addPresentationArtwork(pptx,artworks,cover){
 const parts=presentationArtworkParts(artworks);
 if(cover)parts.unshift(presentationCoverArtworkPart(cover));
 return addArtworkParts(pptx,parts);
}
