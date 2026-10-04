import test from 'node:test';
import assert from 'node:assert/strict';
import {recentAssets,researchStage} from '../dist/workspace/overview-model.mjs';
const draft=(id,text,extra={})=>({id:String(id),title:'同名研究',type:'draft',tool:'writing',projectId:'p',data:{text,stage:'outline'},...extra});
test('identical saved content is grouped without mutating or losing distinct versions',()=>{const rows=[draft(3,'新版'),draft(2,'旧版'),draft(1,'旧版')];assert.deepEqual(recentAssets(rows).map(a=>a.id),['3','2']);assert.equal(rows.length,3);});
test('different projects, tools, requirements and reports retain their identity',()=>{const rows=[draft(1,'正文'),draft(2,'正文',{projectId:'other'}),draft(3,'正文',{data:{text:'正文',stage:'outline',requirements:'不同要求'}}),{id:'r1',type:'report'},{id:'r2',type:'report'}];assert.equal(recentAssets(rows).length,5);});
test('overview filters isolate reports and presentation outlines',()=>{const rows=[draft(1,'正文'),draft(2,'提纲',{tool:'ppt'}),{id:'r',type:'report'}];assert.deepEqual(recentAssets(rows,'writing').map(a=>a.id),['1']);assert.deepEqual(recentAssets(rows,'presentation').map(a=>a.id),['2']);assert.deepEqual(recentAssets(rows,'detection').map(a=>a.id),['r']);});
test('stage derives only from saved content type and does not infer completion',()=>{assert.equal(researchStage(draft(1,'正文')),'outline');assert.equal(researchStage(draft(2,'',{data:{stage:'draft'}})),'writing');assert.equal(researchStage({type:'report'}),'detection');assert.equal(researchStage({tool:'reading'}),null);});
