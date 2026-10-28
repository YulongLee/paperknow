import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import JSZip from 'jszip';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession} from '../backend/auth.mjs';
import {createStorage} from '../backend/storage.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {startToolRunWorker} from '../backend/tool-run-worker.mjs';
import {createPptMasterRuntime,getPptMasterRuntimeStatus} from '../backend/ppt-master-runtime.mjs';

const runtime={enabled:true,engine:'claude-agent-sdk',baseURL:'https://synthetic-runtime.example.invalid',model:'private-synthetic-model',apiKey:'private-synthetic-key',version:'ppt-delivery-fixture',maxTurns:12,maxOutputTokens:4096,maxCostUsd:.5,timeoutMs:30000};
const source='【合成测试资料】样本来自三次测量。处理流程保持原始顺序，引用标记为 [1]。';
const input=()=>({kind:'presentation',operation:'ppt',snapshot:{title:'【合成验收】研究汇报',text:source,language:'中文',mode:'thesis',requirements:'只整理给定的合成资料，不增添研究结果。',context:{pages:6,theme:'focus'}}});
const fixtureZip=new JSZip();fixtureZip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',{date:new Date('2026-01-01T00:00:00Z')});fixtureZip.file('ppt/presentation.xml','<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',{date:new Date('2026-01-01T00:00:00Z')});
const fixtureBuffer=await fixtureZip.generateAsync({type:'nodebuffer'});
const xml=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
const result=(body,materials)=>({text:JSON.stringify({complete:true,...body}),trace:materials.map(row=>({tool:'read_material',status:'completed',materialId:row.id,offset:0,limit:row.text.length})),usage:{input:100,output:100},costUsd:.001});
function author({task,validateToolOutput}){
 let output;
 if(task.context.operation==='ppt'){
  const {start,count}=task.context.unit,total=task.context.options.pages;
  output=result({sourceIds:task.materials.map(row=>row.id),slides:Array.from({length:count},(_,index)=>{const page=start+index+1;return{id:'slide-'+page,title:page===1?task.context.title:'研究页面 '+page,body:'样本来自三次测量 [1]\n处理流程保持原始顺序',notes:'核对给定的合成资料，不补充研究结果。',layout:page===1?'cover':page===total?'closing':'content'};})},task.materials);
 }else{
  assert.equal(task.context.operation,'ppt-master-slide');
  const {current}=task.context.design;
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" data-pptx-page-role="'+current.role+'"><rect id="background" data-pptx-role="background" x="0" y="0" width="1280" height="720" fill="#FFFFFF"/>'+task.context.visibleContent.map((row,index)=>{const footer=row.role==='footer',y=footer?670:40+index*170,h=footer?40:140,size=row.role==='title'?44:footer?16:26;return '<g id="'+row.id+'" data-pptx-bounds="60 '+y+' 1160 '+h+'"><text x="72" y="'+(y+(footer?24:60))+'" font-family="Microsoft YaHei" font-size="'+size+'" fill="#173E48">'+xml(row.text)+'</text></g>';}).join('')+'</svg>';
  output=result({slide:structuredClone(task.context.outputSchema.slide),svg,sourceIds:[task.materials[0].id]},task.materials);
 }
 assert.equal(validateToolOutput(output).valid,true,JSON.stringify(validateToolOutput(output)));
 return output;
}
function gate(){let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),waiting=new Promise(resolve=>{release=resolve;});return{entered,release,async hold(){enter();await waiting;}};}
async function fixture(t,extra={}){
 const db=database(':memory:'),objects=new Map(),uploads=[],removals=[],hooks={},gates=[],users={};
 for(const id of ['alice','bob']){db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());users[id]={id,cookie:'pk_session='+createSession(db,id)};}
 const storage=createStorage({ossBucket:'synthetic-ppt-bucket',ossEndpoint:'https://oss-cn-shanghai.aliyuncs.com',ossRegion:'cn-shanghai',ossPrefix:'paperknow/',ossAccessKeyId:'synthetic-id',ossAccessKeySecret:'synthetic-secret'},{async put(key,value,options){const upload={key,buffer:Buffer.from(value),options};uploads.push(upload);await hooks.beforePut?.(upload);objects.set(key,Buffer.from(value));},async get(key){return{content:objects.get(key)};},async delete(key){await hooks.beforeDelete?.(key);removals.push(key);objects.delete(key);}});
 let authorCalls=0,rendererCalls=0,worker;
 const config={storage,getAI:()=>({enabled:false}),getAgentSettings:version=>!version||version===runtime.version?{...runtime}:null,agentTaskRunner:async args=>{authorCalls++;return author(args);},pptMasterEnabled:true,pptMasterRenderer:async({slides,signal})=>{rendererCalls++;assert.equal(slides.length,6);assert.equal(signal.aborted,false);return{pptx:fixtureBuffer};},toolPollMs:60000,...extra};
 const billing=createBillingService(db,config);config.billing=billing;
 const api=createAPI(db,{cancel(id){worker?.cancel(id);}},config),server=http.createServer((req,res)=>void api(req,res));worker=startToolRunWorker(db,config);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{for(const waiting of gates)waiting.release();await worker.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
 const call=(path,data,user='alice')=>fetch(base+(path.startsWith('/api/')?path:'/api'+path),{method:data===undefined?'GET':'POST',headers:{...(user?{Cookie:users[user].cookie}:{}),...(data===undefined?{}:{Origin:base,'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
 async function request(path,data,user){const response=await call(path,data,user);return{status:response.status,value:await response.json()};}
 function pay(){billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});const id=randomUUID(),at=new Date().toISOString();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,'alice','credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(id,'alice','credits-200',200,'purchase',at);}
 async function submit(value=input(),options={}){const quoted=await request('/tool-runs/quote',value);assert.equal(quoted.status,200,JSON.stringify(quoted.value));const command={...value,...options,clientKey:randomUUID(),billingToken:quoted.value.token,consent:true},created=await request('/tool-runs/jobs',command);assert.equal(created.status,202,JSON.stringify(created.value));return{...created.value.item,command};}
 const eventCount=(kind,id)=>db.prepare('SELECT count(*) n FROM billing_events e JOIN billing_reservations r ON r.id=e.reservation_id WHERE e.kind=? AND r.job_id=?').get(kind,id).n;
 return{db,objects,uploads,removals,hooks,config,billing,call,request,pay,submit,eventCount,get worker(){return worker;},authorCalls:()=>authorCalls,rendererCalls:()=>rendererCalls,newGate(){const waiting=gate();gates.push(waiting);return waiting;},async restart(){await worker.stop();worker=startToolRunWorker(db,config);return worker;}};
}
function uncharged(f,id){assert.equal(f.billing.balance('alice').balance,200);assert.equal(f.billing.balance('alice').held,0);assert.equal(f.eventCount('settle',id),0);assert.equal(f.eventCount('release',id),1);assert.equal(f.db.prepare('SELECT count(*) n FROM results WHERE job_id=?').get(id).n,0);}

test('twelve-page content repairs the exact second batch and delivers all pages with one settlement',async t=>{
 const tasks=[];let rendered=0,nativeProof;
 const f=await fixture(t,{agentTaskRunner:async args=>{
  tasks.push({operation:args.task.context.operation,unit:args.task.context.unit?.id,page:args.task.context.design?.current.id});
  if(args.task.context.operation==='ppt'&&args.task.context.unit.start===6){
   const bad=result({slides:[{id:'slide-7',title:'未完整的候选',body:'不得持久化的候选正文',layout:'content',notes:''}],sourceIds:args.task.materials.map(s=>s.id)},args.task.materials);
   for(let i=0;i<8;i++)assert.equal(args.validateToolOutput(bad).feedback.presentation.expectedCount,6);
  }
  return author(args);
 },pptMasterRenderer:async({slides})=>{rendered++;assert.deepEqual(slides.map(s=>s.id),Array.from({length:12},(_,i)=>'slide-'+(i+1)));if(getPptMasterRuntimeStatus().ready){nativeProof=await createPptMasterRuntime().render({slides});assert.equal(nativeProof.validation.slideCount,12);assert.ok(nativeProof.validation.nativeShapeCount>=12);return nativeProof;}return{pptx:fixtureBuffer};}});
 f.pay();const value=input();value.snapshot.context.pages=12;const job=await f.submit(value);await f.worker.tick();
 const completed=(await f.request('/tool-runs/jobs/'+job.id)).value.item;
 assert.equal(completed.status,'completed',JSON.stringify(completed));assert.equal(completed.output.slides.length,12);assert.equal(completed.completedUnits,2);assert.equal(completed.progress.completedPages,12);assert.equal(rendered,1);
 assert.deepEqual(tasks.filter(t=>t.operation==='ppt').map(t=>t.unit),['unit-0','unit-1']);assert.equal(tasks.filter(t=>t.operation==='ppt-master-slide').length,12);
 const diagnostic=f.db.prepare('SELECT code,metrics FROM tool_diagnostics WHERE run_id=?').get(job.id),metrics=JSON.parse(diagnostic.metrics);
 assert.equal(diagnostic.code,'ppt_completed_after_repair');assert.equal(metrics.presentationValidation.rejected,8);assert.equal(metrics.presentationValidation.recent.length,6);
 for(const r of metrics.presentationValidation.recent){assert.equal(r.code,'ppt_page_count');assert.equal(r.unitId,'unit-1');assert.equal(r.expectedCount,6);assert.equal(r.actualCount,1);}
 assert.doesNotMatch(diagnostic.metrics,/未完整|候选正文|private|apiKey/);assert.equal(completed.output.presentationValidation,undefined);
 if(nativeProof){const zip=await JSZip.loadAsync(f.uploads.find(u=>u.key.endsWith('.pptx')).buffer);assert.equal(Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,12);assert.match(await zip.file('ppt/notesSlides/notesSlide12.xml').async('string'),/合成资料/);}
 const archive=f.uploads.find(u=>u.key.endsWith('.zip')),zip=await JSZip.loadAsync(archive.buffer);assert.equal(Object.keys(zip.files).filter(n=>/^slides\/slide-\d+\.svg$/.test(n)).length,12);
 assert.equal(f.billing.balance('alice').balance,190);assert.equal(f.billing.balance('alice').held,0);assert.equal(f.eventCount('settle',job.id),1);
});

test('second-batch failure records safe repair causes and explicit resume skips the saved first six pages',async t=>{
 const units=[];let fail=true;
 const f=await fixture(t,{agentTaskRunner:async args=>{
  if(args.task.context.operation==='ppt'){
   units.push(args.task.context.unit.id);
   if(fail&&args.task.context.unit.start===6){
    const bad=result({complete:false,slides:[],sourceIds:args.task.materials.map(s=>s.id)},args.task.materials);assert.equal(args.validateToolOutput(bad).feedback.presentation.code,'ppt_completion');
    throw Object.assign(Error('AI 已达到回合上限，结果未完成'),{code:'turn_limit',status:502,usage:{input:20,output:10},costUsd:.001});
   }
  }
  return author(args);
 },pptMasterRenderer:async({slides})=>{assert.equal(slides.length,12);return{pptx:fixtureBuffer};}});
 f.pay();const value=input();value.snapshot.context.pages=12;const job=await f.submit(value);await f.worker.tick();
 const failed=(await f.request('/tool-runs/jobs/'+job.id)).value.item;assert.equal(failed.status,'failed');assert.equal(failed.completedUnits,1);uncharged(f,job.id);assert.equal(f.uploads.length,0);
 const diagnostic=f.db.prepare('SELECT code,metrics FROM tool_diagnostics WHERE run_id=?').get(job.id);assert.equal(diagnostic.code,'turn_limit');assert.equal(JSON.parse(diagnostic.metrics).presentationValidation.recent[0].code,'ppt_completion');
 fail=false;const resumed=await f.submit(value,{resumeFromJobId:job.id});await f.worker.tick();const completed=(await f.request('/tool-runs/jobs/'+resumed.id)).value.item;
 assert.equal(completed.status,'completed',JSON.stringify(completed));assert.deepEqual(units,['unit-0','unit-1','unit-1']);assert.equal(completed.output.slides.length,12);
 assert.equal(f.eventCount('settle',job.id),0);assert.equal(f.eventCount('release',job.id),1);assert.equal(f.eventCount('settle',resumed.id),1);assert.equal(f.billing.balance('alice').balance,190);
});

test('unavailable presentation generation rejects the quote before reserving points or creating work',async t=>{
 const f=await fixture(t,{pptMasterEnabled:false});f.pay();const capabilities=await f.request('/tool-runs/capabilities');assert.equal(capabilities.value.ready,true);assert.equal(capabilities.value.presentation.ready,false);
 const quoted=await f.request('/tool-runs/quote',input());assert.equal(quoted.status,503);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_quotes').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,0);assert.equal(f.billing.balance('alice').held,0);assert.equal(f.authorCalls(),0);assert.equal(f.rendererCalls(),0);
});

test('owned presentation HTTP lifecycle publishes three private files and settles ten points once',async t=>{
 const f=await fixture(t);f.pay();const job=await f.submit();assert.equal(f.billing.balance('alice').held,10);
 assert.equal((await f.request('/tool-runs/jobs/'+job.id,undefined,null)).status,401);assert.equal((await f.request('/tool-runs/jobs/'+job.id,undefined,'bob')).status,404);
 await f.worker.tick();const completed=(await f.request('/tool-runs/jobs/'+job.id)).value.item;assert.equal(completed.status,'completed',JSON.stringify(completed));assert.equal(completed.snapshot.text,source);assert.equal(completed.snapshot.context.pages,6);assert.equal(completed.completedUnits,1);assert.equal(completed.totalUnits,1);assert.equal(completed.progress.completedPages,6);assert.equal(completed.output.slides.length,6);assert.equal(completed.output.artifacts.length,3);assert.deepEqual(completed.output.artifacts.map(item=>item.role),['deck','preview','sources']);assert.equal(f.authorCalls(),7);assert.equal(f.rendererCalls(),1);
 assert.equal(f.uploads.length,3);for(const upload of f.uploads){assert.match(upload.key,/^paperknow\/users\/alice\/exports\//);assert.equal(upload.options.headers['x-oss-object-acl'],'private');assert.equal(upload.options.headers['Content-Disposition'],'attachment');}
 const list=(await f.request('/artifacts')).value;assert.equal(list.total,3);assert.equal((await f.request('/artifacts',undefined,'bob')).value.total,0);
 for(const artifact of completed.output.artifacts){const downloaded=await f.call(artifact.downloadUrl+'?expectedUserId=alice');assert.equal(downloaded.status,200);assert.match(downloaded.headers.get('content-disposition'),/^attachment/);assert.equal(downloaded.headers.get('x-content-type-options'),'nosniff');const bytes=Buffer.from(await downloaded.arrayBuffer());assert.equal(bytes.length,artifact.bytes);if(artifact.role==='deck')assert.deepEqual(bytes,fixtureBuffer);if(artifact.role==='preview'){assert.match(bytes.toString(),/<svg/);assert.match(bytes.toString(),/Content-Security-Policy/);}if(artifact.role==='sources'){const zip=await JSZip.loadAsync(bytes);assert.equal(Object.keys(zip.files).filter(name=>/^slides\/slide-\d+\.svg$/.test(name)).length,6);assert.match(await zip.file('notes/slide-01.txt').async('string'),/合成资料/);assert.doesNotMatch(await zip.file('manifest.json').async('string'),/apiKey|private-synthetic|revision/);}assert.equal((await f.call(artifact.downloadUrl,undefined,'bob')).status,404);assert.equal((await f.call(artifact.downloadUrl+'?expectedUserId=bob')).status,409);}
 assert.doesNotMatch(JSON.stringify(completed),/private-synthetic|synthetic-secret|storage_key|settings_version|runtimeRoot/);assert.equal(f.billing.balance('alice').balance,190);assert.equal(f.billing.balance('alice').held,0);assert.equal(f.eventCount('settle',job.id),1);assert.equal(f.db.prepare('SELECT count(*) n FROM results WHERE job_id=?').get(job.id).n,1);assert.equal((await f.request('/results/'+completed.resultId)).value.item.body.presentation.artifactId,completed.output.presentation.artifactId);
 const acknowledged=await f.request('/tool-runs/jobs',{...job.command,billingToken:'expired-after-completion'});assert.equal(acknowledged.status,200);assert.equal(acknowledged.value.item.id,job.id);await f.worker.tick();assert.equal(f.eventCount('settle',job.id),1);assert.equal(f.authorCalls(),7);assert.equal(f.uploads.length,3);
});

test('ready files stay absent from listing and blocked from download until all uploads and billing complete',async t=>{
 const f=await fixture(t);f.pay();const blocked=f.newGate();f.hooks.beforePut=upload=>upload.key.endsWith('.zip')?blocked.hold():undefined;const job=await f.submit(),running=f.worker.tick();await blocked.entered;
 assert.equal(f.billing.balance('alice').balance,200);assert.equal(f.billing.balance('alice').held,10);assert.equal(f.eventCount('settle',job.id),0);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);const privateRows=f.db.prepare("SELECT id,status FROM artifacts WHERE source_id=? AND status='ready'").all(job.id);assert.equal(privateRows.length,2);assert.equal((await f.request('/artifacts')).value.total,0);
 for(const row of privateRows)assert.equal((await f.call('/artifacts/'+row.id+'/download?expectedUserId=alice')).status,409);const progress=(await f.request('/tool-runs/jobs/'+job.id)).value.item;assert.equal(progress.status,'running');assert.equal(progress.stage,'storing');assert.equal(progress.output,null);assert.equal(progress.completedUnits,1);assert.equal(progress.progress.completedPages,6);
 blocked.release();await running;assert.equal((await f.request('/tool-runs/jobs/'+job.id)).value.item.status,'completed');assert.equal((await f.request('/artifacts')).value.total,3);assert.equal(f.eventCount('settle',job.id),1);assert.equal(f.billing.balance('alice').balance,190);
});

test('late upload cancellation releases the hold and removes only newly created delivery files',async t=>{
 const f=await fixture(t);f.pay();const prior=await f.request('/artifacts',{name:'原有演示.pptx',data:fixtureBuffer.toString('base64'),sourceType:'other',expectedUserId:'alice'});assert.equal(prior.status,201);const other=await f.request('/artifacts',{name:'其他账户.txt',data:Buffer.from('其他账户资料').toString('base64'),expectedUserId:'bob'},'bob');assert.equal(other.status,201);
 const blocked=f.newGate();f.hooks.beforePut=upload=>upload.key.endsWith('.zip')?blocked.hold():undefined;const job=await f.submit(),running=f.worker.tick();await blocked.entered;const cancelled=await f.request('/tool-runs/jobs/'+job.id+'/cancel',{});assert.equal(cancelled.value.item.status,'cancelled');assert.equal(f.billing.balance('alice').held,0);blocked.release();await running;uncharged(f,job.id);
 const saved=(await f.request('/tool-runs/jobs/'+job.id)).value.item;assert.equal(saved.status,'cancelled');assert.equal(saved.output,null);assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE source_id=? AND status!='deleted'").get(job.id).n,0);assert.equal((await f.request('/artifacts')).value.total,1);assert.equal((await f.request('/artifacts',undefined,'bob')).value.total,1);assert.equal((await f.call(prior.value.item.downloadUrl)).status,200);assert.equal((await f.call(other.value.item.downloadUrl,undefined,'bob')).status,200);assert.equal(f.objects.size,2);assert.equal(f.removals.includes(f.db.prepare('SELECT storage_key FROM artifacts WHERE id=?').get(prior.value.item.id).storage_key),false);
 assert.equal((await f.request('/tool-runs/jobs/'+job.id+'/cancel',{})).status,200);assert.equal(f.eventCount('release',job.id),1);
});

test('compiler failure preserves prior files, releases the reservation, and never publishes a result',async t=>{
 const f=await fixture(t,{pptMasterRenderer:async()=>{throw Error('private-synthetic-model compiler failure at /tmp/private-output');}});f.pay();const prior=await f.request('/artifacts',{name:'原有成果.txt',data:Buffer.from('保留此文件').toString('base64'),expectedUserId:'alice'});const job=await f.submit();await f.worker.tick();const failed=(await f.request('/tool-runs/jobs/'+job.id)).value.item;assert.equal(failed.status,'failed');assert.equal(failed.output,null);assert.doesNotMatch(failed.error,/private-synthetic|\/tmp\/private-output/);uncharged(f,job.id);assert.equal(f.uploads.length,1);assert.equal(f.removals.length,0);assert.equal((await f.request('/artifacts')).value.total,1);assert.equal((await f.call(prior.value.item.downloadUrl)).status,200);
});

test('restart releases an interrupted delivery and retries private cleanup without touching unrelated owned files',async t=>{
 const f=await fixture(t);f.pay();const job=await f.submit();const interrupted=await f.request('/artifacts',{name:'中断的生成版.pptx',data:fixtureBuffer.toString('base64'),sourceType:'presentation',sourceId:job.id,expectedUserId:'alice'});assert.equal(interrupted.status,201);const own=await f.request('/artifacts',{name:'应保留.txt',data:Buffer.from('此文件不属于中断任务').toString('base64'),expectedUserId:'alice'});const other=await f.request('/artifacts',{name:'别人的文件.txt',data:Buffer.from('另一账户').toString('base64'),expectedUserId:'bob'},'bob');
 f.db.prepare("UPDATE tool_runs SET status='running',stage='storing' WHERE id=?").run(job.id);f.db.prepare("UPDATE jobs SET status='running',stage='storing' WHERE id=?").run(job.id);f.db.prepare('INSERT INTO tool_checkpoints VALUES(?,?,?,?,?)').run(job.id,'ppt-delivery',2000,JSON.stringify({artifacts:[interrupted.value.item],createdIds:[interrupted.value.item.id,own.value.item.id,other.value.item.id]}),new Date(Date.now()-120000).toISOString());
 let deleteFails=true;f.hooks.beforeDelete=()=>{if(deleteFails)throw Error('synthetic temporary deletion interruption');};await f.restart();assert.equal((await f.request('/tool-runs/jobs/'+job.id)).value.item.status,'failed');uncharged(f,job.id);await f.worker.tick();assert.equal(f.db.prepare('SELECT status FROM artifacts WHERE id=?').get(interrupted.value.item.id).status,'deleting');assert.equal((await f.request('/artifacts')).value.total,1);
 deleteFails=false;f.db.prepare('UPDATE tool_checkpoints SET created_at=? WHERE run_id=? AND unit_id=?').run(new Date(Date.now()-120000).toISOString(),job.id,'ppt-delivery');await f.worker.tick();assert.equal(f.db.prepare('SELECT status FROM artifacts WHERE id=?').get(interrupted.value.item.id).status,'deleted');assert.deepEqual(JSON.parse(f.db.prepare('SELECT output FROM tool_checkpoints WHERE run_id=? AND unit_id=?').get(job.id,'ppt-delivery').output).createdIds,[]);assert.equal((await f.call(own.value.item.downloadUrl)).status,200);assert.equal((await f.call(other.value.item.downloadUrl,undefined,'bob')).status,200);assert.equal(f.objects.size,2);assert.equal(f.authorCalls(),0);assert.equal(f.rendererCalls(),0);
});

test('restart recovers acknowledged uploads without a manifest and throttles failed cleanup by exact owner and run',async t=>{
 const f=await fixture(t);f.pay();const job=await f.submit();
 const interrupted=await f.request('/artifacts',{name:'崩溃窗口.pptx',data:fixtureBuffer.toString('base64'),sourceType:'presentation',sourceId:job.id,expectedUserId:'alice'});assert.equal(interrupted.status,201);
 const own=await f.request('/artifacts',{name:'其他来源.txt',data:Buffer.from('此文件来源不属于当前任务').toString('base64'),sourceType:'presentation',sourceId:'unrelated-run',expectedUserId:'alice'});
 const other=await f.request('/artifacts',{name:'同编号其他账户.txt',data:Buffer.from('另一账户的独立文件').toString('base64'),sourceType:'presentation',sourceId:job.id,expectedUserId:'bob'},'bob');
 f.db.prepare("UPDATE tool_runs SET status='running',stage='storing' WHERE id=?").run(job.id);f.db.prepare("UPDATE jobs SET status='running',stage='storing' WHERE id=?").run(job.id);
 assert.equal(f.db.prepare("SELECT 1 FROM tool_checkpoints WHERE run_id=? AND unit_id='ppt-delivery'").get(job.id),undefined);
 let deletionAttempts=0,deleteFails=true;f.hooks.beforeDelete=()=>{deletionAttempts++;if(deleteFails)throw Error('synthetic cloud deletion interruption');};
 await f.restart();await f.worker.tick();uncharged(f,job.id);assert.equal(deletionAttempts,1);assert.equal(f.db.prepare('SELECT status FROM artifacts WHERE id=?').get(interrupted.value.item.id).status,'deleting');
 const checkpoint=f.db.prepare("SELECT output,created_at FROM tool_checkpoints WHERE run_id=? AND unit_id='ppt-delivery'").get(job.id);assert.deepEqual(JSON.parse(checkpoint.output).createdIds,[interrupted.value.item.id]);
 await f.worker.tick();assert.equal(deletionAttempts,1,'the new manifest throttles immediate repeated deletion attempts');
 deleteFails=false;f.db.prepare("UPDATE tool_checkpoints SET created_at=? WHERE run_id=? AND unit_id='ppt-delivery'").run(new Date(Date.now()-120000).toISOString(),job.id);await f.worker.tick();assert.equal(deletionAttempts,2);assert.equal(f.db.prepare('SELECT status FROM artifacts WHERE id=?').get(interrupted.value.item.id).status,'deleted');
 assert.equal((await f.call(own.value.item.downloadUrl)).status,200);assert.equal((await f.call(other.value.item.downloadUrl,undefined,'bob')).status,200);assert.equal(f.objects.size,2);assert.equal(f.authorCalls(),0);
});

test('a job deadline before the content loop releases the hold and cannot leave a running queue blocker',async t=>{
 const f=await fixture(t,{pptMasterJobTimeoutMs:1000});f.pay();const job=await f.submit(),blocked=f.newGate();
 f.config.getAgentSettings=async version=>{if(!version)await blocked.hold();return{...runtime};};
 const running=f.worker.tick();await blocked.entered;await new Promise(resolve=>setTimeout(resolve,1100));blocked.release();await running;
 const row=(await f.request('/tool-runs/jobs/'+job.id)).value.item;assert.equal(row.status,'failed');assert.match(row.error,/等待上限/);uncharged(f,job.id);assert.equal(f.authorCalls(),0);assert.equal(f.rendererCalls(),0);assert.equal(f.db.prepare("SELECT count(*) n FROM tool_runs WHERE status='running'").get().n,0);
});

for(const [label,pptMasterMaxTokens,expected] of [['default',undefined,1000000],['configured',1500000,1500000],['upper bound',2000000,2000000],['invalid override',2000001,1000000]])test('PPT worker uses '+label+' dedicated tokens while preserving the saved aggregate dollar cap',async t=>{
 const settings=[];const f=await fixture(t,{pptMasterMaxTokens,toolMaxTokens:1000,agentTaskRunner:async args=>{settings.push(args.settings);return author(args);}});f.pay();const job=await f.submit();await f.worker.tick();
 const completed=(await f.request('/tool-runs/jobs/'+job.id)).value.item;assert.equal(completed.status,'completed',JSON.stringify(completed));assert.equal(settings.length,7);
 for(const [index,setting] of settings.entries()){assert.equal(setting.maxTotalTokens,expected-index*200);assert.ok(Math.abs(setting.maxCostUsd-(index===0?runtime.maxCostUsd:Math.min(.12,runtime.maxCostUsd-index*.001)))<1e-10);assert.equal(setting.maxTurns,index===0?runtime.maxTurns:4);assert.equal(setting.maxOutputTokens,runtime.maxOutputTokens);}
 assert.equal(f.eventCount('settle',job.id),1);
});

test('a full content plan can finish all twelve pages within the frozen budget without another paid layout call',async t=>{
 let contentCalls=0;
 const f=await fixture(t,{agentTaskRunner:async args=>{assert.equal(args.task.context.operation,'ppt');contentCalls++;return {...author(args),costUsd:.2475};},pptMasterRenderer:async({slides})=>{assert.equal(slides.length,12);assert.ok(slides.every(slide=>slide.layoutMethod==='validated'));return{pptx:fixtureBuffer};}});
 f.pay();const value=input();value.snapshot.context.pages=12;const job=await f.submit(value);await f.worker.tick();const completed=(await f.request('/tool-runs/jobs/'+job.id)).value.item;
 assert.equal(completed.status,'completed',JSON.stringify(completed));assert.equal(contentCalls,2);assert.equal(completed.completedUnits,2);assert.equal(completed.progress.completedPages,12);assert.equal(f.eventCount('settle',job.id),1);assert.equal(f.billing.balance('alice').balance,190);
 const metrics=JSON.parse(f.db.prepare('SELECT metrics FROM tool_diagnostics WHERE run_id=?').get(job.id).metrics);assert.equal(metrics.presentationLayout.validatedPages,12);assert.equal(metrics.presentationLayout.reasons.budget_exceeded,12);assert.equal(metrics.sdkCost.used,.495);
});

test('a bounded failed page design uses a validated editable layout and continues the remaining pages once',async t=>{
 let layoutCalls=0;
 const f=await fixture(t,{agentTaskRunner:async args=>{if(args.task.context.operation==='ppt-master-slide'){layoutCalls++;assert.ok(args.task.context.startingSvg);assert.ok(args.settings.maxTurns<=4);if(args.task.context.design.current.page===1)throw Object.assign(Error('Synthetic layout repair exhausted'),{code:'turn_limit',status:502,usage:{input:500,output:100},costUsd:.01});}return author(args);}});
 f.pay();const job=await f.submit();await f.worker.tick();const completed=(await f.request('/tool-runs/jobs/'+job.id)).value.item;
 assert.equal(completed.status,'completed',JSON.stringify(completed));assert.equal(layoutCalls,1);assert.equal(f.eventCount('settle',job.id),1);assert.equal(completed.progress.completedPages,6);
 const metrics=JSON.parse(f.db.prepare('SELECT metrics FROM tool_diagnostics WHERE run_id=?').get(job.id).metrics);assert.equal(metrics.presentationLayout.validatedPages,6);assert.equal(metrics.presentationLayout.aiPages,0);assert.equal(metrics.presentationLayout.reasons.turn_limit,6);
});

test('unknown usage and cancellation never become a successful fallback deck',async t=>{
 for(const kind of ['unknown','cancel']){
  let f;f=await fixture(t,{agentTaskRunner:async args=>{if(args.task.context.operation==='ppt-master-slide'){if(kind==='cancel')f.worker.cancel(f.db.prepare("SELECT id FROM tool_runs WHERE status='running'").get().id);throw Object.assign(Error('Synthetic stopped author'),{code:'turn_limit',status:502,...(kind==='unknown'?{}:{usage:{input:50,output:10},costUsd:.001})});}return author(args);}});f.pay();const job=await f.submit();await f.worker.tick();const row=(await f.request('/tool-runs/jobs/'+job.id)).value.item;assert.equal(row.status,kind==='cancel'?'cancelled':'failed');assert.equal(row.output,null);assert.equal(f.rendererCalls(),0);uncharged(f,job.id);
 }
});

test('two completed content batches do not misclassify a failed first-page authorization as completed layout',async t=>{
 const f=await fixture(t,{agentTaskRunner:async args=>{if(args.task.context.operation==='ppt-master-slide')throw Object.assign(Error('Synthetic access denied'),{code:'access_denied',status:403,usage:{input:20,output:10},costUsd:.001});return author(args);}});
 f.pay();const value=input();value.snapshot.context.pages=12;const job=await f.submit(value);await f.worker.tick();const row=(await f.request('/tool-runs/jobs/'+job.id)).value.item;
 assert.equal(row.status,'failed');assert.equal(row.completedUnits,2);assert.equal(row.totalUnits,2);assert.equal(row.progress.stage,'authoring');assert.equal(row.progress.completedPages,0);assert.equal(f.rendererCalls(),0);uncharged(f,job.id);
 f.db.prepare('DELETE FROM tool_diagnostics WHERE run_id=?').run(job.id);assert.equal((await f.request('/tool-runs/jobs/'+job.id)).value.item.progress.stage,'authoring','legacy failures without a saved phase recover their real layout stage');
});

test('the observed SDK cost-budget stop finishes with checked layouts instead of spending on each later page',async t=>{
 let calls=0;const f=await fixture(t,{agentTaskRunner:async args=>{if(args.task.context.operation==='ppt-master-slide'){calls++;throw Object.assign(Error('Agent 已达到预算上限，结果未完成'),{code:'cost_budget',status:502,usage:{input:8290,output:1036},costUsd:.04736525});}return author(args);}});
 f.pay();const job=await f.submit();await f.worker.tick();const row=(await f.request('/tool-runs/jobs/'+job.id)).value.item;
 assert.equal(row.status,'completed',JSON.stringify(row));assert.equal(calls,1);assert.equal(row.progress.completedPages,6);assert.equal(f.eventCount('settle',job.id),1);assert.equal(f.billing.balance('alice').balance,190);
 const metrics=JSON.parse(f.db.prepare('SELECT metrics FROM tool_diagnostics WHERE run_id=?').get(job.id).metrics);assert.equal(metrics.presentationLayout.reasons.cost_budget,6);assert.ok(metrics.sdkCost.used<metrics.sdkCost.limit);
});
