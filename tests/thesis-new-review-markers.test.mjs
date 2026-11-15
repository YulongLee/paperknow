import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {completionNewMarkers} from '../backend/thesis-new-review-markers.mjs';
import {completionReviewPanel} from '../dist/workspace/thesis-completion-review.mjs';

function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE thesis_chapter_versions(id TEXT,thesis_id TEXT,chapter_id TEXT,text TEXT)');
 db.prepare('INSERT INTO thesis_chapter_versions VALUES(?,?,?,?)').run('old1','t1','c1','作者原稿【待补充：对照输出】。');
 const row={id:'t1'},baseline=[{chapterId:'c1',versionId:'old1'}],run={id:'r1',status:'completed',settings_meta:JSON.stringify({completion:{scope:'full',baseline}})};
 const original='作者原稿【待补充：对照输出】。\n\n后续分析【待补充：扩展算例】。';
 const saved=[{id:'c1',title:'结果',record:{source:'generated',run_id:'r1',text:original}}];return{db,row,run,saved};
}
test('only uniquely new generated markers are presented with chapter and context, never resolving original gaps',()=>{
 const {db,row,run,saved}=fixture(),before=JSON.stringify(saved);try{
  const result=completionNewMarkers(db,row,run,saved,{current:true});assert.equal(result.length,1);assert.equal(result[0].marker,'【待补充：扩展算例】');assert.match(result[0].context,/后续分析/);assert.equal(result[0].chapterId,'c1');assert.equal(JSON.stringify(saved),before);
  const html=completionReviewPanel({status:'needs_materials',reportCurrent:true,newMarkers:result,missing:['对照输出仍需核对'],checks:{},changes:[]},{chapters:[]});
  assert.match(html,/自动完善后新出现的标记/);assert.match(html,/初稿中没有逐字相同的标记/);assert.match(html,/data-completion-view="c1"/);assert.match(html,/对照输出仍需核对/);assert.doesNotMatch(html,/data-completion-confirm(?:\s|>)/);
 }finally{db.close();}
});
test('stale, incomplete, other-owner baselines and manually edited versions never claim AI provenance',()=>{
 const {db,row,run,saved}=fixture();try{
  assert.deepEqual(completionNewMarkers(db,row,run,saved,{current:false}),[]);
  assert.deepEqual(completionNewMarkers(db,row,{...run,status:'running'},saved,{current:true}),[]);
  assert.deepEqual(completionNewMarkers(db,{id:'another-thesis'},run,saved,{current:true}),[]);
  const missing={...run,settings_meta:JSON.stringify({completion:{scope:'full',baseline:[{chapterId:'c1',versionId:'missing'}]}})};assert.deepEqual(completionNewMarkers(db,row,missing,saved,{current:true}),[]);
  assert.deepEqual(completionNewMarkers(db,row,run,[{...saved[0],record:{...saved[0].record,source:'manual'}}],{current:true}),[]);
  assert.deepEqual(completionNewMarkers(db,row,run,[{...saved[0],record:{...saved[0].record,run_id:'other'}}],{current:true}),[]);
  const html=completionReviewPanel({status:'needs_materials',reportCurrent:false,newMarkers:[{chapterId:'c1',title:'x',context:'old'}],missing:[],checks:{},changes:[]});assert.doesNotMatch(html,/自动完善后新出现的标记/);
 }finally{db.close();}
});
test('review-only uses the bound paid run and handles English markers without trusting markup',()=>{
 const {db,row,run,saved}=fixture();try{
  const review={...run,id:'review1',settings_meta:JSON.stringify({reviewOnly:true,reviewPaidRunId:'r1',completion:{scope:'full',baseline:[{chapterId:'c1',versionId:'old1'}]}})};
  saved[0].record.text+='\n[To be verified: future & <script> scope]';const result=completionNewMarkers(db,row,review,saved,{current:true});assert.equal(result.length,2);
  const html=completionReviewPanel({status:'needs_materials',reportCurrent:true,newMarkers:result,missing:[],checks:{},changes:[]});assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
 }finally{db.close();}
});
