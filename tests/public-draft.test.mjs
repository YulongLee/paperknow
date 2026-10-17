import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {publicDraftCopy,publicTaskCopy,publicBackupCopy} from '../dist/workspace/public-draft.mjs';

const draft=()=>({id:'local-thesis',title:'神经网络模型研究',tool:'writing',text:'论文讨论 OpenAI 与 Claude 的研究方法，不应删除用户正文。',model:'private-model',provider:'private-provider',engine:'codex_sdk',outlineAIResult:{jobId:'o1',model:'private-model',provider:'private-provider',generatedAt:'2026-10-17'},methodSuggestion:{text:'拟开展模型比较研究。',jobId:'m1',model:'private-model',engine:'codex_sdk',generatedAt:'2026-10-17'},researchData:{model:'用户记录的回归模型',provider:'用户资料来源'},writingReferences:[{id:'r1',title:'Model-based research',provider:'Crossref'}],knowledgeFiles:[{text:'用户原始研究资料',model:'研究中的模型参数'}]});

test('export copies omit generated model metadata and keep user-authored research and source metadata',()=>{
 const original=draft(),before=structuredClone(original),copy=publicDraftCopy(original);
 assert.deepEqual(original,before);assert.notEqual(copy,original);assert.notEqual(copy.methodSuggestion,original.methodSuggestion);
 assert.equal(copy.model,undefined);assert.equal(copy.provider,undefined);assert.equal(copy.engine,undefined);
 assert.deepEqual(copy.outlineAIResult,{jobId:'o1',generatedAt:'2026-10-17'});
 assert.deepEqual(copy.methodSuggestion,{text:'拟开展模型比较研究。',jobId:'m1',generatedAt:'2026-10-17'});
 assert.equal(copy.title,original.title);assert.equal(copy.text,original.text);assert.deepEqual(copy.researchData,original.researchData);assert.deepEqual(copy.writingReferences,original.writingReferences);assert.deepEqual(copy.knowledgeFiles,original.knowledgeFiles);
 assert.doesNotMatch(JSON.stringify(copy),/private-model|private-provider|codex_sdk/);
});

test('workspace backup projects only draft and task runtime metadata and leaves original saved records intact',()=>{
 const input={format:'paperknow-workspace-backup',version:1,drafts:[draft()],tasks:[{id:'t1',title:'保存研究',model:'private-model',engine:'codex_sdk',provider:'private-provider',trace:[{tool:'claude-code'}],notes:'用户正文提到 GPT-4.1'}],literature:[{id:'r1',provider:'OpenAlex'}],sources:[{id:'s1',provider:'用户材料'}],reports:[{id:'report-1',source:{provider:'用户材料'}}],payment:{provider:'alipay'}};
 const before=structuredClone(input),copy=publicBackupCopy(input);
 assert.deepEqual(input,before);assert.deepEqual(copy.tasks,[{id:'t1',title:'保存研究',notes:'用户正文提到 GPT-4.1'}]);assert.equal(copy.drafts[0].model,undefined);
 for(const key of ['literature','sources','reports','payment'])assert.deepEqual(copy[key],input[key]);
 assert.deepEqual(publicTaskCopy({id:'t2',status:'completed',trace:[],model:'legacy'}),{id:'t2',status:'completed'});
});

test('legacy export envelopes omit runtime versions and endpoints while keeping nested research parameters',()=>{
 const privateFields={aiModel:'private-legacy-model',settingsVersion:'private-version',settings_version:'private-version',settings_meta:{model:'private-legacy-model'},runtime:'private-runtime',runtimeConfig:{baseURL:'https://private.example.test'},baseURL:'https://private.example.test',providerCalls:4};
 const input={id:'legacy',...privateFields,methodSuggestion:{text:'用户方法',...privateFields},data:{model:'研究模型',baseURL:'用户研究中的地址'}};
 const copy=publicDraftCopy(input);
 for(const field of Object.keys(privateFields)){assert.equal(copy[field],undefined);assert.equal(copy.methodSuggestion[field],undefined);}
 assert.deepEqual(copy.data,input.data);assert.equal(input.aiModel,'private-legacy-model');
});

test('all local JSON download paths use a public copy without changing backup fingerprint and restore reads',async()=>{
 const app=await readFile(new URL('../dist/workspace/app.mjs',import.meta.url),'utf8'),backup=await readFile(new URL('../dist/workspace/backup-service.mjs',import.meta.url),'utf8');
 assert.match(app,/JSON\.stringify\(publicBackupCopy\(backup\),null,2\)/);
 assert.match(app,/drafts:selected\.filter\(a=>a\.type==='draft'\)\.map\(a=>publicDraftCopy\(a\.data\)\)/);
 assert.match(app,/rows\.map\(\(\{asset,report,\.\.\.row\}\)=>publicTaskCopy\(row\)\)/);
 assert.doesNotMatch(backup,/publicDraftCopy|publicBackupCopy|publicTaskCopy/);
});
