import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {formulaTemplates,formulaSubjects,formulaLevels,formulaFontSizes,formulaEnvironments,formulaSymbolGroups,formulaSymbolReferenceMappings,filterFormulaTemplates,formulaTemplateCategories,formulaCategoryTaxonomy,formulaCategoryCounts,paginateFormulaTemplates,formulaSymbolGlyph,formulaSymbolPreviewSource} from '../dist/workspace/research-formula-catalog.mjs';
import {mountResearchFormulaStudio,formulaStudioDraftKey} from '../dist/workspace/research-formula-studio.mjs';
import JSZip from 'jszip';
import {createFormulaDocx} from '../src/research-formula-document.js';
import {formulaSvgMarkup,formulaMathMLMarkup,unwrapFormulaDelimiters} from '../src/research-formula-core.js';
import {endDraftScope,beginDraftScope,keys,list} from '../dist/workspace/state.mjs';
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(t,options={}){
 endDraftScope();
 const dom=new JSDOM('<main id="studio"></main>',{url:'https://paperknow.test/workspace.html#category/research?mode=formula'});
 for(const key of ['window','document','localStorage','location','DOMParser','XMLSerializer','FormData'])globalThis[key]=dom.window[key];
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 const compiled=[],files=[];
 const renderer={renderFormulaSvg:formula=>{compiled.push(formula);return formulaSvgMarkup(formula).markup;},renderFormulaMathML:formula=>formulaMathMLMarkup(formula).markup,unwrapFormulaDelimiters,createFormulaDocx};
 options.setup?.();
 const studio=mountResearchFormulaStudio({container:dom.window.document.querySelector('#studio'),loadRenderer:async()=>renderer,downloadFile:async(...args)=>files.push(args),...options});
 t.after(()=>{studio.dispose();endDraftScope();dom.window.close();});
 const q=selector=>dom.window.document.querySelector(selector);
 return {dom,studio,compiled,files,q,all:selector=>[...dom.window.document.querySelectorAll(selector)],set(selector,value,type='change'){const node=q(selector);node.value=value;node.dispatchEvent(new dom.window.Event(type,{bubbles:true}));}};
}
test('curated library has four school stages and substantive coverage in every subject',()=>{
 assert.ok(formulaTemplates.length>=280);
 const ids=new Set(),expressions=new Set();
 for(const item of formulaTemplates){assert.ok(!ids.has(item.id),item.id);ids.add(item.id);assert.ok(formulaSubjects.some(([id])=>id===item.subject));assert.ok(formulaLevels.some(([id])=>id===item.level));assert.ok(item.formula.length<2000);assert.ok(item.description.trim());expressions.add(item.formula);}
 assert.equal(expressions.size,formulaTemplates.length,'different records must describe different relationships');
 for(const subject of ['math','physics','chemistry','statistics'])assert.ok(filterFormulaTemplates({subject}).length>=35,subject);
 for(const level of ['primary','junior','high','university'])assert.ok(filterFormulaTemplates({level}).length>=20,level);
 assert.equal(formulaSymbolGroups.find(item=>item.id==='chem-elements').tokens.length,118);
});
test('catalog search, categories and bounded pagination compose without fabricating matches',()=>{
 assert.equal(filterFormulaTemplates({query:'三角形 面积'})[0].id,'triangle');
 assert.equal(filterFormulaTemplates({subject:'chemistry',level:'primary'}).length,0);
 const chemistry=formulaTemplateCategories({subject:'chemistry',level:'university'});
 assert.ok(chemistry.includes('电化学'));assert.ok(!chemistry.includes('平面图形'));
 const first=paginateFormulaTemplates({pageSize:6}),second=paginateFormulaTemplates({page:2,pageSize:6});
 assert.equal(first.items.length,6);assert.equal(second.items.length,6);assert.ok(!first.items.some(row=>second.items.includes(row)));
 assert.equal(paginateFormulaTemplates({query:'no_such_formula',page:900}).page,1);
 assert.equal(paginateFormulaTemplates({page:Infinity}).page,Math.ceil(formulaTemplates.length/10));
 assert.equal(paginateFormulaTemplates({pageSize:5000}).pageSize,50);
});
test('pages and searches replace only the library, preserve editor and clamp invalid pages',async t=>{
 const f=fixture(t,{initialFormula:'x=7'});await settle();
 const editor=f.q('[data-fs-editor]'),preview=f.q('[data-fs-preview]');
 assert.equal(f.all('[data-fs-template]').length,10);assert.equal(f.q('[data-fs-page="previous"]').disabled,true);
 f.q('[data-fs-page="next"]').click();assert.equal(f.q('[data-fs-page-input]').value,'2');assert.equal(f.q('[data-fs-template]').dataset.fsTemplate,formulaTemplates[10].id);
 assert.equal(f.q('[data-fs-editor]'),editor);assert.equal(f.q('[data-fs-preview]'),preview);assert.equal(editor.value,'x=7');
 f.set('[data-fs-page-input]','99999');assert.equal(f.q('[data-fs-page-input]').value,String(Math.ceil(formulaTemplates.length/10)));assert.equal(f.q('[data-fs-page="next"]').disabled,true);
 f.set('[data-fs-search]','卡诺','input');assert.equal(f.q('[data-fs-page-input]').value,'1');assert.equal(f.all('[data-fs-template]').length,1);assert.equal(f.q('[data-fs-template]').dataset.fsTemplate,'carnot-efficiency');
 f.set('[data-fs-search]','','input');f.set('[data-fs-page-size]','6');assert.equal(f.all('[data-fs-template]').length,6);assert.equal(editor.value,'x=7');
});
test('school stage changes available categories and resets a no-longer-valid category',async t=>{
 const f=fixture(t);f.set('[data-fs-subject]','math');f.set('[data-fs-level]','university');
 assert.ok(f.all('[data-fs-category] option').some(node=>node.value==='矩阵与线性代数'));
 f.set('[data-fs-category]','矩阵与线性代数');f.set('[data-fs-level]','primary');
 assert.equal(f.q('[data-fs-category]').value,'all');assert.ok(!f.all('[data-fs-category] option').some(node=>node.value==='矩阵与线性代数'));
 assert.ok(f.all('[data-fs-template]').length>0);
});
test('formula symbols are searchable, insert at selection and maintain actual recent usage',async t=>{
 const f=fixture(t,{initialFormula:'x='});await settle();const editor=f.q('[data-fs-editor]');editor.setSelectionRange(2,2);
 f.q('[data-fs-tab="symbols"]').click();assert.equal(f.q('[data-fs-symbol-filter]').hidden,false);assert.ok(f.all('[data-fs-template-filter]').every(node=>node.hidden));
 f.set('[data-fs-library-group]','chem-ions');f.set('[data-fs-search]','钙','input');assert.equal(f.all('[data-fs-library-token]').length,1);
 const entry=f.q('[data-fs-library-token]');entry.click();assert.equal(editor.value,'x=\\mathrm{Ca}^{2+}');
 f.q('[data-fs-group="recent"]').click();assert.equal(f.all('[data-fs-token]').length,1);assert.match(f.q('[data-fs-symbols]').textContent,/钙离子/);
 f.q('[data-fs-action="undo"]').click();assert.equal(editor.value,'x=');
 f.q('[data-fs-tab="templates"]').click();assert.equal(f.q('[data-fs-symbol-filter]').hidden,true);assert.ok(f.all('[data-fs-template-filter]').every(node=>!node.hidden));
});
test('environment insertion and wrapping selected code preserve undo and compiler validity',async t=>{
 const f=fixture(t,{initialFormula:'x+1'});await settle();const editor=f.q('[data-fs-editor]');editor.setSelectionRange(0,3);
 f.set('[data-fs-wrap]','sqrt');assert.equal(editor.value,'\\sqrt{x+1}');await settle();assert.ok(f.q('[data-fs-preview] svg'));
 f.q('[data-fs-action="undo"]').click();assert.equal(editor.value,'x+1');
 editor.setSelectionRange(0,3);f.set('[data-fs-environment]','aligned');assert.match(editor.value,/\\begin\{aligned\}/);await settle();assert.equal(f.q('[data-fs-error]').hidden,true);
});
test('numbering is visual, exported correctly and reset without injecting tag commands',async t=>{
 const f=fixture(t,{initialFormula:'E=mc^2'});await settle();
 f.set('[data-fs-numbering]','right');f.set('[data-fs-number]','7');await settle();
 assert.ok(f.compiled.includes('E=mc^2\\qquad(7)'));assert.equal(f.studio.getState().formula,'E=mc^2');assert.equal(f.studio.getState().style.equationNumber,7);
 f.q('[data-fs-action="txt"]').click();await settle();assert.equal(f.files[0][1],'E=mc^2');
 f.q('[data-fs-action="number-reset"]').click();await settle();assert.equal(f.q('[data-fs-number]').value,'1');assert.ok(f.compiled.includes('E=mc^2\\qquad(1)'));assert.equal(f.q('[data-fs-editor]').value,'E=mc^2');
 f.set('[data-fs-number]','9999');assert.equal(f.q('[data-fs-number]').value,'999');
});
test('saved display preferences restore inside the original account scope without shared local writes',async t=>{
 const shared=JSON.stringify({formula:'shared'}),f=fixture(t,{initialFormula:'x_A',initialId:'a',setup(){localStorage.setItem(formulaStudioDraftKey,shared);beginDraftScope({ownerId:'alice',drafts:[{id:'a',tool:'research',formula:'x_A',formulaStyle:{font:'bold',size:40,ink:'#123456',numbering:true,equationNumber:3}}]});}});
 await settle();assert.equal(f.q('[data-fs-font]').value,'bold');assert.equal(f.q('[data-fs-numbering]').value,'right');assert.equal(f.q('[data-fs-number]').value,'3');
 f.set('[data-fs-number]','9');await settle();f.q('[data-fs-action="save"]').click();assert.equal(list(keys.drafts)[0].formulaStyle.equationNumber,9);assert.equal(localStorage.getItem(formulaStudioDraftKey),shared);
 f.studio.dispose();endDraftScope();beginDraftScope({ownerId:'bob'});f.set('[data-fs-page-input]','2');assert.equal(f.q('[data-fs-page-input]').value,'2','a detached listener must not rewrite a different owner view');assert.equal(localStorage.getItem(formulaStudioDraftKey),shared);
});

test('all observed mathematics and physics categories have real deduplicated results and accurate counts',()=>{
 for(const [subject,size] of [['math',65],['physics',10]]){
  assert.equal(formulaCategoryTaxonomy[subject].length,size);
  const counts=formulaCategoryCounts({subject});
  assert.deepEqual(counts.map(item=>item.value),formulaCategoryTaxonomy[subject]);
  for(const {value,count}of counts){const rows=filterFormulaTemplates({subject,category:value});assert.ok(count>0,value);assert.equal(rows.length,count);assert.equal(new Set(rows.map(item=>item.id)).size,rows.length);}
 }
 const painleve=filterFormulaTemplates({subject:'math',category:'皮安诺函数（Painlevé 超越函数）'});
 assert.ok(painleve.length>0);assert.ok(painleve.every(item=>item.topics.includes('Painlevé 超越函数（潘勒韦）')));
 assert.ok(filterFormulaTemplates({query:'皮安诺'}).length>0);
 const math=filterFormulaTemplates({subject:'math'});assert.equal(new Set(math.map(item=>item.id)).size,math.length);
});

test('all observed chemistry categories have actual entries while retaining useful calculation topics',()=>{
 assert.equal(formulaCategoryTaxonomy.chemistry.length,41);
 const counts=formulaCategoryCounts({subject:'chemistry'});
 for(const category of formulaCategoryTaxonomy.chemistry){const item=counts.find(row=>row.value===category);assert.ok(item?.count>0,category);assert.equal(item.count,filterFormulaTemplates({subject:'chemistry',category}).length);}
 assert.ok(counts.some(item=>item.value==='化学热力学'));assert.ok(counts.some(item=>item.value==='溶液'));
});
test('actual MathML copy and file exports preserve structured formula and account ownership',async t=>{
 const copied=[],f=fixture(t,{initialFormula:'\\frac{a_1}{b^2}',setup(){beginDraftScope({ownerId:'alice'});}});
 Object.defineProperty(f.dom.window.navigator,'clipboard',{value:{writeText:async value=>copied.push(value)},configurable:true});
 await settle();f.q('[data-fs-action="copy-mathml"]').click();await settle();
 assert.equal(copied.length,1);assert.match(copied[0],/<mfrac>/);assert.match(copied[0],/<msub>/);assert.match(copied[0],/<msup>/);
 assert.match(copied[0],/xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML"/);assert.doesNotMatch(copied[0],/<svg|href=|<script/);
 f.q('[data-fs-action="mml"]').click();await settle();
 assert.equal(f.files.length,1);assert.match(f.files[0][0],/\.mml$/);assert.match(f.files[0][2],/^application\/mathml\+xml/);assert.equal(f.files[0][3].expectedUserId,'alice');assert.equal(f.files[0][3].sourceType,'research');
});
test('rich MathML copy supplies safe HTML and plain XML without assuming a Word paste result',async t=>{
 const copied=[],f=fixture(t,{initialFormula:'x^2'});class Item{constructor(types){this.types=types;}static supports(){return false;}}
 Object.defineProperty(f.dom.window,'ClipboardItem',{value:Item,configurable:true});
 Object.defineProperty(f.dom.window.navigator,'clipboard',{value:{write:async values=>copied.push(values)},configurable:true});
 await settle();f.q('[data-fs-action="copy-mathml"]').click();await settle();
 assert.equal(copied.length,1);assert.deepEqual(Object.keys(copied[0][0].types),['text/html','text/plain']);assert.equal(copied[0][0].types['text/html'].type,'text/html');
});
test('late MathML rendering cannot copy or export after account scope changes',async t=>{
 let resolve;const pending=new Promise(r=>resolve=r),copied=[],f=fixture(t,{initialFormula:'x_{Alice}',setup(){beginDraftScope({ownerId:'alice'});},loadRenderer:()=>pending});
 Object.defineProperty(f.dom.window.navigator,'clipboard',{value:{writeText:async value=>copied.push(value)},configurable:true});
 f.q('[data-fs-action="mml"]').click();await settle();f.studio.dispose();endDraftScope();beginDraftScope({ownerId:'bob'});f.q('#studio').textContent='Bob';
 resolve({renderFormulaSvg:formula=>formulaSvgMarkup(formula).markup,renderFormulaMathML:formula=>formulaMathMLMarkup(formula).markup});await settle();
 assert.equal(copied.length,0);assert.equal(f.files.length,0);assert.equal(f.q('#studio').textContent,'Bob');
});

test('all 26 observed mathematical environments include valid standalone argument scaffolds',()=>{
 assert.equal(formulaEnvironments.length,26);assert.equal(new Set(formulaEnvironments.map(item=>item.id)).size,26);
 for(const item of formulaEnvironments){assert.match(formulaSvgMarkup(item.formula).markup,/<svg/);assert.match(formulaMathMLMarkup(item.formula).markup,/<math/);}
 assert.match(formulaEnvironments.find(item=>item.id==='alignat').formula,/\\begin\{alignat\}\{2\}/);
 for(const alignment of ['l','c','r'])assert.match(formulaEnvironments.find(item=>item.id==='array-'+alignment).formula,new RegExp('\\\\begin\\{array\\}\\{'+alignment+'\\}'));
});
test('the four math source wrappers keep original LaTeX while typography and preview remain valid',async t=>{
 const f=fixture(t,{initialFormula:'x+1'});await settle();const editor=f.q('[data-fs-editor]');
 const pairs=[['inline-dollar','$x+1$'],['inline-paren','\\(x+1\\)'],['display-dollar','$$x+1$$'],['display-bracket','\\[x+1\\]']];
 for(const [choice,expected]of pairs){f.set('[data-fs-wrap]',choice);await settle();assert.equal(editor.value,expected);assert.equal(f.q('[data-fs-error]').hidden,true);assert.ok(f.q('[data-fs-preview] svg'));}
 f.set('[data-fs-font]','bold');f.set('[data-fs-numbering]','right');await settle();assert.equal(f.q('[data-fs-error]').hidden,true);
 f.q('[data-fs-action="txt"]').click();await settle();assert.equal(f.files[0][1],'\\[x+1\\]');assert.equal(f.q('[data-fs-editor]'),editor);
});
test('capture silently preserves existing account formula style before the parent saves it',async t=>{
 const notices=[],f=fixture(t,{initialFormula:'x_A',initialId:'a',ctx:{notify:message=>notices.push(message)},setup(){beginDraftScope({ownerId:'alice',drafts:[{id:'a',tool:'research',formula:'x_A',requirements:''}]});}});
 await settle();f.set('[data-fs-font]','bold');f.set('[data-fs-numbering]','right');f.set('[data-fs-number]','6');f.studio.capture();
 const saved=list(keys.drafts)[0];assert.equal(saved.formulaStyle.font,'bold');assert.equal(saved.formulaStyle.equationNumber,6);assert.equal(saved.formula,'x_A');assert.deepEqual(notices,[]);
 endDraftScope();beginDraftScope({ownerId:'bob',drafts:[]});f.studio.capture();assert.deepEqual(list(keys.drafts),[]);
});
test('style changes cancel a delayed rich clipboard fallback and prevent stale delivery',async t=>{
 let rejectRich;const rich=new Promise((_resolve,reject)=>rejectRich=reject),fallback=[],f=fixture(t,{initialFormula:'x^2'});
 class Item{constructor(types){this.types=types;}static supports(){return false;}}
 Object.defineProperty(f.dom.window,'ClipboardItem',{value:Item,configurable:true});Object.defineProperty(f.dom.window.navigator,'clipboard',{value:{write:()=>rich,writeText:async value=>fallback.push(value)},configurable:true});
 await settle();f.q('[data-fs-action="copy-mathml"]').click();await settle();f.set('[data-fs-numbering]','right');rejectRich(Error('permission changed'));await settle();assert.deepEqual(fallback,[]);assert.equal(f.files.length,0);
});
test('Word export delivers a real editable native OMML document through the original owner',async t=>{
 const f=fixture(t,{initialFormula:'\\frac{x_1}{y^2}',setup(){beginDraftScope({ownerId:'alice'});}});await settle();
 f.q('[data-fs-action="docx"]').click();for(let i=0;i<100&&!f.files.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(f.files.length,1);assert.match(f.files[0][0],/\.docx$/);assert.equal(f.files[0][3].expectedUserId,'alice');
 const archive=await JSZip.loadAsync(await f.files[0][1].arrayBuffer()),document=await archive.file('word/document.xml').async('string');
 assert.match(document,/<m:oMath/);assert.match(document,/<m:f>/);assert.match(document,/<m:sSub>/);assert.match(document,/<m:sSup>/);assert.doesNotMatch(document,/<w:drawing|altChunk|<img/);assert.ok(!Object.keys(archive.files).some(name=>name.startsWith('word/media/')));
});

test('symbol thumbnails use exact native glyphs or valid placeholder-aware mathematical structures',()=>{
 assert.equal(formulaSymbolGlyph('\\alpha'),'α');assert.equal(formulaSymbolGlyph('\\mathrm{He}'),'He');assert.equal(formulaSymbolGlyph('\\frac{}{}'),null);
 assert.equal(formulaSymbolPreviewSource('\\frac{}{}'),'\\frac{\\Box}{\\Box}');assert.equal(formulaSymbolPreviewSource('_{}'),'\\Box_{\\Box}');assert.equal(formulaSymbolPreviewSource('\\,'),'a\\,{}b');
 for(const group of formulaSymbolGroups)for(const [,token]of group.tokens){if(formulaSymbolGlyph(token)!==null)continue;assert.match(formulaSvgMarkup(formulaSymbolPreviewSource(token)).markup,/<svg/);}
});
test('selected symbols show real mathematical previews and retain accessible insertion labels without raw-code clutter',async t=>{
 const f=fixture(t,{initialFormula:'x='});await settle();
 const first=f.q('[data-fs-token="0"]');assert.equal(first.getAttribute('aria-label'),'插入分数');assert.equal(first.title,'\\frac{}{}');assert.equal(f.q('[data-fs-symbols] code'),null);assert.ok(first.querySelector('svg'));assert.doesNotMatch(first.textContent,/\\frac/);
 const editor=f.q('[data-fs-editor]');editor.setSelectionRange(2,2);first.click();assert.equal(editor.value,'x=\\frac{}{}');
 f.q('[data-fs-tab="symbols"]').click();f.set('[data-fs-library-group]','operators');await settle();assert.ok(f.q('[data-fs-library-preview] .fs-symbol-glyph'));assert.equal(f.q('.fs-symbol-result code'),null);
});
test('all 118 element buttons use precise lightweight native chemical symbols without 118 SVG compiles',async t=>{
 const f=fixture(t);await settle();const before=f.compiled.length;f.q('[data-fs-group="chem-elements"]').click();await settle();
 assert.equal(f.all('[data-fs-token]').length,118);assert.equal(f.q('[data-fs-symbols] svg'),null);assert.equal(f.q('[data-fs-symbols] .fs-symbol-glyph').textContent,'H');assert.equal(f.compiled.length,before);
});
test('a late symbol renderer cannot overwrite the subsequently selected element group',async t=>{
 let resolve;const pending=new Promise(r=>resolve=r),f=fixture(t,{loadRenderer:()=>pending});
 f.q('[data-fs-group="chem-elements"]').click();assert.equal(f.all('[data-fs-token]').length,118);
 resolve({renderFormulaSvg:formula=>formulaSvgMarkup(formula).markup,renderFormulaMathML:formula=>formulaMathMLMarkup(formula).markup,unwrapFormulaDelimiters,createFormulaDocx});await settle();
 assert.equal(f.all('[data-fs-token]').length,118);assert.equal(f.q('[data-fs-symbols] .fs-symbol-glyph').textContent,'H');assert.equal(f.q('[data-fs-symbols] svg'),null);
});


test('every observed toolbar item has an actual supported insertion and corrected scientific meaning',()=>{
 const referenceCounts=[31,51,33,40,39,52,34,16,64,28,33,35,80,27];
 const grouped=new Map();
 for(const mapping of formulaSymbolReferenceMappings){
  if(!grouped.has(mapping.referenceGroup))grouped.set(mapping.referenceGroup,[]);grouped.get(mapping.referenceGroup).push(mapping);
  const group=formulaSymbolGroups.find(item=>item.id===mapping.groupId);assert.ok(group,mapping.referenceLabel);
  assert.ok(group.tokens.some(([,token])=>token===mapping.token),mapping.referenceLabel);
  assert.doesNotThrow(()=>formulaSvgMarkup(formulaSymbolPreviewSource(mapping.token)),mapping.referenceLabel);
  assert.doesNotThrow(()=>formulaMathMLMarkup(formulaSymbolPreviewSource(mapping.token)),mapping.referenceLabel);
 }
 assert.equal(formulaSymbolReferenceMappings.length,563);assert.deepEqual([...grouped.values()].map(items=>items.length),referenceCounts);
 for(const items of grouped.values())assert.deepEqual(items.map(item=>item.referenceIndex),Array.from({length:items.length},(_,index)=>index));
 for(const group of formulaSymbolGroups)assert.equal(new Set(group.tokens.map(([,token])=>token)).size,group.tokens.length,group.id);
 for(const mapping of formulaSymbolReferenceMappings.filter(item=>item.referenceLabel==='四重积分 ∯')){assert.ok(mapping.correctionNote);assert.equal(mapping.token,'\\iiiint_D');}
 const functions=formulaSymbolReferenceMappings.filter(item=>item.groupId==='functions');assert.equal(functions.length,64);
 for(const mapping of functions.filter(item=>/^反/.test(item.referenceLabel)))assert.doesNotMatch(mapping.token,/\\frac/,'inverse functions must not become reciprocals');
 assert.equal(formulaSymbolReferenceMappings.find(item=>item.referenceLabel==='大写西格玛 Ξ').token,'\\Xi');
 assert.match(formulaSymbolReferenceMappings.find(item=>item.referenceLabel.includes('中子')).token,/1.*0.*n/);
});

test('all ten named font sizes restore, apply and remain bounded including previous saved sizes',async t=>{
 assert.deepEqual(formulaFontSizes.map(([,label])=>label),['极小','脚本大小','脚注大小','小','正常','略大','大','更大','巨大','特大']);
 const f=fixture(t,{initialFormula:'x^2'});await settle();assert.equal(f.all('[data-fs-size] option').length,10);
 for(const [value,label] of formulaFontSizes){f.set('[data-fs-size]',String(value));assert.equal(f.studio.getState().style.size,value,label);assert.equal(f.q('[data-fs-preview]').style.getPropertyValue('--formula-size'),value+'px');}
 f.set('[data-fs-size]','900');assert.equal(f.studio.getState().style.size,32);
 f.set('[data-fs-size]','72');f.studio.capture();f.q('[data-fs-action="save"]').click();
 assert.equal(list(keys.drafts)[0].formulaStyle.size,72);
});
