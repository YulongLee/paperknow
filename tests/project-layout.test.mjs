import test from 'node:test';
import assert from 'node:assert/strict';
import {fitProjectRows} from '../dist/workspace/project-layout.mjs';
test('project results expand with available height and shrink when other content occupies it',()=>{
 const measurements={width:1440,height:900,listTop:600,rowHeight:80,footerHeight:180};
 assert.equal(fitProjectRows(measurements),3);
 assert.equal(fitProjectRows({...measurements,height:1600}),10);
 assert.equal(fitProjectRows({...measurements,height:1600,listTop:1000}),5);
});
test('mobile density remains bounded and invalid measurements cannot break rendering',()=>{
 assert.equal(fitProjectRows({width:390,height:2000,listTop:200,rowHeight:80}),5);
 assert.equal(fitProjectRows({width:1440,height:10000,listTop:200,rowHeight:20}),20);
 assert.equal(fitProjectRows({width:1440,height:900,listTop:200,rowHeight:0}),5);
});
