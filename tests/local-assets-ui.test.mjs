import {withStableView} from '../dist/workspace/view-stability.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {assetCategories,assetCategory,selectAssets} from '../dist/workspace/asset-model.mjs';
import {esc} from '../dist/workspace/ui.mjs';
const source=await readFile(new URL('../dist/workspace/app.mjs',import.meta.url),'utf8');
const functions=['updateAssetTable','renderLocalAssets','updateAssetTableView','renderLocalAssetsView'].map(name=>source.slice(source.indexOf('function '+name+'('),source.indexOf('\nfunction ',source.indexOf('function '+name+'(')))).join('\n');
const assets=[{id:'d1',type:'draft',tool:'writing',title:'写作草稿',kind:'草稿',stamp:3,data:{stage:'draft'}},{id:'p1',type:'draft',tool:'ppt',title:'答辩演示草稿',kind:'演示文稿',stamp:2,data:{stage:'draft'}},{id:'p2',type:'draft',tool:'ppt',title:'答辩演示提纲',kind:'演示草稿',stamp:1,data:{stage:'outline'}}];

test('local asset type, status, query and project filters combine and retain selected controls on rerender',()=>{
 const dom=new JSDOM('<main class="dashboard"></main>',{runScripts:'outside-only'}),w=dom.window;try{
  Object.assign(w,{withStableView,assets:structuredClone(assets),assetCategories,assetCategory,selectAssets,esc,projects:()=>[],icon:()=>'',pageHeading:()=>'',projectAssetIcon:()=>'',assetDate:()=>'',reportError:false,$:selector=>w.document.querySelector(selector),assetTableRow:asset=>'<tr><td><input type="checkbox" data-asset-select="'+esc(asset.id)+'">'+esc(asset.title)+'</td></tr>'});
  w.eval("let assetFilter='draft',assetTypeFilter='all',assetProject='all',assetQuery='',assetSort='updated';"+functions+"\nwindow.assetsTest={render:renderLocalAssets,setStatus:value=>{assetFilter=value;renderLocalAssets();}};");
  const f=w.assetsTest;f.render();assert.match(w.document.querySelector('#asset-count').textContent,/2 份/);
  const all=w.document.querySelector('[data-asset-select-all]');all.checked=true;all.dispatchEvent(new w.Event('change'));assert.equal(w.document.querySelectorAll('[data-asset-select]:checked').length,2);const first=w.document.querySelector('[data-asset-select]');first.checked=false;first.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(all.checked,false);assert.equal(all.indeterminate,true);const type=w.document.querySelector('#asset-type-filter');type.value='presentation';type.dispatchEvent(new w.Event('change'));assert.equal(w.document.querySelector('#asset-count').textContent,'共 1 份成果');assert.equal(w.document.querySelector('[data-asset-select-all]').checked,false);assert.equal(w.document.querySelector('[data-asset-select-all]').indeterminate,false);assert.equal(w.document.querySelector('[data-asset-filter="draft"]').getAttribute('aria-pressed'),'true');assert.match(w.document.querySelector('#asset-table-body').textContent,/答辩演示草稿/);assert.doesNotMatch(w.document.querySelector('#asset-table-body').textContent,/提纲/);
  f.setStatus('pending');assert.equal(w.document.querySelector('#asset-type-filter').value,'presentation');assert.equal(w.document.querySelector('#asset-count').textContent,'共 1 份成果');assert.match(w.document.querySelector('#asset-table-body').textContent,/答辩演示提纲/);
  const query=w.document.querySelector('#asset-query');query.value='没有结果';query.dispatchEvent(new w.Event('input'));assert.match(w.document.querySelector('#asset-table-body').textContent,/没有匹配的成果/);assert.equal(w.document.querySelector('#asset-count').textContent,'共 0 份成果');assert.deepEqual(w.assets,assets);
 }finally{dom.window.close();}
});

test('local recent and backup labels describe actual saved ordering and export scope',()=>{
 assert.match(source,/<h2>最近更新<\/h2><span>继续编辑已保存内容<\/span>/);assert.doesNotMatch(source,/<h2>最近打开<\/h2>/);assert.match(source,/导出此浏览器的工作空间备份/);assert.doesNotMatch(source,/导出本项目的全部成果/);
});
