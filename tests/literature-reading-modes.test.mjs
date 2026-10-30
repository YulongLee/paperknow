import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readingModes,readingChatHistory} from '../dist/workspace/literature-reading-modes.mjs';
import {mountLiteratureAi} from '../dist/workspace/literature-ai.mjs';
import {validateSavedLiteratureAiResults} from '../dist/workspace/literature-ai-model.mjs';
import {projectReference} from '../dist/workspace/project-directory.mjs';
const source='An actual source paragraph with a verifiable method and finding.';
const materials=[{id:'p1',name:'Paper / paragraph 1',text:source}];
const answer=(id,question='Question '+id,text='Answer '+id)=>({id,jobId:id,operation:'answer',sourceScope:'full',materials:structuredClone(materials),question,output:{text,sourceIds:['p1'],citations:[{sourceId:'p1',quote:'actual source paragraph'}]},createdAt:'2026-10-20T00:00:0'+id+'Z'});
const paper=results=>({id:'paper1',title:'Paper',scope:'full',text:source,notes:[],aiResults:results});
const until=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.fail('UI did not settle');};
function fixture(t,results=[]){const dom=new JSDOM('<main class="dashboard"><div id="ai"></div></main>',{url:'https://audit.test/workspace.html#literature/paper1'}),w=dom.window,old={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:w,document:w.document});const $=s=>w.document.querySelector(s),calls=[],notices=[],jobs=new Map();let p=paper(results),failEdits=false;
 const ctx={notify:msg=>notices.push(msg),api:async(path,data)=>{calls.push({path,data});if(path==='/auth/me')return {user:{id:'owner1'}};if(path==='/tool-runs/capabilities')return {ready:true};if(path==='/tool-runs/quote')return {type:'agent',source:'credits',title:'Reading',token:'test-quote',creditCost:10,expiresAt:new Date(Date.now()+600000).toISOString()};if(path==='/tool-runs/jobs'){const output={text:'Generated answer with evidence.',...(data.operation==='translate'?{targetLanguage:data.snapshot.language,segments:data.snapshot.materials.map(row=>({id:row.id,source:row.text,translation:'Translated synthetic paragraph.'}))}:{}),sourceIds:[data.snapshot.materials[0].id],citations:[{sourceId:data.snapshot.materials[0].id,quote:data.snapshot.materials[0].text}]},item={id:'job'+jobs.size,kind:'literature',operation:data.operation,status:'completed',output,completedUnits:1,totalUnits:1};jobs.set(item.id,item);return {item};}const id=path.split('/').at(-1);if(jobs.has(id))return {item:jobs.get(id)};throw Object.assign(Error('Not found'),{status:404});}};
 const update=fn=>{const next=fn(p);if(failEdits&&next.aiResults?.some(r=>r.output.text==='Unpersisted human edit'))throw Error('quota');p=next;};let ui;
 const mount=()=>{ui?.dispose();ui=mountLiteratureAi({container:$('#ai'),ctx,getPaper:()=>p,updatePaper:update});};mount();t.after(()=>{ui?.dispose();Object.assign(globalThis,old);w.close();});
 const input=(selector,value)=>{const el=$(selector);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 return {w,$,calls,notices,input,mount,getPaper:()=>p,setPaper:value=>{p=value;},failEdits:()=>{failEdits=true;},getUi:()=>ui,open:async()=>{const before=p.aiResults.length;$('[data-lit-ai-open]').click();await until(()=>p.aiResults.length>before);assert.equal($('[data-tj-apply]'),null);},submit:async()=>{await until(()=>p.aiResults.some(r=>r.jobId.startsWith('job')));}};
}

test('reading modes are distinct server-consumable instructions with three explicit labels',()=>{assert.deepEqual(Object.keys(readingModes),['keypoints','summary','deep']);assert.equal(new Set(Object.values(readingModes).map(m=>m.requirements)).size,3);assert.ok(Object.isFrozen(readingModes));for(const mode of Object.values(readingModes)){assert.ok(mode.label);assert.ok(mode.requirements);assert.ok(Object.isFrozen(mode));}});
test('conversation history is opt-in and requires exact frozen materials, scope and unedited answers',()=>{
 const matching=answer('1'),changedText={...answer('2'),materials:[{...materials[0],text:source+'different'}]},changedName={...answer('3'),materials:[{...materials[0],name:'Different title'}]},changedScope={...answer('4'),sourceScope:'abstract'},edited={...answer('5'),editedAt:''},read={...answer('6'),operation:'read'},p=paper([matching,changedText,changedName,changedScope,edited,read]);
 assert.deepEqual(readingChatHistory(p,materials).history,[]);assert.deepEqual(readingChatHistory(p,materials,{enabled:true}).history,[{question:matching.question,answer:matching.output.text}]);
});
test('history keeps the latest three rounds in chronological order with complete strings',()=>{
 const rows=['1','2','3','4'].map(id=>answer(id,' Q '+id+' ',' A '+id+' ')),history=readingChatHistory(paper(rows),materials,{enabled:true}).history;
 assert.deepEqual(history,rows.slice(1).map(r=>({question:r.question,answer:r.output.text})));assert.equal(history[0].question,' Q 2 ');assert.equal(history.at(-1).answer,' A 4 ');
});
test('overlong rounds and aggregate limits omit whole rounds with a notice and never crop answers',()=>{
 const longQ=answer('1','q'.repeat(1501)),longA=answer('2','q','a'.repeat(6001)),valid=answer('3','q','a'.repeat(6000)),result=readingChatHistory(paper([longQ,longA,valid]),materials,{enabled:true});assert.deepEqual(result.history,[{question:'q',answer:'a'.repeat(6000)}]);assert.match(result.notice,/2/);
 const rounds=['1','2','3'].map(id=>answer(id,'q','a'.repeat(4000))),bounded=readingChatHistory(paper(rounds),materials,{enabled:true});assert.equal(bounded.history.length,2);assert.ok(bounded.history.every(row=>row.answer.length===4000));assert.match(bounded.notice,/未加入.*未截断/);
});
test('backup preserves optional mode and edit markers so edited answers cannot become trusted history again',()=>{
 const edited={...answer('1'),editedAt:'2026-10-20'},read={...answer('2'),operation:'read',mode:'deep'},legacy={...answer('3'),operation:'read'},rows=validateSavedLiteratureAiResults([edited,read,legacy]);assert.equal(rows[0].editedAt,'2026-10-20');assert.equal(rows[1].mode,'deep');assert.equal(Object.hasOwn(rows[2],'mode'),false);assert.deepEqual(readingChatHistory(paper(rows),materials,{enabled:true}).history,[]);assert.throws(()=>validateSavedLiteratureAiResults([{...read,mode:'invented'}]));
});
test('each visible read mode reaches the quoted snapshot and adopted saved record without automatic submission',async t=>{
 const f=fixture(t);for(const [index,mode]of Object.keys(readingModes).entries()){if(index){f.setPaper(paper([]));f.mount();}const before=f.calls.filter(c=>c.path==='/tool-runs/jobs').length;f.$('[data-lit-read-mode="'+mode+'"]').click();assert.equal(f.$('[data-lit-read-mode="'+mode+'"]').getAttribute('aria-pressed'),'true');assert.equal(f.calls.filter(c=>c.path==='/tool-runs/jobs').length,before);await f.open();const snapshot=f.calls.filter(c=>c.path==='/tool-runs/quote').at(-1).data.snapshot;assert.equal(snapshot.mode,mode);assert.equal(snapshot.requirements,readingModes[mode].requirements);await f.submit();assert.equal(f.getPaper().aiResults.at(-1).mode,mode);}
});
test('quick questions only fill the input and same-source history is included automatically without an extra checkbox',async t=>{
 const f=fixture(t);f.setPaper(paper([{...answer('2'),materials:[]},answer('1')]));f.mount();
 // Use the same exact material name that the real selector places in snapshots.
 f.getPaper().aiResults.forEach(r=>{r.materials=[{id:'p1',name:'Paper · 第 1 段',text:source}];});f.$('[data-lit-ai-operation="answer"]').click();assert.equal(f.$('[data-lit-include-history]'),null);f.$('[data-lit-quick-question]').click();assert.ok(f.$('[data-lit-ai-question]').value);assert.equal(f.calls.length,0);
 const conversations=[...f.w.document.querySelectorAll('[data-lit-conversation] .lit-ai-saved-question')].map(n=>n.textContent);assert.ok(conversations[0].includes('Question 1'));assert.ok(conversations[1].includes('Question 2'));
 await f.open();const snapshot=f.calls.find(c=>c.path==='/tool-runs/quote').data.snapshot;assert.equal(snapshot.context.chatHistory.length,2);assert.equal(snapshot.context.chatHistory[0].question,'Question 1');assert.equal(snapshot.context.chatHistory[1].question,'Question 2');assert.equal(f.calls.filter(c=>c.path==='/tool-runs/jobs').length,1);
});
test('an unsaved manual edit is excluded from chat history even while durable storage still holds the old answer',async t=>{
 const record=answer('1');record.materials=[{id:'p1',name:'Paper · 第 1 段',text:source}];const f=fixture(t,[record]);f.$('[data-lit-ai-operation="answer"]').click();f.failEdits();f.input('[data-lit-ai-text]','Unpersisted human edit');assert.equal(f.getUi().getPendingEdits().length,1);f.input('[data-lit-ai-question]','A new source question');await f.open();const snapshot=f.calls.find(c=>c.path==='/tool-runs/quote').data.snapshot;assert.equal(snapshot.context.chatHistory,undefined);
});
test('question retrieval is the default, manual ranges override it and automatic mode can be restored',async t=>{
 const f=fixture(t),paragraphs=Array.from({length:40},(_,i)=>i===35?'The model achieves a BLEU score of 28.4.':`Synthetic background paragraph ${i} without measured results.`);
 f.setPaper({...paper([]),text:paragraphs.join('\n\n')});f.mount();f.$('[data-lit-ai-operation="answer"]').click();f.input('[data-lit-ai-question]','BLEU score?');await f.open();
 let snapshot=f.calls.filter(c=>c.path==='/tool-runs/quote').at(-1).data.snapshot;assert.equal(snapshot.context.answerStrategy,'question-retrieval-v1');assert.ok(snapshot.materials.some(m=>m.id==='p36'));
 f.input('[data-lit-ai-start]','1');f.input('[data-lit-ai-end]','1');await f.open();snapshot=f.calls.filter(c=>c.path==='/tool-runs/quote').at(-1).data.snapshot;assert.equal(snapshot.context.answerStrategy,undefined);assert.deepEqual(snapshot.materials.map(m=>m.id),['p1']);
 f.$('[data-lit-auto-range]').click();await f.open();snapshot=f.calls.filter(c=>c.path==='/tool-runs/quote').at(-1).data.snapshot;assert.ok(snapshot.materials.some(m=>m.id==='p36'));
});
test('interactive history keeps complete recent turns within a small context budget',()=>{
 const rows=['1','2','3'].map(id=>answer(id,'q','a'.repeat(1000))),result=readingChatHistory(paper(rows),materials,{enabled:true,maxCharacters:2000,maxTurns:2});
 assert.equal(result.history.length,1);assert.equal(result.history[0].answer.length,1000);assert.ok(result.history[0].question.length+result.history[0].answer.length<=2000);
});
test('a pending pre-retrieval answer retains its original manual scope when the reader is upgraded',t=>{
 const f=fixture(t),p=paper([]);p.aiDraft={start:1,end:1,question:'Existing question'};p.aiJobStates={answer:{itemId:'legacy-pending',snapshot:{question:'Existing question',context:{}}}};f.setPaper(p);f.mount();
 assert.equal(f.getUi().getState().answerScope,'manual');assert.equal(f.getUi().getState().start,1);assert.equal(f.calls.some(c=>c.path==='/tool-runs/jobs'),false);
});

for(const operation of ['read','answer','translate'])test('literature '+operation+' sends the selected account project in both quote and job requests',async t=>{
 const f=fixture(t),reference=projectReference('owner1','cloud-paper-project');f.setPaper({...paper([]),projectId:reference});f.mount();
 if(operation!=='read')f.$('[data-lit-ai-operation="'+operation+'"]').click();if(operation==='answer')f.input('[data-lit-ai-question]','What method does the supplied paragraph describe?');
 await f.open();const quoted=f.calls.find(row=>row.path==='/tool-runs/quote').data;
 assert.equal(quoted.projectId,'cloud-paper-project');assert.equal(quoted.snapshot.projectId,undefined);assert.equal(quoted.snapshot.text,source);assert.equal(f.calls.filter(row=>row.path==='/tool-runs/jobs').length,1);
 await until(()=>f.calls.some(row=>row.path==='/tool-runs/jobs'));
 const created=f.calls.find(row=>row.path==='/tool-runs/jobs').data;assert.equal(created.projectId,'cloud-paper-project');assert.equal(created.operation,operation);assert.deepEqual(created.snapshot,quoted.snapshot);
 assert.equal(f.getPaper().projectId,reference);assert.equal(f.getPaper().text,source);assert.deepEqual(f.getPaper().notes,[]);
 assert.equal(f.getPaper().aiJobStates[operation].projectRef,reference);assert.equal(f.getPaper().aiJobStates[operation].projectId,'cloud-paper-project');
});

for(const [label,reference]of [['foreign account',projectReference('another-owner','private-project')],['historical local project','legacy-project']])test('a literature '+label+' association cannot be dropped into an independent AI submission',async t=>{
 const f=fixture(t);f.setPaper({...paper([]),projectId:reference});f.mount();f.$('[data-lit-ai-open]').click();await until(()=>!!f.$('[role="alert"]'));
 assert.equal(f.calls.some(row=>row.path==='/tool-runs/quote'||row.path==='/tool-runs/jobs'),false);assert.equal(f.getPaper().projectId,reference);assert.equal(f.getPaper().text,source);
});
