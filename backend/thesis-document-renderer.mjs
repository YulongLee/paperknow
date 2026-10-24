import {execFile} from 'node:child_process';
import {constants} from 'node:fs';
import {access,mkdtemp,mkdir,writeFile,readFile,lstat,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {PDFDocument} from 'pdf-lib';
import {prepareThesisDocxTemplate} from '../src/thesis-template-profile.js';

export const THESIS_RENDER_MAX_INPUT_BYTES=2*1024*1024;
export const THESIS_RENDER_MAX_OUTPUT_BYTES=20*1024*1024;
const MAX_TIMEOUT=120000,MAX_LOG_BYTES=64*1024;
const unoHelper=fileURLToPath(new URL('./thesis-document-convert.py',import.meta.url));
let activeConversions=0;
async function sourceRangeSignatures(bytes){
 const zip=await JSZip.loadAsync(bytes),part=zip.file('word/document.xml');if(!part)throw Error('missing document');
 const doc=new DOMParser().parseFromString(await part.async('string'),'application/xml'),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',M='http://schemas.openxmlformats.org/officeDocument/2006/math',starts=new Map(),ends=new Map(),signatures=new Map(),names=new Set();let text='';
 const read=node=>{if(node.nodeType===1){if(node.namespaceURI===W&&node.localName==='bookmarkStart'){const name=node.getAttributeNS(W,'name'),id=node.getAttributeNS(W,'id');if(/^PKInput_\d+$/.test(name)){if(starts.has(id)||names.has(name))throw Error('duplicate source range');names.add(name);starts.set(id,{name,offset:text.length,node});}}if(node.namespaceURI===W&&node.localName==='bookmarkEnd'){const id=node.getAttributeNS(W,'id');if(starts.has(id)){if(ends.has(id))throw Error('duplicate source end');ends.set(id,text.length);}}if((node.namespaceURI===W||node.namespaceURI===M)&&node.localName==='t')text+=node.textContent;}for(const child of node.childNodes||[])read(child);};read(doc);
 for(const [id,row]of starts){if(!ends.has(id))throw Error('source range missing');let table=row.node.parentNode;while(table&&!(table.namespaceURI===W&&table.localName==='tbl'))table=table.parentNode;const value=table?[...table.getElementsByTagNameNS(W,'t')].map(node=>node.textContent).join(''):text.slice(row.offset,ends.get(id));const container=table||row.node.parentNode,drawingCount=container.getElementsByTagNameNS(W,'drawing').length+container.getElementsByTagNameNS(W,'pict').length;signatures.set(row.name,JSON.stringify({text:value.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' '),drawingCount}));}
 return signatures;
}
async function assertRefreshedSourceRanges(before,after){
 const expected=await sourceRangeSignatures(before),actual=await sourceRangeSignatures(after);if(!expected.size)throw Error('missing source provenance');
 if(expected.size!==actual.size||JSON.stringify([...expected.keys()])!==JSON.stringify([...actual.keys()])||[...expected].some(([key,text])=>actual.get(key)!==text))throw Error('source text changed');
}
const failure=(status,code,message)=>Object.assign(new Error(message),{status,code});
const cancelled=()=>failure(499,'document_render_cancelled','PDF 转换已取消，请重试。');
const abortIfNeeded=signal=>{if(signal?.aborted)throw cancelled();};
const bounded=(value,fallback,max)=>Number.isFinite(Number(value))&&Number(value)>0?Math.min(max,Math.max(1,Math.floor(Number(value)))):fallback;
const mediaInvalid=()=>failure(422,'document_render_media_invalid','文档中的 PNG/JPEG 图片头损坏或不受支持，请修复图片后重试；仍可下载 Word 文档。');
const mediaUnsupported=()=>failure(422,'document_render_media_unsupported','PDF 转换暂仅支持静态 PNG、JPEG 图片；请替换不支持的媒体后重试，或下载 Word 文档。');
const mediaLimit=()=>failure(422,'document_render_media_limit','PDF 转换的单张图片最多 1200 万像素、最长边 10000 像素，全部图片合计最多 2400 万像素；请缩小图片后重试，或下载 Word 文档。');
const PNG_CRC=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);return value>>>0;});
function pngCrc(bytes){let value=0xffffffff;for(const byte of bytes)value=(value>>>8)^PNG_CRC[(value^byte)&255];return(value^0xffffffff)>>>0;}

function pngDimensions(bytes){
 if(bytes.length<33)throw mediaInvalid();const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=8,dimensions,dataBytes=0,seenData=false,seenEnd=false,palette=false;
 while(offset<bytes.length){
  if(offset+12>bytes.length)throw mediaInvalid();const length=view.getUint32(offset),type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
  if(!/^[A-Za-z]{4}$/.test(type)||length>bytes.length-offset-12)throw mediaInvalid();
  if(pngCrc(bytes.subarray(offset+4,offset+8+length))!==view.getUint32(offset+8+length))throw mediaInvalid();
  if(['acTL','fcTL','fdAT'].includes(type))throw mediaUnsupported();
  if(offset===8&&type!=='IHDR')throw mediaInvalid();
  if(type==='IHDR'){
   if(dimensions||offset!==8||length!==13)throw mediaInvalid();const width=view.getUint32(offset+8),height=view.getUint32(offset+12),depth=bytes[offset+16],color=bytes[offset+17];
   if(!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]})[color]?.includes(depth)||bytes[offset+18]!==0||bytes[offset+19]!==0||bytes[offset+20]>1)throw mediaInvalid();
   dimensions={width,height,color};checkImageBounds(dimensions);
  }else if(type==='IDAT'){if(!dimensions||dimensions.color===3&&!palette)throw mediaInvalid();seenData=true;dataBytes+=length;}
  else if(type==='PLTE'){if(seenData||!length||length>768||length%3)throw mediaInvalid();palette=true;}
  else if(type==='IEND'){if(length||!seenData||!dataBytes||offset+12!==bytes.length)throw mediaInvalid();seenEnd=true;}
  else if(type[0]===type[0].toUpperCase())throw mediaInvalid();
  offset+=length+12;
 }
 if(!dimensions||!seenEnd)throw mediaInvalid();return dimensions;
}
function jpegDimensions(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=2,dimensions,components,scan=false;
 while(offset<bytes.length){
  if(bytes[offset++]!==0xff)throw mediaInvalid();while(bytes[offset]===0xff)offset++;if(offset>=bytes.length)throw mediaInvalid();const marker=bytes[offset++];
  if(marker===0xd9){if(!dimensions||!scan||offset!==bytes.length)throw mediaInvalid();return dimensions;}
  if(marker===0x00||marker===0xd8||marker===0x01||marker>=0xd0&&marker<=0xd7||[0xdc,0xde,0xdf].includes(marker))throw mediaInvalid();
  if(offset+2>bytes.length)throw mediaInvalid();const length=view.getUint16(offset);if(length<2||length>bytes.length-offset)throw mediaInvalid();
  if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
   if(dimensions||length<8)throw mediaInvalid();components=bytes[offset+7];
   if(!components||components>4||length!==8+3*components||![8,12,16].includes(bytes[offset+2]))throw mediaInvalid();
   dimensions={height:view.getUint16(offset+3),width:view.getUint16(offset+5)};checkImageBounds(dimensions);
  }
  if(marker===0xda){
   const count=bytes[offset+2];if(!dimensions||length<6||!count||count>components||length!==6+2*count)throw mediaInvalid();scan=true;offset+=length;
   // Walk escaped entropy bytes without decoding image data. A second frame
   // cannot hide a larger set of dimensions behind the first small frame.
   while(offset<bytes.length){
    if(bytes[offset]!==0xff){offset++;continue;}const start=offset++;while(bytes[offset]===0xff)offset++;if(offset>=bytes.length)throw mediaInvalid();const next=bytes[offset];
    if(next===0x00||next>=0xd0&&next<=0xd7){offset++;continue;}offset=start;break;
   }
  }else offset+=length;
 }
 throw mediaInvalid();
}
function checkImageBounds({width,height}){if(!width||!height||width>10000||height>10000||width*height>12000000)throw mediaLimit();}
async function inspectEmbeddedMedia(zip,documents){
 const parts=new Set(),types=new Map(),entries=Object.values(zip.files).filter(entry=>!entry.dir),contentTypes=documents.get('[Content_Types].xml');
 const defaults=new Map();for(const node of contentTypes.getElementsByTagName('*')){
  const mime=(node.getAttribute('ContentType')||'').toLowerCase();if(node.localName==='Default')defaults.set((node.getAttribute('Extension')||'').toLowerCase(),mime);
  if(node.localName==='Override'&&mime.startsWith('image/')){const part=(node.getAttribute('PartName')||'').replace(/^\//,'');parts.add(part);types.set(part,mime);}
 }
 for(const entry of entries){const extension=entry.name.split('.').at(-1).toLowerCase(),mime=defaults.get(extension);
  if(mime?.startsWith('image/')){parts.add(entry.name);if(!types.has(entry.name))types.set(entry.name,mime);}
  if(/(?:^|\/)media\//i.test(entry.name)||/\.(?:png|jpe?g|gif|bmp|dib|tiff?|webp|svg|emf|wmf|avif|heic|ico|pict?|jxr|wdp|hdp)$/i.test(entry.name))parts.add(entry.name);
 }
 for(const [name,document]of documents){if(!name.endsWith('.rels'))continue;const base=name==='_rels/.rels'?'':name.replace(/\/_rels\/[^/]+\.rels$/,'');
  for(const node of document.getElementsByTagName('*'))if(node.localName==='Relationship'&&/\/image$/i.test(node.getAttribute('Type')||'')){
   const target=(node.getAttribute('Target')||'').split('#')[0],part=target.startsWith('/')?target.slice(1):path.posix.normalize(path.posix.join(base,target));parts.add(part);
  }
 }
 let total=0;
 for(const name of parts){
  const entry=zip.file(name),mime=types.get(name);if(!entry||mime&&!['image/png','image/jpeg','image/jpg','image/pjpeg'].includes(mime))throw mediaUnsupported();
  const bytes=await entry.async('uint8array');let dimensions;
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)){if(mime&&mime!=='image/png')throw mediaInvalid();dimensions=pngDimensions(bytes);}
  else if(bytes[0]===0xff&&bytes[1]===0xd8){if(mime&&mime==='image/png')throw mediaInvalid();dimensions=jpegDimensions(bytes);}
  else throw mediaUnsupported();
  total+=dimensions.width*dimensions.height;if(total>24000000)throw mediaLimit();
 }
}

// This private profile disables macros and automatic link updates. External
// resources are also rejected before opening the document; ordinary hyperlinks
// remain navigation only. No user path, filename or option enters the command.
// Do not set DisableActiveContent: Writer renders native OMML using its math
// object engine, and that switch silently blanks valid formulas. Uploaded OLE
// objects and macros are rejected by the strict OOXML preflight instead.
const registry=`<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item></oor:items>`;

/** Strict template inspection runs first, with the existing ZIP/XML limits. */
async function safeDocument(bytes){
 let prepared;
 try{prepared=await prepareThesisDocxTemplate(bytes);}
 catch(error){throw failure(422,'document_render_unsafe','无法转换该 DOCX：'+String(error?.message||'文档未通过安全检查。'));}
 // VML can carry a raw image URL without a relationship. It must never be
 // resolved by the renderer, even when it occurs outside a picture field.
 const zip=await JSZip.loadAsync(prepared.bytes,{createFolders:false}),documents=new Map();
 for(const entry of Object.values(zip.files)){
  if(entry.dir||!/(?:\.xml|\.rels)$/i.test(entry.name))continue;
  const text=await entry.async('uint8array'),encoding=text[0]===0xff&&text[1]===0xfe?'utf-16le':text[0]===0xfe&&text[1]===0xff?'utf-16be':'utf-8';
  const doc=new DOMParser({onError:()=>{throw failure(422,'document_render_unsafe','DOCX XML 内容无效。');}}).parseFromString(new TextDecoder(encoding,{fatal:true}).decode(text),'application/xml');
  documents.set(entry.name,doc);
  for(const node of doc.getElementsByTagName('*'))for(const attribute of node.attributes){
   if(['src','href'].includes(attribute.localName.toLowerCase())||attribute.namespaceURI==='http://schemas.openxmlformats.org/officeDocument/2006/relationships'&&attribute.localName==='link')throw failure(422,'document_render_unsafe','DOCX 含外部资源引用，请先将图片嵌入文档后重试。');
  }
 }
 await inspectEmbeddedMedia(zip,documents);
 return prepared.bytes;
}

/** Process runner is injectable for tests; shell execution is always disabled. */
export function runThesisDocumentConversion({commandPath,workspace,signal,timeoutMs=MAX_TIMEOUT,useUno=process.platform==='linux',pythonPath='/usr/bin/python3',execFileImpl=execFile,killImpl=process.kill}={}){
 abortIfNeeded(signal);
 return new Promise((resolve,reject)=>{
  let child,timer,killTimer,finished=false,reason;
  const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
  const killGroup=()=>{
   try{if(process.platform!=='win32'&&child?.pid)killImpl(-child.pid,'SIGKILL');else child?.kill('SIGKILL');}catch{try{child?.kill('SIGKILL');}catch{}}
  };
  const stop=error=>{
   if(finished||reason)return;reason=error;
   // execFile normally completes as soon as SIGKILL is reaped. Bound the wait
   // even for an abnormal wrapper, then let the caller clean the private files.
   killTimer=setTimeout(()=>finish(reason),1000);
   killGroup();
  };
  const abort=()=>stop(cancelled());
  const args=useUno?['-I',unoHelper,commandPath,workspace,String(bounded(timeoutMs,MAX_TIMEOUT,MAX_TIMEOUT)/1000)]:[`-env:UserInstallation=${pathToFileURL(path.join(workspace,'profile')).href}`,'--headless','--nologo','--nodefault','--nolockcheck','--nofirststartwizard','--convert-to','pdf:writer_pdf_Export','--outdir',path.join(workspace,'output'),path.join(workspace,'document.docx')];
  const executable=useUno?pythonPath:commandPath;
  const env={PATH:`${path.dirname(commandPath)}:/usr/bin:/bin`,HOME:workspace,TMPDIR:workspace,TMP:workspace,TEMP:workspace,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',SAL_USE_VCLPLUGIN:'svp',OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'};
  try{
   child=execFileImpl(executable,args,{cwd:workspace,env,shell:false,detached:process.platform!=='win32',windowsHide:true,maxBuffer:MAX_LOG_BYTES,encoding:'utf8'},error=>{
    if(error&&!reason)killGroup();
    finish(reason||(error?error.code===124?failure(504,'document_render_timeout','PDF 转换超时，请稍后重试或下载 Word 文档。'):failure(error.code==='ENOENT'?503:502,error.code==='ENOENT'?'document_render_unavailable':'document_render_failed',error.code==='ENOENT'?'PDF 转换服务暂不可用，请下载 Word 文档。':'PDF 转换失败，请下载 Word 文档或稍后重试。'):null));
   });
  }catch{finish(failure(503,'document_render_unavailable','PDF 转换服务暂不可用，请下载 Word 文档。'));return;}
  if(finished)return;
  signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>stop(failure(504,'document_render_timeout','PDF 转换超时，请稍后重试或下载 Word 文档。')),bounded(timeoutMs,MAX_TIMEOUT,MAX_TIMEOUT));
  if(signal?.aborted)abort();
 });
}

export function createThesisDocumentRenderer(config={}){
 const commandPath=config.commandPath||process.env.PAPERKNOW_SOFFICE_PATH||(process.platform==='linux'?'/usr/bin/soffice':'');
 const useUno=config.useUno??process.platform==='linux',pythonPath=config.pythonPath||'/usr/bin/python3';
 const timeoutMs=bounded(config.timeoutMs,MAX_TIMEOUT,MAX_TIMEOUT),maxOutputBytes=bounded(config.maxOutputBytes,THESIS_RENDER_MAX_OUTPUT_BYTES,THESIS_RENDER_MAX_OUTPUT_BYTES);
 const status=async()=>{
  let available=false;
  if(config.enabled!==false&&typeof commandPath==='string'&&path.isAbsolute(commandPath)&&!commandPath.includes('\0'))try{await access(commandPath,constants.X_OK);available=(await stat(commandPath)).isFile();}catch{}
  if(available&&useUno)try{if(typeof pythonPath!=='string'||!path.isAbsolute(pythonPath)||pythonPath.includes('\0'))throw Error();await access(pythonPath,constants.X_OK);available=(await stat(pythonPath)).isFile();}catch{available=false;}
  return{available,busy:activeConversions>0,engine:'libreoffice',maxInputBytes:THESIS_RENDER_MAX_INPUT_BYTES,maxOutputBytes,timeoutMs};
 };
 return{
  status,
  async convert({bytes,signal}={}){
   abortIfNeeded(signal);
   if(!(bytes instanceof Uint8Array)||!bytes.byteLength)throw failure(422,'document_render_invalid','请提供有效的 DOCX 文档。');
   if(bytes.byteLength>THESIS_RENDER_MAX_INPUT_BYTES)throw failure(413,'document_render_input_large','DOCX 转 PDF 暂支持最大 2 MB 文档，请下载 Word 文档。');
   // Copy before any await so callers cannot replace bytes after validation.
   const input=new Uint8Array(bytes);
   if(!(await status()).available)throw failure(503,'document_render_unavailable','PDF 转换服务暂不可用，请下载 Word 文档。');
   if(activeConversions>=1)throw failure(429,'document_render_busy','PDF 转换服务繁忙，请稍后重试。');
   activeConversions++;let workspace;
   try{
    const prepared=await safeDocument(input);abortIfNeeded(signal);
    workspace=await mkdtemp(path.join(config.tempRoot||tmpdir(),'paperknow-docx-pdf-'));
    await mkdir(path.join(workspace,'profile','user'),{recursive:true,mode:0o700});
    await mkdir(path.join(workspace,'output'),{mode:0o700});
    await writeFile(path.join(workspace,'profile','user','registrymodifications.xcu'),registry,{mode:0o600});
    await writeFile(path.join(workspace,'document.docx'),prepared,{mode:0o600});
    abortIfNeeded(signal);
    await (config.runConversion||runThesisDocumentConversion)({commandPath,workspace,signal,timeoutMs,useUno,pythonPath});
    abortIfNeeded(signal);
    if(useUno){
     let report;
     try{const reportPath=path.join(workspace,'conversion-report.json'),info=await lstat(reportPath);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw Error();report=JSON.parse(await readFile(reportPath,'utf8'));}catch{throw failure(502,'document_render_refresh_failed','目录与页码更新未完成，请下载 Word 后更新域或稍后重试。');}
     if(report.version!==1||report.textFieldsRefreshed!==true||report.sourceUnchanged!==true||!Number.isSafeInteger(report.indexesUpdated)||report.indexesUpdated<0||report.indexesUpdated>200||report.sourceSha256!==createHash('sha256').update(prepared).digest('hex')||createHash('sha256').update(await readFile(path.join(workspace,'document.docx'))).digest('hex')!==report.sourceSha256)throw failure(502,'document_render_refresh_failed','目录与页码更新未完成，请下载 Word 后更新域或稍后重试。');
    }
    const target=path.join(workspace,'output','document.pdf');let info;
    try{info=await lstat(target);}catch{throw failure(502,'document_render_missing','PDF 转换未生成文件，请稍后重试或下载 Word 文档。');}
    if(!info.isFile()||info.isSymbolicLink())throw failure(502,'document_render_invalid_result','PDF 转换结果无效，请重新导出。');
    if(info.size>maxOutputBytes)throw failure(413,'document_render_output_large','PDF 文件超过 20 MB，请下载 Word 文档。');
    const output=await readFile(target);abortIfNeeded(signal);
    if(output.length!==info.size||output.length<8||output.subarray(0,5).toString()!=='%PDF-')throw failure(502,'document_render_invalid_result','PDF 转换结果无效，请重新导出。');
    let pages;
    try{pages=(await PDFDocument.load(output,{updateMetadata:false,throwOnInvalidObject:true})).getPageCount();}catch{throw failure(502,'document_render_invalid_result','PDF 转换结果无法读取，请重新导出。');}
    if(!Number.isSafeInteger(pages)||pages<1||pages>1000)throw failure(422,'document_render_page_limit','PDF 页数不在支持范围内，请下载 Word 文档。');
    let docxBytes=null;
    if(useUno){const refreshed=path.join(workspace,'output','document-refreshed.docx');let info;try{info=await lstat(refreshed);}catch{}if(info){try{if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>THESIS_RENDER_MAX_INPUT_BYTES)throw Error();const bytes=await readFile(refreshed);await safeDocument(bytes);await assertRefreshedSourceRanges(prepared,bytes);docxBytes=new Uint8Array(bytes);}catch{throw failure(502,'document_render_word_changed','更新目录后的 Word 正文完整性核对未通过，未交付终稿；原正文保留，可下载初稿。');}}}
    abortIfNeeded(signal);
    return{bytes:new Uint8Array(output),...(docxBytes?{docxBytes}:{}),...(useUno?{fieldsRefreshed:true}:{}),pages,warnings:['PDF 已按当前 Word 文档转换，字体显示和最终分页请按学校要求核对。',...(!useUno?['本次转换未自动刷新目录与交叉引用页码，请在 Word/WPS 更新域后核对。']:[])]};
   }finally{
    try{if(workspace)await rm(workspace,{recursive:true,force:true,maxRetries:3,retryDelay:50});}finally{activeConversions--;}
   }
  }
 };
}

/** Authentication and expectedUserId verification belong to the API route. */
export async function convertThesisDocumentPayload(renderer,payload,{signal}={}){
 if(!payload||typeof payload!=='object'||typeof payload.data!=='string'||!payload.data.length)throw failure(422,'document_render_invalid','请提供 DOCX 文档。');
 if(payload.data.length>Math.ceil(THESIS_RENDER_MAX_INPUT_BYTES/3)*4)throw failure(413,'document_render_input_large','DOCX 转 PDF 暂支持最大 2 MB 文档，请下载 Word 文档。');
 if(payload.data.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.data))throw failure(422,'document_render_invalid','DOCX 文件编码无效，请重新导出。');
 const bytes=Buffer.from(payload.data,'base64');
 if(bytes.byteLength>THESIS_RENDER_MAX_INPUT_BYTES)throw failure(413,'document_render_input_large','DOCX 转 PDF 暂支持最大 2 MB 文档，请下载 Word 文档。');
 if(bytes.toString('base64')!==payload.data)throw failure(422,'document_render_invalid','DOCX 文件编码无效，请重新导出。');
 const result=await renderer.convert({bytes,signal});
 return{data:Buffer.from(result.bytes).toString('base64'),...(result.docxBytes?{docxData:Buffer.from(result.docxBytes).toString('base64')}:{}),...(result.fieldsRefreshed?{fieldsRefreshed:true}:{}),pages:result.pages,mimeType:'application/pdf',warnings:result.warnings};
}
