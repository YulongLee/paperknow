import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {mountOnlineThesis,disposeOnlineThesis} from '../dist/workspace/thesis-online.mjs';

const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const snapshot={title:'连续生成验收',profile:{level:'本科',major:'设计学',language:'中文',targetWords:1000},requirements:{},outline:[{id:'c1',title:'研究方案',targetWords:1000}],materials:[],references:[]};
function thesis(job={},extra={}){return {id:'t1',version:1,status:'running',title:snapshot.title,snapshot,profile:snapshot.profile,outline:snapshot.outline,chapters:[{id:'c1',title:'研究方案',version:0,status:'pending',text:'',sourceIds:[]}],job:{status:'running',stage:'generating_section',continuous:true,totalSections:2,completedSections:1,...job},...extra};}
function fixture(item=thesis()){
 disposeOnlineThesis();
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://example.test/workspace.html#thesis/t1'});
 for(const key of ['window','document','location','AbortController'])globalThis[key]=dom.window[key];
 const style=document.createElement('style');style.textContent=readFileSync(new URL('../dist/workspace/thesis-detail-commercial.css',import.meta.url),'utf8');document.head.append(style);
 let record=structuredClone(item);const calls=[];
 const api=async(path,data)=>{calls.push({path,data});if(path==='/auth/me')return {user:{id:'u1'}};if(path==='/capabilities')return {thesis:{ready:true}};if(path==='/theses/t1'&&data===undefined)return {item:structuredClone(record)};if(path==='/theses/t1/cancel'){record={...record,status:'cancelled',version:record.version+1,job:{...record.job,status:'cancelled',canResume:true}};return {item:structuredClone(record)};}throw Error('Unexpected test request '+path);};
 return {dom,calls,ctx:{api,session:async()=>({status:'ready',user:{id:'u1'}})},$:selector=>document.querySelector(selector),setItem:item=>{record=structuredClone(item);},close(){disposeOnlineThesis();dom.window.close();}};
}

test('continuous jobs render writing, source verification and review stages without new submissions',async()=>{
 const f=fixture();
 try{
  const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;
  assert.match(f.$('.thesis-continuity-note').textContent,/一次提交，自动连续生成/);
  const noteHeight=window.getComputedStyle(f.$('.thesis-continuity-note')).height;
  for(const [stage,label] of [['auto_recovering','正在自动恢复'],['verifying_citations','核验参考文献题录'],['checking_consistency','检查正文一致性'],['reviewing_manuscript','正在审校全文']]){
   f.setItem(thesis({stage,recovery:{automaticRetries:1,lastReason:'provider qwen max_tokens <img src=x onerror=1>'}}));
   f.$('[data-thesis-refresh]').click();await settle();
   assert.match(f.$('.thesis-progress').textContent,new RegExp(label));
   assert.equal(window.getComputedStyle(f.$('.thesis-continuity-note')).height,noteHeight);
   assert.doesNotMatch(f.$('.thesis-progress').textContent,/provider|qwen|max_tokens|onerror/);
   assert.equal(f.$('img'),null);
  }
  assert.equal(f.calls.some(row=>row.data),false);
 }finally{f.close();}
});

test('automatic recovery gives bounded user guidance without exposing internal reasons or retrying from the browser',async()=>{
 const f=fixture(thesis({stage:'auto_recovering',recovery:{automaticRetries:2,lastReason:'Anthropic model max_turns maxBudgetUsd'},error:{message:'internal budget diagnostic'}}));
 try{
  const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;
  assert.match(f.$('.thesis-continuity-note').textContent,/第 2 次尝试恢复/);
  assert.match(f.$('.thesis-continuity-note').textContent,/无需重复提交/);
  assert.equal(f.$('.thesis-progress > .thesis-error'),null);
  assert.doesNotMatch(f.$('.thesis-progress').textContent,/Anthropic|max_turns|maxBudgetUsd|internal budget|永不中断/);
  f.setItem(thesis({stage:'auto_recovering',recovery:{automaticRetries:'<script>bad</script>',lastReason:'secret'}}));
  f.$('[data-thesis-refresh]').click();await settle();
  assert.doesNotMatch(f.$('.thesis-continuity-note').textContent,/script|secret|NaN/);
  assert.equal(f.calls.some(row=>row.data),false);
 }finally{f.close();}
});

test('stopping a continuous task masks stale recovery stages and never resumes or resubmits automatically',async()=>{
 const f=fixture(thesis({stage:'auto_recovering',recovery:{automaticRetries:1,lastReason:'temporary'}}));
 try{
  const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;
  f.$('[data-thesis-cancel]').click();await settle();
  assert.match(f.$('.thesis-continuity-note').textContent,/任务已停止，不会自动继续/);
  assert.doesNotMatch(f.$('.thesis-progress').textContent,/正在自动恢复/);
  assert.equal(f.calls.filter(row=>row.path.endsWith('/cancel')).length,1);
  assert.equal(f.calls.some(row=>/\/(resume|generate|quote)$/.test(row.path)),false);
  assert.ok(f.$('[data-thesis-quote="resume"]'),'only a deliberate new quote can start a later resume');
 }finally{f.close();}
});

test('legacy jobs retain a non-continuous description',async()=>{
 const f=fixture(thesis({continuous:false}));
 try{const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;assert.doesNotMatch(f.$('.thesis-continuity-note').textContent,/一次提交/);assert.match(f.$('.thesis-continuity-note').textContent,/关闭页面不影响后台任务/);}finally{f.close();}
});

const quality=()=>({status:'partial',checkedAt:'2026-10-22T08:30:00Z',stale:false,citations:{items:[{id:'r1',metadataStatus:'matched',reason:'公开题录已对应。',claimSupport:'not_checked'},{id:'r2',metadataStatus:'not_found',reason:'本次来源中未找到；不代表文献不存在。',claimSupport:'not_checked'},{id:'r3',metadataStatus:'unverified',reason:'未提供可核验标识。',claimSupport:'not_checked'}],summary:{matched:1,conflict:0,not_found:1,unverified:1,unavailable:0},limitations:['题录记录不代表读取全文。']},consistency:{findings:[{id:'f1',sectionId:'c1',sectionTitle:'研究方案',category:'unresolved_placeholder',severity:'warning',quote:'【待补充：调查数据】<img src=x onerror=1>',offset:0,explanation:'需要补充真实资料。'}],totalFindings:1,truncated:false,limitations:[]},reviews:[{status:'review_required',findings:[{id:'ai1',sectionId:'c1',sectionTitle:'研究方案',category:'method_result_consistency',severity:'warning',quote:'拟开展调查，但尚未采集真实数据。',offset:0,explanation:'结论应与当前研究阶段一致。',suggestion:'保留拟开展语气，待取得数据后完善。'}],checkedSections:1,excerpted:true,limitations:['本次仅检查提供的片段。']}],limitations:['请结合实际研究记录自行核对。']});

test('quality window is reserved before results arrive and remains collapsed with escaped evidence and correct scope',async()=>{
 const f=fixture();
 try{
  const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;
  assert.equal(f.$('[data-thesis-quality-panel]').open,false);
  assert.match(f.$('[data-thesis-quality-scroll]').textContent,/生成后/);
  f.setItem(thesis({status:'completed',stage:'completed'},{status:'completed',quality:quality()}));
  f.$('[data-thesis-refresh]').click();await settle();
  const frame=f.$('[data-thesis-quality-panel]'),scroll=f.$('[data-thesis-quality-scroll]');
  assert.equal(frame.open,false,'new results must not expand the page');
  assert.equal(scroll.getAttribute('data-scroll-key'),'thesis-quality:t1');
  assert.equal(scroll.tabIndex,0);
  assert.equal(window.getComputedStyle(scroll).height,'320px');
  assert.equal(window.getComputedStyle(scroll).overflow,'auto');
  assert.match(scroll.textContent,/题录匹配|暂未找到|未核验/);
  assert.match(scroll.textContent,/不代表文献不存在|不能判定文献虚假/);
  assert.match(scroll.textContent,/题录核验不代表已查证全文/);
  assert.match(scroll.textContent,/研究方案/);
  assert.match(scroll.textContent,/保留拟开展语气/);
  assert.match(scroll.textContent,/仅检查提供的正文片段，未覆盖完整全文/);
  assert.equal(f.$('img,script'),null);
  assert.match(scroll.textContent,/<img src=x onerror=1>/);
  assert.equal(f.calls.some(row=>row.data),false);
 }finally{f.close();}
});

test('quality refresh preserves user expansion, inner scroll and keyboard focus while marking old checks stale',async()=>{
 const f=fixture(thesis({status:'completed',stage:'completed'},{status:'completed',quality:quality()}));
 try{
  const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;
  f.$('[data-thesis-quality-panel]').open=true;
  f.$('[data-thesis-quality-scroll]').scrollTop=127;
  f.$('[data-thesis-quality-summary]').focus();
  const next=quality();next.stale=true;next.consistency.findings.push({...next.consistency.findings[0],id:'f2'});
  f.setItem(thesis({status:'completed',stage:'completed'},{version:2,status:'completed',quality:next}));
  f.$('[data-thesis-refresh]').click();await settle();
  assert.equal(f.$('[data-thesis-quality-panel]').open,true);
  assert.equal(f.$('[data-thesis-quality-scroll]').scrollTop,127);
  assert.equal(document.activeElement,f.$('[data-thesis-quality-summary]'));
  assert.match(f.$('.thesis-quality-stale').textContent,/正文已修改，以下为生成时检查记录/);
  assert.equal(f.calls.some(row=>row.data),false);
 }finally{f.close();}
});

test('unavailable checks remain incomplete and never expose provider diagnostics or imply a clean manuscript',async()=>{
 const value={status:'unavailable',citations:{items:[{id:'r1',metadataStatus:'unavailable',reason:'provider qwen max_tokens budget 100'}],summary:{unavailable:1}},reviews:[{status:'unavailable',checkedSections:0,findings:[],limitations:['Anthropic maxBudgetUsd cost 0.3']}],limitations:[]};
 const f=fixture(thesis({status:'completed',stage:'completed'},{status:'completed',quality:value}));
 try{
  const panel=mountOnlineThesis({id:'t1',ctx:f.ctx});await panel.ready;
  const result=f.$('[data-thesis-quality-scroll]').textContent;
  assert.match(f.$('[data-thesis-quality-summary]').textContent,/检查暂未完成/);
  assert.match(result,/正文规则检查尚未完成/);
  assert.match(result,/辅助审校未能完成/);
  assert.doesNotMatch(result,/provider|qwen|max_tokens|budget|Anthropic|cost|0\.3/);
  assert.doesNotMatch(result,/未列出问题|没有问题|全部通过|查证全文已完成/);
 }finally{f.close();}
});
