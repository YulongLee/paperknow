import test from 'node:test';
import assert from 'node:assert/strict';
import {computeWritingRunBudget} from '../backend/writing-execution-policy.mjs';
const snapshot={title:'合成综述',profile:{language:'中文',targetWords:800},requirements:{},references:[{id:'a',confirmed:true,text:'公开资料片段'.repeat(2000)},{id:'b',confirmed:true,text:'另一篇公开资料'.repeat(2000)}],materials:[],outline:[]};
const plan=Array.from({length:4},(_,i)=>({id:'s'+i,targetWords:200}));const settings={maxTurns:6,maxOutputTokens:4096};
test('writing token plan funds planned reviews while retaining operator and ledger ceilings',()=>{
 const before=computeWritingRunBudget({snapshot,plan,settings,reviewAllowance:1});
 const planned=computeWritingRunBudget({snapshot,plan,settings,reviewAllowance:8});
 assert.ok(planned>before);assert.ok(planned<=2000000);
 assert.equal(computeWritingRunBudget({snapshot,plan,settings,reviewAllowance:8,config:{writingMaxRunTokens:300000}}),300000);
});
