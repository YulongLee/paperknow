import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {finalWritingState,finalWritingStepsHTML,applyFinalWritingStep} from '../dist/workspace/thesis-final-flow.mjs';
const paper=extra=>({status:'completed',chapters:[{id:'c1',text:'已有初稿'}],...extra});
test('final flow derives real prerequisites, busy state and delivery eligibility without guessing a passed check',()=>{
 assert.equal(finalWritingState(null).recommended,'source');
 assert.equal(finalWritingState(paper({chapters:[]})).canProceed,false);
 assert.equal(finalWritingState(paper()).recommended,'prepare');
 assert.equal(finalWritingState(paper()).confirmed,false);
 const ready=paper({completionReview:{required:true,status:'ready'}});
 assert.equal(finalWritingState(ready).recommended,'review');
 for(const changes of [{dirty:true},{completionRunId:'old'}])assert.equal(finalWritingState(ready,changes).ready,!changes.dirty);
 for(const review of [{status:'ready',basisChanged:true},{status:'ready',suggestions:[{title:'待修正'}]},{status:'needs_materials'},{status:'check_required'}])assert.equal(finalWritingState(paper({completionReview:review})).recommended,'prepare');
 const active=paper({status:'running',job:{id:'a',status:'running',purpose:'draft'}});
 assert.equal(finalWritingState(active).recommended,'source');assert.equal(finalWritingState(active).canProceed,false);
 const completing=paper({status:'running',job:{id:'a',status:'running',purpose:'completion'}});
 assert.equal(finalWritingState(completing).recommended,'prepare');assert.equal(finalWritingState(completing).canProceed,true);assert.equal(finalWritingState(completing).ready,false);
 const confirmed=paper({completionReview:{required:true,status:'confirmed'}});
 assert.equal(finalWritingState(confirmed).confirmed,true);assert.equal(finalWritingState(confirmed,{dirty:true}).confirmed,false);
 const legacy=paper({quality:{coverage:{complete:true},supplementCheck:{version:1,phase:'final',status:'final_ready',coverage:{total:1,checked:1,complete:true},items:[{status:'not_required'}]}}});
 assert.equal(finalWritingState(legacy).confirmed,true);assert.equal(finalWritingState({...legacy,quality:{...legacy.quality,stale:true}}).confirmed,false);
});
test('step navigation keeps actual inputs, focus and scroll while locking steps that lack a draft',()=>{
 const dom=new JSDOM(`<main>${finalWritingStepsHTML()}${['source','prepare','review'].map(key=>`<section data-thesis-final-stage="${key}"><textarea>${key}</textarea></section>`).join('')}</main>`),root=dom.window.document.querySelector('main'),field=root.querySelector('[data-thesis-final-stage="prepare"] textarea');
 try{applyFinalWritingStep(root,'prepare',finalWritingState(paper()));field.value='尚未保存的补充';field.focus();field.setSelectionRange(2,5);field.scrollTop=40;applyFinalWritingStep(root,'review',finalWritingState(paper()));applyFinalWritingStep(root,'prepare',finalWritingState(paper()));assert.equal(field,root.querySelector('[data-thesis-final-stage="prepare"] textarea'));assert.equal(field.value,'尚未保存的补充');assert.equal(field.selectionStart,2);assert.equal(field.scrollTop,40);assert.equal(root.querySelector('[aria-current="step"]').dataset.thesisFinalStep,'prepare');
 assert.equal(applyFinalWritingStep(root,'review',finalWritingState(paper({chapters:[]}))),'source');assert.equal(root.querySelector('[data-thesis-final-step="prepare"]').disabled,true);assert.equal(root.querySelector('[data-thesis-final-stage="review"]').hidden,true);
 }finally{dom.window.close();}
});
