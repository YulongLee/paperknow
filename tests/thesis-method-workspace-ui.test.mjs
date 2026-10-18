import {workspaceJobLabel,workspaceJobActive,workspaceJobStatusLabel} from '../dist/workspace/workspace-job-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {withStableView} from '../dist/workspace/view-stability.mjs';
import {esc,icon} from '../dist/workspace/ui.mjs';
const personalCode=(await readFile(new URL('../dist/workspace/online-personal-services.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const code=(await readFile(new URL('../dist/workspace/online-workspace.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const now='2026-10-17T00:00:00Z';
async function settle(check){for(let i=0;i<80;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,4));}throw Error('Account method UI did not settle');}
// Same isolated DOM surface and API boundaries as online-workspace.test.mjs.
async function fixture(t,{view='tasks',params='',jobs:initialJobs=[],results=[],item}={}){
 const dom=new JSDOM('<div id="app"><aside id="existing-sidebar">现有导航</aside><main class="dashboard"><div id="online"></div></main></div>',{url:'https://paperknow.cn/workspace.html#tasks?scope=account',runScripts:'outside-only'}),w=dom.window,doc=w.document,calls=[],downloads=[],blobs=[];let jobs=structuredClone(initialJobs);
 t.after(()=>{w.onlineTest.disposeOnlineWorkspace();w.close();});
 w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const OriginalBlob=w.Blob;w.Blob=class extends OriginalBlob{constructor(parts,options){super(parts,options);this.testParts=parts;}};
 w.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:method-result';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push(this.download);};
 w.localStorage.setItem('paperknow-drafts','[{"title":"本地论文不应被上传"}]');
 w.download=async(name,content,type)=>{const blob=new w.Blob([content],{type});w.URL.createObjectURL(blob);downloads.push(name);return{message:'已保存到账户云文件并发起下载。'};};
 Object.assign(w,{workspaceJobLabel,workspaceJobActive,workspaceJobStatusLabel,withStableView,esc,icon,keys:{drafts:'paperknow-drafts'},list:key=>JSON.parse(w.localStorage.getItem(key)||'[]')});
 w.fetch=async(path,options={})=>{const body=options.body?JSON.parse(options.body):undefined;calls.push({path,body});let value={};
  if(path==='/api/auth/me')value={user:{id:'owner',name:'论文用户',email:'owner@example.test'}};
  else if(path==='/api/capabilities')value={ai:false,agent:false,thesisMethod:{ready:true}};
  else if(path==='/api/projects'||path==='/api/files'||path==='/api/workspace/drafts'||path==='/api/theses')value={items:[]};
  else if(path==='/api/jobs')value={items:jobs};
  else if(/^\/api\/jobs\/[^/]+\/cancel$/.test(path)){const id=path.split('/')[3];jobs=jobs.map(job=>job.id===id?{...job,status:'cancelled'}:job);}
  else if(path==='/api/results')value={items:results};
  else if(item&&path==='/api/results/'+item.id)value={item};
  else throw Error('Unexpected method account request '+path);
  return{ok:true,status:200,json:async()=>structuredClone(value)};
 };
 w.eval(personalCode+'\nwindow.renderOnlinePersonal=renderOnlinePersonal;');
 w.eval(code+'\nwindow.onlineTest={mountOnlineWorkspace,disposeOnlineWorkspace};');
 await w.onlineTest.mountOnlineWorkspace(doc.querySelector('#online'),view,{notify:()=>{}},new w.URLSearchParams(params));
 return{w,doc,calls,downloads,blobs};
}

test('method jobs have readable task names, search and paid retry boundaries even when generic AI is disabled',async t=>{
 const jobs=[{id:'method-failed',type:'thesis_method',status:'failed',attempt:1,created_at:now,error:'生成中断，请重新确认费用'},{id:'method-done',type:'thesis_method',status:'completed',attempt:1,created_at:now,result_id:'method-result'},{id:'unrelated-parse',type:'parse',status:'completed',attempt:1,created_at:now}];
 const f=await fixture(t,{jobs});
 assert.equal(f.doc.querySelectorAll('.account-job-row').length,3);
 const methodRows=[...f.doc.querySelectorAll('.account-job-row')].filter(row=>row.textContent.includes('研究方法建议'));
 assert.equal(methodRows.length,2);
 for(const row of methodRows){assert.ok(row.querySelector('a[href="#tool/writing"]'));assert.equal(row.querySelector('[data-action="retry"]'),null);}
 assert.equal(methodRows[1].querySelector('[data-result]').dataset.result,'method-result');
 const query=f.doc.querySelector('#account-job-query');query.value='研究方法建议';query.dispatchEvent(new f.w.Event('input',{bubbles:true}));
 assert.equal(f.doc.querySelectorAll('.account-job-row').length,2);
 assert.equal(f.calls.some(call=>call.body),false);
 assert.match(f.w.localStorage.getItem('paperknow-drafts'),/本地论文不应被上传/);
});

test('queued method tasks can cancel through their normal account action without retries or extra quotes',async t=>{
 const f=await fixture(t,{jobs:[{id:'method-queued',type:'thesis_method',status:'queued',attempt:0,created_at:now}]});
 f.doc.querySelector('[data-job="method-queued"][data-action="cancel"]').click();
 await settle(()=>f.doc.querySelector('.tag.cancelled'));
 assert.equal(f.calls.filter(call=>call.path==='/api/jobs/method-queued/cancel').length,1);
 assert.equal(f.calls.some(call=>call.path.includes('/retry')||call.path.includes('/billing/quote')),false);
 assert.match(f.doc.querySelector('#job-list').textContent,/研究方法建议/);
});

test('method results display proposed provenance and escape content while exporting the exact suggestion without revision calls',async t=>{
 const text='以下为拟采用的方法，尚未开展。\n步骤：核对用户条件。\n<script>alert("unsafe")</script>';
 const item={id:'method-result',type:'thesis_method',title:'用户题目 · 研究方法建议',created_at:now,body:{text,model:'configured-method-model',proposed:true,evidenceStatus:'proposal'}};
 const f=await fixture(t,{view:'results',params:'result=method-result',results:[item],item});
 assert.match(f.doc.querySelector('#view').textContent,/研究方法建议/);
 assert.match(f.doc.querySelector('#result-detail').textContent,/拟开展方案，需结合真实研究条件核对/);
 assert.doesNotMatch(f.doc.querySelector('#result-detail').textContent,/configured-method-model/);
 assert.match(f.doc.querySelector('#result-detail').textContent,/AI 生成方法建议/);
 assert.equal(f.doc.querySelector('#result-detail pre').textContent,text);
 assert.equal(f.doc.querySelector('#result-detail script'),null);
 assert.equal(f.doc.querySelector('#revision-form'),null);
 assert.ok(f.doc.querySelector('#result-detail a[href="#tool/writing"]'));
 f.doc.querySelector('#export-result').click();
 assert.deepEqual(f.downloads,['PaperKnow成果.txt']);
 assert.equal(f.blobs.length,1);assert.equal(f.blobs[0].testParts.join(''),text);
 assert.equal(f.blobs[0].type,'text/plain;charset=utf-8');
 assert.equal(f.calls.some(call=>call.path.includes('/revisions')||call.body),false);
});
