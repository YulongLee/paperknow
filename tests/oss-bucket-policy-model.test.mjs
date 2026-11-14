import test from 'node:test';
import assert from 'node:assert/strict';

// An intentionally limited thought experiment, not Alibaba Cloud's policy evaluator.
// Missing context and every unmodeled OSS operation are unknown, not allowed.
function illustrativeDecision({accessId,listed,operation,identityAllows}) {
 const modeled = ['GetObject', 'PutObject', 'DeleteObject'];
 if (!modeled.includes(operation) || typeof accessId !== 'string' || !accessId) return 'unknown';
 if (!listed.includes(accessId)) return 'deny';
 return identityAllows ? 'allow' : 'implicit-deny';
}
test('illustrative allowlist restricts modeled object operations even with broad identity grant',()=>{
 const listed=['synthetic-backup-key','synthetic-recovery-key'];
 for(const operation of ['GetObject','PutObject','DeleteObject']) {
  assert.equal(illustrativeDecision({accessId:'other-synthetic-key',listed,operation,identityAllows:true}),'deny');
  assert.equal(illustrativeDecision({accessId:'synthetic-backup-key',listed,operation,identityAllows:true}),'allow');
  assert.equal(illustrativeDecision({accessId:'synthetic-backup-key',listed,operation,identityAllows:false}),'implicit-deny');
 }
});
test('missing context and operations outside the model are not treated as proven',()=>{
 const listed=['synthetic-backup-key'];
 assert.equal(illustrativeDecision({accessId:'',listed,operation:'GetObject',identityAllows:true}),'unknown');
 assert.equal(illustrativeDecision({accessId:'other-synthetic-key',listed,operation:'CopyObject',identityAllows:true}),'unknown');
});
