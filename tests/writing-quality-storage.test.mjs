import test from 'node:test';
import assert from 'node:assert/strict';
import {fitOptionalWritingQuality} from '../backend/writing-quality-storage.mjs';

const report={status:'completed',findings:['大'.repeat(1000)]};
const build=quality=>JSON.stringify({text:'必须保留的正文',...(quality?{quality}:{})});
const guard=limit=>value=>{if(Buffer.byteLength(value)>limit)throw Object.assign(new Error('storage limit'),{status:413});};

test('optional quality retains a full report when the original storage guard permits it',()=>{
 const result=fitOptionalWritingQuality(report,{build,check:guard(10000)});assert.equal(result.quality,report);assert.equal(result.value,build(report));
});

test('a large report falls back to a small explicit incomplete report without changing the manuscript',()=>{
 const result=fitOptionalWritingQuality(report,{build,check:guard(700)}),value=JSON.parse(result.value);assert.equal(value.text,'必须保留的正文');assert.equal(value.quality.status,'unavailable');assert.equal(value.quality.reasonCode,'storage_limit');assert.match(value.quality.limitations.join(''),/正文已保留/);
});

test('if even a compact report cannot fit, the unchanged bare manuscript still passes its original guard',()=>{
 const bare=build(null),result=fitOptionalWritingQuality(report,{build,check:guard(Buffer.byteLength(bare))});assert.equal(result.quality,null);assert.equal(result.value,bare);assert.equal(JSON.parse(result.value).quality,undefined);
});

test('a manuscript that cannot fit continues to fail the original quota instead of bypassing it',()=>{
 assert.throws(()=>fitOptionalWritingQuality(report,{build,check:guard(Buffer.byteLength(build(null))-1)}),error=>error.status===413);
});

test('non-quota errors are never hidden by optional-report fallback',()=>{
 const failure=Object.assign(new Error('database unavailable'),{status:503});assert.throws(()=>fitOptionalWritingQuality(report,{build,check:()=>{throw failure;}}),error=>error===failure);
});
