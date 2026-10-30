import test from 'node:test';
import assert from 'node:assert/strict';
import {retrieveLiteratureMaterials,isReadingFollowUp} from '../dist/workspace/literature-retrieval.mjs';
import {literatureParagraphs} from '../dist/workspace/literature-ai-model.mjs';
import {toolRunPlan,normalizeToolRequest,toolRunTask,validateToolCandidate} from '../backend/tool-run-model.mjs';
const paper=text=>({id:'shared-id',title:'Synthetic literature',scope:'full',text});
test('retrieval finds late evidence beyond the former first twenty paragraphs and preserves exact source identity',()=>{
 const p=paper(Array.from({length:60},(_,i)=>i===57?'The evaluation reports a BLEU score of 28.4 for German translation.':`Paragraph ${i} describes background context.`).join('\n\n'));
 const materials=retrieveLiteratureMaterials(p,'论文的 BLEU 分数是多少？'),parts=literatureParagraphs(p.text);
 assert.ok(materials.some(m=>m.id==='p58'));
 for(const m of materials)assert.equal(m.text,parts.find(p=>p.id===m.id).text);
 assert.ok(materials.length<=6);assert.ok(materials.reduce((n,m)=>n+m.text.length,0)<=5500);
 const value=normalizeToolRequest({kind:'literature',operation:'answer',snapshot:{title:p.title,text:materials.map(m=>m.text).join('\n\n'),materials,question:'BLEU?',context:{answerStrategy:'question-retrieval-v1'}}});
 assert.equal(toolRunPlan(value).length,1);const task=toolRunTask(value,toolRunPlan(value)[0]);assert.doesNotMatch(task.instructions,/chart的全部|演讲备注/);assert.match(task.instructions,/read_material/);
 const candidate={text:JSON.stringify({complete:true,text:'The score is 28.4.',sourceIds:['p58'],citations:[{sourceId:'p58',quote:'BLEU score of 28.4'}]}),trace:[]};
 assert.equal(validateToolCandidate(candidate,value,toolRunPlan(value)[0]).valid,false,'fast answers still require actual material reads');
});
test('Chinese method questions can retrieve English methods and content changes invalidate both index and query cache',()=>{
 const p=paper('# Abstract\n\nThis paper describes an example.\n\n# Model Architecture\n\nThe architecture uses a multi-head attention mechanism and an encoder-decoder model.');
 const first=retrieveLiteratureMaterials(p,'作者采用了什么研究方法？');assert.ok(first.some(m=>m.text.includes('multi-head')));
 first[0].text='mutated caller';assert.ok(retrieveLiteratureMaterials(p,'作者采用了什么研究方法？').every(m=>m.text!=='mutated caller'));
 const changed=paper('# Abstract\n\nA replacement document uses a randomized control experiment.');
 assert.ok(retrieveLiteratureMaterials(changed,'作者采用了什么研究方法？').every(m=>!m.text.includes('attention')));
});
test('follow-up retrieval uses previous question to resolve references but never inserts previous answers as source text',()=>{
 assert.equal(isReadingFollowUp('这篇文献研究了什么问题？'),false);assert.equal(isReadingFollowUp('This paper describes what problem?'),false);assert.equal(isReadingFollowUp('那具体是多少？'),true);
 const p=paper('A training dataset includes 400 samples.\n\nThe limitation is restricted evaluation across domains.\n\nResults include a BLEU score of 28.4.');
 const materials=retrieveLiteratureMaterials(p,'那具体是多少？',{previousQuestion:'BLEU score'});
 assert.ok(materials.some(m=>m.text.includes('28.4')));assert.ok(materials.every(m=>p.text.includes(m.text)));
});
test('retrieval remains bounded for long source paragraphs and treats missing source text as unavailable',()=>{
 const p=paper(Array.from({length:40},(_,i)=>('Results dataset '+i+' ').repeat(200)).join('\n\n'));
 const selected=retrieveLiteratureMaterials(p,'results dataset');assert.ok(selected.length);assert.ok(selected.reduce((n,m)=>n+m.text.length,0)<=5500);
 assert.throws(()=>retrieveLiteratureMaterials({...p,scope:'metadata',text:''},'results'));
});
test('a numbered equation question retrieves the matching mathematical source instead of only the conclusion',()=>{
 const p=paper('# Equations\n\n$$E=mc^2\\tag{1}$$\n\nAn unrelated paragraph about history.\n\n$$a^2+b^2=c^2\\tag{2}$$\n\n# Conclusion\n\nThis is an example conclusion.');
 const materials=retrieveLiteratureMaterials(p,'解释公式 2 中的变量。',{maxSources:1});assert.equal(materials.length,1);assert.match(materials[0].text,/tag\{2\}/);
});
test('answer correction feedback identifies invalid quote length and exact-copy mismatch without changing source requirements',()=>{
 const source='Actual source evidence. '.repeat(40),value=normalizeToolRequest({kind:'literature',operation:'answer',snapshot:{title:'Synthetic',text:source,question:'What is the evidence?'}}),unit=toolRunPlan(value)[0];
 const trace=unit.ranges.map(r=>({tool:'read_material',status:'completed',materialId:r.sourceId,offset:r.start,limit:r.end-r.start})),id=unit.ranges[0].sourceId;
 const candidate=quote=>({text:JSON.stringify({complete:true,text:'The source provides evidence.',sourceIds:[id],citations:[{sourceId:id,quote}]}),trace});
 let check=validateToolCandidate(candidate(source.slice(0,700)),value,unit);assert.equal(check.valid,false);assert.equal(check.feedback.reading.code,'quote_length');assert.equal(check.feedback.reading.maxCharacters,600);
 check=validateToolCandidate(candidate('This quote is not present.'),value,unit);assert.equal(check.valid,false);assert.equal(check.feedback.reading.code,'quote_not_exact');
 assert.equal(validateToolCandidate(candidate('Actual source evidence.'),value,unit).valid,true);
});
