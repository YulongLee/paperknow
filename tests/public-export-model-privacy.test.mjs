import {mockArtifactFetch,waitForExport} from './fixtures/artifact-session.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {PDFDocument} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {JSDOM} from 'jsdom';
import {createWritingDocx,createWritingPdf} from '../src/writing-document.js';
import {thesisDocumentText,mountOnlineThesis,disposeOnlineThesis} from '../dist/workspace/thesis-online.mjs';

const privateIdentity='private-runtime-identity-do-not-publish';
const researchText='本研究比较 Claude、GPT-4 与 OpenAI 发布资料中的统计指标。';
const citationTitle='Claude 与 OpenAI 的公开文献分析';
function thesis(){
 return {id:'privacy-thesis',version:1,status:'completed',title:'公开模型的比较研究',profile:{level:'硕士',discipline:'计算机科学'},model:privateIdentity,provider:privateIdentity,engine:privateIdentity,settingsVersion:privateIdentity,trace:[{model:privateIdentity,server:privateIdentity}],job:{status:'completed',model:privateIdentity,engine:privateIdentity},snapshot:{materials:[],references:[{id:'ref-cited',title:citationTitle,authors:'研究者',year:'2026',confirmed:true,provider:'crossref'},{id:'ref-unused',title:'尚未引用的来源',confirmed:true}]},chapters:[{id:'chapter-1',title:'第一章 模型比较',status:'saved',version:1,text:researchText,sourceIds:['ref-cited'],model:privateIdentity,engine:privateIdentity}]};
}
const assertPrivateIdentityAbsent=value=>assert.equal(String(value).includes(privateIdentity),false);

test('actual DOCX artifact excludes execution envelopes while retaining model names used in research and citations',async()=>{
 const item=thesis(),before=structuredClone(item),bytes=await createWritingDocx(thesisDocumentText(item)),zip=await JSZip.loadAsync(bytes);
 let packageText='';
 for(const name of Object.keys(zip.files))if(!zip.files[name].dir)packageText+=await zip.files[name].async('string');
 assertPrivateIdentityAbsent(packageText);
 const xml=await zip.file('word/document.xml').async('string'),doc=new DOMParser().parseFromString(xml,'application/xml'),exported=Array.from(doc.getElementsByTagName('w:t')).map(node=>node.textContent).join('\n');
 assert.ok(exported.includes(researchText));assert.ok(exported.includes(citationTitle));assert.ok(exported.includes('待引用文献（尚未在正文引用）'));assert.ok(exported.includes('尚未引用的来源'));assert.doesNotMatch(exported,/\[1\]|已使用的参考文献/);
 assert.deepEqual(item,before);
});

test('actual PDF pages and document metadata exclude runtime identity without censoring academic model discussion',async()=>{
 const font=await readFile(new URL('../dist/workspace/assets/fonts/NotoSansSC-Regular.otf',import.meta.url)),bytes=await createWritingPdf(thesisDocumentText(thesis()),font),metadata=await PDFDocument.load(bytes);
 for(const value of [metadata.getTitle(),metadata.getAuthor(),metadata.getSubject(),metadata.getCreator(),metadata.getProducer(),metadata.getKeywords()])assertPrivateIdentityAbsent(value);
 const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:false});
 try{const document=await task.promise;let content='';for(let index=1;index<=document.numPages;index++){const page=await document.getPage(index);content+=(await page.getTextContent()).items.map(item=>item.str).join('');}
  assertPrivateIdentityAbsent(content);const compact=value=>value.replace(/\s+/g,'');assert.ok(compact(content).includes(compact(researchText)));assert.ok(compact(content).includes(compact(citationTitle)));assert.ok(compact(content).includes('待引用文献（尚未在正文引用）'));assert.ok(content.includes('尚未引用的来源'));assert.doesNotMatch(content,/\[1\]|已使用的参考文献/);
 }finally{await task.destroy();}
});

test('customer TXT download retains manuscript and explicit pending bibliography without the surrounding runtime object',async()=>{const originalFetch=globalThis.fetch,artifactFetch=mockArtifactFetch(path=>{throw Error('Unexpected request '+path);},{userId:'researcher'});globalThis.fetch=async(path,options)=>{const response=await artifactFetch(path,options);return String(path).includes('/download?')?new Response(await response.arrayBuffer(),{headers:{'Content-Type':'text/plain;charset=utf-8'}}):response;};const restoreExport=()=>{globalThis.fetch=originalFetch;};
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.test/workspace.html#thesis/privacy-thesis'}),globals=['window','document','location','AbortController'],saved=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),objectURL=URL.createObjectURL,revokeURL=URL.revokeObjectURL,schedule=globalThis.setTimeout,blobs=[],clicked=[];
 disposeOnlineThesis();
 try{
  for(const key of globals)globalThis[key]=dom.window[key];
  URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:paperknow-export';};URL.revokeObjectURL=()=>{};
  globalThis.setTimeout=(fn,delay,...args)=>{const timer=schedule(fn,delay,...args);if(delay>=10000)timer.unref?.();return timer;};
  dom.window.HTMLAnchorElement.prototype.click=function(){clicked.push({name:this.download,url:this.href});};
  const item=thesis(),api=async path=>{if(path==='/auth/me')return {user:{id:'researcher'}};if(path==='/capabilities')return {thesis:{ready:true}};if(path==='/theses/privacy-thesis')return {item};throw Error('Unexpected request '+path);},view=mountOnlineThesis({id:item.id,ctx:{api,session:async()=>({status:'ready',user:{id:'researcher'}})},container:document.querySelector('.dashboard')});
  await view.ready;
  const button=document.querySelector('[data-thesis-txt]');assert.ok(button);assert.equal(button.disabled,false);button.click();
  await waitForExport(()=>blobs.length);assert.equal(blobs.length,1);assert.equal(clicked.length,1);assert.match(clicked[0].name,/\.txt$/);assert.equal(blobs[0].type,'text/plain;charset=utf-8');
  const text=await blobs[0].text();assertPrivateIdentityAbsent(text);assert.ok(text.includes(researchText));assert.ok(text.includes(citationTitle));assert.ok(text.includes('待引用文献（尚未在正文引用）'));assert.ok(text.includes('尚未引用的来源'));assert.doesNotMatch(text,/\[1\]|已使用的参考文献/);
 }finally{
  restoreExport();disposeOnlineThesis();dom.window.close();URL.createObjectURL=objectURL;URL.revokeObjectURL=revokeURL;globalThis.setTimeout=schedule;
  for(const [key,descriptor]of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
 }
});
