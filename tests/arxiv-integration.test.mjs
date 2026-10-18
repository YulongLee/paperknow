import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createAPI} from '../backend/api.mjs';
import {database} from '../backend/database.mjs';
import {createSession} from '../backend/auth.mjs';
import {normalizeReferenceSearchItem,newReferenceSearchItems} from '../dist/workspace/writing-reference-search.mjs';
import {validatePaper,mergeLiteratureBackup} from '../dist/workspace/literature-model.mjs';

const feed=`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
 <id>https://export.arxiv.org/api/query</id><title>arXiv Query</title><updated>2026-10-19T00:00:00Z</updated>
 <opensearch:totalResults>1</opensearch:totalResults><opensearch:startIndex>0</opensearch:startIndex><opensearch:itemsPerPage>10</opensearch:itemsPerPage>
 <entry><id>http://arxiv.org/abs/2610.01234v2</id><published>2026-10-18T10:30:00Z</published><updated>2026-10-19T08:00:00Z</updated>
 <title>Graph learning and current research</title><summary>Database abstract is not the full paper.</summary>
 <author><name>Example Researcher</name></author><link href="http://arxiv.org/abs/2610.01234v2" rel="alternate" type="text/html"/>
 <link href="http://arxiv.org/pdf/2610.01234v2" rel="related" title="pdf" type="application/pdf"/>
 <arxiv:primary_category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/><category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
 </entry></feed>`;

async function fixture(t){
 const db=database(':memory:'),calls=[];
 const api=createAPI(db,{cancel(){}},{getAI:()=>({aiEnabled:false}),literatureFetch:async(url,options)=>{calls.push({url:String(url),options});return new Response(feed,{headers:{'content-type':'application/atom+xml; charset=utf-8'}});}});
 const server=http.createServer((req,res)=>void api(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const users=Object.fromEntries(['alice','bob'].map(id=>{db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());return [id,{id,cookie:'pk_session='+createSession(db,id)}];}));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
 async function request(path,{data,user,owner}={}){const response=await fetch(base+'/api'+path,{method:data===undefined?'GET':'POST',headers:{...(user?{Cookie:user.cookie}:{}),...(owner?{'x-paperknow-user':owner}:{}),...(data===undefined?{}:{Origin:base,'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,value:await response.json()};}
 return {db,base,users,calls,request};
}

test('public arXiv API exposes current search capabilities and safe metadata without account credentials or PDF downloads',async t=>{
 const f=await fixture(t),cap=await f.request('/capabilities');assert.equal(cap.status,200);assert.equal(cap.value.academicSearchSources.includes('arxiv'),true);assert.equal(cap.value.academicSearchSourceStatus.find(row=>row.id==='arxiv').configured,true);
 const path='/literature/search?'+new URLSearchParams({q:'graph learning',source:'arxiv',sort:'lastUpdatedDate',dateFrom:'2026-10-01',dateTo:'2026-10-19'});
 const res=await f.request(path,{user:f.users.alice});assert.equal(res.status,200);assert.equal(res.value.items.length,1);const row=res.value.items[0];
 assert.equal(row.source,'arxiv');assert.equal(row.sourceId,'2610.01234');assert.equal(row.arxivId,'2610.01234v2');assert.equal(row.type,'preprint');assert.equal(row.openAccess,true);assert.equal(row.publishedDate.slice(0,10),'2026-10-18');assert.equal(row.updatedDate.slice(0,10),'2026-10-19');assert.deepEqual(row.categories,['cs.LG']);assert.equal(row.url,'https://arxiv.org/abs/2610.01234v2');assert.equal(row.fullTextUrl,'https://arxiv.org/pdf/2610.01234v2');
 assert.equal(f.calls.length,1);const request=f.calls[0],url=new URL(request.url);assert.equal(url.origin,'https://export.arxiv.org');assert.equal(url.pathname,'/api/query');assert.equal(url.searchParams.get('sortBy'),'lastUpdatedDate');assert.equal(url.searchParams.get('sortOrder'),'descending');assert.equal(request.options.body,undefined);for(const key of Object.keys(request.options.headers))assert.equal(/authorization|cookie|x-paperknow-user/i.test(key),false);
 assert.equal((await f.request(path)).status,200);assert.equal(f.calls.length,1,'repeat anonymous search reuses only public metadata cache');assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM artifacts').get().n,0);
});

test('arXiv metadata preserves version and dates through library backup and private account drafts without becoming confirmed full text',async t=>{
 const f=await fixture(t),res=await f.request('/literature/search?q=graph%20learning&source=arxiv&sort=submittedDate'),raw=res.value.items[0];assert.equal(res.status,200);
 const imported=normalizeReferenceSearchItem(raw),paper=validatePaper({...imported,id:'arxiv-library-fixture',notes:[{id:'note-1',text:'A private reading note'}]});
 for(const row of [imported,paper]){assert.equal(row.scope,'metadata');assert.equal(row.text,'');assert.equal(row.confirmed,false);assert.equal(row.fullTextRead,false);assert.match(row.sourceLabel,/arXiv.*未读取全文/);assert.equal(row.sourceId,'2610.01234');assert.equal(row.arxivId,'2610.01234v2');assert.equal(row.publishedDate.slice(0,10),'2026-10-18');assert.equal(row.updatedDate.slice(0,10),'2026-10-19');assert.deepEqual(row.categories,['cs.LG']);}
 const newer={...raw,arxivId:'2610.01234v3',sourceId:'2610.01234v3',title:'Graph learning and current research revised title',url:'https://arxiv.org/abs/2610.01234v3'};assert.deepEqual(newReferenceSearchItems([newer],[paper]),[],'new version cannot duplicate an existing saved arXiv work');assert.equal(paper.notes[0].text,'A private reading note');
 const restored=mergeLiteratureBackup([],{format:'paperknow-literature-backup',version:1,papers:[paper]}).papers[0];assert.equal(restored.arxivId,'2610.01234v2');assert.equal(restored.publishedDate,paper.publishedDate);assert.equal(restored.updatedDate,paper.updatedDate);
 const saved=await f.request('/workspace/drafts',{data:{title:'arXiv reading record',tool:'reading',clientKey:'arxiv-fixture-owner-draft',payload:{paper:restored}},user:f.users.alice,owner:'alice'});assert.equal(saved.status,201);
 const path='/workspace/drafts/'+saved.value.item.id,reopened=await f.request(path,{user:f.users.alice,owner:'alice'});assert.equal(reopened.status,200);assert.deepEqual(reopened.value.item.payload.paper,restored);
 assert.equal((await f.request(path,{user:f.users.bob,owner:'bob'})).status,404);assert.equal((await f.request(path,{user:f.users.bob,owner:'alice'})).status,409);assert.equal((await f.request(path)).status,401);
 assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM artifacts').get().n,0,'saving metadata never mirrors a PDF into server or OSS storage');
});
