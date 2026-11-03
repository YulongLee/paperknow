import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {parseWordObject,serializeWordObject,ommlMathML,REL,WORD,MATH,WP} from '../src/docx-object-xml.js';
import {thesisError} from './thesis-model.mjs';
import {docxObjectIds} from '../dist/workspace/docx-object-markers.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),fail=message=>{throw thesisError(422,message);};
export async function extractDocxObjects(zip,doc,fileSha){
 const relations=new Map();if(zip.file('word/_rels/document.xml.rels')){
  const {DOMParser}=await import('@xmldom/xmldom');let bad=false;const text=await zip.file('word/_rels/document.xml.rels').async('string');if(text.length>1000000||/<!DOCTYPE|<!ENTITY/i.test(text))fail('初稿图片关联结构无效。');const xml=new DOMParser({onError:()=>bad=true}).parseFromString(text,'application/xml');if(bad)fail('初稿图片关联内容不完整。');for(const node of xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/relationships','Relationship'))relations.set(node.getAttribute('Id'),node);
 }
 const nodes=[...doc.getElementsByTagName('*')].filter(node=>node.namespaceURI===WORD&&['drawing','pict'].includes(node.localName)||node.namespaceURI===MATH&&['oMath','oMathPara'].includes(node.localName)&&node.parentNode?.namespaceURI!==MATH);
 if(nodes.length>128)fail('初稿最多支持 128 处图片与公式，请分开整理后重试。');
 const objects=[],markers=new WeakMap(),mediaCache=new Map();let total=0;
 for(const [index,node]of nodes.entries()){
  const kind=node.namespaceURI===MATH?'formula':'image',id='obj-'+hash(fileSha+':'+index).slice(0,24),markup=serializeWordObject(node);let root;try{root=parseWordObject(markup,kind);}catch(error){fail(error.message+' 当前正文未改变。');}
  const media=[];if(kind==='image'){
   const references=[...new Set([root,...root.getElementsByTagName('*')].flatMap(row=>[...row.attributes].filter(attribute=>attribute.namespaceURI===REL).map(attribute=>attribute.value)))];if(!references.length)fail('初稿中有暂不能完整保留的特殊绘图，请将该图在 Word 中另存为图片后重试；普通图片与公式可直接上传。');
   for(const relationId of references){const relation=relations.get(relationId),target=relation?.getAttribute('Target'),path=target&&posix.normalize(posix.join('word',target));if(!relation||relation.getAttribute('TargetMode')==='External'||!relation.getAttribute('Type').endsWith('/image')||!path?.startsWith('word/media/')||target.includes('\\')||!zip.file(path))fail('原稿图片未嵌入文档或关联不完整，请在 Word 中嵌入图片后上传。');
    if(!mediaCache.has(path))try{const bytes=await zip.file(path).async('nodebuffer');if(bytes.length>3*1024*1024)fail('单张原稿图片过大，请压缩图片后上传。');const image=sharp(bytes,{limitInputPixels:12000000,animated:false}),info=await image.metadata();if(!['png','jpeg','webp','gif','tiff'].includes(info.format)||info.pages>1||info.width>4096||info.height>4096)fail('原稿图片尺寸或格式暂不支持，请使用静态 PNG 或 JPEG 图片后重试。');const data=await image.png({palette:false,compressionLevel:9}).toBuffer();if(data.length>3*1024*1024)fail('单张原稿图片过大，请压缩图片后上传。');mediaCache.set(path,{data:data.toString('base64'),sha256:hash(data),width:info.width,height:info.height});}catch(error){if(error.status)throw error;fail('原稿图片无法完整读取，请在 Word 中重新插入图片后上传。');}
    media.push({relationId,...mediaCache.get(path)});
   }
  }
  const label=kind==='formula'?'原稿公式':node.getElementsByTagNameNS(WP,'docPr')[0]?.getAttribute('descr')||node.getElementsByTagNameNS(WP,'docPr')[0]?.getAttribute('name')||'原稿图片',plaintext=[...root.getElementsByTagNameNS(MATH,'t')].map(row=>row.textContent).join('');
  const object={id,kind,label:String(label).slice(0,200),xml:serializeWordObject(root),media,...(kind==='formula'?{mathML:ommlMathML(root),plaintext:plaintext.slice(0,2000)}:{})};total+=Buffer.byteLength(JSON.stringify(object));if(total>8*1024*1024)fail('初稿图片与公式总量较大，请压缩图片后上传。');objects.push(object);markers.set(node,'[docx:'+id+']');
 }
 return {objects,markers};
}
export function initializeDocxObjects(db){db.exec('CREATE TABLE IF NOT EXISTS thesis_docx_objects(thesis_id TEXT NOT NULL REFERENCES theses(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(thesis_id,id));CREATE INDEX IF NOT EXISTS thesis_docx_objects_owner ON thesis_docx_objects(user_id,thesis_id);');}
export function thesisDocxObjects(db,thesisId,userId,chapters,{full=false}={}){
 const ids=[...new Set(chapters.flatMap(row=>docxObjectIds(row.text)))];if(!ids.length)return [];
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='thesis_docx_objects'").get())throw thesisError(409,'原稿图片或公式暂不可读取，请重新读取论文状态。');
 return ids.map(id=>{const row=db.prepare('SELECT body FROM thesis_docx_objects WHERE thesis_id=? AND user_id=? AND id=?').get(thesisId,userId,id);if(!row)throw thesisError(409,'原稿图片或公式关联不完整，当前正文已保留。');const object=JSON.parse(row.body);return full?object:{id:object.id,kind:object.kind,label:object.label,...(object.kind==='formula'?{mathML:object.mathML,plaintext:object.plaintext}:{})};});
}
