import {thesisHash,thesisError} from './thesis-model.mjs';
import {thesisDocxObjects} from './thesis-docx-objects.mjs';

// These are system-generated capability limitations, not model findings or
// statements about image content. Unknown and missing objects never qualify.
export function importedImageLimitations(chapters=[],objects=[]){
 const known=new Map(objects.filter(row=>row?.kind==='image'&&typeof row.id==='string').map(row=>[row.id,row]));
 const result=[];
 for(const chapter of chapters)for(const match of String(chapter?.text||'').matchAll(/\[docx:(obj-[a-f0-9]{24})\]/g)){
  if(known.has(match[1]))result.push({version:1,kind:'visual_not_read',objectId:match[1],chapterId:String(chapter.id||''),offset:match.index});
 }
 return result;
}

export function initializeThesisImageReview(db){db.exec('CREATE TABLE IF NOT EXISTS thesis_image_confirmations(thesis_id TEXT NOT NULL,user_id TEXT NOT NULL,run_id TEXT NOT NULL,basis TEXT NOT NULL,image_id TEXT NOT NULL,confirmed_at TEXT NOT NULL,PRIMARY KEY(thesis_id,user_id,run_id,basis,image_id));');}

export function thesisImageReviewItems(db,row,run,saved,quality,{current=false}={}){
 if(!current||!quality?.supplementCheck?.coverage?.complete)return [];
 const chapters=saved.map(({record,...chapter})=>({...chapter,text:record?.text||''}));
 const full=thesisDocxObjects(db,row.id,row.user_id,chapters,{full:true}),images=full.filter(object=>object.kind==='image');if(!images.length)return [];
 const expected=importedImageLimitations(chapters,images),recorded=quality.supplementCheck.imageLimitations;
 // Historic checks cannot be treated as having reviewed this contract.
 if(!Array.isArray(recorded)||JSON.stringify(expected)!==JSON.stringify(recorded))return [{available:false,reason:'请重新检查当前图片，后再由作者逐图核对。'}];
 const basis=thesisHash({owner:row.user_id,thesis:row.id,run:run.id,snapshot:row.snapshot_hash,chapters:saved.map(c=>[c.id,c.record?.id||null,thesisHash(c.record?.text||'')]),metadata:row.export_metadata||null,template:row.export_template||null,quality:run.quality,objects:images.map(o=>[o.id,thesisHash(o.xml),thesisHash(o.media.map(m=>m.data))])});
 return expected.map(entry=>{const object=images.find(o=>o.id===entry.objectId),chapter=chapters.find(c=>c.id===entry.chapterId);
  // The preview endpoint displays only the first original media, not Word's
  // rendered composition. Never offer a visual confirmation for a composite,
  // cropped, rotated or mirrored object whose actual appearance may differ.
  if(!Array.isArray(object?.media)||object.media.length!==1||/<(?:[\w.-]+:)?srcRect\b|\b(?:rot|flipH|flipV)\s*=/i.test(object.xml||''))return {available:false,reason:'原稿图片的组合或裁切暂不能在此完整预览，请在 Word 中核对后调整图片。'};
  const id=thesisHash({basis,...entry}),text=String(chapter?.text||''),marker='[docx:'+entry.objectId+']',context=text.slice(Math.max(0,entry.offset-180),Math.min(text.length,entry.offset+marker.length+180)).replace(/\[(?:source|docx|figure):[^\]]+\]/g,'').trim();return {id,basis,objectId:entry.objectId,chapterId:entry.chapterId,chapterTitle:chapter?.title||'正文',context,available:true,confirmed:Boolean(db.prepare('SELECT 1 FROM thesis_image_confirmations WHERE thesis_id=? AND user_id=? AND run_id=? AND basis=? AND image_id=?').get(row.id,row.user_id,run.id,basis,id))};});
}

export function confirmThesisImage(db,row,run,saved,quality,input,at,current){
 if(!input||Object.keys(input).some(key=>!['version','runId','imageId','confirmed'].includes(key))||input.version!==row.version||input.runId!==run?.id||typeof input.imageId!=='string'||typeof input.confirmed!=='boolean')throw thesisError(409,'图片或论文状态已变化，请重新检查后确认。');
 const image=thesisImageReviewItems(db,row,run,saved,quality,{current}).find(item=>item.id===input.imageId&&item.available);
 if(!image)throw thesisError(409,'图片或检查结果已变化，请重新检查后确认。');
 if(input.confirmed)db.prepare('INSERT OR REPLACE INTO thesis_image_confirmations(thesis_id,user_id,run_id,basis,image_id,confirmed_at) VALUES(?,?,?,?,?,?)').run(row.id,row.user_id,run.id,image.basis,image.id,at);
 else db.prepare('DELETE FROM thesis_image_confirmations WHERE thesis_id=? AND user_id=? AND run_id=? AND basis=? AND image_id=?').run(row.id,row.user_id,run.id,image.basis,image.id);
}
