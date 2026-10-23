import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {PDFDocument} from 'pdf-lib';
import {createWritingDocx} from '../src/writing-document.js';
import {createThesisDocumentRenderer,runThesisDocumentConversion,convertThesisDocumentPayload,THESIS_RENDER_MAX_INPUT_BYTES} from '../backend/thesis-document-renderer.mjs';

const documentText='PaperKnow synthetic rendering acceptance\n\n第一章 合成验收\n这是合成论文正文，不包含用户资料。\nFINAL_RENDER_MARKER_20261023';
const docx=()=>createWritingDocx(documentText,{documentKind:'thesis',metadata:{title:'Synthetic rendering acceptance'}});
const pdfBytes=async()=>{const pdf=await PDFDocument.create();pdf.addPage([595,842]);return pdf.save();};
async function fixture(t,options={}){
 const root=await mkdtemp(path.join(tmpdir(),'paperknow-render-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const commandPath=path.join(root,'fixed-renderer');await writeFile(commandPath,'fixed test executable',{mode:0o700});
 const renderer=createThesisDocumentRenderer({commandPath,tempRoot:root,useUno:false,runConversion:async({workspace})=>writeFile(path.join(workspace,'output','document.pdf'),await pdfBytes()),...options});
 return{root,commandPath,renderer,empty:async()=>assert.deepEqual((await readdir(root)).sort(),['fixed-renderer'])};
}
const errorCode=code=>error=>error.code===code;

test('capability status exposes availability and bounded limits without server paths',async t=>{
 const f=await fixture(t,{timeoutMs:999999,maxOutputBytes:999999999});
 assert.deepEqual(await f.renderer.status(),{available:true,busy:false,engine:'libreoffice',maxInputBytes:2097152,maxOutputBytes:20971520,timeoutMs:120000});
 const disabled=createThesisDocumentRenderer({commandPath:f.commandPath,enabled:false});assert.equal((await disabled.status()).available,false);
 const absent=createThesisDocumentRenderer({commandPath:path.join(f.root,'missing')});assert.equal((await absent.status()).available,false);
 const relative=createThesisDocumentRenderer({commandPath:'soffice'});assert.equal((await relative.status()).available,false);
 await assert.rejects(()=>disabled.convert({bytes:new Uint8Array([80,75])}),errorCode('document_render_unavailable'));
 await f.empty();
});

test('valid DOCX is converted in a private directory, preserving the caller bytes and removing all temporary files',async t=>{
 let work,seen;
 const f=await fixture(t,{runConversion:async options=>{
  work=options.workspace;seen=await readFile(path.join(work,'document.docx'));const registry=await readFile(path.join(work,'profile','user','registrymodifications.xcu'),'utf8');
  assert.match(registry,/MacroSecurityLevel/);assert.match(registry,/DisableMacrosExecution/);assert.match(registry,/DisableActiveContent/);assert.match(registry,/Office.Writer\/Content\/Update/);assert.ok(path.isAbsolute(options.commandPath));assert.equal(options.timeoutMs,120000);
  await writeFile(path.join(work,'output','document.pdf'),await pdfBytes());
 }});
 const bytes=await docx(),original=Buffer.from(bytes),result=await f.renderer.convert({bytes});
 assert.equal(result.pages,1);assert.equal(Buffer.from(result.bytes).subarray(0,5).toString(),'%PDF-');assert.equal(result.warnings.length,2);assert.match(result.warnings[1],/未自动刷新目录/);
 assert.deepEqual(Buffer.from(bytes),original);assert.ok(seen.length);assert.match(work,/paperknow-docx-pdf-/);await f.empty();
});

test('invalid, empty and oversized inputs never enter the converter',async t=>{
 let calls=0;const f=await fixture(t,{runConversion:async()=>calls++});
 for(const bytes of [undefined,new ArrayBuffer(4),new Uint8Array()])await assert.rejects(()=>f.renderer.convert({bytes}),errorCode('document_render_invalid'));
 await assert.rejects(()=>f.renderer.convert({bytes:new Uint8Array(THESIS_RENDER_MAX_INPUT_BYTES+1)}),errorCode('document_render_input_large'));
 await assert.rejects(()=>f.renderer.convert({bytes:new Uint8Array([80,75,0])}),errorCode('document_render_unsafe'));
 assert.equal(calls,0);await f.empty();
});

async function changedDocument(change){const zip=await JSZip.loadAsync(await docx());await change(zip);return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});}
test('macros, embedded objects, external images and dynamic file-import fields are rejected before conversion',async t=>{
 let calls=0;const f=await fixture(t,{runConversion:async()=>calls++});
 const changes=[
  zip=>zip.file('word/vbaProject.bin',new Uint8Array([0])),
  zip=>zip.file('word/embeddings/object.bin',new Uint8Array([0])),
  async zip=>zip.file('word/document.xml',(await zip.file('word/document.xml').async('string')).replace('</w:body>','<w:p><w:fldSimple w:instr="INCLUDETEXT &quot;https://example.test/private&quot;"><w:r><w:t>unsafe</w:t></w:r></w:fldSimple></w:p></w:body>')),
  async zip=>zip.file('word/document.xml',(await zip.file('word/document.xml').async('string')).replace('</w:body>','<w:p xmlns:v="urn:schemas-microsoft-com:vml"><w:r><w:pict><v:shape><v:imagedata src="https://example.test/remote.png"/></v:shape></w:pict></w:r></w:p></w:body>')),
  zip=>zip.file('word/_rels/dangerous.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="x" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" TargetMode="External" Target="https://example.test/remote.png"/></Relationships>')
 ];
 for(const change of changes)await assert.rejects(()=>changedDocument(change).then(bytes=>f.renderer.convert({bytes})),errorCode('document_render_unsafe'));
 assert.equal(calls,0);await f.empty();
});

test('ordinary web links are navigation and do not trigger application fetch',async t=>{
 const f=await fixture(t);let fetches=0;const original=globalThis.fetch;globalThis.fetch=()=>{fetches++;throw Error('network is forbidden');};
 try{
  const bytes=await changedDocument(async zip=>zip.file('word/document.xml',(await zip.file('word/document.xml').async('string')).replace('</w:body>','<w:p><w:fldSimple w:instr="HYPERLINK &quot;https://example.edu.cn/rules&quot;"><w:r><w:t>学校要求</w:t></w:r></w:fldSimple></w:p></w:body>')));
  assert.equal((await f.renderer.convert({bytes})).pages,1);assert.equal(fetches,0);
 }finally{globalThis.fetch=original;}
 await f.empty();
});

const pngCrcTable=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);return value>>>0;});
function pngChunk(type,data=Buffer.alloc(0)){
 const tag=Buffer.from(type),chunk=Buffer.alloc(12+data.length);chunk.writeUInt32BE(data.length);tag.copy(chunk,4);data.copy(chunk,8);let crc=0xffffffff;
 for(const byte of Buffer.concat([tag,data]))crc=(crc>>>8)^pngCrcTable[(crc^byte)&255];chunk.writeUInt32BE((crc^0xffffffff)>>>0,8+data.length);return chunk;
}
function syntheticPng(width=1,height=1,{animated=false}={}){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),...(animated?[pngChunk('acTL',Buffer.from([0,0,0,2,0,0,0,0]))]:[]),pngChunk('IDAT',Buffer.from([120,156,99,0,0,0,1,0,1])),pngChunk('IEND')]);
}
function syntheticJpeg(width=1,height=1){
 const frame=Buffer.alloc(11);frame.writeUInt16BE(11);frame[2]=8;frame.writeUInt16BE(height,3);frame.writeUInt16BE(width,5);frame[7]=1;frame[8]=1;frame[9]=0x11;
 return Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xc0]),frame,Buffer.from([0xff,0xda,0,8,1,1,0,0,63,0,0,0xff,0xd9])]);
}
async function documentWithMedia(media,{relationship=false}={}){
 return changedDocument(async zip=>{
  let types=await zip.file('[Content_Types].xml').async('string');
  for(const {name,bytes,mime}of media){zip.file(name,bytes);if(mime)types=types.replace('</Types>',`<Override PartName="/${name}" ContentType="${mime}"/></Types>`);}
  zip.file('[Content_Types].xml',types);
  if(relationship){const filename='word/_rels/document.xml.rels',rels=await zip.file(filename).async('string');zip.file(filename,rels.replace('</Relationships>',`<Relationship Id="renderTestImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${media[0].name.slice(5)}"/></Relationships>`));}
 });
}

test('embedded PNG/JPEG headers are bounded before conversion and the original DOCX remains unchanged',async t=>{
 let calls=0;const f=await fixture(t,{runConversion:async({workspace})=>{calls++;await writeFile(path.join(workspace,'output','document.pdf'),await pdfBytes());}});
 const bytes=await documentWithMedia([{name:'word/media/figure.png',bytes:syntheticPng(4000,3000),mime:'image/png'},{name:'word/media/figure.jpg',bytes:syntheticJpeg(4000,3000),mime:'image/jpeg'}]),original=Buffer.from(bytes);
 assert.equal((await f.renderer.convert({bytes})).pages,1);assert.equal(calls,1);assert.deepEqual(Buffer.from(bytes),original);await f.empty();
});

test('oversized PNG/JPEG dimensions, maximum edges and aggregate unreferenced media fail before conversion',async t=>{
 let calls=0;const f=await fixture(t,{runConversion:async()=>calls++});
 for(const image of [syntheticPng(4000,3001),syntheticPng(10001,1),syntheticJpeg(4000,3001),syntheticJpeg(10001,1)]){
  const bytes=await documentWithMedia([{name:'word/media/dimension-limit',bytes:image}]),original=Buffer.from(bytes);
  await assert.rejects(()=>f.renderer.convert({bytes}),errorCode('document_render_media_limit'));assert.deepEqual(Buffer.from(bytes),original);
 }
 const aggregate=await documentWithMedia(Array.from({length:3},(_,index)=>({name:`word/media/unreferenced-${index}.png`,bytes:syntheticPng(4000,3000),mime:'image/png'})));
 await assert.rejects(()=>f.renderer.convert({bytes:aggregate}),errorCode('document_render_media_limit'));assert.equal(calls,0);await f.empty();
});

test('APNG, malformed PNG/JPEG, unsupported raster/vector and relocated image relationships fail closed',async t=>{
 let calls=0;const f=await fixture(t,{runConversion:async()=>calls++}),badPng=syntheticPng();badPng[29]^=1;
 for(const [image,code]of [[syntheticPng(1,1,{animated:true}),'document_render_media_unsupported'],[badPng,'document_render_media_invalid'],[syntheticPng().subarray(0,24),'document_render_media_invalid'],[Buffer.from([0xff,0xd8,0xff,0xe0,0,2,0xff,0xd9]),'document_render_media_invalid'],[syntheticJpeg().subarray(0,-2),'document_render_media_invalid'],[Buffer.from('GIF89a'),'document_render_media_unsupported'],[Buffer.from('synthetic EMF'),'document_render_media_unsupported']]){
  const bytes=await documentWithMedia([{name:'word/media/not-trusted',bytes:image}]);await assert.rejects(()=>f.renderer.convert({bytes}),errorCode(code));
 }
 const vector=await documentWithMedia([{name:'word/assets/vector.emf',bytes:Buffer.from('EMF'),mime:'image/x-emf'}]);await assert.rejects(()=>f.renderer.convert({bytes:vector}),errorCode('document_render_media_unsupported'));
 const moved=await documentWithMedia([{name:'word/assets/drawing.dat',bytes:syntheticPng(5000,3000)}],{relationship:true});await assert.rejects(()=>f.renderer.convert({bytes:moved}),errorCode('document_render_media_limit'));
 // A second JPEG frame cannot override the dimensions checked in the first.
 const small=syntheticJpeg(),large=syntheticJpeg(10001,1),multiFrame=Buffer.concat([small.subarray(0,-2),large.subarray(2)]),multiple=await documentWithMedia([{name:'word/media/multiple.jpg',bytes:multiFrame,mime:'image/jpeg'}]);
 await assert.rejects(()=>f.renderer.convert({bytes:multiple}),errorCode('document_render_media_invalid'));assert.equal(calls,0);await f.empty();
});

test('one conversion per process is allowed across instances and failures release the slot',async t=>{
 let release,entered;const ready=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);
 const f=await fixture(t,{runConversion:async()=>{entered();await wait;throw Error('synthetic converter failure');}}),other=createThesisDocumentRenderer({commandPath:f.commandPath,tempRoot:f.root,useUno:false,runConversion:async({workspace})=>writeFile(path.join(workspace,'output','document.pdf'),await pdfBytes())});
 const bytes=await docx(),first=f.renderer.convert({bytes});await ready;assert.equal((await other.status()).busy,true);
 await assert.rejects(()=>other.convert({bytes}),errorCode('document_render_busy'));
 release();await assert.rejects(()=>first,/synthetic converter failure/);assert.equal((await other.status()).busy,false);
 assert.equal((await other.convert({bytes})).pages,1);await f.empty();
});

test('cancellation before and during conversion cleans files and leaves the service usable',async t=>{
 const controller=new AbortController();controller.abort();const f=await fixture(t);
 await assert.rejects(async()=>f.renderer.convert({bytes:await docx(),signal:controller.signal}),errorCode('document_render_cancelled'));
 const during=new AbortController(),g=await fixture(t,{runConversion:async()=>during.abort()});
 await assert.rejects(async()=>g.renderer.convert({bytes:await docx(),signal:during.signal}),errorCode('document_render_cancelled'));
 assert.equal((await f.renderer.convert({bytes:await docx()})).pages,1);await f.empty();await g.empty();
});

test('missing, invalid, oversized and symlinked PDF output is rejected and cleaned',async t=>{
 for(const variant of ['missing','header','broken','large','link']){
  const f=await fixture(t,{maxOutputBytes:1024,runConversion:async({workspace})=>{
   const target=path.join(workspace,'output','document.pdf');
   if(variant==='header')await writeFile(target,'not a PDF');
   if(variant==='broken')await writeFile(target,'%PDF-1.7 broken document');
   if(variant==='large')await writeFile(target,Buffer.alloc(1025));
   if(variant==='link')await symlink(path.join(workspace,'document.docx'),target);
  }});
  await assert.rejects(async()=>f.renderer.convert({bytes:await docx()}),error=>['document_render_missing','document_render_invalid_result','document_render_output_large'].includes(error.code));
  assert.equal((await f.renderer.status()).busy,false);await f.empty();
 }
});

function fakeExec({onCall,onKill,complete=true}={}){
 const child=new EventEmitter();child.pid=123456;let callback;
 child.kill=signal=>{onKill?.(child.pid,signal);setImmediate(()=>callback?.(Object.assign(new Error('killed'),{code:'KILLED'})));};
 return{child,run:(command,args,options,cb)=>{callback=cb;onCall?.(command,args,options);if(complete)setImmediate(()=>cb(null,'synthetic stdout',''));return child;},kill:(pid,signal)=>{onKill?.(pid,signal);setImmediate(()=>callback?.(Object.assign(new Error('killed'),{code:'KILLED'})));}};
}
test('process runner uses fixed arguments, isolated profile, bounded output and no inherited credentials or shell',async()=>{
 const fake=fakeExec({onCall:(command,args,options)=>{
  assert.equal(command,'/fixed/soffice');assert.ok(args.includes('pdf:writer_pdf_Export'));assert.ok(args.includes('/private/job/document.docx'));
  assert.ok(args[0].startsWith('-env:UserInstallation=file:///private/job/profile'));assert.equal(options.shell,false);assert.equal(options.maxBuffer,65536);
  assert.equal(options.env.HOME,'/private/job');assert.equal(options.env.SAL_USE_VCLPLUGIN,'svp');assert.equal(options.env.OPENAI_API_KEY,undefined);assert.equal(options.env.AWS_SECRET_ACCESS_KEY,undefined);
 }});
 await runThesisDocumentConversion({commandPath:'/fixed/soffice',workspace:'/private/job',useUno:false,execFileImpl:fake.run});
});

test('UNO command uses isolated Python and the fixed helper without any client-controlled URL or arguments',async()=>{
 const fake=fakeExec({onCall:(command,args,options)=>{
  assert.equal(command,'/fixed/python3');assert.equal(args[0],'-I');assert.match(args[1],/backend\/thesis-document-convert\.py$/);assert.deepEqual(args.slice(2),['/fixed/soffice','/private/job','120']);assert.equal(options.shell,false);assert.equal(options.detached,process.platform!=='win32');
 }});
 await runThesisDocumentConversion({commandPath:'/fixed/soffice',workspace:'/private/job',useUno:true,pythonPath:'/fixed/python3',execFileImpl:fake.run});
});

test('UNO result requires confirmed field/index refresh and unchanged private DOCX',async t=>{
 const f=await fixture(t,{useUno:true,runConversion:async({workspace,useUno})=>{
  assert.equal(useUno,true);const source=await readFile(path.join(workspace,'document.docx'));
  await writeFile(path.join(workspace,'conversion-report.json'),JSON.stringify({version:1,textFieldsRefreshed:true,indexesUpdated:1,sourceUnchanged:true,sourceSha256:createHash('sha256').update(source).digest('hex')}));
  await writeFile(path.join(workspace,'output','document.pdf'),await pdfBytes());
 }});
 const result=await f.renderer.convert({bytes:await docx()});assert.equal(result.pages,1);assert.equal(result.warnings.some(message=>message.includes('未自动刷新')),false);await f.empty();
 for(const variant of ['missing','incomplete','changed']){
  const g=await fixture(t,{useUno:true,runConversion:async({workspace})=>{
   const source=await readFile(path.join(workspace,'document.docx'));
   if(variant!=='missing')await writeFile(path.join(workspace,'conversion-report.json'),JSON.stringify({version:1,textFieldsRefreshed:variant!=='incomplete',indexesUpdated:0,sourceUnchanged:true,sourceSha256:createHash('sha256').update(source).digest('hex')}));
   if(variant==='changed')await writeFile(path.join(workspace,'document.docx'),'changed source');
   await writeFile(path.join(workspace,'output','document.pdf'),await pdfBytes());
  }});
  await assert.rejects(async()=>g.renderer.convert({bytes:await docx()}),errorCode('document_render_refresh_failed'));await g.empty();
 }
});

test('Python helper tests cover refresh order, read-only load, source immutability and subprocess cleanup',()=>{
 const result=execFileSync('python3',['-I',new URL('./thesis-document-convert-test.py',import.meta.url).pathname],{encoding:'utf8',timeout:15000});assert.match(result,/helper-tests-passed/);
});

test('process timeout kills the isolated process group and returns a safe error',async()=>{
 const kills=[],fake=fakeExec({complete:false,onKill:(...args)=>kills.push(args)});
 await assert.rejects(()=>runThesisDocumentConversion({commandPath:'/fixed/soffice',workspace:'/private/job',timeoutMs:10,execFileImpl:fake.run,killImpl:fake.kill}),errorCode('document_render_timeout'));
 assert.deepEqual(kills,[[process.platform==='win32'?123456:-123456,'SIGKILL']]);
});

test('process timeout also removes private source files and releases the renderer slot',async t=>{
 const fake=fakeExec({complete:false}),f=await fixture(t,{runConversion:options=>runThesisDocumentConversion({...options,timeoutMs:10,execFileImpl:fake.run,killImpl:fake.kill})});
 await assert.rejects(async()=>f.renderer.convert({bytes:await docx()}),errorCode('document_render_timeout'));
 assert.equal((await f.renderer.status()).busy,false);await f.empty();
});

test('process cancellation kills the group; command failures do not expose paths or command output',async()=>{
 const controller=new AbortController(),kills=[],fake=fakeExec({complete:false,onKill:(...args)=>kills.push(args)});
 const promise=runThesisDocumentConversion({commandPath:'/fixed/soffice',workspace:'/private/job',signal:controller.signal,execFileImpl:fake.run,killImpl:fake.kill});controller.abort();
 await assert.rejects(()=>promise,errorCode('document_render_cancelled'));assert.equal(kills.length,1);
 const absent=(_command,_args,_options,callback)=>{setImmediate(()=>callback(Object.assign(new Error('/private/secret TOKEN leaked'),{code:'ENOENT'})));return new EventEmitter();};
 await assert.rejects(()=>runThesisDocumentConversion({commandPath:'/fixed/soffice',workspace:'/private/job',execFileImpl:absent}),error=>error.code==='document_render_unavailable'&&!error.message.includes('secret'));
 await assert.rejects(()=>runThesisDocumentConversion({commandPath:'/fixed/soffice',workspace:'/private/job',execFileImpl:()=>{throw Error('secret');}}),errorCode('document_render_unavailable'));
});

test('API payload helper rejects ambiguous base64 before conversion and returns a PDF envelope',async()=>{
 let calls=0;const renderer={convert:async({bytes})=>{calls++;assert.deepEqual(bytes,Buffer.from('DOCX'));return{bytes:Buffer.from('%PDF-result'),pages:2,warnings:['分页需核对']};}};
 for(const data of [undefined,'','RA=','RE9DWA==\n','data:application/docx;base64,RE9DWA==','R===','Zh==','_w=='])await assert.rejects(()=>convertThesisDocumentPayload(renderer,{data}),errorCode('document_render_invalid'));
 await assert.rejects(()=>convertThesisDocumentPayload(renderer,{data:'A'.repeat(Math.ceil(THESIS_RENDER_MAX_INPUT_BYTES/3)*4+4)}),errorCode('document_render_input_large'));assert.equal(calls,0);
 await assert.rejects(()=>convertThesisDocumentPayload(renderer,{data:Buffer.alloc(THESIS_RENDER_MAX_INPUT_BYTES+1).toString('base64')}),errorCode('document_render_input_large'));assert.equal(calls,0);
 assert.deepEqual(await convertThesisDocumentPayload(renderer,{data:'RE9DWA=='}),{data:Buffer.from('%PDF-result').toString('base64'),pages:2,mimeType:'application/pdf',warnings:['分页需核对']});assert.equal(calls,1);
});

test('real LibreOffice renders the current DOCX with first and last body content preserved',{skip:!process.env.PAPERKNOW_TEST_SOFFICE},async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'paperknow-render-native-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const renderer=createThesisDocumentRenderer({commandPath:process.env.PAPERKNOW_TEST_SOFFICE,tempRoot:root});
 const text='Synthetic native rendering acceptance\n\n第一章 合成验收\nNATIVE_FIRST_CONTENT_MARKER\n'+Array.from({length:100},(_,index)=>'Synthetic paragraph '+index+': Chinese 研究正文 and English body are preserved.').join('\n')+'\nFINAL_RENDER_MARKER_20261023';
 const result=await renderer.convert({bytes:await createWritingDocx(text,{documentKind:'thesis',metadata:{title:'Synthetic native rendering acceptance'}})});
 assert.ok(result.pages>=2);const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(result.bytes),isEvalSupported:false,useSystemFonts:false}),pdf=await task.promise;
 try{let extracted='';for(let index=1;index<=pdf.numPages;index++)extracted+=(await(await pdf.getPage(index)).getTextContent()).items.map(item=>item.str).join('');assert.match(extracted,/NATIVE_FIRST_CONTENT_MARKER/);assert.match(extracted,/FINAL_RENDER_MARKER_20261023/);assert.equal(pdf.numPages,result.pages);}finally{await task.destroy();}
 assert.deepEqual(await readdir(root),[]);
});
