import test from 'node:test';
import assert from 'node:assert/strict';
import {membershipSnapshot} from '../dist/workspace/membership.mjs';
test('membership counts saved records, retaining same-title results and archived projects; unavailable reports are unknown, not zero',()=>{
 const input={projectRows:[{status:'archived'},{status:'active'}],drafts:[{id:1,title:'同名'},{id:2,title:'同名'}],papers:[{id:'p'}],reports:[{id:'r1'},{id:'r2'}]};
 assert.deepEqual(membershipSnapshot(input),{projects:2,assets:4,papers:1,reports:2});
 assert.deepEqual(membershipSnapshot({...input,reportError:true}),{projects:2,assets:null,papers:1,reports:null});
 assert.deepEqual(membershipSnapshot(),{projects:0,assets:0,papers:0,reports:0});
 assert.equal(input.drafts.length,2);
});
