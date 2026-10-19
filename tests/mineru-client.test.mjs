import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import JSZip from 'jszip';
import {createMineruClient,isMineruConfigurationValid} from '../backend/mineru-client.mjs';

const token='unit-only-mineru-secret',uploadURL='https://mineru-upload.oss-cn-shanghai.aliyuncs.com/source.pdf?signature=secret-upload',zipURL='https://cdn-mineru.openxlab.org.cn/result.zip?signature=secret-result';
const lookupImpl=async()=>[{address:'8.8.8.8',family:4}];
const api=data=>new Response(JSON.stringify({code:0,data}),{headers:{'content-type':'application/json'}});
const client=(fetchImpl,extra={})=>createMineruClient({token,lookupImpl,fetchImpl,...extra});
const safe=code=>err=>err.mineruSafe===true&&(!code||err.code===code)&&!err.message.includes(token)&&!err.message.includes('signature=');
async function zipFixture({pages=[0,1],markdown='# 合成文档\n共24项服务，其中6项远程服务。\n<table><tr><td>24</td><td>6</td></tr></table>\n![](images/figure.png)',extra={},invalidJson=false}={}){
 const zip=new JSZip();zip.file('full.md',markdown);zip.file('sample_content_list.json',invalidJson?'{invalid':JSON.stringify(pages.map((page_idx,i)=>({type:'text',page_idx,text:'合成第'+(i+1)+'页，24项服务'}))));zip.file('sample_middle.json',JSON.stringify({pdf_info:pages.map(page_idx=>({page_idx,para_blocks:[]}))}));for(const [name,value]of Object.entries(extra))zip.file(name,value);return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}

test('configuration readiness and client construction share strict token and official HTTPS rules',()=>{
 for(const config of [{token},{token,baseURL:'https://mineru.net/api/v4'},{token,baseURL:'https://mineru.net/api/v4/'}]){
  assert.equal(isMineruConfigurationValid(config),true);assert.doesNotThrow(()=>createMineruClient(config));
 }
 for(const config of [{},{token:' '.repeat(20)},{token:'x'.repeat(19)},{token:'x'.repeat(16385)},{token:token+'\n'},{token,baseURL:''},{token,baseURL:null},{token,baseURL:'http://mineru.net/api/v4'},{token,baseURL:'https://evil.example.com/api/v4'},{token,baseURL:'https://user:pass@mineru.net/api/v4'},{token,baseURL:'https://mineru.net:444/api/v4'},{token,baseURL:'https://mineru.net/api/v4?key=secret'},{token,baseURL:'https://mineru.net/api/v5'}]){
  assert.equal(isMineruConfigurationValid(config),false);assert.throws(()=>createMineruClient(config),safe('mineru_configuration'));
 }
});

test('single PDF submission uses the official API, exact business success, VLM and bounded page ranges',async()=>{
 let captured;const service=client(async(url,init)=>{captured={url,init};return api({batch_id:'batch-123',file_urls:[uploadURL]});});
 assert.deepEqual(await service.createUpload({name:'合成论文.pdf',dataId:'file-123',pageRanges:'1-2'}),{batchId:'batch-123',uploadURL});
 assert.equal(captured.url,'https://mineru.net/api/v4/file-urls/batch');assert.equal(captured.init.headers.Authorization,'Bearer '+token);assert.equal(captured.init.redirect,'error');
 assert.deepEqual(JSON.parse(captured.init.body),{files:[{name:'合成论文.pdf',data_id:'file-123',is_ocr:true,page_ranges:'1-2'}],model_version:'vlm',language:'ch',enable_formula:true,enable_table:true});
 for(const range of ['0','1-101','3-1','1,1','1-2,2-3','1-2\r\nX:1'])await assert.rejects(()=>service.createUpload({name:'a.pdf',dataId:'a',pageRanges:range}),safe('mineru_input_invalid'));
 for(const name of ['../a.pdf','a.docx','a\n.pdf'])await assert.rejects(()=>service.createUpload({name,dataId:'a'}),safe('mineru_input_invalid'));
});

test('upload and result downloads never receive API Bearer credentials or follow redirects',async()=>{
 const calls=[],zip=await zipFixture(),service=client(async(url,init)=>{calls.push({url,init});return init.method==='PUT'?new Response(null,{status:204}):new Response(zip);});
 await service.upload(uploadURL,Buffer.from('%PDF-synthetic'));
 const result=await service.downloadResult(zipURL);
 assert.equal(result.pageCount,2);assert.deepEqual(result.pages.map(p=>p.pageIndex),[0,1]);assert.match(result.text,/24项/);assert.doesNotMatch(result.text,/images\/figure/);assert.ok(result.layout);assert.ok(result.contentList);assert.deepEqual(result.rawZip,zip);
 for(const call of calls){assert.equal(call.init.headers.Authorization,undefined);assert.equal(call.init.redirect,'error');}
 assert.equal(calls[0].init.headers['Content-Length'],String(Buffer.byteLength('%PDF-synthetic')));
 const redirect=client(async()=>new Response(null,{status:302,headers:{Location:'https://evil.example.com/?secret='+token}}));await assert.rejects(()=>redirect.upload(uploadURL,Buffer.from('%PDF-synthetic')),safe('mineru_unavailable'));
});

test('polling is read-only, validates the one-file state and does not expose supplier messages',async()=>{
 const calls=[];let state='running';const service=client(async(url,init)=>{calls.push({url,init});return api({extract_result:[{state,extract_progress:{extracted_pages:1,total_pages:2},full_zip_url:zipURL,err_msg:token+' '+zipURL}]});});
 assert.deepEqual(await service.poll('batch-1'),{state:'running',progress:{extractedPages:1,totalPages:2},zipURL:null});state='done';assert.equal((await service.poll('batch-1')).zipURL,zipURL);state='failed';assert.deepEqual(await service.poll('batch-1'),{state:'failed',progress:{extractedPages:1,totalPages:2},zipURL:null,errCode:'mineru_parse_failed'});
 assert.ok(calls.every(c=>c.init.method==='GET'&&c.init.body===undefined));
 await assert.rejects(()=>client(async()=>api({extract_result:[]})).poll('batch-1'),safe());
 await assert.rejects(()=>client(async()=>api({extract_result:[{state:'invented'}]})).poll('batch-1'),safe());
 await assert.rejects(()=>client(async()=>api({extract_result:[{state:'running',extract_progress:{total_pages:101}}]})).poll('batch-1'),safe('mineru_page_limit'));
 await assert.rejects(()=>client(async()=>api({extract_result:[{state:'done',full_zip_url:'http://127.0.0.1/result.zip'}]})).poll('batch-1'),safe('mineru_url_invalid'));
});

test('poll binds the provider result to the exact submitted data ID and rejects missing identities',async()=>{
 const service=dataId=>client(async()=>api({extract_result:[{state:'pending',...(dataId===undefined?{}:{data_id:dataId})}]}));
 const result=await service('source-1').poll('batch-1',undefined,{dataId:'source-1'});assert.equal(result.providerDataId,'source-1');
 for(const id of [undefined,'source-other'])await assert.rejects(()=>service(id).poll('batch-1',undefined,{dataId:'source-1'}),safe('mineru_response_mismatch'));
});

test('layout filenames are explicit and model detector JSON is not returned as a layout',async()=>{
 for(const name of ['layout.json','middle.json','middle_json.json','document_layout.json','document_middle.json']){
  const z=new JSZip();z.file('full.md','合成正文，不代表真实研究。');z.file(name,JSON.stringify({pdf_info:[{page_idx:0},{page_idx:1}]}));z.file('document_model.json',JSON.stringify({page_idx:99,detectorOnly:true}));
  const buffer=await z.generateAsync({type:'nodebuffer'}),result=await client(async()=>new Response(buffer)).downloadResult(zipURL);assert.equal(result.pageCount,2);assert.equal(result.layout.detectorOnly,undefined);
 }
 const z=new JSZip();z.file('full.md','合成正文');z.file('document_model.json',JSON.stringify({pdf_info:[{page_idx:0}]}));const buffer=await z.generateAsync({type:'nodebuffer'});await assert.rejects(()=>client(async()=>new Response(buffer)).downloadResult(zipURL),safe('mineru_zip_invalid'));
});

test('page-grouped and flat content-list v2 normalize page text and retain blank pages',async()=>{
 for(const grouped of [true,false]){
  const rows=[{type:'paragraph',content:{paragraph_content:[{type:'text',content:'第一段合成文字'}]}},{type:'title',content:{title_content:'第二页标题'}}];
  const value=grouped?[[rows[0]],[rows[1]],[]]:rows.map((row,index)=>({...row,page_idx:index}));
  const z=new JSZip();z.file('markdown.md','# 合成正文\n第一段合成文字\n第二页标题');z.file('test_content_list_v2.json',JSON.stringify(value));
  const buffer=await z.generateAsync({type:'nodebuffer'}),result=await client(async()=>new Response(buffer)).downloadResult(zipURL);assert.equal(result.pageCount,grouped?3:2);assert.match(result.pages[0].text,/第一段合成文字/);assert.match(result.pages[1].text,/第二页标题/);assert.equal(result.contentList[0].page_idx,0);if(grouped)assert.equal(result.pages[2].text,'');
 }
});

test('provider business codes, HTTP errors and arbitrary exception text never escape',async()=>{
 for(const code of ['0',1,-1])await assert.rejects(()=>client(async()=>new Response(JSON.stringify({code,msg:token+' '+zipURL,data:{}}),{headers:{'Content-Type':'application/json'}})).poll('a'),safe('mineru_business_error'));
 await assert.rejects(()=>client(async()=>new Response('<html>'+token,{headers:{'Content-Type':'text/html'}})).poll('a'),safe());
 await assert.rejects(()=>client(async()=>{throw new Error(token+' '+zipURL);}).poll('a'),safe('mineru_transport_failed'));
 for(const [status,code]of [[401,'mineru_auth_failed'],[403,'mineru_auth_failed'],[429,'mineru_rate_limited'],[500,'mineru_unavailable']])await assert.rejects(()=>client(async()=>new Response(token,{status})).poll('a'),safe(code));
});

test('untrusted URL hosts and private/mixed DNS results fail before any HTTP call',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return api({});};
 for(const value of ['https://mineru.net.evil.example/a.zip','https://evil.aliyuncs.com/a.zip','https://user:pass@cdn-mineru.openxlab.org.cn/a.zip','https://cdn-mineru.openxlab.org.cn:444/a.zip','https://127.0.0.1/a.zip','https://cdn-mineru.openxlab.org.cn/a.zip#frag','http://cdn-mineru.openxlab.org.cn/a.zip'])await assert.rejects(()=>client(fetchImpl).downloadResult(value),safe('mineru_url_invalid'));
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.1.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::'])await assert.rejects(()=>client(fetchImpl,{lookupImpl:async()=>[{address:'8.8.8.8',family:4},{address,family:address.includes(':')?6:4}]}).poll('a'),safe('mineru_dns_invalid'));
 assert.equal(calls,0);
 assert.throws(()=>client(fetchImpl,{baseURL:'https://evil.example.com/api/v4'}),safe('mineru_configuration'));
});

test('default native transport pins resolved DNS and TLS hostname, without a credential-bearing redirect',async()=>{
 let captured;const service=createMineruClient({token,lookupImpl,requestImpl:(options,callback)=>{
  captured=options;const request=new EventEmitter();request.destroy=()=>request.emit('close');request.end=()=>queueMicrotask(()=>{const response=Readable.from([JSON.stringify({code:0,data:{extract_result:[{state:'pending'}]}})]);response.statusCode=200;response.headers={'content-type':'application/json'};callback(response);});return request;
 }});
 assert.equal((await service.poll('batch')).state,'pending');assert.equal(captured.hostname,'mineru.net');assert.equal(captured.servername,'mineru.net');assert.equal(captured.agent,false);assert.equal(captured.headers.Authorization,'Bearer '+token);captured.lookup('mineru.net',{},(err,address,family)=>{assert.equal(err,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);});
});

test('API and streamed result body limits are enforced even without Content-Length',async()=>{
 await assert.rejects(()=>client(async()=>new Response('x'.repeat(100)),{maxApiBytes:20}).poll('a'),safe('mineru_response_too_large'));
 await assert.rejects(()=>client(async()=>new Response('small',{headers:{'Content-Length':'999999'}}),{maxApiBytes:20}).poll('a'),safe('mineru_response_too_large'));
 await assert.rejects(()=>client(async()=>new Response(await zipFixture()),{maxZipBytes:20}).downloadResult(zipURL),safe('mineru_response_too_large'));
});

test('ZIP central directory rejects traversal, canonical duplicates, symlinks and excessive entry counts',async()=>{
 for(const name of ['../escape.json','C:/escape.json','folder/../../escape.json','evil\\escape.json']){const zip=await zipFixture({extra:{[name]:'{}'}});await assert.rejects(()=>client(async()=>new Response(zip)).downloadResult(zipURL),safe('mineru_zip_invalid'));}
 const duplicates=await zipFixture({extra:{'same.json':'{}','SAME.json':'{}'}});await assert.rejects(()=>client(async()=>new Response(duplicates)).downloadResult(zipURL),safe('mineru_zip_invalid'));
 const z=new JSZip();z.file('full.md','source');z.file('symlink','../../sensitive',{unixPermissions:0o120777});const symlink=await z.generateAsync({type:'nodebuffer',platform:'UNIX'});await assert.rejects(()=>client(async()=>new Response(symlink)).downloadResult(zipURL),safe('mineru_zip_invalid'));
 const zip=await zipFixture();await assert.rejects(()=>client(async()=>new Response(zip),{maxEntries:2}).downloadResult(zipURL),safe('mineru_zip_invalid'));
});

test('ZIP decompression, text/JSON size, invalid JSON and missing/gapped page metadata fail safely',async()=>{
 const large=await zipFixture({extra:{'image.dat':'x'.repeat(2000)}});await assert.rejects(()=>client(async()=>new Response(large),{maxUncompressedBytes:1000}).downloadResult(zipURL),safe('mineru_zip_invalid'));
 const good=await zipFixture();await assert.rejects(()=>client(async()=>new Response(good),{maxMarkdownBytes:10}).downloadResult(zipURL),safe('mineru_zip_invalid'));
 await assert.rejects(()=>client(async()=>new Response(good),{maxJsonBytes:10}).downloadResult(zipURL),safe('mineru_zip_invalid'));
 await assert.rejects(()=>client(async()=>new Response(good),{maxTextCharacters:3}).downloadResult(zipURL),safe('mineru_text_limit'));
 for(const opts of [{invalidJson:true},{pages:[]},{pages:[0,2]},{pages:[100]}])await assert.rejects(()=>client(async()=>new Response(await zipFixture(opts))).downloadResult(zipURL),safe());
 const z=new JSZip();z.file('full.md','No page mapping');const zip=await z.generateAsync({type:'nodebuffer'});await assert.rejects(()=>client(async()=>new Response(zip)).downloadResult(zipURL),safe('mineru_zip_invalid'));
});

test('damaged actual decompressed size is rejected instead of trusting ZIP declared metadata',async()=>{
 const zip=await zipFixture();let cursor=0;while((cursor=zip.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]),cursor))!==-1){const length=zip.readUInt16LE(cursor+28),name=zip.subarray(cursor+46,cursor+46+length).toString();if(name==='full.md'){zip.writeUInt32LE(1,cursor+24);break;}cursor+=46+length;}
 await assert.rejects(()=>client(async()=>new Response(zip)).downloadResult(zipURL),safe('mineru_zip_invalid'));
});

test('cancellation stops dispatch and timeout errors stay sanitized',async()=>{
 let called=false;await assert.rejects(()=>client(async()=>{called=true;}).poll('a',AbortSignal.abort()),safe('mineru_cancelled'));assert.equal(called,false);
 const service=client(async(_url,init)=>new Promise((_,reject)=>{init.signal.addEventListener('abort',()=>reject(new Error(token)),{once:true});}),{timeoutMs:5});
 const keepAlive=setTimeout(()=>{},100);try{await assert.rejects(()=>service.poll('a'),safe('mineru_timeout'));}finally{clearTimeout(keepAlive);}
});

test('upload has an independent longer bounded budget, remains cancellable and never retries',async()=>{
 const calls=[];
 const fetchImpl=async(_url,init)=>new Promise((resolve,reject)=>{
  calls.push(init.method);
  const timer=setTimeout(()=>{init.signal.removeEventListener('abort',abort);resolve(init.method==='PUT'?new Response(null,{status:204}):api({extract_result:[{state:'pending'}]}));},60);
  const abort=()=>{clearTimeout(timer);reject(new Error(token));};init.signal.addEventListener('abort',abort,{once:true});
 });
 const service=client(fetchImpl,{timeoutMs:20,uploadTimeoutMs:200});
 await assert.rejects(()=>service.poll('a'),safe('mineru_timeout'));
 await service.upload(uploadURL,Buffer.from('%PDF-synthetic'));
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5);
 try{await assert.rejects(()=>service.upload(uploadURL,Buffer.from('%PDF-synthetic'),controller.signal),safe('mineru_cancelled'));}finally{clearTimeout(timer);}
 assert.deepEqual(calls,['GET','PUT','PUT']);
 assert.throws(()=>client(fetchImpl,{uploadTimeoutMs:60001}),safe('mineru_configuration'));
});

test('a shorter global timeout also bounds upload unless an independent upload budget is supplied',async()=>{
 let calls=0;const service=client(async(_url,init)=>new Promise((_,reject)=>{calls++;init.signal.addEventListener('abort',()=>reject(new Error(token)),{once:true});}),{timeoutMs:5});
 const keepAlive=setTimeout(()=>{},100);try{await assert.rejects(()=>service.upload(uploadURL,Buffer.from('%PDF-synthetic')),safe('mineru_timeout'));}finally{clearTimeout(keepAlive);}
 assert.equal(calls,1);
});
