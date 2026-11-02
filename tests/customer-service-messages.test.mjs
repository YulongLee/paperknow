import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {serviceMessage} from '../dist/workspace/service-message.mjs';
import {confirmDocumentImport} from '../dist/workspace/document-import-confirm.mjs';
import {publicAIResponse} from '../backend/public-ai-metadata.mjs';
import {approveDocumentBatch,createWorkspaceDocumentImporter} from '../dist/workspace/document-import.mjs';

test('customer diagnostics remove providers and internals while retaining actionable account, quota and file validation',()=>{
 for(const message of ['MinerU token invalid','阿里云 OSS 凭据未配置','Claude Agent SDK failure','Qwen-Image-3.0 not available','Model.AccessDenied','AI 请求了未授权工具 read_material','提纲达到 token 预算','SQLITE_BUSY /opt/paperknow/private.sqlite','Unexpected token < in JSON','maxCostUsd=1','PDF 解析凭据暂不可用']){const clean=serviceMessage(message);assert.notEqual(clean,message);assert.doesNotMatch(clean,/MinerU|OSS|Claude|Qwen|Model\.|token|SQLITE|JSON|read_material|maxCostUsd|凭据/i);}
 for(const message of ['积分不足，请先充值。','请先登录。','登录账户已变化，请重新选择文件。','PDF 最大 20MB、最多 100 页。','请填写论文题目。','未检测到可读取正文，请选择其他文件。'])assert.equal(serviceMessage(message),message);
 assert.match(serviceMessage('Failed to fetch'),/网络连接/);
});
test('document and detection task diagnostics are projected without changing research content or staff diagnostics',()=>{
 const text='研究比较 Claude、Qwen 与 MinerU，记录模型输入 Token 数。',error={message:'MinerU request failed at https://private.example/api',stack:'secret stack',code:'parse_failed'},item={id:'x',status:'failed',error,result:{text},title:text};
 for(const path of ['/api/document-parses/x','/api/document-translations/x','/api/formula-recognitions/x','/api/aigc-detections/x','/api/web-similarity/x']){const value=publicAIResponse(path,{item,items:[item]});assert.doesNotMatch(value.item.error.message,/MinerU|private\.example/);assert.equal(value.item.error.stack,undefined);assert.equal(value.item.error.code,'parse_failed');assert.equal(value.item.result.text,text);assert.equal(value.item.title,text);assert.equal(value.items[0].result.text,text);}
 assert.equal(item.error.stack,'secret stack');assert.deepEqual(publicAIResponse('/api/admin/jobs',{item},{authorizedAdmin:true}),{item});
 for(const key of ['documentParsing','documentTranslation','formulaOcr','aigcDetection','webSimilarity'])assert.doesNotMatch(publicAIResponse('/api/capabilities',{[key]:{ready:false,reason:'MinerU not configured'}})[key].reason,/MinerU|configured/);
});
function dialogFixture(t){const dom=new JSDOM('<button id="upload">上传文献</button>',{url:'https://paperknow.test/workspace.html#category/literature'}),previous=globalThis.document;globalThis.document=dom.window.document;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.confirm=()=>{throw Error('Native confirm must not be used');};t.after(()=>{globalThis.document=previous;dom.window.close();});return {dom,doc:dom.window.document};}
test('branded import confirmation escapes filenames, links privacy and submits only after the explicit action',async t=>{
 const {doc}=dialogFixture(t);doc.querySelector('#upload').focus();let accepted=false;const pending=confirmDocumentImport('添加文献\n\n<script>不是代码</script>.pdf\n\nPDF 最大 20MB、最多 100 页。').then(value=>accepted=value);
 assert.equal(doc.querySelector('dialog').open,true);assert.equal(doc.querySelector('script'),null);assert.match(doc.querySelector('dialog').textContent,/<script>不是代码/);assert.equal(doc.querySelector('dialog a').pathname,'/privacy/');assert.equal(accepted,false);doc.querySelector('dialog .primary').click();assert.equal(await pending,true);assert.equal(doc.querySelector('dialog'),null);assert.equal(doc.activeElement.id,'upload');
});
test('escape and navigation cancel an import without submitting and restore the upload control',async t=>{
 const {doc,dom}=dialogFixture(t);doc.querySelector('#upload').focus();let pending=confirmDocumentImport('添加文献\n\n文献将保存至文件管理。');doc.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel',{cancelable:true}));assert.equal(await pending,false);assert.equal(doc.activeElement.id,'upload');pending=confirmDocumentImport('添加文献');dom.window.dispatchEvent(new dom.window.Event('hashchange'));assert.equal(await pending,false);assert.equal(doc.querySelector('dialog'),null);
});
test('a PDF batch is approved once and never exposes parser names in its confirmation',async()=>{
 const files=[{name:'a.pdf'},{name:'b.pdf'}];let copy='';const token=await approveDocumentBatch(files,'u',{confirmImpl:message=>{copy=message;return true;}});assert.ok(token);assert.match(copy,/2 份文献/);assert.match(copy,/20MB、最多 100 页/);assert.doesNotMatch(copy,/MinerU|解析服务|上游|OSS/);
 let posts=0;const extract=createWorkspaceDocumentImporter({confirmImpl:()=>false,fetchImpl:async url=>{if(url==='/api/auth/me')return Response.json({user:{id:'u'}});if(url==='/api/capabilities')return Response.json({documentParsing:{ready:true}});posts++;return Response.json({});}});await assert.rejects(extract({name:'a.pdf',size:4,arrayBuffer:async()=>new Uint8Array([37,80,68,70]).buffer}),/已取消/);assert.equal(posts,0);
});
test('redaction preserves confirmed billing outcomes without inventing a completed refund',()=>{
 const done=serviceMessage('单次执行保护，原提纲保留；预占权益已释放，本次不扣积分或套餐次数。');assert.doesNotMatch(done,/单次执行保护/);assert.match(done,/原提纲已保留/);assert.match(done,/预占已释放/);assert.match(done,/本次不扣积分或套餐次数/);
 const pending=serviceMessage('Qwen 内容检查未完成，预占将自动释放。');assert.match(pending,/预占将释放/);assert.doesNotMatch(pending,/预占已释放/);assert.doesNotMatch(serviceMessage('MinerU service unavailable'),/已释放|不扣积分/);
});
test('closing an import confirmation inside a file window returns focus to the original upload button',async t=>{
 const {doc}=dialogFixture(t),parent=doc.createElement('dialog'),button=doc.querySelector('#upload');doc.body.append(parent);parent.append(button);parent.showModal();button.focus();const pending=confirmDocumentImport('导入文件');doc.querySelector('.document-import-confirm .secondary').click();assert.equal(await pending,false);assert.equal(parent.open,true);assert.equal(doc.activeElement,button);
});
