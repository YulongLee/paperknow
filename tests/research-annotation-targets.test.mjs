import test from 'node:test';
import assert from 'node:assert/strict';
import {createScientificFigure} from '../backend/research-figure-quality.mjs';
import {illustrationTargetTask,normalizeIllustrationTargets} from '../backend/research-illustration-labels.mjs';
import {cantileverArtwork,cantileverPlan,cantileverLocations} from './fixtures/research-cantilever.mjs';
const settings={enabled:true,model:'qwen-image-3.0',apiKey:'sk-fixture-private',version:'target-test',baseURL:'https://dashscope.aliyuncs.com',timeoutMs:1000};
const snapshot={mode:'professional',title:'Beam',text:'Left support, downward end load, regular mesh, separate qualitative bending trend.',language:'English',context:{categoryId:'simulation',figureType:'abaqus-02',aspectRatio:'16:9',palette:'academic'}};
const request=m=>JSON.parse(m[1].content[0].text);
const targets=(m,bad=-1,scope='annotation')=>({passed:!request(m).labels.some(a=>a.index===bad),checks:request(m).labels.map(a=>({index:a.index,passed:a.index!==bad,scope,detail:a.index===bad?'Wrong target: move to the actual load arrow':'Exact feature at cross centre'}))});
const review=m=>({passed:true,checks:request(m).requestedChecks.map(key=>({key,passed:true,detail:'Actual scientific content verified'}))});
test('target checks require exact unique coverage and consistent conclusions',()=>{
 const layout=cantileverLocations.annotations;
 const valid={passed:true,checks:layout.map(a=>({index:a.index,passed:true,detail:'verified'}))};
 assert.equal(normalizeIllustrationTargets(valid,layout).passed,true);
 for(const bad of [{...valid,checks:[]},{...valid,passed:false},{...valid,checks:valid.checks.map(c=>({...c,index:0}))},{...valid,checks:valid.checks.map(c=>({...c,passed:'true'}))}])assert.throws(()=>normalizeIllustrationTargets(bad,layout),{code:'figure_annotation_invalid'});
});
test('each target is independently enlarged with full-image context and precise centre',async()=>{
 const sharp=(await import('sharp')).default;const large=await sharp(await cantileverArtwork()).resize(2688,1512).png().toBuffer();
 const messages=await illustrationTargetTask(cantileverPlan,large,cantileverLocations.annotations);
 const content=messages[1].content;assert.equal(content.filter(p=>p.type==='image_url').length,5);assert.deepEqual(request(messages).labels.map(a=>a.index),[0,1,2,3]);
});
test('bad anchors repair without paid redraw; approved anchors cannot regress; the actual final labelled image still requires independent review',async()=>{
 const raw=await cantileverArtwork();let images=0,locations=0,targetRounds=0;const events=[];
 const result=await createScientificFigure(snapshot,{settings,audit:e=>events.push(e),imageRunner:async()=>{images++;return{buffer:raw,imageCount:1};},jsonRunner:async(m,{phase})=>{
  if(phase==='planning')return{value:{complete:true,figure:cantileverPlan}};
  if(phase==='label_layout'){
   locations++;if(locations===2)assert.deepEqual(request(m).verifiedIndices,[0,2,3]);
   return{value:{hasText:false,annotations:cantileverLocations.annotations.map(a=>({...a,x:locations===1?a.x:999}))}};
  }
  if(phase==='label_targets'){targetRounds++;if(targetRounds===2)assert.deepEqual(request(m).labels.map(a=>a.index),[2,3]);return{value:targets(m,targetRounds===1?1:-1)};}
  assert.notEqual(m[1].content[1].image_url.url,'data:image/png;base64,'+raw.toString('base64'));
  assert.ok(request(m).requestedChecks.includes('labels_legible'));return{value:review(m)};
 }});
 assert.equal(images,1);assert.equal(locations,2);assert.equal(result.review.passed,true);
 const layout=events.find(e=>e.model==='native-fonts'&&e.status==='accepted').layout;
 assert.equal(layout.find(a=>a.index===0).x,cantileverLocations.annotations[0].x);assert.equal(layout.find(a=>a.index===1).x,999);
 assert.equal(result.review.checks.length,6);assert.equal(result.review.checks.find(c=>c.key==='labels_legible').passed,true);
});
test('missing objects regenerate artwork while persistently incorrect anchors never pass',async()=>{
 const raw=await cantileverArtwork();
 for(const scope of ['artwork','annotation']){let images=0;
 await assert.rejects(()=>createScientificFigure(snapshot,{settings,imageRunner:async()=>{images++;return{buffer:raw,imageCount:1};},jsonRunner:async(m,{phase})=>({value:phase==='planning'?{complete:true,figure:cantileverPlan}:phase==='label_layout'?cantileverLocations:phase==='label_targets'?targets(m,0,scope):review(m)})}),{code:'figure_quality_rejected'});
 assert.equal(images,scope==='artwork'?2:1);
 }
});
test('crop corrections are converted into raw-image coordinates and must pass a new independent check',async()=>{
 const raw=await cantileverArtwork();let locations=0,checks=0,images=0,expected;const events=[];
 const result=await createScientificFigure(snapshot,{settings,audit:e=>events.push(e),imageRunner:async()=>{images++;return{buffer:raw,imageCount:1};},jsonRunner:async(m,{phase})=>{
  if(phase==='planning')return{value:{complete:true,figure:cantileverPlan}};
  if(phase==='label_layout'){locations++;return{value:cantileverLocations};}
  if(phase==='label_targets'){
   checks++;const value=targets(m,checks===1?1:-1);
   if(checks===1){value.checks.find(c=>c.index===1).correction={x:450,y:550};const r=JSON.parse(m[1].content.find(p=>p.type==='text'&&JSON.parse(p.text).index===1).text).cropBounds;expected={x:r.left+.45*r.width,y:r.top+.55*r.height};}
   else if(checks===3){assert.equal(request(m).labels.length,1);assert.equal(request(m).labels[0].x,expected.x);assert.equal(request(m).labels[0].y,expected.y);}
   return{value};
  }
  return{value:review(m)};
 }});
 assert.equal(locations,1);assert.equal(checks,3);assert.equal(images,1);assert.equal(result.review.passed,true);
 assert.equal(events.find(e=>e.model==='native-fonts'&&e.status==='accepted').layout[1].x,expected.x);
});
test('a final visual rejection cannot be overridden by approved raw targets or native typography',async()=>{
 let images=0,reviews=0;const raw=await cantileverArtwork();
 const result=await createScientificFigure(snapshot,{settings,imageRunner:async()=>{images++;return{buffer:raw,imageCount:1};},jsonRunner:async(m,{phase})=>{
  if(phase==='planning')return{value:{complete:true,figure:cantileverPlan}};
  if(phase==='label_layout')return{value:cantileverLocations};if(phase==='label_targets')return{value:targets(m)};
  if(phase==='review')reviews++;const value=review(m);if(reviews===1){value.passed=false;Object.assign(value.checks.find(c=>c.key==='labels_legible'),{passed:false,scope:'annotation',detail:'Actual marker points to the wrong component'});}return{value};
 }});
 assert.equal(reviews,2);assert.equal(images,1);assert.equal(result.review.passed,true);
});
test('actual bad existing text requires a new artwork, then native labels can complete normally',async()=>{
 let images=0,locations=0,reviews=0;const raw=await cantileverArtwork();
 const result=await createScientificFigure(snapshot,{settings,imageRunner:async()=>{images++;return{buffer:raw,imageCount:1};},jsonRunner:async(m,{phase})=>{
  if(phase==='planning')return{value:{complete:true,figure:cantileverPlan}};
  if(phase==='label_layout')return{value:++locations===1?{hasText:true,annotations:[]}:cantileverLocations};
  if(phase==='label_targets')return{value:targets(m)};
  reviews++;const value=review(m);if(images===1){value.passed=false;Object.assign(value.checks.find(c=>c.key==='labels_legible'),{passed:false,scope:'annotation',detail:'Unwanted prompt text and garbled labels'});}return{value};
 }});
 assert.equal(images,2);assert.equal(reviews,3);assert.equal(result.review.passed,true);
});
test('text detection never bypasses scientific review; persistent lettering errors produce an accurate failure reason',async()=>{
 const raw=await cantileverArtwork();
 for(const key of ['labels_legible','scientific_relations']){let images=0,reviews=0;
 await assert.rejects(()=>createScientificFigure(snapshot,{settings,imageRunner:async()=>{images++;return{buffer:raw,imageCount:1};},jsonRunner:async(m,{phase})=>{
  if(phase==='planning')return{value:{complete:true,figure:cantileverPlan}};
  if(phase==='label_layout')return{value:{hasText:true,annotations:[]}};
  reviews++;const value=review(m);value.passed=false;Object.assign(value.checks.find(c=>c.key===key),{passed:false,scope:key==='labels_legible'?'annotation':'artwork',detail:'A real visible error persists'});return{value};
 }}),e=>e.code==='figure_quality_rejected'&&(key==='labels_legible'?e.message.includes('文字标注'):e.message.includes('内容或版式')));
 assert.equal(images,2);assert.equal(reviews,4);
 }
});
