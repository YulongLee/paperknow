import test from 'node:test';import assert from 'node:assert/strict';import http from'node:http';import{randomUUID}from'node:crypto';import{JSDOM}from'jsdom';
import{database}from'../backend/database.mjs';import{createSession}from'../backend/auth.mjs';import{createAPI}from'../backend/api.mjs';import{startToolRunWorker}from'../backend/tool-run-worker.mjs';import{createReadingWireObserver}from'../backend/literature-execution.mjs';import{streamLiteratureAnswer}from'../dist/workspace/literature-answer-stream.mjs';import{mountLiteratureAi}from'../dist/workspace/literature-ai.mjs';
import{mountToolJobPanel}from'../dist/workspace/tool-job-panel.mjs';
const source='This authorized synthetic source reports a value of 27.3 in Table 2.';
const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://fixture.example/anthropic',model:'stream-fixture',apiKey:'not-a-real-key',version:'stream-fixture-v1',maxTurns:4,maxOutputTokens:2048,maxCostUsd:.1,timeoutMs:10000};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const until=async check=>{for(let i=0;i<200;i++){if(check())return;await sleep(5);}assert.ok(check(),'Expected stream state');};
const event=(name,value)=>new TextEncoder().encode('event: '+name+'\ndata: '+JSON.stringify(value)+'\n\n');

test('upstream tool arguments are observable before the SDK aggregates a full assistant message',()=>{
 const parts=[],wire=createReadingWireObserver('text/event-stream',text=>parts.push(text)),enc=new TextEncoder();
 wire.write(event('content_block_start',{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'a',name:'mcp__paperknow__submit_writing_output',input:{}}}));
 wire.write(event('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"candidate":{"text":"第一段真实生成的文字已经到达。'}}));assert.equal(parts[0],'第一段真实生成的文字已经到达。');
 wire.write(event('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'第二段仍在生成。","complete":true}}'}}));wire.end();assert.equal(parts.at(-1),'第一段真实生成的文字已经到达。第二段仍在生成。');
 const other=createReadingWireObserver('text/event-stream',text=>parts.push(text)),before=parts.length;other.write(enc.encode('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"tool diagnostics must never be a reading answer"}}\n\n'));other.end();assert.equal(parts.length,before);
});

test('UTF-8 SSE chunks update a response incrementally and a completed event is delivered once',async()=>{
 let controller;const body=new ReadableStream({start(c){controller=c;}}),texts=[],results=[],promise=streamLiteratureAnswer({id:'one',ownerId:'alice',fetcher:async(_p,o)=>{assert.equal(o.headers['X-PaperKnow-User'],'alice');return new Response(body,{headers:{'Content-Type':'text/event-stream'}});},onText:t=>texts.push(t),onResult:r=>results.push(r)});
 const packet=event('answer',{text:'第一段回答'});for(let i=0;i<packet.length;i+=3)controller.enqueue(packet.slice(i,i+3));await until(()=>texts.length===1);assert.deepEqual(texts,['第一段回答']);assert.equal(results.length,0);
 controller.enqueue(event('answer',{text:'第一段回答，第二段继续。'}));controller.enqueue(event('result',{item:{id:'one',status:'completed'}}));assert.equal(await promise,true);assert.equal(texts.length,2);assert.equal(results.length,1);
});

async function backend(t,runner,extra={}){
 const db=database(':memory:');for(const id of ['alice','bob'])db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());const config={getAgentSettings:()=>settings,getAI:()=>({aiEnabled:false}),agentTaskRunner:runner,toolPollMs:60000,literaturePreviewIntervalMs:5,...extra};let worker;
 const api=createAPI(db,{cancel:id=>worker.cancel(id)},config),server=http.createServer((req,res)=>void api(req,res));worker=startToolRunWorker(db,config);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,alice='pk_session='+createSession(db,'alice'),bob='pk_session='+createSession(db,'bob');
 t.after(async()=>{server.closeAllConnections();await worker.stop();await new Promise(r=>server.close(r));db.close();});
 async function request(path,data,cookie=alice,owner='alice'){return fetch(base+'/api'+path,{method:data?'POST':'GET',headers:{Cookie:cookie,'X-PaperKnow-User':owner,...(data?{Origin:base,'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});}
 const value={kind:'literature',operation:'answer',snapshot:{title:'Synthetic paper',question:'What value?',materials:[{id:'p1',name:'Paper',text:source}],context:{answerEvidencePolicy:'grounded-v2'}}},quote=await(await request('/tool-runs/quote',value)).json(),created=await(await request('/tool-runs/jobs',{...value,billingToken:quote.token,clientKey:randomUUID(),consent:true})).json();assert.ok(created.item?.id,JSON.stringify(created));return{db,worker,request,id:created.item.id,base,alice,bob};
}
const output=task=>({text:JSON.stringify({complete:true,answered:true,text:'The value is 27.3 according to the authorized source.',sourceIds:['p1'],citations:[{sourceId:'p1',quote:source}]}),trace:task.context.unit.ranges.map(r=>({tool:'read_material',status:'completed',materialId:r.sourceId,offset:r.start,limit:r.end-r.start})),usage:{input:100,output:100},costUsd:.001});

test('authenticated HTTP SSE publishes approved text before completion and never exposes internal stages or duplicates execution',async t=>{
 let release,started,calls=0;const gate=new Promise(r=>{release=r;}),entered=new Promise(r=>{started=r;});t.after(()=>release());const f=await backend(t,async args=>{calls++;started();args.onText('The first part is visible while the answer continues.');await gate;args.onText('The first part is visible while the answer continues. Second part.');await sleep(15);return output(args.task);});
 const running=f.worker.tick();await entered;const texts=[],done=[],sse=streamLiteratureAnswer({id:f.id,ownerId:'alice',fetcher:(path,options)=>fetch(f.base+path,{...options,headers:{...options.headers,Cookie:f.alice}}),onText:t=>texts.push(t),onResult:r=>done.push(r)});
 await until(()=>texts.length>0);assert.equal(f.db.prepare('SELECT status FROM tool_runs WHERE id=?').get(f.id).status,'running');assert.equal(done.length,0);assert.doesNotMatch(texts.join(''),/agent_running|checking_output|read_material/);
 assert.equal((await f.request('/tool-runs/jobs/'+f.id+'/events',undefined,f.bob,'bob')).status,404);assert.equal((await f.request('/tool-runs/jobs/'+f.id+'/events',undefined,f.alice,'bob')).status,409);release();await running;assert.equal(await sse,true);assert.equal(done[0].status,'completed');assert.equal(calls,1);assert.equal(f.db.prepare('SELECT count(*) n FROM tool_runs').get().n,1);
});

test('failed moderation never emits the candidate into an answer stream',async t=>{
 let release;const gate=new Promise(r=>{release=r;});t.after(()=>release());const f=await backend(t,async args=>{args.onText('Rejected synthetic candidate must not reach the reader.');await gate;return output(args.task);},{moderationEnabled:true,moderation:{ready:true,checkText:async()=>({allowed:false})}});const running=f.worker.tick(),texts=[],sse=streamLiteratureAnswer({id:f.id,ownerId:'alice',fetcher:(path,options)=>fetch(f.base+path,{...options,headers:{...options.headers,Cookie:f.alice}}),onText:t=>texts.push(t)});await sleep(40);assert.equal(f.db.prepare('SELECT count(*) n FROM tool_run_previews').get().n,0);release();await running;await sse;assert.deepEqual(texts,[]);
});

test('assistant displays an incremental answer in the conversation with only a stop control, then saves exactly once',async t=>{
 const dom=new JSDOM('<main class="dashboard"><section id="reader"></section></main>',{url:'https://paperknow.test/workspace.html#literature/one',pretendToBeVisual:true}),w=dom.window;globalThis.document=w.document;let streamController,posted=0;
 const outputBody={text:'According to the original paper, the value is 27.3.',sourceIds:['p1'],citations:[{sourceId:'p1',quote:source}]},job={id:'job-one',kind:'literature',operation:'answer',status:'running',output:null,totalUnits:1,completedUnits:0},body=new ReadableStream({start(c){streamController=c;}});
 w.fetch=async(path,opts)=>{assert.match(path,/\/events$/);assert.equal(opts.headers['X-PaperKnow-User'],'alice');return new Response(body,{headers:{'Content-Type':'text/event-stream'}});};let paper={id:'paper-one',title:'Public synthetic paper',scope:'full',text:source,notes:[]};
 const ui=mountLiteratureAi({container:w.document.querySelector('#reader'),layout:'assistant',initialOperation:'answer',getPaper:()=>paper,updatePaper:fn=>{paper=fn(paper);},ctx:{api:async(path,data)=>{if(path==='/auth/me')return{user:{id:'alice'}};if(path==='/tool-runs/reuse')return{item:null};if(path==='/tool-runs/capabilities')return{ready:true};if(path==='/tool-runs/quote'||path==='/tool-runs/quote-preview')return{type:'agent',source:'credits',title:'Reading',token:'fixture',creditCost:10,expiresAt:new Date(Date.now()+60000).toISOString()};if(path==='/tool-runs/jobs'){posted++;return{item:structuredClone(job)};}if(path==='/tool-runs/jobs/job-one')return{item:structuredClone(job)};throw Error(path);}}});t.after(()=>{ui.dispose();w.close();});
 const q=w.document.querySelector('[data-lit-ai-question]');q.value='What value?';q.dispatchEvent(new w.Event('input',{bubbles:true}));await until(()=>/本次消耗/.test(w.document.querySelector('[data-lit-price]').textContent));w.document.querySelector('[data-lit-ai-open]').click();await until(()=>posted===1);await until(()=>!!w.document.querySelector('[data-lit-stream]:not([hidden])'));
 streamController.enqueue(event('answer',{text:'The answer begins now, while the remaining text is still coming.'}));await until(()=>w.document.querySelector('[data-lit-stream-body]').textContent.includes('begins now'));
 assert.equal(w.document.querySelector('.lit-ai-results > .lit-ai-empty').hidden,true);assert.equal(paper.aiResults?.length||0,0);assert.equal(w.document.querySelector('[data-lit-working]').hidden,true);assert.equal(w.document.querySelector('[data-tj-wait-title]'),null);assert.equal(w.document.querySelector('[data-tj-units]'),null);assert.equal(w.document.querySelector('[data-lit-stream-stop]').hidden,false);
 streamController.enqueue(event('answer',{text:outputBody.text}));streamController.enqueue(event('result',{item:{...job,status:'completed',completedUnits:1,output:outputBody}}));await until(()=>paper.aiResults?.length===1);assert.equal(posted,1);assert.equal(w.document.querySelector('[data-lit-stream]').hidden,true);assert.match(w.document.querySelector('.lit-assistant-response').textContent,/27.3/);
});

test('closing a response stream does not cancel generation, and a revoked session cannot keep reading',async t=>{
 let release;const gate=new Promise(r=>{release=r;});t.after(()=>release());const f=await backend(t,async args=>{args.onText('A permitted partial answer for the current owner.');await gate;return output(args.task);});const work=f.worker.tick();
 const first=await f.request('/tool-runs/jobs/'+f.id+'/events');assert.match(first.headers.get('content-type'),/text\/event-stream/);assert.equal(first.headers.get('x-accel-buffering'),'no');await first.body.cancel();assert.equal(f.db.prepare('SELECT status FROM tool_runs WHERE id=?').get(f.id).status,'running');
 const text=[],waiting=streamLiteratureAnswer({id:f.id,ownerId:'alice',fetcher:(path,o)=>fetch(f.base+path,{...o,headers:{...o.headers,Cookie:f.alice}}),onText:t=>text.push(t)});await until(()=>text.length>0);f.db.prepare('DELETE FROM sessions WHERE user_id=?').run('alice');await assert.rejects(waiting,/登录状态/);assert.equal(f.db.prepare('SELECT status FROM tool_runs WHERE id=?').get(f.id).status,'running');release();await work;
});

test('a transient identity heartbeat failure recovers the existing answer without another generation or charge',async t=>{
 const dom=new JSDOM('<main class="dashboard"><section id="job"></section></main>',{url:'https://paperknow.test/workspace.html',pretendToBeVisual:true}),w=dom.window;globalThis.document=w.document;
 let guard,controller,failAuth=false,posted=0,quotes=0,applied=0;const partial=[],interval=w.setInterval.bind(w),job={id:'heartbeat-job',kind:'literature',operation:'answer',status:'running',output:null,totalUnits:1,completedUnits:0};
 w.setInterval=(fn,ms)=>{if(ms===5000)guard=fn;return interval(fn,ms);};
 w.fetch=async(_path,options)=>new Response(new ReadableStream({start(c){controller=c;options.signal.addEventListener('abort',()=>c.error(Object.assign(Error('Aborted'),{name:'AbortError'})),{once:true});}}),{headers:{'Content-Type':'text/event-stream'}});
 const snapshot={title:'Synthetic paper',question:'What value?',materials:[{id:'p1',name:'Paper',text:source}],context:{answerEvidencePolicy:'grounded-v2'}};
 const panel=mountToolJobPanel({container:w.document.querySelector('#job'),kind:'literature',operation:'answer',compactReading:true,autoApply:true,getSnapshot:()=>snapshot,onPartial:text=>partial.push(text),onApply:()=>{applied++;},ctx:{api:async path=>{
  if(path==='/auth/me'){if(failAuth){failAuth=false;throw Error('Temporary connection failure');}return{user:{id:'alice'}};}
  if(path==='/tool-runs/reuse')return{item:null};if(path==='/tool-runs/capabilities')return{ready:true};
  if(path==='/tool-runs/quote'||path==='/tool-runs/quote-preview'){quotes++;return{type:'agent',source:'credits',title:'Reading',token:'fixture',creditCost:10,expiresAt:new Date(Date.now()+60000).toISOString()};}
  if(path==='/tool-runs/jobs'){posted++;return{item:structuredClone(job)};}if(path==='/tool-runs/jobs/heartbeat-job')return{item:structuredClone(job)};throw Error(path);
 }}});t.after(()=>{panel.dispose();w.close();});
 await panel.generate();await until(()=>!!guard&&!!controller);controller.enqueue(event('answer',{text:'The first approved part.'}));await until(()=>partial.includes('The first approved part.'));
 failAuth=true;guard();job.status='completed';job.completedUnits=1;job.output={text:'The final approved answer.',sourceIds:['p1'],citations:[{sourceId:'p1',quote:source}]};
 const deadline=Date.now()+4000;while(!applied&&Date.now()<deadline)await sleep(10);
 assert.equal(applied,1);assert.equal(posted,1);assert.equal(quotes,1);assert.equal(panel.hasWork(),false);
});
