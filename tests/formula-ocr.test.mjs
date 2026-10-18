import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {createFormulaOcrClient,formulaOcrConfigured,formulaOcrLimits,validateFormulaImage,normalizeRecognizedFormula} from '../backend/formula-ocr-client.mjs';
import {createFormulaOcrService} from '../backend/formula-ocr-service.mjs';

const configured={formulaOcrEnabled:true,formulaOcrAccessKeyId:'unit-ocr-id',formulaOcrAccessKeySecret:'unit-ocr-secret'};
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}return(crc^0xffffffff)>>>0;};
function png(width=16,height=16,color=255){
 const chunk=(type,data)=>{const body=Buffer.concat([Buffer.from(type),data]),crc=Buffer.alloc(4),length=Buffer.alloc(4);crc.writeUInt32BE(crc32(body));length.writeUInt32BE(data.length);return Buffer.concat([length,body,crc]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=0;
 const pixels=Buffer.alloc((width+1)*height,color);for(let row=0;row<height;row++)pixels[row*(width+1)]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
const response=(content='x^2+y^2=z^2')=>({statusCode:200,body:{Data:JSON.stringify({content,imageBase64:'upstream-source-never-returned',prism_version:'upstream-internal-version'}),RequestId:'private-trace'}});
const safe=code=>error=>{assert.equal(error.code,code);assert.equal(error.formulaOcrSafe,true);assert.doesNotMatch(error.message,/unit-ocr|secret|aliyun|AccessKey|private-trace/);return true;};
function fixture(t,options={}){
 const db=options.db||new DatabaseSync(':memory:');if(!options.db){db.exec('PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES (\'alice\'),(\'bob\'),(\'carol\');');t.after(()=>db.close());}
 const calls=[],client={ready:true,async recognize(bytes,mime){calls.push({bytes:Buffer.from(bytes),mime});return{latex:'E=mc^2'};},...options.client};
 const config={...configured,...options.config},service=createFormulaOcrService(db,config,{client});
 const image=png();
 const submit=(extra={},user={id:'alice'})=>service.handle({path:'/api/formula-recognitions',method:'POST',user,readBody:async()=>({imageBase64:image.toString('base64'),mime:'image/png',consent:true,expectedUserId:user?.id,idempotencyKey:crypto.randomUUID(),...extra})});
 const get=(id,user={id:'alice'})=>service.handle({path:'/api/formula-recognitions/'+id,method:'GET',user});
 return{db,service,config,client,calls,image,submit,get};
}

test('formula service only enables explicitly configured credentials and the supported HTTPS region',async()=>{
 for(const config of [{},{formulaOcrEnabled:true},{...configured,formulaOcrEnabled:'1'},{...configured,formulaOcrRegion:'cn-shanghai'},{...configured,formulaOcrAccessKeyId:'contains space'},{formulaOcrEnabled:true,ossAccessKeyId:'unit-oss',ossAccessKeySecret:'unit-secret'}]){
  assert.equal(formulaOcrConfigured(config),false);
  const client=createFormulaOcrClient(config,{client:{callApi(){assert.fail('must not call');}}});assert.equal(client.ready,false);await assert.rejects(client.recognize(png(),'image/png'),safe('formula_ocr_not_configured'));
 }
 assert.equal(formulaOcrConfigured(configured),true);
});

test('sends binary stream with correct official action, HTTPS transport and retries disabled',async()=>{
 const calls=[];const client=createFormulaOcrClient(configured,{client:{async callApi(params,request,runtime){const parts=[];for await(const chunk of request.stream)parts.push(chunk);calls.push({params,request,runtime,body:Buffer.concat(parts)});return response('\\[ E=mc^2 \\]');}}});
 const result=await client.recognize(png(),'image/png');assert.deepEqual(result,{latex:'E=mc^2'});assert.doesNotMatch(JSON.stringify(result),/prism|imageBase64|private-trace/);
 const call=calls[0];assert.equal(call.params.action,'RecognizeEduFormula');assert.equal(call.params.version,'2021-07-07');assert.equal(call.params.protocol,'HTTPS');assert.equal(call.params.style,'RPC');assert.equal(call.params.method,'POST');assert.equal(call.params.reqBodyType,'binary');assert.deepEqual(call.body,png());assert.equal(call.request.query,undefined);assert.equal(call.runtime.autoretry,false);assert.equal(call.runtime.maxAttempts,1);assert.equal(call.runtime.ignoreSSL,false);
});

test('image admission checks MIME against actual headers, dimensions, PNG CRC and full chunk boundaries',()=>{
 assert.deepEqual(validateFormulaImage(png(),'image/png'),{width:16,height:16,bytes:png().length,mime:'image/png'});
 for(const [bytes,mime]of [[png(),'image/jpeg'],[Buffer.from('<svg>attack</svg>'),'image/png'],[Buffer.concat([png(),Buffer.from('trailing')]),'image/png'],[png().subarray(0,-1),'image/png'],[png(1001,1),'image/png'],[png(1,1024),'image/png'],[Buffer.alloc(2*1024*1024+1),'image/png'],[png(),'image/gif']])assert.throws(()=>validateFormulaImage(bytes,mime),safe('formula_image_invalid'));
 const bad=Buffer.from(png());bad[20]^=1;assert.throws(()=>validateFormulaImage(bad,'image/png'),safe('formula_image_invalid'));
});

test('JPEG and WebP dimensions are verified and animated WebP is rejected',()=>{
 const jpeg=Buffer.from([255,216,255,192,0,11,8,0,16,0,24,1,1,17,0,255,218,0,8,1,1,0,0,63,0,1,255,217]);
 assert.equal(validateFormulaImage(jpeg,'image/jpeg').width,24);
 const large=Buffer.from(jpeg);large.writeUInt16BE(2000,9);assert.throws(()=>validateFormulaImage(large,'image/jpeg'),safe('formula_image_invalid'));
 const webp=Buffer.alloc(26);webp.write('RIFF');webp.writeUInt32LE(18,4);webp.write('WEBP',8);webp.write('VP8L',12);webp.writeUInt32LE(5,16);webp[20]=47;webp.writeUInt32LE(15|(15<<14),21);
 assert.equal(validateFormulaImage(webp,'image/webp').height,16);const wrong=Buffer.from(webp);wrong[20]=0;assert.throws(()=>validateFormulaImage(wrong,'image/webp'),safe('formula_image_invalid'));
 const animated=Buffer.concat([webp.subarray(0,12),Buffer.from('ANIM'),Buffer.alloc(4)]);animated.writeUInt32LE(animated.length-8,4);assert.throws(()=>validateFormulaImage(animated,'image/webp'),safe('formula_image_invalid'));
});

test('upstream non-success, malformed result and unsafe LaTeX fail closed without raw diagnostics',async()=>{
 for(const value of [{statusCode:403,body:{Message:'unit-ocr-secret'}},{statusCode:200,body:{Code:'noPermission',Data:response().body.Data}},response(''),response('x'.repeat(2001)),response('\\href{https://attacker.invalid}{x}'),response('\\newcommand{\\x}{y}\\x'),response('<script>alert(1)</script>'),{statusCode:200,body:{Data:'{invalid'}}]){
  const client=createFormulaOcrClient(configured,{client:{async callApi(){return value;}}});await assert.rejects(client.recognize(png(),'image/png'),error=>{assert.equal(error.formulaOcrSafe,true);assert.doesNotMatch(error.message,/unit-ocr|secret|attacker|script|noPermission/);return true;});
 }
 const client=createFormulaOcrClient(configured,{client:{async callApi(){throw new Error('AccessKey unit-ocr-secret');}}});await assert.rejects(client.recognize(png(),'image/png'),safe('formula_ocr_unavailable'));
 assert.equal(normalizeRecognizedFormula('$$\\frac{a}{b}$$'),'\\frac{a}{b}');
 assert.equal(normalizeRecognizedFormula('a<b'),'a\\lt b');assert.equal(normalizeRecognizedFormula('x > 0'),'x \\gt  0');
});

test('timeout never retries and retains SDK concurrency until outstanding transport settles',async()=>{
 const pending=[];let calls=0;const client=createFormulaOcrClient({...configured,formulaOcrTimeoutMs:5},{client:{callApi(){calls++;return new Promise(resolve=>pending.push(resolve));}}});
 await assert.rejects(client.recognize(png(),'image/png'),safe('formula_ocr_timeout'));await assert.rejects(client.recognize(png(),'image/png'),safe('formula_ocr_timeout'));await assert.rejects(client.recognize(png(),'image/png'),safe('formula_ocr_busy'));assert.equal(calls,2);
 for(const settle of pending)settle(response());await new Promise(resolve=>setImmediate(resolve));
});

test('known permission and quota failures expose only safe actionable categories',async()=>{
 for(const [code,expected]of [['noPermission','formula_ocr_permission'],['Forbidden.RAM','formula_ocr_permission'],['InvalidAccessKeyId.NotFound','formula_ocr_permission'],['Throttling.User','formula_ocr_busy']]){
  const client=createFormulaOcrClient(configured,{client:{callApi(){throw Object.assign(new Error('unit-ocr-secret private-trace'),{code});}}});
  await assert.rejects(client.recognize(png(),'image/png'),safe(expected));
 }
});

test('service requires login, account match, consent, bounded canonical image and supported fields before invoking provider',async t=>{
 const f=fixture(t);await assert.rejects(f.submit({},null),{status:401});
 for(const [extra,status]of [[{consent:false},400],[{expectedUserId:'bob'},409],[{url:'https://example.invalid'},400],[{imageBase64:'SGVsbG8='},400],[{imageBase64:'x'.repeat(3000000)},400],[{imageBase64:'AAAA\n'},400],[{idempotencyKey:'bad'},400],[{mime:'image/svg+xml'},400]])await assert.rejects(f.submit(extra),{status});
 assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM formula_recognitions').get().n,0);
 const cap=f.service.capabilities();assert.equal(cap.ready,true);assert.equal(cap.maxDimension,1000);assert.doesNotMatch(JSON.stringify(cap),/unit-ocr|aliyun|secret/);
 const disabled=fixture(t,{config:{formulaOcrEnabled:false}});await assert.rejects(disabled.submit(),{status:503});
});

test('same image/key deduplicates durably, alternate key is bound, and records are owner-only',async t=>{
 const f=fixture(t),key=crypto.randomUUID();const one=await f.submit({idempotencyKey:key});assert.equal(one.status,201);assert.equal(one.value.status,'completed');assert.equal(one.value.latex,'E=mc^2');
 const again=await f.submit({idempotencyKey:key}),otherKey=crypto.randomUUID(),alias=await f.submit({idempotencyKey:otherKey});assert.equal(again.value.id,one.value.id);assert.equal(alias.value.id,one.value.id);assert.equal(f.calls.length,1);
 await assert.rejects(f.submit({idempotencyKey:otherKey,imageBase64:png(17,16).toString('base64')}),{status:409});
 await assert.rejects(f.get(one.value.id,{id:'bob'}),{status:404});assert.equal((await f.get(one.value.id)).value.latex,'E=mc^2');
 const afterRestart=fixture(t,{db:f.db,client:{recognize(){assert.fail('no repeat on restart');}}});assert.equal((await afterRestart.submit()).value.id,one.value.id);
 const row=f.db.prepare('SELECT * FROM formula_recognitions').get();assert.equal(row.imageBase64,undefined);assert.doesNotMatch(JSON.stringify(row),new RegExp(f.image.toString('base64')));
});

test('ambiguous failure is safely recorded and never resubmitted with a new key or after restart',async t=>{
 const f=fixture(t,{client:{async recognize(){throw new Error('private upstream AccessKey unit-ocr-secret');}}});
 const one=await f.submit();assert.equal(one.status,503);assert.equal(one.value.status,'failed');assert.doesNotMatch(one.value.error,/private|AccessKey|secret/);
 const resumed=fixture(t,{db:f.db,client:{recognize(){assert.fail('ambiguous call must not be repeated');}}});const again=await resumed.submit();assert.equal(again.value.id,one.value.id);assert.equal(again.value.status,'failed');
});

test('parallel identical content coalesces and independent per-user/global active slots are bounded',async t=>{
 let settle;const f=fixture(t,{client:{recognize(){return new Promise(resolve=>{settle=resolve;});}}});const pending=f.submit();await new Promise(resolve=>setImmediate(resolve));
 const duplicate=await f.submit();assert.equal(duplicate.value.status,'running');
 await assert.rejects(f.submit({imageBase64:png(17,16).toString('base64')}),{status:409});
 let settleBob;const bob=fixture(t,{db:f.db,client:{recognize(){return new Promise(resolve=>{settleBob=resolve;});}}});const second=bob.submit({}, {id:'bob'});await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(bob.submit({}, {id:'carol'}),{status:429});settle({latex:'x=1'});settleBob({latex:'y=2'});await Promise.all([pending,second]);
});

test('durable daily budget survives service restart, and stale unknown calls are never replayed',async t=>{
 const f=fixture(t);for(let i=0;i<formulaOcrLimits.userDaily;i++)assert.equal((await f.submit({imageBase64:png(16+i,16).toString('base64')})).value.status,'completed');
 const resumed=fixture(t,{db:f.db});await assert.rejects(resumed.submit({imageBase64:png(50,16).toString('base64')}),{status:429});
 const old=new Date(Date.now()-300000).toISOString();f.db.prepare("INSERT INTO formula_recognitions VALUES('stale','bob','stale-hash','running',NULL,NULL,?,?)").run(old,old);
 const result=await f.get('stale',{id:'bob'});assert.equal(result.value.status,'failed');assert.match(result.value.error,/不会自动/);
});
