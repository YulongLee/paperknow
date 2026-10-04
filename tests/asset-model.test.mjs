import test from 'node:test';
import assert from 'node:assert/strict';
import {assetCategory,selectAssets} from '../dist/workspace/asset-model.mjs';
const projects=[{id:'p1',name:'教育研究项目'}];
const assets=[{id:'101',title:'同名论文',kind:'论文大纲',tool:'writing',type:'draft',stamp:10,projectId:'p1',data:{}},{id:'102',title:'同名论文',kind:'论文草稿',tool:'writing',type:'draft',stamp:20,projectId:'',data:{}},{id:'r1',title:'比对结果',kind:'查重报告',tool:'check',type:'report',stamp:30,projectId:'p1',data:{}},{id:'103',title:'文献阅读',kind:'文献研读',tool:'reading',type:'draft',stamp:5,projectId:'',data:{}}];
test('categories distinguish reports, reading, PPT and writing',()=>{assert.equal(assetCategory(assets[2]),'detection');assert.equal(assetCategory(assets[3]),'literature');assert.equal(assetCategory({tool:'ppt',type:'draft'}),'presentation');assert.equal(assetCategory(assets[0]),'writing');});
test('combined filters search project names and preserve separate same-title records',()=>{assert.deepEqual(selectAssets(assets,{query:'教育研究',category:'writing'},projects).map(a=>a.id),['101']);assert.equal(selectAssets(assets,{query:'同名论文'},projects).length,2);assert.deepEqual(selectAssets(assets,{project:'none'},projects).map(a=>a.id),['102','103']);assert.equal(assets.length,4);});
test('sort orders do not mutate the stored results and unmatched query returns empty',()=>{assert.deepEqual(selectAssets(assets,{sort:'created'}).map(a=>a.id),['103','102','101','r1']);assert.deepEqual(assets.map(a=>a.id),['101','102','r1','103']);assert.equal(selectAssets(assets,{query:'不存在'}).length,0);});
