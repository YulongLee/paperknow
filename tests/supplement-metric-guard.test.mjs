import test from 'node:test';
import assert from 'node:assert/strict';
import {supplementCheckTask,parseSupplementCheck} from '../backend/supplement-check.mjs';
function check(text,record){const task=supplementCheckTask({phase:'final',chapters:[{id:'c',title:'结果',text}],materials:[{id:'a',name:'原始记录',text:record}]});return parseSupplementCheck({text:JSON.stringify({items:[{id:'c',status:'sufficient',requirement:'结果',reason:'核对记录',manuscriptQuote:text,evidence:[{sourceId:'a',quote:record}],missing:[]}]})},task)[0].status;}
test('numeric metrics cannot pass merely because unrelated sample counts match',()=>{
 for(const wording of ['约为','约等于','大约是'])assert.equal(check(`模型测试准确率${wording}0.99，29条测试样本中正确28条。[source:a]`,'实验记录：测试准确率为0.50，29条测试样本中正确28条。'),'missing');
 assert.equal(check('模型测试准确率达到99，29条测试样本中正确28条。[source:a]','实验记录：测试准确率为50，29条测试样本中正确28条。'),'missing');
 assert.equal(check('模型测试准确率为99%，29条测试样本中正确28条。[source:a]','实验记录：测试准确率为99%，29条测试样本中正确28条。'),'missing');
 assert.equal(check('模型测试准确率为99%，测试集29条样本，28条预测正确。[source:a]','实验记录：测试准确率为99%，测试集29条样本，28条预测正确。'),'missing');
 assert.equal(check('模型在数据集 DATAA 的测试准确率为80%。[source:a]','模型在数据集 DATAB 的测试准确率为80%。'),'missing');
});
test('a citation on the next line cannot be replaced by another source',()=>{
 const text='实测准确率为80%。\n[source:a]',a={id:'a',name:'当前来源',text:'记录显示实测准确率为50%。'},b={id:'b',name:'其他来源',text:'记录显示实测准确率为80%。'},task=supplementCheckTask({phase:'final',chapters:[{id:'c',title:'结果',text}],materials:[a,b]});
 const result=parseSupplementCheck({text:JSON.stringify({items:[{id:'c',status:'sufficient',requirement:'结果',reason:'核对记录',manuscriptQuote:'实测准确率为80%。',evidence:[{sourceId:'b',quote:b.text}],missing:[]}]})},task);assert.equal(result[0].status,'missing');
});
test('planned measurements cannot substantiate a measured result',()=>{
 assert.equal(check('测试准确率为90%。[source:a]','计划测试准确率为90%。'),'missing');
 for(const record of ['并非测试准确率为80%。','测试准确率并非为80%。','测试准确率未达到80%。'])assert.equal(check('测试准确率为80%。[source:a]',record),'missing');
});
test('a selected fragment cannot hide negation in the original sentence',()=>{
 const text='测试准确率为80%。',record='并非测试准确率为80%。',task=supplementCheckTask({phase:'final',chapters:[{id:'c',title:'结果',text}],materials:[{id:'a',name:'原始记录',text:record}]});const result=parseSupplementCheck({text:JSON.stringify({items:[{id:'c',status:'sufficient',requirement:'结果',reason:'核对记录',manuscriptQuote:text,evidence:[{sourceId:'a',quote:'测试准确率为80%'}],missing:[]}]})},task);assert.equal(result[0].status,'missing');
 assert.equal(check('测试准确率为80%。','测试准确率为80%。'),'sufficient');
});
test('simulation proof cannot pass an unlabelled result by adding unrelated real evidence',()=>{
 const text='测试准确率为90%。',sim={id:'s',name:'模拟结果',text:'测试准确率为90%。',dataKind:'simulation'},real={id:'r',name:'其他文献',text:'公开研究资料与这个数字无关。'},task=supplementCheckTask({phase:'final',chapters:[{id:'c',title:'结果',text}],materials:[sim,real]});const result=parseSupplementCheck({text:JSON.stringify({items:[{id:'c',status:'sufficient',requirement:'结果',reason:'核对记录',manuscriptQuote:text,evidence:[{sourceId:'s',quote:sim.text},{sourceId:'r',quote:real.text}],missing:[]}]})},task);assert.equal(result[0].status,'missing');
});
test('English metrics do not silently pass and planned targets are not reported as measured',()=>{
 for(const phrase of ['Test accuracy was 0.99','Test accuracy was approximately 0.99','Test accuracy of 0.99','Test accuracy reached a value of 0.99'])assert.equal(check(phrase+'. [source:a]','Test accuracy was 0.50.'),'missing');
 assert.equal(check('We will use a model, and the observed accuracy was 0.99. [source:a]','Test accuracy was 0.50.'),'missing');
 const text='We will aim for accuracy of 0.90.',record='The plan will aim for accuracy of 0.90.',task=supplementCheckTask({phase:'final',chapters:[{id:'c',title:'Plan',text}],materials:[{id:'a',name:'Plan',text:record}]});const result=parseSupplementCheck({text:JSON.stringify({items:[{id:'c',status:'sufficient',requirement:'Plan',reason:'Plan provided',manuscriptQuote:text,evidence:[{sourceId:'a',quote:record}],missing:[]}]})},task);assert.equal(result[0].status,'sufficient');
});

test('English result passes only an exact unique same-source sentence, never negation, another split or simulation',()=>{
 const text='The test accuracy was 0.95.';assert.equal(check(text,text),'sufficient');
 for(const bad of ['The train accuracy was 0.95.','The test accuracy was 0.50.','Not The test accuracy was 0.95.','The following claim is false:\nThe test accuracy was 0.95.','Planned result:\nThe test accuracy was 0.95.','Simulation only:\nThe test accuracy was 0.95.','The test accuracy was 0.95. (training set only)','The test accuracy was 0.95.\nThe test accuracy was 0.95.','Simulated: The test accuracy was 0.95.'])assert.equal(check(text,bad),'missing',bad);
 const a={id:'a',name:'来源A',text:'The test accuracy was 0.50.'},b={id:'b',name:'来源B',text},cited=text+'[source:a]',task=supplementCheckTask({phase:'final',chapters:[{id:'c',title:'结果',text:cited}],materials:[a,b]});const result=parseSupplementCheck({text:JSON.stringify({items:[{id:'c',status:'sufficient',requirement:'结果',reason:'核对记录',manuscriptQuote:cited,evidence:[{sourceId:'b',quote:text}],missing:[]}]})},task);assert.equal(result[0].status,'missing');
 const simTask=supplementCheckTask({phase:'final',chapters:[{id:'c',title:'结果',text}],materials:[{id:'a',name:'模拟记录',text,dataKind:'simulation'}]});assert.throws(()=>parseSupplementCheck({text:JSON.stringify({items:[{id:'c',status:'sufficient',requirement:'结果',reason:'核对记录',manuscriptQuote:text,evidence:[{sourceId:'a',quote:text}],missing:[]}]})},simTask));
});

test('a future action in a previous clause cannot hide a reported numerical result',()=>{for(const text of ['We will run more trials, but test accuracy was 0.99.','We will run more trials and test accuracy was 0.99.','We will evaluate the system and accuracy is 0.99.','We will use a model where accuracy reached 0.99.'])assert.equal(check(text,'Test accuracy was 0.50.'),'missing',text);});

test('hypothetical source labels cannot support an unqualified English result',()=>{const text='The test accuracy was 0.95.';for(const name of ['Proposed results','Predicted results','Example results','合成数据','演示结果']){const task=supplementCheckTask({phase:'final',chapters:[{id:'c',title:'结果',text}],materials:[{id:'a',name,text}]}),result=parseSupplementCheck({text:JSON.stringify({items:[{id:'c',status:'sufficient',requirement:'结果',reason:'核对记录',manuscriptQuote:text,evidence:[{sourceId:'a',quote:text}],missing:[]}]})},task);assert.equal(result[0].status,'missing',name);}});
