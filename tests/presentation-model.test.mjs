import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSlides,deckText,validateMaterial,validateDeck} from '../dist/workspace/presentation-model.mjs';
const base={title:'验证论文',material:'实际研究资料含有真实结果，不能补造结果。',pages:12,scenario:'毕业论文答辩',degree:'本科',language:'中文',author:'甲',school:'乙',advisor:'丙'};
test('outline preserves requested count and leaves evidence explicitly for the user',()=>{const s=buildSlides(base);assert.equal(s.length,12);assert.equal(new Set(s.map(s=>s.id)).size,12);assert.match(s[0].body,/甲 · 乙 · 导师：丙/);assert.ok(s.slice(1,-1).every(s=>s.body.startsWith('待补充')));assert.equal(s.at(-1).title,'致谢与问答');});
test('different scenarios produce distinct outlines and require real input',()=>{assert.notDeepEqual(buildSlides({...base,pages:8,scenario:'开题报告'}).map(s=>s.title),buildSlides({...base,pages:8}).map(s=>s.title));assert.throws(()=>buildSlides({...base,material:''}));assert.throws(()=>buildSlides({...base,pages:31}));assert.throws(()=>validateMaterial('x'.repeat(80001)));});
test('text export includes user edits and speaker notes; export validates slide limits',()=>{const deck={...base,slides:buildSlides(base)};deck.slides[1].body='用户提供的真实发现 [1]';deck.slides[1].notes='提醒核对引用';assert.match(deckText(deck),/用户提供的真实发现 \[1\]/);assert.match(deckText(deck),/提醒核对引用/);assert.equal(validateDeck(deck),deck);deck.slides[1].title='';assert.throws(()=>validateDeck(deck));});

test('PPTX export contains editable text, slide count and speaker notes, with XML escaping',async()=>{const {createPresentation}=await import('../src/presentation-export.js');const {default:JSZip}=await import('jszip');const deck={...base,theme:'academic',slides:buildSlides({...base,pages:6})};deck.slides[1].body='真实正文 <研究> & [1]';deck.slides[1].notes='演讲提示：保留来源';const bytes=await createPresentation(deck).write({outputType:'nodebuffer'});const zip=await JSZip.loadAsync(bytes);assert.equal(Object.keys(zip.files).filter(p=>/^ppt\/slides\/slide\d+\.xml$/.test(p)).length,6);const slide=await zip.file('ppt/slides/slide2.xml').async('string');assert.match(slide,/真实正文 &lt;研究&gt; &amp; \[1\]/);assert.match(slide,/<a:t>/);const notes=await zip.file('ppt/notesSlides/notesSlide2.xml').async('string');assert.match(notes,/演讲提示：保留来源/);assert.match(await zip.file('ppt/presentation.xml').async('string'),/12192000/);});
test('a short defense still contains methods and results',()=>{const slides=buildSlides({...base,pages:6});assert.ok(slides.some(s=>s.title==='研究设计与方法'));assert.ok(slides.some(s=>s.title==='研究结果与分析'));});

test('AI presentation snapshots require real report material, preserve user context and reject silent truncation',async()=>{
 const {presentationSnapshot,adoptPresentationOutput}=await import('../dist/workspace/presentation-model.mjs');
 assert.throws(()=>presentationSnapshot({...base,material:''},'thesis'),/论文正文/);
 assert.throws(()=>presentationSnapshot({...base,material:''},'proposal'),/开题报告正文/);
 assert.throws(()=>presentationSnapshot({...base,material:'x'.repeat(40001)},'ai'),/不会被截断/);
 const snapshot=presentationSnapshot({...base,material:'',prompt:'向新生介绍科研方法'},'ai');assert.equal(snapshot.materials.length,0);assert.equal(snapshot.text,'');assert.match(snapshot.requirements,/科研方法/);
 const output={slides:Array.from({length:12},(_,i)=>({title:'实际内容 '+i,body:'依据真实资料',notes:'备注',layout:'twoColumn'}))};assert.equal(adoptPresentationOutput(output,base).length,12);assert.throws(()=>adoptPresentationOutput({...output,slides:output.slides.slice(0,6)},base),/页数/);
});

test('two-column and closing slides export editable contents into actual independent text boxes',async()=>{
 const {createPresentation}=await import('../src/presentation-export.js'),{default:JSZip}=await import('jszip');const deck={...base,theme:'academic',slides:buildSlides({...base,pages:6})};deck.slides[1]={...deck.slides[1],layout:'twoColumn',body:'左栏真实资料\n左栏补充\n右栏真实资料\n右栏补充'};deck.slides[5].layout='closing';const zip=await JSZip.loadAsync(await createPresentation(deck).write({outputType:'nodebuffer'}));const xml=await zip.file('ppt/slides/slide2.xml').async('string');assert.match(xml,/左栏真实资料/);assert.match(xml,/右栏真实资料/);assert.ok((xml.match(/<p:txBody>/g)||[]).length>=5);
});


test('generated presentation references allow only owned API downloads and omit storage or provider data',async()=>{
 const {presentationArtifact,presentationDownloads,restorePresentationSnapshot,presentationSnapshot,presentationProgress,presentationPublicError}=await import('../dist/workspace/presentation-model.mjs');
 const result=presentationArtifact({presentation:{artifactId:'file_123',downloadUrl:'/api/artifacts/file_123/download',fileName:'研究汇报.pptx',pageCount:12,storageKey:'private/hidden',engineVersion:'private-engine'}});assert.deepEqual(result,{artifactId:'file_123',downloadUrl:'/api/artifacts/file_123/download',fileName:'研究汇报.pptx',pageCount:12});
 assert.equal(presentationArtifact({presentation:{artifactId:'file_123',downloadUrl:'https://untrusted.example/file.pptx'}}),null);assert.equal(presentationArtifact({artifacts:[{id:'x',kind:'pptx',downloadUrl:'/api/artifacts/another/download'}]}),null);assert.equal(presentationArtifact({presentation:{artifactId:'../secret'}}),null);assert.equal(presentationArtifact({artifactIds:['owned-id']}).downloadUrl,'/api/artifacts/owned-id/download');const files=presentationDownloads({presentation:{artifactId:'deck',previewArtifactId:'preview',sourcesArtifactId:'sources'}});assert.deepEqual(files.map(file=>file.role),['deck','preview','sources']);assert.deepEqual(files.map(file=>file.downloadUrl),['/api/artifacts/deck/download','/api/artifacts/preview/download','/api/artifacts/sources/download']);assert.equal(presentationDownloads({presentation:{artifactId:'deck'},artifacts:[{id:'preview',role:'preview',downloadUrl:'https://untrusted.example'}]}).length,1);
 const snapshot=presentationSnapshot({...base,prompt:'说明研究计划'},'proposal','premium'),restored=restorePresentationSnapshot(snapshot,{theme:'academic'});assert.deepEqual(presentationSnapshot(restored,'proposal',restored.pptTier),snapshot);assert.equal(restored.pptTier,'premium');
 assert.deepEqual(presentationProgress({stage:'authoring',progress:{currentPage:3,totalPages:12}}),{stage:'authoring',index:1,label:'制作演示页面',pageText:'3 / 12 页'});assert.equal(presentationProgress({progress:{stage:'internal-worker',currentPage:100,totalPages:12}}).stage,null);assert.equal(presentationProgress({progress:{currentPage:100,totalPages:12}}).pageText,'');assert.doesNotMatch(presentationPublicError('PPTMaster provider failed in /tmp/private'),/PPTMaster|provider|\/tmp/);
});


test('completed presentation progress uses delivered page counts after transient design checkpoints are removed',async()=>{
 const {presentationProgress}=await import('../dist/workspace/presentation-model.mjs');
 const completed={status:'completed',stage:'completed',progress:{stage:'planning',currentPage:1,completedPages:6,totalPages:6},output:{presentation:{artifactId:'completed-deck',pageCount:6}}};
 assert.equal(presentationProgress(completed).pageText,'6 / 6 页');
 assert.equal(presentationProgress({...completed,progress:undefined}).pageText,'6 / 6 页');
 assert.equal(presentationProgress({...completed,status:'running'}).pageText,'1 / 6 页');
 assert.equal(presentationProgress({status:'completed',progress:{currentPage:1,totalPages:12}}).pageText,'12 / 12 页');
});
