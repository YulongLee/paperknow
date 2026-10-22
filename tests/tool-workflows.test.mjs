import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {toolBanner,toolBannerCategories,updateToolBannerWorkflow} from '../dist/workspace/tool-banner.mjs';
import {getToolWorkflow} from '../dist/workspace/tool-workflows.mjs';
import {writingFlowSpecs} from '../dist/workspace/writing-flow-model.mjs';
import {writingFeatureKeys} from '../dist/workspace/writing-feature-identities.mjs';
import {writingDetailHeading} from '../dist/workspace/writing-catalog.mjs';

test('every workspace category has a collapsed explanatory flow without extra task actions or fake progress',()=>{
 for(const key of Object.keys(toolBannerCategories)){
  const dom=new JSDOM(toolBanner(key,{actions:'<button id="original-action">继续</button>'}));
  try{const doc=dom.window.document,banner=doc.querySelector('header'),guide=banner.querySelector('.tool-banner-workflow');assert.ok(guide,key);assert.ok(guide.querySelectorAll('.tool-workflow-steps > li').length>=3);assert.equal(guide.querySelector('details').open,false);assert.equal(guide.querySelectorAll('button,a,[aria-current]').length,0);assert.equal(doc.querySelectorAll('#original-action').length,1);assert.equal(banner.querySelectorAll('h1').length,1);}finally{dom.window.close();}
 }
});
test('all eleven writing identities select their own flow and existing multi-step forms keep their actual sequence',()=>{
 for(const key of writingFeatureKeys){const dom=new JSDOM(writingDetailHeading(key));try{const banner=dom.window.document.querySelector('header');assert.equal(banner.dataset.workflow,'writing:'+key);if(writingFlowSpecs[key])assert.deepEqual([...banner.querySelectorAll('.tool-workflow-label')].map(node=>node.textContent),writingFlowSpecs[key].steps);}finally{dom.window.close();}}
 assert.equal(getToolWorkflow('writing','writing:writing').steps[1].title,'补充资料（可选）');assert.match(getToolWorkflow('writing','writing:writing').steps[2].detail,/至少一篇/);
});
test('drawing, formulas, data, local comparisons and text identification do not promise each others capabilities',()=>{
 assert.match(JSON.stringify(getToolWorkflow('research')),/描述绘图需求/);assert.doesNotMatch(JSON.stringify(getToolWorkflow('research')),/导入 CSV|导入CSV/);
 assert.match(JSON.stringify(getToolWorkflow('research','research:formula')),/LaTeX/);assert.match(JSON.stringify(getToolWorkflow('research','research:data')),/CSV/);
 assert.match(JSON.stringify(getToolWorkflow('detection','detection:local')),/提供的对照材料/);assert.match(getToolWorkflow('aigc','aigc:detection').note,/不等同于学校/);
 for(const key of ['format:check','format:smart'])assert.equal(getToolWorkflow('format',key).steps[0].title,'选择模板');
});
test('switching an inner feature changes only its guide and leaves headings, actions, draft text and focus intact',()=>{
 const dom=new JSDOM('<main>'+toolBanner('aigc',{actions:'<button id="start">继续</button>'})+'<textarea id="draft">尚未保存的原稿</textarea></main>');
 try{const doc=dom.window.document,banner=doc.querySelector('header'),title=doc.querySelector('h1'),action=doc.querySelector('#start'),draft=doc.querySelector('#draft');draft.focus();draft.setSelectionRange(2,4);updateToolBannerWorkflow(banner,'aigc:detection');assert.equal(banner.dataset.workflow,'aigc:detection');assert.match(banner.querySelector('.tool-banner-workflow').textContent,/分段结果/);assert.equal(doc.querySelector('h1'),title);assert.equal(doc.querySelector('#start'),action);assert.equal(doc.activeElement,draft);assert.equal(draft.value,'尚未保存的原稿');assert.equal(draft.selectionStart,2);const detail=banner.querySelector('details');detail.open=true;updateToolBannerWorkflow(banner,'aigc:detection');assert.equal(banner.querySelector('details'),detail);assert.equal(detail.open,true);updateToolBannerWorkflow(banner,'aigc');assert.equal(banner.querySelector('details').open,false);}finally{dom.window.close();}
});
test('workflow selection cannot inject markup and can be explicitly omitted for non-functional error screens',()=>{
 const dom=new JSDOM(toolBanner('writing',{workflow:'"><script>bad()</script>',title:'<img src=x onerror=bad()>'}));try{assert.equal(dom.window.document.querySelectorAll('script,img').length,0);assert.equal(dom.window.document.querySelector('header').dataset.workflow,'writing');}finally{dom.window.close();}
 assert.doesNotMatch(toolBanner('literature',{workflow:false}),/tool-banner-workflow/);
});
