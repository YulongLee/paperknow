import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeToolRequest} from '../backend/tool-run-model.mjs';
import {pptMasterDesignPlan,validatePptMasterVisibleText} from '../backend/ppt-master-model.mjs';
import {validatedPresentationLayout} from '../backend/presentation-layout.mjs';
import {validatePptMasterSvg} from '../backend/ppt-master-runtime.mjs';
const make=(language='中文',theme='academic')=>{
 const value=normalizeToolRequest({kind:'presentation',operation:'ppt',snapshot:{title:'Synthetic & 合成汇报',text:'所有内容来自明确给出的合成材料，不新增事实。',language,mode:'thesis',context:{pages:12,theme,author:'合成作者 <测试>'}}}),slides=Array.from({length:12},(_,index)=>({id:'slide-'+(index+1),title:index===0?'Synthetic & 合成汇报':index===11?'总结与核对':'研究方法与流程 '+(index+1),body:language==='英文'?'Synthetic <source> & review [1]\nPreserve 3.5 mg/mL and x = 2y\nNo new findings are added.':'保留原始材料中的 3.5 mg/mL 与引用 [1]\n核对流程与证据边界，不新增研究结果\n检查 <结构>、& 符号和全部原始标点',notes:'只使用给出的合成资料，不补充真实研究结果。',layout:index===0?'cover':index===11?'closing':index%3===0?'twoColumn':'content'})),plan=pptMasterDesignPlan(value,slides);
 return{value,slides,plan};
};
test('validated layouts cover both languages and all themes without dropping immutable content or accepting external SVG',()=>{
 for(const language of ['中文','英文'])for(const theme of ['academic','formal','focus','slate','indigo','sand']){const {value,slides,plan}=make(language,theme);for(const slide of slides){const page=validatedPresentationLayout(value,slide,plan);assert.equal(page.layoutMethod,'validated');assert.equal(page.body,slide.body);assert.equal(page.notes,slide.notes);assert.deepEqual(page.authorSourceIds,[]);assert.equal(validatePptMasterSvg(page.svg),page.svg);assert.equal(validatePptMasterVisibleText(page.svg,slide,plan),true);assert.doesNotMatch(page.svg,/<image|<script|foreignObject|href=/);}}
});
test('long titles and full-length author metadata reflow while impossible page density fails without truncation',()=>{
 const {value,slides,plan}=make();slides[0].title='标题'.repeat(50);plan.metadata.author='作者'.repeat(50);assert.equal(validatedPresentationLayout(value,slides[0],plan).title,slides[0].title);
 slides[1].body='密'.repeat(1400);assert.throws(()=>validatedPresentationLayout(value,slides[1],plan),error=>error.code==='ppt_layout_capacity');
});
export {make};
