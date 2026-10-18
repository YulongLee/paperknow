import test from 'node:test';
import assert from 'node:assert/strict';
import {accountOverviewItems} from '../dist/workspace/home-account-model.mjs';
test('home continuation includes active account theses and avoids duplicate completed snapshots',()=>{
 const rows=accountOverviewItems({theses:[{id:'paper',title:'实际论文',status:'running',updatedAt:'2026-10-19T02:00:00Z',projectId:'p'}],drafts:[{id:'draft',title:'开题材料',tool:'proposal',updated_at:'2026-10-18T00:00:00Z'}],results:[{id:'snapshot',thesis_id:'paper',type:'agent',created_at:'2026-10-18T23:00:00Z'},{id:'ppt',type:'tool_run',tool_kind:'presentation',tool_operation:'ppt',created_at:'2026-10-17T00:00:00Z'},{id:'web',type:'web_similarity',created_at:'2026-10-16T00:00:00Z'}]}, {proposal:['开题报告']});
 assert.deepEqual(rows.map(row=>row.id),['paper','draft','ppt','web']);assert.equal(rows[0].url,'#thesis/paper');assert.match(rows[0].kind,/生成中/);assert.equal(rows[0].projectId,'p');assert.equal(rows[1].kind,'开题报告');assert.equal(rows[2].tool,'ppt');assert.equal(rows[3].tool,'check');
});
test('historical thesis results remain reachable when outside the recent thesis list',()=>{const rows=accountOverviewItems({results:[{id:'result',thesis_id:'old-paper',type:'agent'}]});assert.equal(rows[0].url,'#thesis/old-paper');assert.equal(rows[0].tool,'writing');assert.deepEqual(accountOverviewItems(),[]);});
