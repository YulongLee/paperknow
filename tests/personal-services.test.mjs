import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {renderOnlinePersonal,onlineUsageSummary,publicFeedbackStatus} from '../dist/workspace/online-personal-services.mjs';
import {feedbackKey} from '../dist/workspace/help-model.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function setup(api,hash='#help?scope=account'){
 const dom=new JSDOM('<main id="view"></main>',{url:'http://localhost/workspace.html'+hash});
 for(const key of ['window','document','location','localStorage'])globalThis[key]=dom.window[key];
 let pending,remembered=0;const notices=[];
 const ctx={target:document.querySelector('#view'),api,notify:text=>notices.push(text),submit:(event,fn)=>{event.preventDefault();pending=Promise.resolve().then(fn).catch(error=>notices.push(error.message));},rememberForms:()=>remembered++,esc:escape,date:value=>value||'—',icon:()=>'', $:selector=>document.querySelector(selector)};
 return {dom,ctx,notices,remembered:()=>remembered,async submit(){document.querySelector('form').dispatchEvent(new window.Event('submit',{cancelable:true}));await pending;},async click(selector){document.querySelector(selector).click();await pending;}};
}
test('usage separates account cumulative totals, recent unknown tokens and storage from billing',async()=>{
 const env=setup(async path=>path==='/usage'?{items:[{model:'real-model',input_tokens:5,output_tokens:null,created_at:'2026-10-15'}]}:{usage:{records:120,inputTokens:2000,outputTokens:1000},storage:{fileBytes:1048576,draftBytes:0,maxAccountFileBytes:52428800,maxAccountDraftBytes:52428800}});
 try{assert.equal(await renderOnlinePersonal('usage',env.ctx),true);const text=env.ctx.target.textContent;assert.match(text,/120/);assert.match(text,/2,000/);assert.match(text,/未知/);assert.match(text,/50.00 MB/);assert.match(text,/当前未启用扣费/);assert.equal(env.ctx.target.querySelector('a[href*="membership/pay"]'),null);assert.deepEqual(onlineUsageSummary([{input_tokens:3,output_tokens:2},{input_tokens:null,output_tokens:4}]),{records:2,inputTokens:3,outputTokens:6,unknownRecords:1});}finally{env.dom.window.close();}
});
test('account membership uses actual service state and existing entitlements without starting purchase',async()=>{
 const calls=[],env=setup(async(path,data)=>{calls.push([path,data]);return path==='/capabilities'?{ai:true,agent:false,payment:true}:path==='/payments/entitlements'?{items:[{title:'真实已有权益',description:'<img src=x>',starts_at:'2020-01-01',expires_at:'2099-01-01'}]}:{counts:{projects:2,drafts:3,results:4,files:5}};},'#membership?scope=account');
 try{await renderOnlinePersonal('membership',env.ctx);assert.match(env.ctx.target.textContent,/真实已有权益/);assert.match(env.ctx.target.textContent,/在线 AI 修改已开放/);assert.match(env.ctx.target.textContent,/科研智能助手未配置/);assert.equal(env.ctx.target.querySelector('img'),null);assert.equal(env.ctx.target.querySelector('a[href*="membership/pay"]'),null);assert.equal(calls.every(([,data])=>data===undefined),true);assert.match(env.ctx.target.textContent,/本地草稿不会自动上传/);}finally{env.dom.window.close();}
});
test('feedback shows only public status, escapes research text and refresh preserves unsubmitted input',async()=>{
 let reads=0;const env=setup(async()=>({items:[{id:'f-1',category:'功能问题',body:'<script>研究问题</script>',status:++reads===1?'processing':'resolved',created_at:'2026-10-15',updated_at:'2026-10-16',note:'不应公开的后台备注'}]}));
 try{await renderOnlinePersonal('help',env.ctx);assert.match(env.ctx.target.textContent,/处理中/);assert.doesNotMatch(env.ctx.target.textContent,/不应公开/);assert.equal(env.ctx.target.querySelector('script'),null);document.querySelector('#feedback').value='尚未提交的输入';await env.click('#feedback-refresh');assert.equal(document.querySelector('#feedback').value,'尚未提交的输入');assert.match(document.querySelector('#feedback-records').textContent,/已处理/);assert.equal(publicFeedbackStatus('invalid'),'待处理');}finally{env.dom.window.close();}
});
test('successful feedback remains confirmed when status refresh fails and never resubmits automatically',async()=>{
 const calls=[],item={id:'f-real',category:'功能问题',body:'保存不成功，需要检查',status:'open',created_at:'2026-10-15'};
 const env=setup(async(path,data)=>{calls.push([path,data]);if(data)return {id:item.id,item};if(calls.length>1)throw Error('offline');return {items:[]};});
 try{await renderOnlinePersonal('help',env.ctx);document.querySelector('#feedback').value=item.body;await env.submit();assert.match(document.querySelector('#feedback-submit-status').textContent,/反馈已提交，编号 f-real/);assert.match(document.querySelector('#feedback-records').textContent,/保存不成功/);assert.match(document.querySelector('#feedback-list-status').textContent,/暂时无法刷新/);assert.equal(document.querySelector('#feedback').value,'');assert.equal(env.remembered(),1);assert.equal(calls.filter(([,data])=>data).length,1);}finally{env.dom.window.close();}
});
test('failed feedback keeps input and draft carry requires explicit route and a second submit',async()=>{
 let posts=0;const env=setup(async(path,data)=>{if(data){posts++;throw Error('暂时无法提交');}return {items:[]};},'#help?scope=account&draft=local');
 try{localStorage.setItem(feedbackKey,JSON.stringify({type:'体验建议',feature:'设置与备份',content:'明确选择的本地反馈草稿'}));await renderOnlinePersonal('help',env.ctx);assert.equal(posts,0);assert.equal(document.querySelector('#feedback').value,'明确选择的本地反馈草稿');assert.equal(document.querySelector('#feedback-category').value,'体验建议');await env.submit();assert.equal(posts,1);assert.equal(document.querySelector('#feedback').value,'明确选择的本地反馈草稿');assert.equal(env.remembered(),0);assert.match(localStorage.getItem(feedbackKey),/本地反馈草稿/);assert.match(env.notices.join(''),/暂时无法提交/);}finally{env.dom.window.close();}
});
test('local feedback is never read into account without explicit draft route',async()=>{
 const env=setup(async()=>({items:[]}));try{localStorage.setItem(feedbackKey,JSON.stringify({content:'其他使用者留在浏览器的反馈'}));await renderOnlinePersonal('help',env.ctx);assert.equal(document.querySelector('#feedback').value,'');assert.equal(await renderOnlinePersonal('projects',env.ctx),false);}finally{env.dom.window.close();}
});
test('feedback input is frozen only during save and restored after failure',async()=>{
 let rejectSave;const env=setup(async(path,data)=>data?new Promise((_,reject)=>{rejectSave=reject;}):{items:[]});
 try{await renderOnlinePersonal('help',env.ctx);document.querySelector('#feedback').value='发送中的反馈';const saving=env.submit();await Promise.resolve();await Promise.resolve();assert.equal(document.querySelector('#feedback').disabled,true);assert.equal(document.querySelector('#feedback-category').disabled,true);rejectSave(Error('暂时无法保存'));await saving;assert.equal(document.querySelector('#feedback').disabled,false);assert.equal(document.querySelector('#feedback-category').disabled,false);assert.equal(document.querySelector('#feedback').value,'发送中的反馈');}finally{env.dom.window.close();}
});
test('expired account sessions propagate to the workspace login handler without rendering private content',async()=>{
 const expired=Object.assign(Error('登录已过期'),{status:401}),env=setup(async()=>{throw expired;});
 try{await assert.rejects(renderOnlinePersonal('membership',env.ctx),error=>error.status===401);assert.equal(env.ctx.target.textContent,'');}finally{env.dom.window.close();}
});
