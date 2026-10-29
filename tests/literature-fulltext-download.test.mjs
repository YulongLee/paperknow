import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createLiteraturePDFReader,createLiteratureDownloadService,literaturePDFLocation} from '../backend/literature-pdf-download.mjs';
import {createServer} from '../server.mjs';
import {createSession} from '../backend/auth.mjs';
const pdf=Buffer.from('%PDF-1.4\nSynthetic public literature used only for testing.\n%%EOF');
const row={title:'Owned test / paper',openAccess:true,fullTextUrl:'https://papers.example.edu/a.pdf'};
function transport(responses){const calls=[];return {calls,request(options,callback){calls.push(options);const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const data=responses.shift();if(!data){req.emit('error',Error('Unexpected transport call'));return;}const res=new PassThrough();res.statusCode=data.status||200;res.headers=data.headers||{'content-type':'application/pdf'};callback(res);if(!res.destroyed)res.end(data.bytes||pdf);});return req;}};}
const lookup=async()=>[{address:'93.184.216.34',family:4}];
test('only provider-declared OA locations and canonical arXiv PDFs receive a downloadable location',()=>{
 assert.equal(literaturePDFLocation({...row,openAccess:false}),'');assert.equal(literaturePDFLocation({...row,fullTextUrl:'http://papers.example.edu/a.pdf'}),'');assert.equal(literaturePDFLocation({source:'arxiv',fullTextUrl:'http://arxiv.org/abs/1706.03762v7'}),'https://arxiv.org/pdf/1706.03762v7');
 for(const url of ['https://127.0.0.1/a.pdf','https://example.local/a.pdf','https://a.example.edu:8443/a.pdf','https://u:p@a.example.edu/a.pdf','https://a.example.edu/a.pdf?token=private'])assert.equal(literaturePDFLocation({...row,fullTextUrl:url}),'');
});
test('PDF reads pin public DNS and never forward credentials or cookies across redirects',async()=>{
 const net=transport([{status:302,headers:{location:'https://cdn.example.edu/public.pdf','set-cookie':'secret=private'}},{bytes:pdf}]);const read=createLiteraturePDFReader({lookupImpl:lookup,requestImpl:net.request});const result=await read(row.fullTextUrl);assert.deepEqual(result.bytes,pdf);assert.equal(net.calls.length,2);
 for(const call of net.calls){assert.equal(call.rejectUnauthorized,true);assert.equal(call.agent,false);assert.equal(call.headers.Cookie,undefined);assert.equal(call.headers.Authorization,undefined);let value;call.lookup('changed.invalid',{},(...args)=>value=args);assert.deepEqual(value,[null,'93.184.216.34',4]);}
});
test('a public HTML landing page may resolve a bounded provider PDF meta link',async()=>{
 const net=transport([{headers:{'content-type':'text/html'},bytes:Buffer.from('<html><meta name="citation_pdf_url" content="/paper.pdf"></html>')},{bytes:pdf}]);const result=await createLiteraturePDFReader({lookupImpl:lookup,requestImpl:net.request})(row.fullTextUrl);assert.equal(result.url,'https://papers.example.edu/paper.pdf');assert.equal(net.calls.length,2);
});
test('private DNS and redirect destinations fail before any private connection',async()=>{
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.0.1','::ffff:127.0.0.1','2001:db8::1']){let connects=0;await assert.rejects(createLiteraturePDFReader({lookupImpl:async()=>[{address,family:address.includes(':')?6:4}],requestImpl(){connects++;}})(row.fullTextUrl),{status:422});assert.equal(connects,0);}
 const net=transport([{status:302,headers:{location:'https://169.254.169.254/latest/meta-data'}}]);await assert.rejects(createLiteraturePDFReader({lookupImpl:lookup,requestImpl:net.request})(row.fullTextUrl),{status:400});assert.equal(net.calls.length,1);
});
test('access restrictions, non-PDF payloads and oversized responses never become saved PDFs',async()=>{
 for(const sample of [{status:403},{status:429},{bytes:Buffer.from('not a PDF')},{headers:{'content-length':String(21*1024*1024)}},{headers:{'content-type':'text/html'},bytes:Buffer.from('<script>document.cookie</script>')}]){const net=transport([sample]);await assert.rejects(createLiteraturePDFReader({lookupImpl:lookup,requestImpl:net.request})(row.fullTextUrl));}
});
test('download tickets bind the trusted URL and expire; malformed and foreign-owner requests have no egress',async()=>{
 let now=1000,reads=0,uploads=0;const svc=createLiteratureDownloadService({clock:()=>now,storage:{provider:'aliyun_oss'},readPDF:async()=>{reads++;return{bytes:pdf};},files:{handle:async()=>{uploads++;return{value:{id:'own-file'}};}}}),ticket=svc.decorate(row).downloadToken,user={id:'alice'};
 for(const input of [{token:ticket,expectedUserId:'bob'},{token:ticket+'x',expectedUserId:'alice'},{token:ticket,expectedUserId:'alice',url:'https://evil.example/a.pdf'}])await assert.rejects(svc.save(input,user));assert.equal(reads,0);assert.equal(uploads,0);
 const saved=await svc.save({token:ticket,expectedUserId:'alice'},user);assert.equal(saved.ownerId,'alice');assert.match(saved.downloadUrl,/expectedUserId=alice/);assert.equal(reads,1);assert.equal(uploads,1);now+=8*86400000;await assert.rejects(svc.save({token:ticket,expectedUserId:'alice'},user),{status:410});assert.equal(reads,1);
});
test('cancelled or invalid binary downloads do not call private file storage',async()=>{
 for(const bytes of [Buffer.from('HTML'),Buffer.alloc(21*1024*1024)]){let stored=0;const svc=createLiteratureDownloadService({storage:{provider:'aliyun_oss'},readPDF:async()=>({bytes}),files:{handle:async()=>{stored++;}}});await assert.rejects(svc.save({token:svc.decorate(row).downloadToken,expectedUserId:'alice'},{id:'alice'}));assert.equal(stored,0);}
});
test('HTTP search to cloud save uses real private file admission and content deduplication',async t=>{
 const objects=new Map();let reads=0;
 const config={ossBucket:'test-bucket',ossEndpoint:'https://oss-cn-shanghai.aliyuncs.com',ossRegion:'cn-shanghai',ossPrefix:'test/',ossAccessKeyId:'test',ossAccessKeySecret:'test',requireRemoteStorage:true,ossClient:{async put(key,data){objects.set(key,Buffer.from(data));},async get(key){return{content:objects.get(key)};},async delete(key){objects.delete(key);}},openAlexApiKey:'test',literatureFetch:async()=>new Response(JSON.stringify({results:[{id:'https://openalex.org/W123',title:'Public paper',publication_year:2024,open_access:{is_oa:true},best_oa_location:{is_oa:true,pdf_url:row.fullTextUrl}}],meta:{count:1}}),{headers:{'content-type':'application/json'}}),literaturePdfReader:async()=>{reads++;return{bytes:pdf};}};
 const app=createServer({dbPath:':memory:',config});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());const base='http://127.0.0.1:'+app.server.address().port;for(const id of ['alice','bob'])app.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());const cookie='pk_session='+createSession(app.db,'alice');
 const send=async(path,body,auth=cookie)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:auth,...(body?{Origin:base,'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};};
 const search=await send('/api/literature/search?q=public&source=openalex&limit=5&page=1');assert.equal(search.status,200);const token=search.body.items[0].downloadToken;assert.ok(token);
 const first=await send('/api/literature/files',{token,expectedUserId:'alice'});assert.equal(first.status,201);assert.equal(objects.size,1);assert.ok([...objects.keys()][0].includes('/users/alice/originals/'));
 const second=await send('/api/literature/files',{token,expectedUserId:'alice'});assert.equal(second.body.id,first.body.id);assert.equal(objects.size,1);assert.equal(app.db.prepare('SELECT count(*) n FROM files').get().n,1);
 const foreign=await send('/api/literature/files',{token,expectedUserId:'bob'});assert.equal(foreign.status,409);assert.equal(reads,1);
 const r=await fetch(base+first.body.downloadUrl,{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),pdf);
 const r2=await fetch(base+first.body.downloadUrl,{headers:{Cookie:'pk_session='+createSession(app.db,'bob')}});assert.equal(r2.status,409);
 const cap=await send('/api/literature/capabilities');assert.ok(cap.body.academicSearchSources);assert.equal(cap.body.ai,undefined);
});
