import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument} from '../dist/precheck/engine.mjs';
import {publicWebQueryPlan} from '../dist/precheck/web-query-plan.mjs';

test('a long single paragraph uses the bounded search budget across its length',()=>{
 const text=Array.from({length:12},(_,i)=>String.fromCharCode(65+i).repeat(100)).join('');
 const parsed=parseDocument(text,'Long paragraph');
 const plan=publicWebQueryPlan(parsed,6);
 assert.equal(plan.queries.length,6);
 assert.equal(plan.sampledParagraphs,1);
 assert.equal(plan.queries[0].start,0);
 assert.equal(plan.queries.at(-1).end,1200);
 assert.equal(new Set(plan.queries.map(x=>x.start)).size,6);
 for(const q of plan.queries)assert.equal(q.excerpt,Array.from(text).slice(q.start,q.end).join(''));
 assert.deepEqual(plan,publicWebQueryPlan(parsed,6));
});

test('budget and duplicate windows remain bounded',()=>{
 const parsed=parseDocument('A'.repeat(1200),'Repeated');
 assert.equal(publicWebQueryPlan(parsed,6).queries.length,1);
 assert.equal(publicWebQueryPlan(parsed,0).queries.length,0);
});

test('a long early paragraph does not crowd later short paragraphs out of a fixed query budget',()=>{
 const long=Array.from({length:12},(_,i)=>String.fromCharCode(65+i).repeat(100)).join('');
 const short=Array.from({length:12},(_,i)=>`第${i}个研究对象的来源与研究过程具有不同说明。`.repeat(3));
 const parsed=parseDocument([long,...short].join('\n\n'));
 const plan=publicWebQueryPlan(parsed,6);
 assert.equal(plan.queries.length,6);
 assert.equal(plan.sampledParagraphs,6);
 assert.equal(plan.queries[0].paragraphId,'p-1');
 assert.equal(plan.queries.at(-1).paragraphId,'p-13');
 assert.ok(plan.queries.some(q=>['p-7','p-8'].includes(q.paragraphId)));
});

test('the default plan covers twelve distinct eligible paragraphs without expanding the request budget',()=>{
 const paragraphs=Array.from({length:20},(_,i)=>`第${i}篇研究记录说明用户提供的资料与分析过程应当保留来源信息并审慎核对。`.repeat(3));
 const plan=publicWebQueryPlan(parseDocument(paragraphs.join('\n\n')));
 assert.equal(plan.queries.length,12);assert.equal(plan.sampledParagraphs,12);
 assert.equal(new Set(plan.queries.map(q=>q.paragraphId)).size,12);
 assert.equal(plan.queries[0].paragraphId,'p-1');assert.equal(plan.queries.at(-1).paragraphId,'p-20');
});
