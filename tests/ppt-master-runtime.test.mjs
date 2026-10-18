import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {createPptMasterRuntime,getPptMasterRuntimeStatus,pptMasterRuntimeReady,runPptMasterCompiler,validatePptMasterPackage,validatePptMasterSlides,validatePptMasterSvg,PPT_MASTER_COMMIT} from '../backend/ppt-master-runtime.mjs';
import {verifyPptMasterSources} from '../scripts/setup-ppt-master.mjs';

const safeSvg=(text='Native &amp; editable')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" data-pptx-page-role="content"><rect x="0" y="0" width="1280" height="720" fill="#ffffff" data-pptx-role="background"/><g id="content-1" data-pptx-bounds="80 120 1000 100"><text x="80" y="160" font-family="Arial" font-size="32" fill="#123456">${text}</text></g></svg>`;
const good=[{svg:safeSvg(),title:'Native deck',notes:'Private speaker notes.'}];
const isCode=code=>error=>error.code===code&&error.pptMasterSafe===true;
const REL='http://schemas.openxmlformats.org/package/2006/relationships';
async function nativeFixture({external=false,image=false,slideContent,extra,text='Native &amp; editable'}={}){
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('_rels/.rels',`<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file('ppt/presentation.xml','<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');
  zip.file('ppt/slides/slide1.xml',slideContent??`<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${image?'<p:pic/>':`<p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`}</p:spTree></p:cSld></p:sld>`);
  if(external)zip.file('ppt/slides/_rels/slide1.xml.rels',`<Relationships xmlns="${REL}"><Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="https://example.test/"/></Relationships>`);
  if(extra)extra(zip);
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}

test('safe SVG preserves editable escaped text and semantic geometry',()=>{
  const svg=validatePptMasterSvg(safeSvg('安全 &lt;内容&gt; &amp; native'));
  assert.match(svg,/安全 &lt;内容&gt; &amp; native/);
  assert.match(svg,/data-pptx-bounds="80 120 1000 100"/);
  assert.equal(validatePptMasterSlides(good)[0].notes,good[0].notes);
});

test('SVG boundary denies script, resource, namespace, parser and complexity escape routes',()=>{
  const attacks=[
    safeSvg().replace('<text ','<text onload="alert(1)" '),
    safeSvg().replace('<g ','<g transform="translate(10 10)" '),
    safeSvg().replace('fill="#123456"','fill="url(https://example.test/image)"'),
    safeSvg().replace('Arial','https://example.test/font.woff'),
    safeSvg().replace('</svg>','<image href="file:///etc/passwd"/></svg>'),
    safeSvg().replace('</svg>','<a href="https://example.test"><text x="20" y="20">link</text></a></svg>'),
    safeSvg().replace('</svg>','<script>alert(1)</script></svg>'),
    safeSvg().replace('</svg>','<foreignObject/></svg>'),
    safeSvg().replace('</svg>','<use href="#content-1"/></svg>'),
    safeSvg().replace('</svg>','<defs><style>@font-face{src:url(x)}</style></defs></svg>'),
    '<!DOCTYPE svg [<!ENTITY leak SYSTEM "file:///etc/passwd">]>'+safeSvg(),
    '<?xml-stylesheet href="https://example.test/x"?>'+safeSvg(),
    safeSvg().replace('width="1280"','width="NaN"'),
    safeSvg().replace('viewBox="0 0 1280 720"','viewBox="0 0 1280 721"'),
    safeSvg().replace('<g id="content-1"','<g xmlns="https://example.test" id="content-1"'),
    safeSvg().replace('</svg>','<g id="content-1"/></svg>'),
    safeSvg().replace('</svg>','</svg><svg/>'),
    safeSvg().replace('x="80"','x="80" x="81"'),
    safeSvg().replace('<text ','<text bogus="1" '),
    safeSvg().replace('</svg>','<!-- retained active markup? --></svg>'),
    safeSvg().replace('</svg>','<path d="M0 0 R10 20"/></svg>'),
    safeSvg().replace('</svg>','<path d="M0 0 L1e99999 20"/></svg>'),
    safeSvg().replace('</svg>','<path d="M0 0 A10 20 0 2 1 30 40"/></svg>'),
    safeSvg().replace('<g id="content-1"','<g '+'<g>'.repeat(30)+'id="content-1"'),
    safeSvg('a'.repeat(270000)),
  ];
  for(const svg of attacks)assert.throws(()=>validatePptMasterSvg(svg),isCode('ppt_master_svg_invalid'));
  assert.throws(()=>validatePptMasterSlides(Array.from({length:41},()=>good[0])),isCode('ppt_master_svg_invalid'));
  assert.throws(()=>validatePptMasterSlides([{...good[0],notes:'x'.repeat(12001)}]),isCode('ppt_master_svg_invalid'));
});

test('SVG repair feedback identifies fixed rule categories and safe attribute constraints',()=>{
  const cases=[
    [safeSvg().replace('fill="#123456"','fill="white"'),'attribute_value','fill',/#RGB/],
    [safeSvg().replace('font-size="32"','font-size="32px"'),'attribute_value','font-size',/不带 px/],
    [safeSvg().replace('font-family="Arial"','font-family="Arial, sans-serif"'),'attribute_value','font-family',/一个受支持字体/],
    [safeSvg().replace('data-pptx-bounds="80 120 1000 100"','data-pptx-bounds="80 120 1000"'),'attribute_value','data-pptx-bounds',/4 个/],
    [safeSvg().replace('<rect ','<rect data-pptx-bounds="0 0 1280 720" '),'unsupported_attribute','data-pptx-bounds',/仅可放在 g/],
    [safeSvg().replace('<g ','<g transform="translate(20 20)" '),'unsupported_attribute','transform',/删除 CSS、变换/],
    [safeSvg().replace('</svg>','<image href="file:///private/secret"/></svg>'),'unsupported_element',undefined,/只可使用/],
    ['<?xml version="1.0"?>'+safeSvg(),'xml_declaration',undefined,/删除 XML 声明/],
    [safeSvg().replace('viewBox="0 0 1280 720"','viewBox="0 0 1280 721"'),'attribute_value','viewBox',/1280 720/],
  ];
  for(const [svg,category,attribute,rule] of cases)assert.throws(()=>validatePptMasterSvg(svg),error=>{
    assert.equal(error.code,'ppt_master_svg_invalid');assert.equal(error.status,422);
    assert.equal(error.svgValidation.category,category);assert.equal(error.svgValidation.attribute,attribute);
    assert.match(error.message,rule);assert.equal(error.publicMessage,'演示页面未通过安全校验，请重新生成');return true;
  });
});

test('SVG diagnostics never echo raw text, attribute values, URLs or arbitrary element names',()=>{
  const confidential='ConfidentialPatientCase';
  const source=safeSvg(confidential),attacks=[
    source.replace('<text ','<text href="https://private.example/ConfidentialPatientCase?secret=do-not-echo" '),
    source.replace('font-family="Arial"','font-family="https://private.example/ConfidentialPatientCase.woff"'),
    source.replace('xmlns="http://www.w3.org/2000/svg"','xmlns="https://private.example/ConfidentialPatientCase"'),
    source.replace('</svg>','<ConfidentialPatientCase/>'),
    source.replace('<text ','<text ConfidentialPatientCase="do-not-echo" '),
    source.replace('id="content-1"','id="ConfidentialPatientCase"').replace('</svg>','<g id="ConfidentialPatientCase"/></svg>'),
    source.replace('font-size="32"','font-size="32" font-size="ConfidentialPatientCase"'),
  ];
  for(const svg of attacks)assert.throws(()=>validatePptMasterSvg(svg),error=>{
    const diagnostic=JSON.stringify({...error,message:error.message});
    assert.doesNotMatch(diagnostic,/ConfidentialPatientCase|do-not-echo|https?:\/\/|<svg/);
    assert.ok(error.message.length<500);return isCode('ppt_master_svg_invalid')(error);
  });
});

test('renderer keeps public SVG validation failures generic before any process or file work',async()=>{
  const runtime=createPptMasterRuntime({}, {readiness:()=>{throw new Error('readiness must not run');},runCompiler:()=>{throw new Error('compiler must not run');}});
  await assert.rejects(()=>runtime.render({slides:[{svg:safeSvg().replace('font-size="32"','font-size="32px"')}]}),error=>{
    assert.equal(error.message,'演示页面未通过安全校验，请重新生成');assert.equal(error.svgValidation,undefined);return isCode('ppt_master_svg_invalid')(error);
  });
});

test('native package gate detects external links, active packages, raster fallback and ZIP expansion',async()=>{
  const valid=await nativeFixture();
  assert.deepEqual(await validatePptMasterPackage(valid,{slideCount:1}),{slideCount:1,nativeShapeCount:1,bytes:valid.length});
  const attacks=[
    nativeFixture({external:true}),nativeFixture({image:true}),
    nativeFixture({extra:zip=>zip.file('ppt/embeddings/oleObject1.bin','unsafe')}),
    nativeFixture({extra:zip=>zip.file('../unsafe.xml','<unsafe/>')}),
    nativeFixture({extra:zip=>zip.file('ppt/large.xml','x'.repeat(11*1024*1024))}),
    nativeFixture({extra:zip=>zip.file('ppt/slides/_rels/slide1.xml.rels',`<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="image" Target="file:///private/secret"/></Relationships>`)}),
    nativeFixture({slideContent:'<!DOCTYPE p:sld><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'}),
  ];
  for(const attack of attacks)await assert.rejects(()=>Promise.resolve(attack).then(b=>validatePptMasterPackage(b,{slideCount:1})),isCode('ppt_master_package_invalid'));
  const end=valid.length-22,directory=valid.readUInt32LE(end+16),firstLength=46+valid.readUInt16LE(directory+28)+valid.readUInt16LE(directory+30)+valid.readUInt16LE(directory+32),footer=Buffer.from(valid.subarray(end));
  footer.writeUInt16LE(valid.readUInt16LE(end+8)+1,8);footer.writeUInt16LE(valid.readUInt16LE(end+10)+1,10);footer.writeUInt32LE(valid.readUInt32LE(end+12)+firstLength,12);
  const duplicate=Buffer.concat([valid.subarray(0,end),valid.subarray(directory,directory+firstLength),footer]);
  await assert.rejects(()=>validatePptMasterPackage(duplicate,{slideCount:1}),isCode('ppt_master_package_invalid'));
  await assert.rejects(()=>validatePptMasterPackage(valid,{slideCount:2}),isCode('ppt_master_package_invalid'));
  await assert.rejects(()=>nativeFixture({text:'Dropped accepted content'}).then(bytes=>validatePptMasterPackage(bytes,{slideCount:1,slides:good})),isCode('ppt_master_package_invalid'));
  await assert.rejects(()=>validatePptMasterPackage(Buffer.alloc(20*1024*1024+1),{slideCount:1}),isCode('ppt_master_package_invalid'));
});

function fakeChild(){const child=new EventEmitter();child.pid=32109;child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{setImmediate(()=>child.emit('close',null));};return child;}
test('compiler uses fixed argv and clean env; cancellation kills entire process group',async()=>{
  const child=fakeChild(),controller=new AbortController(),kills=[];let invocation;
  const pending=runPptMasterCompiler({pythonPath:'/private/runtime/venv/bin/python',workspace:'/private/job',signal:controller.signal,spawnImpl:(...args)=>{invocation=args;return child;},killImpl:(...args)=>{kills.push(args);setImmediate(()=>child.emit('close',null));}});
  controller.abort();
  await assert.rejects(pending,isCode('ppt_master_cancelled'));
  assert.equal(invocation[0],'/private/runtime/venv/bin/python');
  assert.equal(invocation[1][0],'-I');assert.match(invocation[1][1],/ppt-master-compile\.py$/);
  assert.equal(invocation[2].shell,false);assert.equal(invocation[2].env.HOME,'/private/job');
  assert.equal(invocation[2].env.ALIYUN_ACCESS_KEY_SECRET,undefined);
  assert.deepEqual(Object.keys(invocation[2].env).sort(),['HOME','LANG','LC_ALL','OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','PATH','TEMP','TMP','TMPDIR'].sort());
  assert.deepEqual(kills,[[-32109,'SIGKILL']]);
});

test('compiler log overflow and wall timeout fail closed without source/log exposure',async()=>{
  for(const mode of ['logs','timeout']){
    const child=fakeChild();
    const pending=runPptMasterCompiler({pythonPath:'/fixed/python',workspace:'/private/job',maxLogBytes:20,timeoutMs:10,spawnImpl:()=>child,killImpl:()=>setImmediate(()=>child.emit('close',null))});
    if(mode==='logs')child.stderr.write('private source information '.repeat(3));
    await assert.rejects(pending,error=>isCode(mode==='logs'?'ppt_master_output_limit':'ppt_master_timeout')(error)&&!error.message.includes('private source'));
  }
});

test('render serializes compiler work, validates output and removes every temporary input',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'paperknow-runtime-test-'));
  let release,entered;const started=new Promise(resolve=>entered=resolve),pause=new Promise(resolve=>release=resolve);
  const fixture=await nativeFixture();let workspace;
  const runtime=createPptMasterRuntime({}, {tempRoot:root,readiness:()=>({ready:true}),runCompiler:async input=>{workspace=input.workspace;entered();await pause;await writeFile(path.join(workspace,'presentation.pptx'),fixture);}});
  try{
    const pending=runtime.render({slides:good});await started;
    await assert.rejects(()=>runtime.render({slides:good}),isCode('ppt_master_busy'));
    assert.match(await import('node:fs/promises').then(fs=>fs.readFile(path.join(workspace,'manifest.json'),'utf8')),/Private speaker notes/);
    release();const result=await pending;
    assert.ok(Buffer.isBuffer(result.pptx));assert.equal(result.commit,PPT_MASTER_COMMIT);assert.equal(result.previews[0].mime,'image/svg+xml');
    assert.deepEqual(await readdir(root),[]);
    const broken=createPptMasterRuntime({}, {tempRoot:root,readiness:()=>({ready:true}),runCompiler:async()=>{throw new Error('private stack');}});
    await assert.rejects(()=>broken.render({slides:good}),error=>isCode('ppt_master_compile_failed')(error)&&!error.message.includes('private'));
    assert.deepEqual(await readdir(root),[]);
    let startedAbort;const abortStarted=new Promise(resolve=>startedAbort=resolve),controller=new AbortController();
    const stopping=createPptMasterRuntime({}, {tempRoot:root,readiness:()=>({ready:true}),runCompiler:({signal})=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{code:'ppt_master_cancelled',pptMasterSafe:true})),{once:true});startedAbort();})});
    const aborted=stopping.render({slides:good,signal:controller.signal});await abortStarted;controller.abort();
    await assert.rejects(aborted,isCode('ppt_master_cancelled'));assert.deepEqual(await readdir(root),[]);
  }finally{release();await rm(root,{recursive:true,force:true});}
});

test('readiness requires enable flag and a completed isolated installation',()=>{
  assert.equal(pptMasterRuntimeReady({pptMasterEnabled:false}),false);
  assert.equal(getPptMasterRuntimeStatus({runtimeRoot:'/nonexistent/ppt-master'}).ready,false);
  assert.equal(createPptMasterRuntime({runtimeRoot:'/nonexistent/ppt-master'}).isReady(),false);
});

test('vendored official distribution has a reproducible per-file source lock and attribution',async()=>{
  const result=await verifyPptMasterSources();assert.equal(result.files,378);assert.ok(result.bytes<11*1024*1024);
});

test('official pinned compiler produces real native editable shapes and notes', {skip:!getPptMasterRuntimeStatus().ready}, async()=>{
  const slides=[{svg:safeSvg('真实可编辑文本 &amp; native'),title:'Native proof',notes:'Speaker notes remain private.'},{svg:safeSvg('Second page'),title:'Order proof',notes:'Second note.'}];
  const result=await createPptMasterRuntime().render({slides});
  assert.equal(result.validation.slideCount,2);assert.ok(result.validation.nativeShapeCount>=2);
  const zip=await JSZip.loadAsync(result.pptx),first=await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(first,/真实可编辑文本/);assert.match(first,/<p:sp>/);assert.doesNotMatch(first,/<p:pic>/);
  assert.match(await zip.file('ppt/notesSlides/notesSlide1.xml').async('string'),/Speaker notes remain private/);
  assert.match(await zip.file('ppt/slides/slide2.xml').async('string'),/Second page/);
});
