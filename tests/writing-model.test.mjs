import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOutline,reconcileSections,composeBody} from '../dist/workspace/writing-model.mjs';
const info={title:'课堂反馈研究',mode:'毕业论文',degree:'本科',major:'教育学',targetWords:'8000',method:'访谈',requirements:'使用真实数据'};
test('template includes user requirements but makes no claim to AI or reference analysis',()=>{const text=buildOutline(info);assert.ok(text.includes('目标字数：8000 字'));assert.ok(text.includes('研究方法：访谈'));assert.ok(text.includes('未调用 AI 或分析参考材料'));});
test('reordered outline retains exact chapter text and removed written chapters stay recoverable',()=>{const old=[{id:'a',title:'第一章 绪论',text:'已有背景内容'},{id:'b',title:'第二章 方法',text:'真实方法'},{id:'c',title:'第三章 结果',text:''}];const result=reconcileSections('第二章 方法\n第一章 研究背景',old);assert.equal(result[0].id,'b');assert.equal(result[0].text,'真实方法');assert.equal(result.at(-1).id,'a');assert.equal(result.at(-1).retained,true);assert.equal(result.at(-1).text,'已有背景内容');assert.equal(old[0].retained,undefined);});
test('export contains only written chapters without fabricating empty research results',()=>{const text=composeBody(info,[{title:'第一章 绪论',text:'用户填写的正文'},{title:'第二章 结果',text:''}]);assert.ok(text.includes('用户填写的正文'));assert.ok(!text.includes('第二章 结果'));assert.equal(reconcileSections('自定义大纲')[0].title,'正文');});

test('body-stage writing assets stay in the writing research stage',async()=>{const {researchStage}=await import('../dist/workspace/overview-model.mjs');assert.equal(researchStage({type:'draft',tool:'writing',data:{stage:'body',text:'已写正文'}}),'writing');});
