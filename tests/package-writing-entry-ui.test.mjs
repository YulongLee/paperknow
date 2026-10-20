import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountWriting} from '../dist/workspace/writing.mjs';
import {mountWritingFlow,disposeWritingFlows} from '../dist/workspace/writing-flows.mjs';
import {flowDefaultWords} from '../dist/workspace/writing-flow-model.mjs';
import {thesisDefaultTargetWords} from '../dist/workspace/writing-model.mjs';
import {clearEditor,flushEditorDraft} from '../dist/workspace/edit-guard.mjs';
import {endDraftScope,keys} from '../dist/workspace/state.mjs';

const levels={junior:'专科',bachelor:'本科',master:'硕士',doctor:'博士'};
function fixture(tool,level,{draft,explicit=false}={}){
 const dom=new JSDOM('<aside class="sidebar"></aside><div class="breadcrumb"><strong></strong></div><main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://paperknow.cn/workspace.html#tool/'+tool+'?level='+encodeURIComponent(level)+(explicit?'':'&new=package-'+tool+'-'+level)});
 for(const key of ['window','document','location','localStorage','FormData','MutationObserver','AbortController'])globalThis[key]=dom.window[key];
 dom.window.HTMLElement.prototype.scrollIntoView=()=>{};dom.window.scrollTo=()=>{};document.querySelector('dialog').close=()=>{};
 if(draft)localStorage.setItem(keys.drafts,JSON.stringify([draft]));
 const calls=[],ctx={notify(){},session:async()=>({status:'guest',user:null}),modal:(_,html)=>{document.querySelector('#workspace-dialog-body').innerHTML=html;},api:async(path,data)=>{calls.push({path,data});if(path==='/auth/me')return {user:null};if(path==='/capabilities')return {thesis:{ready:false}};if(path==='/writing/capabilities')return {ready:false};throw Error('Unexpected paid work '+path);}};
 const $=selector=>document.querySelector(selector);
 return {$,calls,mount(id){if(tool==='writing')return mountWriting(id,undefined,ctx);return mountWritingFlow({kind:tool,container:$('.dashboard'),ctx,draftId:id});},save(){assert.equal(flushEditorDraft(),true);return JSON.parse(localStorage.getItem(keys.drafts))[0];},close(){clearEditor();disposeWritingFlows();endDraftScope();dom.window.close();}};
}

test('package entry preselects the correct degree and suggested word budget for all sixteen blank writing entries',()=>{
 for(const [level,degree] of Object.entries(levels))for(const tool of ['writing','proposal','taskbook','summary']){
  const f=fixture(tool,level);try{
   f.mount();assert.equal(f.$(tool==='writing'?'#writing-degree':'#writing-level').value,degree,tool+' '+level);
   assert.equal(Number(f.$(tool==='writing'?'#writing-target':'#writing-targetWords').value),tool==='writing'?thesisDefaultTargetWords(degree):flowDefaultWords(tool,{level:degree}));
   assert.equal(f.$('#writing-title').value,'');f.$('#writing-title').value='套餐入口学位核对';f.$('#writing-title').dispatchEvent(new window.Event('input',{bubbles:true}));const row=f.save();assert.equal(row.degree,degree);assert.ok(f.calls.every(call=>call.data===undefined));
  }finally{f.close();}
 }
});

test('degree links cannot overwrite an explicitly resumed writing draft or its manual word budget',()=>{
 for(const tool of ['writing','proposal','taskbook','summary']){
  const draft={id:'existing-'+tool,tool,title:'必须保留的研究题目',degree:'硕士',targetWords:1234,writingResume:true,...(tool==='writing'?{}:{writingFlow:{version:1,title:'必须保留的研究题目',level:'硕士',targetWords:1234,targetWordsMode:'manual',stage:0,unlocked:0,materials:[],references:[],outline:[],completed:[],jobs:{},versions:[]}})};
  const f=fixture(tool,'junior',{draft,explicit:true});try{
   f.mount(draft.id);assert.equal(f.$(tool==='writing'?'#writing-degree':'#writing-level').value,'硕士');assert.equal(f.$('#writing-title').value,draft.title);assert.equal(f.$(tool==='writing'?'#writing-target':'#writing-targetWords').value,'1234');const saved=f.save();assert.equal(saved.id,draft.id);assert.equal(saved.degree,'硕士');assert.equal(saved.targetWords,1234);
  }finally{f.close();}
 }
});

test('invalid package degree parameters cannot inject markup or create a non-enumerated academic identity',()=>{
 for(const tool of ['writing','proposal','taskbook','summary'])for(const level of ['master-extra','<img src=x onerror=alert(1)>']){
  const f=fixture(tool,level);try{f.mount();assert.equal(f.$(tool==='writing'?'#writing-degree':'#writing-level').value,'本科');assert.equal(f.$('img[src="x"],[onerror]'),null);assert.ok(f.calls.every(call=>call.data===undefined));}finally{f.close();}
 }
});
