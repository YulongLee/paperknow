import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {composeIllustrationLabels,normalizeIllustrationLabelLayout,illustrationLabelTask} from '../backend/research-illustration-labels.mjs';
import {createScientificFigure} from '../backend/research-figure-quality.mjs';
import {validateResearchImage,researchIllustrationPrompt} from '../backend/research-image-client.mjs';
import {pngFixture} from './fixtures/research-image.mjs';
import {cantileverArtwork,cantileverPlan,cantileverLocations} from './fixtures/research-cantilever.mjs';
const settings={enabled:true,model:'qwen-image-3.0',apiKey:'sk-private-fixture',version:'test-labels',baseURL:'https://dashscope.aliyuncs.com',timeoutMs:1000};
const snapshot={mode:'professional',title:'Assembly',text:'Four stages and three consistent parts.',language:'English',context:{categoryId:'rendering',figureType:'cinema-4d-02',aspectRatio:'16:9',palette:'academic'}};
const plan={kind:'illustration',artworkDescription:'An unlabeled visual arrangement of the specified parts.',description:'Four assembly stages with a gray base and blue barrel.',requiredObjects:['Base','Barrel'],labels:['Separated','Aligned','Inserted','Assembled','Base & lens <front>']};
const layout=()=>({hasText:false,annotations:plan.labels.map((_,index)=>({index,x:index%2?750:250,y:150+index*150}))});
const passed=()=>({passed:true,checks:['brief_fidelity','scientific_relations','numeric_accuracy','labels_legible','no_overlap_or_clipping','figure_grammar'].map(key=>({key,passed:true,detail:'Exact checked correspondence'}))});
test('generated artwork receives no label whitelist; grounded locations cannot introduce arbitrary model text',()=>{
 const prompt=researchIllustrationPrompt(snapshot,plan);assert.match(prompt,/ZERO text/);assert.doesNotMatch(prompt,/Base & lens|Separated|Assembled/);
 const task=illustrationLabelTask(plan,'data:image/png;base64,fixture');assert.equal(task[1].content[1].image_url.url,'data:image/png;base64,fixture');
 const raw=layout();raw.annotations[0].text='MODEL INVENTED LABEL';const normalized=normalizeIllustrationLabelLayout(raw,plan);assert.equal(normalized[0].text,undefined);
});
test('artwork descriptions are separated from semantic label instructions and preserve the source plan',()=>{
 const source={...plan,description:'Write the stage label Separated in the upper corner.',artworkDescription:'Four identical assemblies in a two by two arrangement.'};
 const prompt=researchIllustrationPrompt(snapshot,source);assert.match(prompt,/Four identical assemblies/);assert.doesNotMatch(prompt,/Write the stage label|Separated/);assert.match(source.description,/Write the stage/);
});
test('label geometry requires complete unique grounded indices and bounded finite coordinates',()=>{
 for(const raw of [{},{hasText:false,annotations:[]},{hasText:false,annotations:layout().annotations.map(a=>({...a,index:0}))},{hasText:false,annotations:layout().annotations.map(a=>({...a,x:NaN}))},{hasText:false,annotations:layout().annotations.map(a=>({...a,y:1001}))}])assert.throws(()=>normalizeIllustrationLabelLayout(raw,plan),{code:'figure_annotation_invalid'});
 assert.throws(()=>normalizeIllustrationLabelLayout({hasText:true,annotations:[]},plan),{code:'figure_artwork_text'});
});
test('local typography preserves exact escaped labels and original canvas size without painting over artwork text',async()=>{
 const original=pngFixture(1600,900),composed=await composeIllustrationLabels(original,plan,normalizeIllustrationLabelLayout(layout(),plan));
 assert.equal(composed.annotations,5);assert.match(composed.labelSvg,/Base &amp; lens &lt;front&gt;/);assert.doesNotMatch(composed.labelSvg,/<front>/);assert.equal((composed.labelSvg.match(/data-label="/g)||[]).length,5);
 const checked=validateResearchImage(composed.buffer);assert.equal(checked.width,1600);assert.equal(checked.height,900);assert.notDeepEqual(composed.buffer,original);
});
test('text-bearing artwork is regenerated internally; the final full review receives the program-labelled image',async()=>{
 let images=0,locations=0,reviews=0;const phases=[];const raw=pngFixture(1600,900),hash=b=>createHash('sha256').update(b).digest('hex');
 const result=await createScientificFigure(snapshot,{settings,jsonRunner:async(messages,{phase})=>{
  phases.push(phase);if(phase==='planning')return{value:{complete:true,figure:plan}};
  if(phase==='label_layout')return{value:++locations===1?{hasText:true,annotations:[]}:layout()};
  reviews++;assert.ok(messages[1].content[1].image_url.url.startsWith('data:image/png;base64,'));return{value:passed()};
 },imageRunner:async(_s,{prompt})=>{images++;assert.match(prompt,/ZERO text/);return{buffer:raw,imageCount:1};}});
 assert.equal(images,2);assert.equal(reviews,1);assert.equal(phases.filter(p=>p==='planning').length,1);assert.equal(result.review.passed,true);assert.notEqual(hash(result.buffer),hash(raw));
});
test('uncertain location data never silently omit required labels or trigger another paid image',async()=>{
 let images=0;await assert.rejects(()=>createScientificFigure(snapshot,{settings,jsonRunner:async(_m,{phase})=>({value:phase==='planning'?{complete:true,figure:plan}:{hasText:false,annotations:[]}}),imageRunner:async()=>{images++;return{buffer:pngFixture(),imageCount:1};}}),{code:'figure_quality_rejected'});assert.equal(images,1);
});
test('legacy plans with embedded lettering instructions are repaired before any image is paid for',async()=>{
 let planning=0,images=0;const {artworkDescription,...legacy}=plan;
 const result=await createScientificFigure(snapshot,{settings,jsonRunner:async(_m,{phase})=>({value:phase==='planning'?{complete:true,figure:++planning===1?legacy:plan}:phase==='label_layout'?layout():passed()}),imageRunner:async()=>{images++;assert.equal(planning,2);return{buffer:pngFixture(),imageCount:1};}});
 assert.equal(result.review.passed,true);assert.equal(planning,2);assert.equal(images,1);
});
test('planning schema repairs cannot consume the two actual image repair attempts',async()=>{
 let planning=0,images=0,reviews=0;const {artworkDescription,...legacy}=plan;
 const result=await createScientificFigure(snapshot,{settings,jsonRunner:async(_m,{phase})=>{
  if(phase==='planning')return{value:{complete:true,figure:++planning<3?legacy:plan}};
  if(phase==='label_layout')return{value:layout()};
  const r=passed();if(phase==='review_confirm'||++reviews===1){r.passed=false;r.checks.find(c=>c.key==='brief_fidelity').passed=false;}return{value:r};
 },imageRunner:async()=>{images++;return{buffer:pngFixture(),imageCount:1};}});
 assert.equal(result.review.passed,true);assert.equal(planning,4);assert.equal(images,2);
});
test('panel titles occupy reserved white bands even when the locator returns object centres',async()=>{
 const p={...plan,layout:'grid',labels:['Separated','Aligned','Inserted','Complete']},l=normalizeIllustrationLabelLayout({hasText:false,annotations:p.labels.map((_,index)=>({index,kind:'panel',x:index%2?750:250,y:index<2?250:750}))},p);
 const output=await composeIllustrationLabels(pngFixture(1600,900),p,l);assert.equal((output.labelSvg.match(/data-panel-label=/g)||[]).length,4);assert.doesNotMatch(output.labelSvg,/data-label-target|<path/);
 const ys=[...output.labelSvg.matchAll(/<text x="[^"]+" y="([^"]+)"/g)].map(m=>Number(m[1]));assert.ok(ys[0]<200&&ys[1]<200);assert.ok(ys[2]>450&&ys[2]<600&&ys[3]>450&&ys[3]<600);
});
test('an independently disproved visual suspicion does not require another paid image',async()=>{
 let images=0;const phases=[];
 const result=await createScientificFigure(snapshot,{settings,jsonRunner:async(_m,{phase})=>{
  phases.push(phase);if(phase==='planning')return{value:{complete:true,figure:plan}};if(phase==='label_layout')return{value:layout()};
  const r=passed();if(phase==='review'){r.passed=false;r.checks[0]={key:'brief_fidelity',passed:false,detail:'Suspected extra component; verify actual visible count'};}if(phase==='review_confirm')assert.ok(!JSON.stringify(_m).includes('Suspected extra component'));return{value:r};
 },imageRunner:async()=>{images++;return{buffer:pngFixture(),imageCount:1};}});
 assert.equal(images,1);assert.equal(result.review.passed,true);assert.ok(phases.includes('review_confirm'));
});
test('cantilever callouts preserve exact index-to-label mapping and avoid full-width leaders',async()=>{
 const raw=await cantileverArtwork(),layout=normalizeIllustrationLabelLayout(cantileverLocations,cantileverPlan),result=await composeIllustrationLabels(raw,cantileverPlan,[...layout].reverse());
 assert.equal(result.strategy,'numbered-callouts');assert.equal(result.manifest.length,4);
 assert.deepEqual(result.manifest.map(m=>[m.id,m.label]),cantileverPlan.labels.map((label,i)=>[i+1,label]));
 for(const m of result.manifest){const distance=Math.hypot((m.marker.x-m.target.x)*1.6,(m.marker.y-m.target.y)*.9);assert.ok(distance<=1600*.0155*8+.1);}
 assert.equal(validateResearchImage(result.buffer).width,1600);assert.doesNotMatch(result.labelSvg,/Fixed support.*Fixed support/);
});
test('annotation mapping errors in relation checks repair coordinates, not the underlying scientific picture',async()=>{
 let images=0,locations=0,reviews=0;const raw=await cantileverArtwork();
 const result=await createScientificFigure({...snapshot,context:{...snapshot.context,categoryId:'simulation',figureType:'abaqus-02'}},{settings,jsonRunner:async(messages,{phase})=>{
  if(phase==='planning')return{value:{complete:true,figure:cantileverPlan}};
  if(phase==='label_layout'){locations++;if(locations>1)assert.match(JSON.stringify(messages),/wrong marker mapping/);return{value:cantileverLocations};}
  const r=passed();if(phase==='review_confirm'||++reviews===1){r.passed=false;r.checks[1]={key:'scientific_relations',passed:false,scope:'annotation',detail:'wrong marker mapping'};}return{value:r};
 },imageRunner:async()=>{images++;return{buffer:raw,imageCount:1};}});
 assert.equal(result.review.passed,true);assert.equal(images,1);assert.equal(locations,2);
});
test('a layout correction remains available after the two genuine artwork attempts have been used',async()=>{
 let images=0,reviews=0;const result=await createScientificFigure(snapshot,{settings,jsonRunner:async(_m,{phase})=>{
  if(phase==='planning')return{value:{complete:true,figure:plan}};if(phase==='label_layout')return{value:layout()};
  if(phase==='review')reviews++;const r=passed();if(reviews<3){r.passed=false;const i=reviews===1?0:4;r.checks[i]={...r.checks[i],passed:false,scope:reviews===1?'artwork':'annotation'};}return{value:r};
 },imageRunner:async()=>{images++;return{buffer:pngFixture(),imageCount:1};}});
 assert.equal(result.review.passed,true);assert.equal(images,2);assert.equal(reviews,3);
});
