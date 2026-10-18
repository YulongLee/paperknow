import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {createWebSourceReader} from '../backend/web-similarity-source.mjs';

const text='研究方法以真实证据和公开资料为基础，通过细致的比较分析，讨论研究对象的特征与发展规律，并保留每一个信息来源。';
const publicDNS=async()=>[{address:'8.8.8.8',family:4}];
const safe=code=>e=>e.webSourceSafe===true&&e.code==='web_source_'+code&&!/https?:|synthetic-secret|private-body/.test(e.message);
function transport(rows,captured=[]){let index=0;return (options,callback)=>{
 captured.push(options);const req=new EventEmitter();req.destroy=()=>{req.destroyed=true;};req.end=()=>queueMicrotask(()=>{
  const row=typeof rows==='function'?rows(index++,options):rows[index++];assert.ok(row,'unexpected request');
  if(row.error){req.emit('error',new Error(row.error));return;}
  const res=Readable.from(row.chunks||[Buffer.from(row.body??text)]);res.statusCode=row.status??200;res.headers={'content-type':'text/plain; charset=utf-8',...row.headers};callback(res);
 });return req;
};}
const reader=(rows,extra={},captured=[])=>createWebSourceReader({lookupImpl:publicDNS,requestImpl:transport(rows,captured),clock:()=>1792368000000,...extra});

test('public HTML extracts visible article, omits navigation and executable content, and records actual final evidence',async()=>{
 const html=`<!doctype html><html><head><title>公开研究 &amp; 方法</title><script>private-body</script></head><body><header>全站导航</header><nav>工具下载</nav><div class="site-sidebar">全站侧栏</div><div role="contentinfo">全站底部信息</div><article><h1>公开研究</h1><p>${text}<strong>真实</strong>证据</p><p>${text}</p><div hidden>隐私区域</div><div aria-hidden="true">隐藏内容</div><span style="display: none">隐藏样式</span><script>恶意脚本</script><style>恶意样式</style><form>登录按钮</form></article><footer>全站页脚</footer></body></html>`;
 const captured=[],result=await reader([{body:html,headers:{'content-type':'text/html; charset=utf-8'}}],{},captured)('https://public.example/article#section');
 assert.equal(result.url,'https://public.example/article');assert.equal(result.title,'公开研究 & 方法');assert.match(result.text,/真实证据/);assert.doesNotMatch(result.text,/全站|工具下载|恶意|隐私区域|隐藏|登录按钮/);
 assert.equal(result.contentHash,createHash('sha256').update(result.text).digest('hex'));assert.equal(result.kind,'web');assert.equal(result.provider,'公开网页');assert.equal(result.license,'本次可访问网页文本，仅用于比对');assert.equal(result.fetchedAt,'2026-10-19T00:00:00.000Z');
 assert.deepEqual(Object.keys(captured[0].headers).sort(),['Accept','Accept-Encoding','User-Agent'].sort());assert.equal(captured[0].method,'GET');assert.equal(captured[0].headers['Accept-Encoding'],'identity');
});

test('all DNS answers are checked and the public connection is pinned with TLS hostname validation',async()=>{
 const calls=[],captured=[];await reader([{body:text}],{lookupImpl:async(host,options)=>{calls.push([host,options]);return [{address:'8.8.8.8',family:4},{address:'2606:4700:4700::1111',family:6}];}},captured)('https://public.example/study?q=study');
 assert.deepEqual(calls,[['public.example',{all:true,verbatim:true}]]);const opts=captured[0];assert.equal(opts.hostname,'public.example');assert.equal(opts.servername,'public.example');assert.equal(opts.rejectUnauthorized,true);assert.equal(opts.agent,false);assert.equal(opts.autoSelectFamily,false);assert.equal(opts.family,4);
 opts.lookup('public.example',{},(e,ip,family)=>{assert.equal(e,null);assert.equal(ip,'8.8.8.8');assert.equal(family,4);});opts.lookup('public.example',{all:true},(e,rows)=>{assert.equal(e,null);assert.deepEqual(rows,[{address:'8.8.8.8',family:4}]);});assert.equal(calls.length,1);
});

test('private, reserved, mapped, documentation, metadata and mixed DNS responses never connect',async()=>{
 const forbidden=['0.0.0.0','10.1.2.3','100.64.0.1','100.100.100.200','127.0.0.1','169.254.169.254','172.16.0.1','172.31.255.255','192.0.0.9','192.0.2.1','192.88.99.1','192.168.1.1','198.18.0.1','198.19.1.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::','::1','::ffff:8.8.8.8','::ffff:127.0.0.1','::ffff:0808:0808','64:ff9b::808:808','fe80::1','fc00::1','2001::1','2001:1::1','2001:db8::1','2002:808:808::1','3ffe::1','3fff::1'];
 for(const address of forbidden){let requests=0;const read=createWebSourceReader({lookupImpl:async()=>[{address:'8.8.8.8',family:4},{address,family:address.includes(':')?6:4}],requestImpl:()=>{requests++;}});await assert.rejects(()=>read('https://public.example/'),safe('dns_invalid'));assert.equal(requests,0,address);}
});

test('invalid DNS answer shape, family mismatch and empty records fail closed',async()=>{
 for(const rows of [[],null,[{}],[{address:'8.8.8.8',family:6}],[{address:'not-an-ip',family:4}],Array(65).fill({address:'8.8.8.8',family:4})])await assert.rejects(()=>reader([],{lookupImpl:async()=>rows})('https://public.example/'),safe('dns_invalid'));
 await assert.rejects(()=>reader([],{lookupImpl:async()=>{throw Error('synthetic-secret');}})('https://public.example/'),safe('dns_failed'));
});

test('unsafe URL credentials, sensitive query strings, schemes, ports and local names are rejected before DNS',async()=>{
 const urls=['file:///etc/passwd','ftp://public.example/a','https://user:synthetic-secret@public.example/','https://public.example:8443/','http://localhost/','http://intranet/','http://public.internal/','http://public.local/','http://public.example./','http://127.1/','http://2130706433/','http://0x7f000001/','http://[::ffff:8.8.8.8]/','http://[fe80::1%25en0]/','https://public.example/a?token=synthetic-secret','https://public.example/a?api_key=synthetic-secret','https://public.example/a?X-Amz-Signature=synthetic-secret','https://public.example/a?OSSAccessKeyId=synthetic-secret','https://public.example/a?SessionId=synthetic-secret','https://public.example/a?code=synthetic-secret','https://public.example/a\n','https://public.example\\@127.0.0.1/a'];let dns=0;
 const read=reader([],{lookupImpl:async()=>{dns++;return [];} });for(const url of urls)await assert.rejects(()=>read(url),safe('invalid_url'));assert.equal(dns,0);
});

test('public literal IP is validated and uses no separate DNS resolution',async()=>{
 const captured=[];const result=await reader([{body:text}],{lookupImpl:async()=>{throw Error('must not resolve literal');}},captured)('http://8.8.8.8/study');assert.equal(result.url,'http://8.8.8.8/study');assert.equal(captured[0].protocol,'http:');assert.equal(captured[0].servername,undefined);assert.equal(captured[0].family,4);
});

test('redirects are bounded, each destination is revalidated, and only the final URL is reported',async()=>{
 const hosts=[],captured=[],read=reader([{status:302,headers:{location:'https://other.example/article'}},{status:307,headers:{location:'/final#fragment'}},{body:text}],{lookupImpl:async host=>{hosts.push(host);return [{address:'8.8.8.8',family:4}];}},captured);
 const result=await read('https://public.example/start');assert.equal(result.url,'https://other.example/final');assert.deepEqual(hosts,['public.example','other.example','other.example']);assert.equal(captured.length,3);assert.ok(captured.every(o=>!o.headers.Authorization&&!o.headers.Cookie&&!o.headers.Referer));
 await assert.rejects(()=>reader(Array(3).fill({status:302,headers:{location:'/next'}}))('https://public.example/'),safe('redirects'));
});

test('redirect to a private address, rebinding answer or signed URL stops before connecting',async()=>{
 let dns=0;const captured=[];
 await assert.rejects(()=>reader([{status:302,headers:{location:'/next'}}],{lookupImpl:async()=>[{address:++dns===1?'8.8.8.8':'127.0.0.1',family:4}]},captured)('https://public.example/'),safe('dns_invalid'));assert.equal(captured.length,1);
 for(const location of ['http://169.254.169.254/latest/meta-data','https://public.example/?sig=synthetic-secret','javascript:alert(1)','https://user:synthetic-secret@other.example/'])await assert.rejects(()=>reader([{status:302,headers:{location}}])('https://public.example/'),safe('invalid_url'));
});

test('PDF, binary, attachment, missing type and compressed bodies are explicitly unsupported',async()=>{
 for(const headers of [{'content-type':'application/pdf'},{'content-type':'application/octet-stream'},{'content-type':''},{'content-type':'text/html','content-disposition':'attachment; filename="article.html"'},{'content-encoding':'gzip'}])await assert.rejects(()=>reader([{body:'private-body',headers}])('https://public.example/a'),safe('unsupported'));
});

test('declared and streamed byte limits stop oversized responses',async()=>{
 await assert.rejects(()=>reader([{headers:{'content-length':String(1024*1024+1)}}])('https://public.example/'),safe('too_large'));
 await assert.rejects(()=>reader([{chunks:[Buffer.alloc(60,'a'),Buffer.alloc(60,'b')]}],{maxResponseBytes:100})('https://public.example/'),safe('too_large'));
});

test('access control and temporary status failures have safe classifications without upstream data',async()=>{
 for(const status of [401,402,403,407])await assert.rejects(()=>reader([{status,body:'private-body synthetic-secret'}])('https://public.example/'),safe('access_restricted'));
 await assert.rejects(()=>reader([{status:429}])('https://public.example/'),safe('rate_limited'));await assert.rejects(()=>reader([{status:500}])('https://public.example/'),safe('http_error'));await assert.rejects(()=>reader([{error:'private-body synthetic-secret'}])('https://public.example/'),safe('transport_failed'));
 for(const body of ['<title>Login - Library</title><body><p>Sign in to read this paper. Please sign in to access the content of this article.</p></body>','<title>Just a moment...</title><body>Checking your browser before continuing, please wait for a moment.</body>','<title>文章</title><body><div class="paywall">本篇论文需要订阅后阅读全文。暂未获得授权的用户无法访问论文完整内容，请先完成订阅。</div></body>'])await assert.rejects(()=>reader([{body,headers:{'content-type':'text/html'}}])('https://public.example/'),safe('access_restricted'));
});

test('UTF-8 and declared GB18030 decoding work; unknown and malformed encodings fail closed',async()=>{
 const gb=Buffer.concat([Buffer.from([0xd6,0xd0,0xce,0xc4]),Buffer.from(' research methods, public source evidence and article comparison only. '.repeat(2))]);
 assert.match((await reader([{chunks:[gb],headers:{'content-type':'text/plain; charset=gb2312'}}])('https://public.example/')).text,/中文/);
 const html=Buffer.concat([Buffer.from('<meta charset="gb18030"><article>'),gb,Buffer.from('</article>')]);assert.match((await reader([{chunks:[html],headers:{'content-type':'text/html'}}])('https://public.example/')).text,/中文/);
 await assert.rejects(()=>reader([{headers:{'content-type':'text/plain; charset=unknown-codec'}}])('https://public.example/'),safe('encoding'));
 await assert.rejects(()=>reader([{chunks:[Buffer.from([0xff,0xff,0xff])]}])('https://public.example/'),safe('encoding'));
});

test('Unicode truncation never splits astral characters and preserves a bounded hash',async()=>{
 const result=await reader([{body:'🧪'.repeat(100)+'some ending'}],{maxTextChars:50})('https://public.example/');assert.equal(Array.from(result.text).length,50);assert.equal(result.text,'🧪'.repeat(50));assert.equal(result.text.length,100);
 await assert.rejects(()=>reader([{body:' ' + '<not enough>'}])('https://public.example/'),safe('empty'));
});

test('aborted operations and DNS timeouts are bounded and return safe errors',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(()=>reader([])('https://public.example/',{signal:controller.signal}),safe('cancelled'));
 const keepAlive=setTimeout(()=>{},500);try{await assert.rejects(()=>reader([],{timeoutMs:20,lookupImpl:()=>new Promise(()=>{})})('https://public.example/'),safe('timeout'));}finally{clearTimeout(keepAlive);}
});

test('safe limits cannot be raised beyond hard ceilings',()=>{
 for(const overrides of [{timeoutMs:10001},{maxRedirects:3},{maxResponseBytes:1024*1024+1},{maxTextChars:50001},{fetchImpl:()=>{}},{timeoutMs:0}])assert.throws(()=>createWebSourceReader(overrides),safe('invalid_configuration'));
});
