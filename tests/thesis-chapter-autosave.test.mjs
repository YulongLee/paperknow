import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountOnlineThesis,disposeOnlineThesis,thesisOnlineHasWork,thesisOnlineRouteGuard,thesisOnlineSessionChanged} from '../dist/workspace/thesis-online.mjs';

const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const chapter=(id,text='账户原文',version=1)=>({id,title:id==='c1'?'第一章':'第二章',text,version,status:'saved',sourceIds:[]});
const thesis=(id='t1')=>({id,version:3,title:'真实材料研究',status:'completed',profile:{level:'本科',method:'文献分析',researchQuestion:'已有研究问题',targetWords:1000},snapshot:{title:'真实材料研究',profile:{level:'本科',method:'文献分析',researchQuestion:'已有研究问题',targetWords:1000},materials:[],references:[],outline:[]},chapters:[chapter('c1'),chapter('c2','第二章账户正文')],job:null});
const key=(actor='u1',id='t1')=>'paperknow-thesis-edits-v1:'+encodeURIComponent(actor)+':'+encodeURIComponent(id);
function fixture(t,{handler}={}){
 disposeOnlineThesis();
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.cn/workspace.html#thesis/t1'}),win=dom.window;
 for(const name of ['window','document','location','AbortController'])globalThis[name]=win[name];
 let actor={id:'u1'},record=thesis();const calls=[];let confirms=0;win.confirm=()=>{confirms++;throw Error('Ordinary navigation must not prompt');};
 const ctx={session:async()=>({status:'ready',user:actor}),api:async(path,data)=>{
  calls.push({path,data});if(handler){const response=await handler(path,data);if(response!==undefined)return response;}
  if(path==='/auth/me')return {user:actor};if(path==='/capabilities')return {thesis:{ready:true}};
  if(path==='/theses/'+record.id&&!data)return {item:structuredClone(record)};
  if(path==='/theses/'+record.id&&data){assert.equal(data.version,record.version);record={...record,version:record.version+1,snapshot:data.snapshot,profile:data.snapshot.profile};return {item:structuredClone(record)};}
  const match=path.match(/^\/theses\/[^/]+\/chapters\/([^/]+)$/);if(match&&data){assert.equal(data.version,record.version);record={...record,version:record.version+1,chapters:record.chapters.map(row=>row.id===match[1]?{...row,text:data.text,version:row.version+1,status:'saved'}:row)};return {item:structuredClone(record)};}
  throw Error('Unexpected request '+path);
 }};
 const f={win,dom,ctx,calls,storage:win.localStorage,$:selector=>win.document.querySelector(selector),setActor:value=>{actor=value;},setRecord:value=>{record=structuredClone(value);},getRecord:()=>structuredClone(record),get confirms(){return confirms;},async mount(id=record.id){const stop=mountOnlineThesis({id,ctx,container:f.$('.dashboard')});await stop.ready;return stop;},edit(selector,value){const input=f.$(selector);input.value=value;input.dispatchEvent(new win.Event('input',{bubbles:true}));},stored(actorId='u1',id='t1'){return JSON.parse(win.localStorage.getItem(key(actorId,id)));}};
 t.after(()=>{disposeOnlineThesis();win.close();});return f;
}

test('chapter input saves per chapter locally, returns after navigation, and creates an account version only on explicit save',async t=>{
 const f=fixture(t);let stop=await f.mount();f.edit('[data-thesis-editor]','第一章本地修改');
 assert.equal(f.stored().chapters[0].text,'第一章本地修改');assert.equal(f.stored().chapters[0].baseText,'账户原文');assert.equal(f.stored().chapters[0].baseVersion,1);
 assert.match(f.$('[data-thesis-edit-state]').textContent,/本浏览器草稿已自动保存/);assert.equal(f.$('#thesis-online-docx').disabled,true);
 f.$('[data-thesis-chapter="c2"]').click();f.edit('[data-thesis-editor]','第二章本地修改');assert.equal(f.stored().chapters.length,2);
 assert.equal(thesisOnlineRouteGuard(),true);assert.equal(f.confirms,0);stop();f.$('.dashboard').innerHTML='<h1>其他页面</h1>';assert.equal(thesisOnlineHasWork(),false);
 stop=await f.mount();assert.equal(f.$('[data-thesis-editor]').value,'第二章本地修改');assert.match(f.$('[data-thesis-notice]').textContent,/已恢复此账户/);assert.equal(f.calls.some(row=>row.data),false);
 f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.getRecord().chapters[1].text,'第二章本地修改');assert.equal(f.stored().chapters.length,1);assert.equal(f.stored().chapters[0].id,'c1');assert.equal(f.calls.filter(row=>row.data).length,1);
 stop();await f.mount();f.$('[data-thesis-chapter="c1"]').click();assert.equal(f.$('[data-thesis-editor]').value,'第一章本地修改');f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.storage.getItem(key()),null);assert.equal(thesisOnlineHasWork(),false);assert.equal(f.$('#thesis-online-docx').disabled,false);
});

test('refresh and navigation remain prompt free after persistence; a storage failure alone blocks leaving and can be retried',async t=>{
 const f=fixture(t);await f.mount();f.edit('[data-thesis-editor]','可恢复修改');let event=new f.win.Event('beforeunload',{cancelable:true});assert.equal(f.win.dispatchEvent(event),true);assert.equal(thesisOnlineRouteGuard(),true);
 const original=f.win.Storage.prototype.setItem;f.win.Storage.prototype.setItem=function(){throw Error('quota exhausted');};
 try{f.edit('[data-thesis-editor]','存储失败仍保留在编辑区');assert.equal(f.$('[data-thesis-editor]').value,'存储失败仍保留在编辑区');assert.match(f.$('[data-thesis-notice]').textContent,/自动保存草稿未成功/);assert.equal(thesisOnlineRouteGuard(),false);event=new f.win.Event('beforeunload',{cancelable:true});assert.equal(f.win.dispatchEvent(event),false);assert.equal(f.stored().chapters[0].text,'可恢复修改');assert.equal(f.confirms,0);}finally{f.win.Storage.prototype.setItem=original;}
 assert.equal(thesisOnlineRouteGuard(),true);assert.equal(f.stored().chapters[0].text,'存储失败仍保留在编辑区');assert.equal(f.calls.some(row=>row.data),false);
});

test('account and thesis boundaries isolate restored drafts while a session change removes old private text from view',async t=>{
 const f=fixture(t);let stop=await f.mount();f.edit('[data-thesis-editor]','账户一的私人编辑');thesisOnlineSessionChanged({id:'u2'});assert.doesNotMatch(f.$('.dashboard').textContent,/账户一的私人编辑/);assert.equal(f.stored().actorId,'u1');
 f.setActor({id:'u2'});stop=await f.mount();assert.equal(f.$('[data-thesis-editor]').value,'账户原文');f.edit('[data-thesis-editor]','账户二的私人编辑');stop();
 f.setActor({id:'u1'});f.setRecord(thesis('t2'));stop=await f.mount();assert.equal(f.$('[data-thesis-editor]').value,'账户原文');assert.equal(f.storage.getItem(key('u1','t2')),null);stop();
 f.setRecord(thesis());await f.mount();assert.equal(f.$('[data-thesis-editor]').value,'账户一的私人编辑');assert.equal(f.stored('u2').chapters[0].text,'账户二的私人编辑');assert.equal(f.calls.some(row=>row.data),false);
});

test('a restored draft cannot overwrite a changed chapter until the user explicitly reviews and rebases it',async t=>{
 const f=fixture(t);const stop=await f.mount();f.edit('[data-thesis-editor]','我的离线修改');stop();
 const newer=thesis();newer.version=5;newer.chapters[0]=chapter('c1','另一设备的新正文',2);f.setRecord(newer);await f.mount();
 assert.equal(f.$('[data-thesis-editor]').value,'我的离线修改');assert.match(f.$('.thesis-chapter-conflict').textContent,/另一设备的新正文/);assert.match(f.$('[data-thesis-edit-state]').textContent,/账户版本变化/);f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.calls.some(row=>row.data),false);assert.equal(f.getRecord().chapters[0].text,'另一设备的新正文');
 f.$('[data-thesis-rebase]').click();assert.equal(f.calls.some(row=>row.data),false);assert.equal(f.stored().chapters[0].baseVersion,2);f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.calls.filter(row=>row.data).length,1);assert.equal(f.getRecord().chapters[0].text,'我的离线修改');assert.equal(f.storage.getItem(key()),null);
});

test('a higher chapter version is a conflict even when its saved text is identical to the old base',async t=>{
 const f=fixture(t);let stop=await f.mount();f.edit('[data-thesis-editor]','我的修改');stop();const newer=thesis();newer.version=4;newer.chapters[0].version=2;f.setRecord(newer);stop=await f.mount();assert.ok(f.$('[data-thesis-rebase]'));f.$('[data-thesis-save-chapter]').click();await settle();assert.equal(f.calls.some(row=>row.data),false);assert.equal(f.stored().chapters[0].baseVersion,1);
});

test('a server save conflict retains local text across disposal without retrying or charging a generation',async t=>{
 const f=fixture(t,{handler:(path,data)=>path.endsWith('/chapters/c1')&&data?Promise.reject(Object.assign(Error('version conflict'),{status:409})):undefined});const stop=await f.mount();f.edit('[data-thesis-editor]','冲突中的正文');f.$('[data-thesis-save-chapter]').click();await settle();assert.match(f.$('[data-thesis-notice]').textContent,/版本已更新/);assert.equal(f.stored().chapters[0].text,'冲突中的正文');stop();await f.mount();assert.equal(f.$('[data-thesis-editor]').value,'冲突中的正文');assert.equal(f.calls.filter(row=>row.data).length,1);assert.equal(f.calls.some(row=>/quote|generate|resume/.test(row.path)),false);
});

test('research supplements restore as unsubmitted drafts and cannot overwrite a newer research snapshot without review',async t=>{
 const f=fixture(t);const stop=await f.mount();f.edit('#thesis-research-method','我补充的研究方法');f.edit('#thesis-research-supplement','尚未提交的真实观察记录');assert.equal(f.stored().research.baseVersion,3);stop();
 const newer=thesis();newer.version=4;newer.profile.method='其他设备更新的方法';newer.snapshot.profile.method='其他设备更新的方法';f.setRecord(newer);await f.mount();assert.equal(f.$('#thesis-research-method').value,'我补充的研究方法');assert.equal(f.$('#thesis-research-supplement').value,'尚未提交的真实观察记录');assert.equal(f.getRecord().snapshot.materials.length,0);assert.equal(f.calls.some(row=>row.data),false);
 f.$('[data-thesis-save-research]').click();await settle();assert.equal(f.calls.some(row=>row.data),false);assert.match(f.$('[data-thesis-notice]').textContent,/账户论文已有新版本/);f.$('[data-thesis-rebase-research]').click();f.$('[data-thesis-save-research]').click();await settle();assert.equal(f.calls.filter(row=>row.data).length,1);assert.equal(f.getRecord().snapshot.materials[0].text,'尚未提交的真实观察记录');assert.equal(f.storage.getItem(key()),null);
});

test('removed chapters keep recoverable escaped text and never silently disappear from the local draft',async t=>{
 const f=fixture(t);const stop=await f.mount();f.edit('[data-thesis-editor]','已移除章节草稿 <script>不执行</script>');stop();const newer=thesis();newer.version=4;newer.chapters=[chapter('c2')];f.setRecord(newer);await f.mount();assert.match(f.$('.thesis-chapter-conflict').textContent,/已移除章节草稿/);assert.equal(f.$('script'),null);assert.equal(f.$('[data-thesis-editor]').value,'账户原文');assert.equal(f.stored().chapters[0].id,'c1');assert.equal(f.calls.some(row=>row.data),false);assert.equal(thesisOnlineRouteGuard(),true);
});

test('a concurrent browser tab draft is not overwritten by a stale tab',async t=>{
 const f=fixture(t);await f.mount();f.edit('[data-thesis-editor]','本标签页的修改');const concurrent={...f.stored(),revision:'other-tab-revision',chapters:[{...f.stored().chapters[0],text:'其他标签页的修改'}]};f.storage.setItem(key(),JSON.stringify(concurrent));f.edit('[data-thesis-editor]','本标签页继续输入');assert.equal(f.stored().chapters[0].text,'其他标签页的修改');assert.equal(f.$('[data-thesis-editor]').value,'本标签页继续输入');assert.equal(thesisOnlineRouteGuard(),false);assert.match(f.$('[data-thesis-notice]').textContent,/其他页面更新/);assert.equal(f.calls.some(row=>row.data),false);
});

test('malformed local recovery data is preserved rather than removed or submitted',async t=>{
 const f=fixture(t);const malformed=JSON.stringify({schema:1,actorId:'u1',thesisId:'t1',revision:'r1',chapters:[{id:'c1',text:'保留原始异常数据'}]});f.storage.setItem(key(),malformed);await f.mount();assert.equal(f.$('[data-thesis-editor]').value,'账户原文');assert.match(f.$('[data-thesis-notice]').textContent,/本地章节草稿格式不完整/);f.edit('[data-thesis-editor]','新输入仍在内存');assert.equal(thesisOnlineRouteGuard(),false);assert.equal(f.storage.getItem(key()),malformed);assert.equal(f.calls.some(row=>row.data),false);
});


test('editing after a quotation invalidates consent and cannot start paid generation with an unsaved chapter',async t=>{
 const f=fixture(t,{handler:path=>path==='/theses/t1/quote'?{type:'agent',source:'credits',title:'分章生成',token:'quote-token',creditCost:10,expiresAt:new Date(Date.now()+60000).toISOString()}:undefined});const record=thesis();record.status='draft';record.snapshot.materials=[{id:'m1',name:'真实材料',text:'用户提供的真实材料',confirmed:true}];f.setRecord(record);await f.mount();f.$('[data-thesis-quote]').click();await settle();assert.ok(f.$('[data-thesis-consent]'));f.edit('[data-thesis-editor]','报价后的编辑');const consent=f.$('[data-thesis-consent]');consent.checked=true;consent.dispatchEvent(new f.win.Event('change'));assert.equal(f.$('[data-thesis-start]').disabled,true);f.$('[data-thesis-start]').click();await settle();assert.equal(f.calls.some(row=>/generate|resume/.test(row.path)),false);assert.equal(f.stored().chapters[0].text,'报价后的编辑');
});

test('unavailable local storage does not block an unedited account page',async t=>{
 const f=fixture(t),original=f.win.Storage.prototype.getItem;f.win.Storage.prototype.getItem=function(){throw Error('storage disabled');};try{await f.mount();assert.equal(thesisOnlineHasWork(),false);assert.equal(thesisOnlineRouteGuard(),true);assert.equal(f.win.dispatchEvent(new f.win.Event('beforeunload',{cancelable:true})),true);assert.equal(f.calls.some(row=>row.data),false);}finally{f.win.Storage.prototype.getItem=original;}
});


test('reverting research fields to the account values clears unnecessary recovery work without submitting a snapshot',async t=>{
 const f=fixture(t);await f.mount();f.edit('#thesis-research-method','临时研究方法');assert.equal(thesisOnlineHasWork(),true);assert.ok(f.stored().research);f.edit('#thesis-research-method','文献分析');assert.equal(thesisOnlineHasWork(),false);assert.equal(f.storage.getItem(key()),null);assert.equal(f.$('[data-thesis-save-research]').disabled,true);assert.equal(f.calls.some(row=>row.data),false);
});
