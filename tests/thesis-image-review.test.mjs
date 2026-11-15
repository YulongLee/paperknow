import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../backend/database.mjs';
import {initializeThesisImageReview,importedImageLimitations,thesisImageReviewItems,confirmThesisImage} from '../backend/thesis-image-review.mjs';

function fixture(t){
 const db=database(':memory:');db.exec('CREATE TABLE thesis_docx_objects(thesis_id TEXT,user_id TEXT,id TEXT,body TEXT)');initializeThesisImageReview(db);t.after(()=>db.close());
 const object={id:'obj-0123456789abcdef01234567',kind:'image',label:'测试图片',xml:'<drawing/>',media:[{data:'cGl4ZWxz',sha256:'old'}]},row={id:'t',user_id:'u',version:3,snapshot_hash:'s',export_metadata:'{}',export_template:null},run={id:'run',quality:'quality-v1'},chapter={id:'c',title:'方法',record:{id:'v1',text:`结果见图。\n[docx:${object.id}]\n图 1 测试图。`}};
 db.prepare('INSERT INTO thesis_docx_objects VALUES(?,?,?,?)').run(row.id,row.user_id,object.id,JSON.stringify(object));
 const chapters=[{id:'c',title:'方法',text:chapter.record.text}],quality={supplementCheck:{coverage:{complete:true},imageLimitations:importedImageLimitations(chapters,[object])}};
 return {db,object,row,run,saved:[chapter],quality};
}
test('system image limitations are distinct from missing facts and bind to exact object and chapter position',t=>{
 const f=fixture(t),items=thesisImageReviewItems(f.db,f.row,f.run,f.saved,f.quality,{current:true});assert.equal(items.length,1);assert.equal(items[0].objectId,f.object.id);assert.equal(items[0].confirmed,false);assert.match(items[0].context,/图 1/);
 const request={version:3,runId:'run',imageId:items[0].id,confirmed:true};confirmThesisImage(f.db,f.row,f.run,f.saved,f.quality,request,'today',true);assert.equal(thesisImageReviewItems(f.db,f.row,f.run,f.saved,f.quality,{current:true})[0].confirmed,true);
 confirmThesisImage(f.db,f.row,f.run,f.saved,f.quality,{...request,confirmed:false},'today',true);assert.equal(thesisImageReviewItems(f.db,f.row,f.run,f.saved,f.quality,{current:true})[0].confirmed,false);
});
test('old checks, changed context, image bytes, account and forged IDs cannot reuse a confirmation',t=>{
 const f=fixture(t),first=thesisImageReviewItems(f.db,f.row,f.run,f.saved,f.quality,{current:true})[0],request={version:3,runId:'run',imageId:first.id,confirmed:true};confirmThesisImage(f.db,f.row,f.run,f.saved,f.quality,request,'today',true);
 assert.equal(thesisImageReviewItems(f.db,{...f.row,snapshot_hash:'changed'},f.run,f.saved,f.quality,{current:true})[0].confirmed,false);
 assert.deepEqual(thesisImageReviewItems(f.db,f.row,f.run,f.saved,{supplementCheck:{coverage:{complete:true}}},{current:true}),[{available:false,reason:'请重新检查当前图片，后再由作者逐图核对。'}]);
 assert.throws(()=>confirmThesisImage(f.db,f.row,f.run,f.saved,f.quality,{...request,imageId:'forged'},'today',true),/已变化/);
 assert.throws(()=>confirmThesisImage(f.db,f.row,f.run,f.saved,f.quality,request,'today',false),/已变化/);
 assert.throws(()=>confirmThesisImage(f.db,{...f.row,user_id:'other'},f.run,f.saved,f.quality,request,'today',true),/不完整/);
 f.object.media[0].data='Y2hhbmdlZA==';f.db.prepare('UPDATE thesis_docx_objects SET body=? WHERE id=?').run(JSON.stringify(f.object),f.object.id);
 assert.equal(thesisImageReviewItems(f.db,f.row,f.run,f.saved,f.quality,{current:true})[0].confirmed,false);
});
test('composite and cropped Word objects cannot be confirmed from the raw first-image preview',t=>{
 const f=fixture(t);f.object.media.push({data:'dHdv',sha256:'two'});f.db.prepare('UPDATE thesis_docx_objects SET body=? WHERE id=?').run(JSON.stringify(f.object),f.object.id);
 assert.equal(thesisImageReviewItems(f.db,f.row,f.run,f.saved,f.quality,{current:true})[0].available,false);
 f.object.media.pop();f.object.xml='<drawing><a:srcRect l="1000"/></drawing>';f.db.prepare('UPDATE thesis_docx_objects SET body=? WHERE id=?').run(JSON.stringify(f.object),f.object.id);
 assert.equal(thesisImageReviewItems(f.db,f.row,f.run,f.saved,f.quality,{current:true})[0].available,false);
});
