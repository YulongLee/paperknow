import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {defaultRules,checkFormatting,validateRules,rulesFromTemplate,formatAdviceSnapshot} from '../../dist/workspace/format-model.mjs';
import {suggestedFormatExclusions} from '../../dist/workspace/format-presets.mjs';
import {mountToolJobPanel} from '../../dist/workspace/tool-job-panel.mjs';
import {toolBanner} from '../../dist/workspace/tool-banner.mjs';
import {esc,icon} from '../../dist/workspace/ui.mjs';
import {exampleDocx,parseDocx,applyDocx} from '../../src/format-document.js';

const source=(await readFile(new URL('../../dist/workspace/format.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replace("import('./assets/format-document.js')",'loadFormatDocumentModule()');
export const until=async check=>{for(let i=0;i<400;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,4));}throw Error('Format UI did not settle');};
export async function formatFixture(t,{documentModule,loadDocument,jobStatus='completed',failStorage=false,saved=[],scoped=false}={}){
 globalThis.DOMParser=DOMParser;globalThis.XMLSerializer=XMLSerializer;
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://format.test/workspace.html#category/format',runScripts:'outside-only'}),w=dom.window,$=s=>w.document.querySelector(s),calls=[],downloads=[],notices=[];let status=jobStatus,rows=structuredClone(saved),storageFails=failStorage,scope=scoped,job,snapshot;
 Object.defineProperty(w,'crypto',{value:webcrypto});w.HTMLElement.prototype.scrollIntoView=()=>{};const nativeTimeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,ms===2500?5:ms,...args);
 const api=async(path,data)=>{calls.push({path,data});if(path==='/auth/me')return {user:{id:'format-owner'}};if(path==='/tool-runs/capabilities')return {ready:true};if(path==='/tool-runs/quote')return {type:'agent',source:'credits',creditCost:10,title:'格式复核',token:'synthetic-format',expiresAt:new Date(Date.now()+60000).toISOString()};if(path==='/tool-runs/jobs'){snapshot=data.snapshot;job={id:'format-job',kind:'format',operation:'format'};return {item:currentJob()};}if(path==='/tool-runs/jobs/format-job')return {item:currentJob()};throw Error('Unexpected API '+path);};
 const currentJob=()=>({...job,status,completedUnits:status==='completed'?1:0,totalUnits:1,...(status==='completed'?{output:{text:'依据本次模板规则与实际检查清单完成格式复核。',suggestions:[],sourceIds:['format-review']}}:{})});
 Object.assign(w,{defaultRules,checkFormatting,validateRules,rulesFromTemplate,formatAdviceSnapshot,suggestedFormatExclusions,toolBanner,esc,icon,mountToolJobPanel,keys:{drafts:'drafts'},hasDraftScope:()=>scope,structuredClone,list:()=>structuredClone(rows),write:(key,value)=>{if(storageFails)throw Error('storage full');rows=structuredClone(value);},download:async(name,content,type)=>{downloads.push({name,content,type});},loadFormatDocumentModule:loadDocument||(()=>Promise.resolve(documentModule||{exampleDocx,parseDocx,applyDocx}))});
 w.eval(source+'\nwindow.formatTest={mountFormat,disposeFormat,formatRouteGuard,formatHasWork};');const ctx={api,notify:message=>notices.push(message)};await w.formatTest.mountFormat(ctx);
 t.after(()=>{w.formatTest.disposeFormat();w.close();});
 const f={w,$,root:$('.dashboard'),calls,downloads,notices,ctx,getRows:()=>structuredClone(rows),setRows:value=>rows=structuredClone(value),setStorageFailure:value=>storageFails=value,setScope:value=>scope=value,setStatus:value=>status=value,job:()=>job,snapshot:()=>snapshot,click(selector){const node=$(selector);if(!node)throw Error('Missing control '+selector);node.click();},async upload(kind,data,name=kind==='template'?'学校格式模板.docx':'论文原件.docx'){
  const input=$(kind==='template'?'#format-sample-file':'#format-file');const file={name,size:data.byteLength,arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)};Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new w.Event('change',{bubbles:true}));await until(()=>!input.isConnected||!input.disabled);
 },async ready(){const original=await exampleDocx(),parsed=await parseDocx(original),target={...defaultRules(),font:'仿宋',size:14,line:2,indent:0,left:3};const template=await applyDocx(original,parsed,target);await f.upload('template',template);await f.upload('paper',original);return {original,template,target};},async generate(){f.click('[data-action="apply"]');await until(()=>f.$('[data-format-workflow]').dataset.phase==='complete'||!!f.$('[data-tj-status]')||f.$('[data-format-error]').hidden===false);}};
 return f;
}
export {exampleDocx,parseDocx,applyDocx};
