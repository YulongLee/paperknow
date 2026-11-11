import test from 'node:test';
import assert from 'node:assert/strict';
import {formulaPngSize} from '../dist/workspace/research-formula-studio.mjs';

test('formula PNG keeps wide and tall equations proportional within the export bounds',()=>{
 for(const [w,h] of [[600,100],[100,600],[400,400],[1000,1]]){
  const size=formulaPngSize(w,h);
  assert.ok(size.width<=2400&&size.height<=4800&&size.width>0&&size.height>0);
  assert.ok(Math.abs(size.height-size.width*h/w)<=1);
 }
 assert.deepEqual(formulaPngSize(100,600),{width:800,height:4800});
});
test('formula PNG rejects missing image dimensions instead of producing a broken canvas',()=>{
 for(const [w,h] of [[0,10],[10,0],[Infinity,10],[10,NaN]])assert.throws(()=>formulaPngSize(w,h),/尺寸/);
});
