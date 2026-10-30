import path from 'node:path';
import JSZip from 'jszip';
import {Readable} from 'node:stream';
const safe=message=>Object.assign(new Error(message),{documentTranslationSafe:true});
function zipEntryCount(buffer){
 let end=-1;for(let at=buffer.length-22;at>=Math.max(0,buffer.length-65557);at--)if(buffer.readUInt32LE(at)===0x06054b50&&at+22+buffer.readUInt16LE(at+20)===buffer.length){end=at;break;}
 if(end<0)throw safe('Word文档压缩目录无效');
 const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),offset=buffer.readUInt32LE(end+16);
 if(buffer.readUInt16LE(end+4)!==0||buffer.readUInt16LE(end+6)!==0||buffer.readUInt16LE(end+8)!==count||count===0||count>3000||size===0xffffffff||offset===0xffffffff||offset+size!==end)throw safe('Word文档压缩目录超限或不受支持');
 let at=offset,total=0;const names=new Set();
 for(let n=0;n<count;n++){
  if(at+46>end||buffer.readUInt32LE(at)!==0x02014b50)throw safe('Word文档压缩目录无效');
  const flags=buffer.readUInt16LE(at+8),method=buffer.readUInt16LE(at+10),compressed=buffer.readUInt32LE(at+20),expanded=buffer.readUInt32LE(at+24),nameLength=buffer.readUInt16LE(at+28),extra=buffer.readUInt16LE(at+30),comment=buffer.readUInt16LE(at+32),disk=buffer.readUInt16LE(at+34),mode=buffer.readUInt32LE(at+38)>>>16,local=buffer.readUInt32LE(at+42),next=at+46+nameLength+extra+comment;
  if(flags&1||![0,8].includes(method)||disk!==0||(mode&0o170000)===0o120000||next>end||local>=offset||compressed>20*1024*1024||expanded>10*1024*1024||(total+=expanded)>30*1024*1024)throw safe('Word文档解压内容超过限制或格式不受支持');
  const name=buffer.subarray(at+46,at+46+nameLength).toString('utf8'),key=name.normalize('NFC').toLowerCase().replace(/\/+$/,'');
  if(!name||name.length>512||/^[\/\\]|^[A-Za-z]:|[\\\u0000-\u001f\u007f]/.test(name)||name.split('/').some(part=>part==='..'||part==='.')||names.has(key))throw safe('Word文档包含不安全路径或重复条目');names.add(key);at=next;
 }
 if(at!==end)throw safe('Word文档压缩目录无效');return count;
}
export async function validateTranslationDocument(buffer,{source=true}={}){
 const count=zipEntryCount(buffer);
 let zip;try{zip=await JSZip.loadAsync(buffer);}catch{throw safe('Word文档结构无效，请另存为DOCX后重试');}
 const entries=Object.values(zip.files),maximum=30*1024*1024;
 if(entries.length!==count||entries.length>3000||entries.some(f=>(f._data?.uncompressedSize||0)>10*1024*1024)||entries.reduce((n,f)=>n+(f._data?.uncompressedSize||0),0)>maximum||!zip.file('word/document.xml')||!zip.file('[Content_Types].xml'))throw safe('Word文档结构或解压大小超过限制，请分章节上传');
 // Count all XML text, including notes and headers, before a billable request.
 // Counting entities literally is conservative for the 2,000-character page unit.
 let characters=0,inflated=0;
 for(const entry of entries){
  if(entry.dir)continue;const isXML=entry.name.endsWith('.xml'),parts=[];let length=0;const original=entry.nodeStream('nodebuffer'),stream=Readable.wrap(original);
  try{for await(const chunk of stream){length+=chunk.length;inflated+=chunk.length;if(length>10*1024*1024||inflated>maximum)throw safe('Word文档解压内容超过限制，请分章节上传');if(isXML)parts.push(Buffer.from(chunk));}}catch(error){throw error.documentTranslationSafe?error:safe('Word文档压缩内容无法完整读取');}finally{original.pause();original._helper?.pause();stream.destroy();original.destroy();}
  if(length!==entry._data.uncompressedSize)throw safe('Word文档压缩内容长度校验未通过');
  if(!isXML)continue;let xml;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts,length));}catch{throw safe('Word文档内容编码无效');}
  characters+=Array.from(xml.replace(/<[^>]*>/g,'')).length;if(characters>(source?100000:1000000))throw safe(source?'Word文档超过100,000字符，请分章节翻译':'译文内容超过处理限制，请分章节翻译');
 }
 return Math.max(1,Math.ceil(characters/2000));
}


// The provider's DOCX is treated as untrusted input. Keep embedded layout and
// cached field text; do not let office conversion resolve external resources.
export async function prepareTranslationPreview(bytes){
 await validateTranslationDocument(Buffer.from(bytes),{source:false});
 const {DOMParser,XMLSerializer}=await import('@xmldom/xmldom');
 const zip=await JSZip.loadAsync(bytes),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 for(const entry of Object.values(zip.files)){
  if(entry.dir)continue;
  if(/(?:^|\/)(?:vbaProject|activeX|embeddings|customUI)|\.(?:bin|html?|xhtml|svg)$/i.test(entry.name))throw safe('译文包含不支持的活动内容，无法制作 PDF');
  if(!/\.(?:xml|rels)$/i.test(entry.name))continue;
  const raw=await entry.async('uint8array');if(raw.length>8*1024*1024)throw safe('译文结构过大');
  const encoding=raw[0]===255&&raw[1]===254?'utf-16le':raw[0]===254&&raw[1]===255?'utf-16be':'utf-8';
  const xml=new TextDecoder(encoding,{fatal:true}).decode(raw);if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw safe('译文结构不受支持');
  const doc=new DOMParser({onError:()=>{throw safe('译文 XML 无效');}}).parseFromString(xml,'application/xml');
  for(const node of [...doc.getElementsByTagName('*')]){
   if(node.localName==='Relationship'){
    const type=node.getAttribute('Type'),target=node.getAttribute('Target'),mode=node.getAttribute('TargetMode');
    if(/(?:oleObject|vbaProject|activeX|attachedTemplate|altChunk|package)$/i.test(type))throw safe('译文含不支持的嵌入内容');
    if(mode==='External'){if(!/\/hyperlink$/.test(type))throw safe('译文含外部资源，无法制作 PDF');node.parentNode.removeChild(node);continue;}
    let decoded;try{decoded=decodeURIComponent(target);}catch{throw safe('译文资源路径无效');}
    if(mode||!decoded||/^[a-z][a-z\d+.-]*:|^[\/\\]|[\\\x00-\x1f?#]/i.test(decoded))throw safe('译文资源路径无效');
    const base=entry.name==='_rels/.rels'?'':path.posix.dirname(path.posix.dirname(entry.name)),resolved=path.posix.normalize(path.posix.join(base,decoded));
    if(resolved==='..'||resolved.startsWith('../')||!zip.file(resolved))throw safe('译文资源不存在或路径越界');
   }
   if(['Default','Override'].includes(node.localName)&&/macroEnabled|vbaProject|oleObject|activeX|encrypted/i.test(node.getAttribute('ContentType')||''))throw safe('译文含不支持的活动内容');
   if(node.namespaceURI===W){
    if(['altChunk','object','control','subDoc'].includes(node.localName))throw safe('译文含不支持的嵌入内容');
    if(['instrText','fldChar'].includes(node.localName)){node.parentNode?.removeChild(node);continue;}
    if(node.localName==='fldSimple'){const parent=node.parentNode;while(node.firstChild)parent.insertBefore(node.firstChild,node);parent.removeChild(node);}
   }
  }
  zip.file(entry.name,new XMLSerializer().serializeToString(doc));
 }
 return{bytes:await zip.generateAsync({type:'uint8array',compression:'DEFLATE'})};
}
