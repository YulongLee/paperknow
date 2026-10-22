import {thesisTemplatePanel,uploadThesisTemplate,thesisExportMetadata} from '../dist/workspace/thesis-template.mjs';
import {downloadDefaultThesisTemplate} from '../dist/workspace/document-export.mjs';
import {assessThesisEvidence} from '../dist/workspace/thesis-evidence.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {bindDocumentExports,documentExportButtons} from '../dist/workspace/document-export.mjs';
import {exportGeneratedFile} from '../dist/workspace/artifact-export.mjs';
import {endDraftScope} from '../dist/workspace/state.mjs';
import {withStableView} from '../dist/workspace/view-stability.mjs';
import {toolBanner} from '../dist/workspace/tool-banner.mjs';
import {presentThesisDocument} from '../dist/workspace/thesis-document.mjs';
import {isOutlineReferenceChapter} from '../dist/workspace/outline-word-budget.mjs';
import {thesisEditorPresentation,restoreThesisEditorText,thesisEditorWordCount} from '../dist/workspace/thesis-editor-presentation.mjs';
import {writingQualityPanel} from '../dist/workspace/writing-quality-panel.mjs';
const source=(await readFile(new URL('../dist/workspace/thesis-online.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const settle=async()=>{for(let i=0;i<14;i++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,{bytesGate}={}){
 endDraftScope();
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.test/workspace.html#thesis/t1',runScripts:'outside-only'}),w=dom.window;
 for(const key of ['window','document','location'])globalThis[key]=w[key];
 let cookieOwner='alice',downloads=0,uploadBytes=null,generating=false;
 const calls=[],exports=[],item={id:'t1',version:1,title:'合成账户论文',status:'completed',fullText:'合成账户论文正文',snapshot:{profile:{level:'本科',targetWords:1000},materials:[],references:[],outline:[]},chapters:[{id:'c1',title:'第一章',text:'合成账户论文正文',version:1,status:'saved',sourceIds:[]}]};
 w.HTMLAnchorElement.prototype.click=function(){downloads++;};
 const fetchImpl=async(path,options={})=>{calls.push({path,options});if(path==='/api/auth/me')return Response.json({user:{id:cookieOwner}});if(path==='/api/artifacts'){assert.equal(options.headers['X-PaperKnow-User'],cookieOwner);uploadBytes=Buffer.from(JSON.parse(options.body).data,'base64');return Response.json({item:{id:'file-1',bytes:uploadBytes.length}});}if(path.startsWith('/api/artifacts/file-1/download'))return new Response(uploadBytes);throw Error('Unexpected export request '+path);};
 const exportFile=async(name,content,type,options)=>{exports.push({name,content,type,options});return exportGeneratedFile({name,content,type,...options},{fetchImpl,documentObject:w.document,urlAPI:{createObjectURL:()=> 'blob:synthetic-export',revokeObjectURL(){}},notify(){},setTimeoutImpl(){}});};
 const renderer={createWritingDocx:async()=>{generating=true;return bytesGate?bytesGate.promise:new Uint8Array([80,75]);},createWritingPdf:async()=>{generating=true;return bytesGate?bytesGate.promise:new Uint8Array([37,80]);}};
 Object.assign(w,{withStableView,toolBanner,presentThesisDocument,assessThesisEvidence,isOutlineReferenceChapter,thesisEditorPresentation,restoreThesisEditorText,thesisEditorWordCount,writingQualityPanel,thesisTemplatePanel,uploadThesisTemplate,thesisExportMetadata,downloadDefaultThesisTemplate,exportFile,documentExportButtons,structuredClone,bindDocumentExports:(prefix,getText,getTitle,status,options)=>bindDocumentExports(prefix,getText,getTitle,status,{loadDocument:async()=>renderer,loadFont:async()=>new Uint8Array([0]),downloadFile:exportFile,...options})});
 w.eval(source+'\nwindow.thesisExports={mountOnlineThesis,disposeOnlineThesis,thesisOnlineSessionChanged};');
 const ctx={session:async()=>({status:'ready',user:{id:'alice'}}),api:async path=>{if(path==='/theses/t1')return {item:structuredClone(item)};if(path==='/capabilities')return {thesis:{ready:true}};if(path==='/auth/me')return {user:{id:cookieOwner}};throw Error('Unexpected thesis request '+path);}};
 const stop=w.thesisExports.mountOnlineThesis({id:'t1',ctx,container:w.document.querySelector('.dashboard')});await stop.ready;
 t.after(()=>{stop();dom.window.close();endDraftScope();});
 return {w,stop,calls,exports,get downloads(){return downloads;},get generating(){return generating;},setOwner(id){cookieOwner=id;},click(format){w.document.querySelector(format==='txt'?'[data-thesis-txt]':'#thesis-online-'+format).click();},q:selector=>w.document.querySelector(selector)};
}
test('account thesis TXT, DOCX and PDF explicitly retain the opened account outside draftScope',async t=>{
 for(const format of ['txt','docx','pdf']){const f=await fixture(t);f.click(format);await settle();assert.equal(f.exports.length,1);assert.equal(f.exports[0].options.expectedUserId,'alice');assert.equal(f.exports[0].name,'合成账户论文.'+format);assert.equal(f.calls.filter(call=>call.path==='/api/artifacts').length,1);assert.equal(f.downloads,1);f.stop();}
});
test('a switched cookie cannot upload or download an old account thesis in any export format',async t=>{
 for(const format of ['txt','docx','pdf']){const f=await fixture(t);f.setOwner('bob');f.click(format);await settle();assert.equal(f.exports[0]?.options.expectedUserId,'alice');assert.deepEqual(f.calls.map(call=>call.path),['/api/auth/me']);assert.equal(f.downloads,0);assert.match(f.q(format==='txt'?'[data-thesis-notice]':'[data-thesis-export-status]').textContent,/账户已变化/);f.stop();}
});
test('late account thesis DOCX and PDF bytes cannot write cloud files or download after the page is replaced',async t=>{
 for(const format of ['docx','pdf']){const gate=deferred(),f=await fixture(t,{bytesGate:gate});f.click(format);await settle();assert.equal(f.generating,true);f.stop();f.q('.dashboard').innerHTML='<h1>另一账户的新页面</h1>';f.setOwner('bob');gate.resolve(new Uint8Array([1,2]));await settle();assert.equal(f.exports.length,0);assert.equal(f.calls.length,0);assert.equal(f.downloads,0);assert.equal(f.q('.dashboard').textContent,'另一账户的新页面');}
});
