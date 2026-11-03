import {createHash} from 'node:crypto';
import {createLiteratureSearch} from './literature-search.mjs';

const plain=(value,max=12000)=>String(value??'').replace(/<!--[\s\S]*?-->|<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const normalized=value=>plain(value,2000).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const doi=value=>plain(value,500).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi\s*:\s*/i,'').toLowerCase();
const validDoi=value=>/^10\.\d{4,9}\/[^\s<>]+$/u.test(doi(value))?doi(value):'';
const body=value=>plain(value).replace(/\s/g,'').length>=40;
const readable=value=>plain(value).replace(/\s/g,'').length>=20;
const shortId=value=>createHash('sha256').update(value).digest('hex').slice(0,24);
export const autoReferenceLabels=Object.freeze(['自动获取摘要（非全文）','自动补充文献摘要（非全文）']);

export function sameAcademicReference(reference,candidate){
 const expected=validDoi(reference.doi),actual=validDoi(candidate.doi);
 if(expected&&expected!==actual)return false;
 const title=normalized(reference.title),found=normalized(candidate.title);if(!title||!found||title!==found)return false;
 const year=String(reference.year||'');if(/^\d{4}$/.test(year)&&candidate.year&&Number(year)!==Number(candidate.year))return false;
 return true;
}
const topicTranslations=[['深度学习','deep learning'],['机器学习','machine learning'],['卷积神经网络','convolutional neural network'],['狗脸','dog face'],['犬脸','dog face'],['猫脸','cat face'],['羊脸','sheep face'],['牛脸','cattle face'],['动物个体','animal individual'],['人脸','human face'],['识别','recognition'],['图像分割','image segmentation'],['图像','image'],['目标检测','object detection'],['数字阅读','digital reading'],['图书馆','library'],['课堂反馈','classroom feedback']];
export function referenceTopicQuery(title){
 const original=plain(title,200),parts=topicTranslations.filter(([word])=>original.includes(word)).map(([,word])=>word);
 const focused=parts.some(word=>/^(?:dog|cat|sheep|cattle) face$/.test(word))?parts.filter(word=>!['deep learning','machine learning','convolutional neural network'].includes(word)):parts;
 return focused.length>=2?[...new Set(focused)].join(' ').slice(0,200):original;
}
export function relevantAcademicReference(title,candidate){
 const query=referenceTopicQuery(title),content=normalized(candidate.title+' '+(candidate.abstract||''));
 const species=[['狗脸','犬脸'],['猫脸'],['羊脸'],['牛脸']].find(words=>words.some(word=>String(title).includes(word)));
 if(species){
  const word=species[0],english={'狗脸':['dog','canine'],'猫脸':['cat','feline'],'羊脸':['sheep','ovine'],'牛脸':['cattle','bovine']}[word],visible=candidate.title+' '+candidate.abstract,title=String(candidate.title||'').replace(/[-']/g,' ');
  const specific=english.some(term=>new RegExp('\\b'+term+'s?\\s+(?:face|facial|identification|recognition|identity|individual|biometric|nose|muzzle)\\b','i').test(title)||new RegExp('\\b(?:face|facial|identification|recognition)\\s+(?:of |for )?'+term+'s?\\b','i').test(title));
  const animalScope=/\banimals?\b/i.test(title)&&/\b(?:face|faces|facial|biometric|biometrics|recognition)\b/i.test(title)&&english.some(term=>new RegExp('\\b'+term+'s?\\b','i').test(visible));
  if(!species.some(term=>content.includes(normalized(term)))&&!specific&&!animalScope)return false;
 }
 const stop=new Set(['deep','learning','based','system','research','study','using','method','analysis','with','from','the','and','design','development']);
 const words=(query.toLowerCase().match(/[a-z][a-z-]{2,}/g)||[]).filter(word=>!stop.has(word));
 if(words.length){const visible=(candidate.title+' '+candidate.abstract).toLowerCase();return words.filter(word=>visible.includes(word)).length>=Math.min(2,words.length);}
 const clean=normalized(title).replace(/基于|深度学习|机器学习|系统|设计|研究|分析|方法|实现|应用|技术|的|与|和/g,'');
 const grams=[...new Set(Array.from({length:Math.max(0,clean.length-1)},(_,i)=>clean.slice(i,i+2)))];
 return grams.length>0&&grams.filter(word=>content.includes(word)).length>=Math.min(2,grams.length);
}
function enrich(reference,candidate,{added=false}={}){
 const result={...reference,text:plain(candidate.abstract),sourceLabel:autoReferenceLabels[added?1:0],confirmed:true};
 for(const key of ['authors','year','doi','url','documentType','journal','publisher','volume','issue','pages','venue'])if(!result[key]&&candidate[key]!==undefined)result[key]=candidate[key];
 return result;
}
export function createWritingReferencePreparation(config={}){
 const search=config.writingLiteratureSearch||createLiteratureSearch({fetchImpl:config.literatureFetch,timeoutMs:5000,openAlexApiKey:config.openAlexApiKey,openAlexDailyLimit:config.openAlexDailyLimit,aminerEnabled:false,semanticScholarEnabled:false});
 const available=()=>typeof search.listSources==='function'?search.listSources({allowAminer:false,allowSemanticScholar:false}):['crossref','arxiv'];
 const lookupSources=()=>['crossref','openalex'].filter(source=>available().includes(source)).join(',')||'crossref';
 return {async prepare(snapshot,{userId='isolated',isCurrent=()=>true}={}){
  const references=structuredClone(snapshot.references||[]),before=references.filter(row=>row.confirmed!==false&&readable(row.text)).length;
  const retrieved=[];let unavailable=false;
  const configured=Number(config.thesisMaxSourceCharacters),limit=Number.isSafeInteger(configured)&&configured>=1000&&configured<=200000?configured:100000;
  let remaining=Math.max(0,limit-[...(snapshot.materials||[]),...references].reduce((sum,row)=>sum+String(row.text||'').length,0));
  const adopt=(reference,candidate,options)=>{const abstract=plain(candidate.abstract,Math.min(3000,remaining));if(!body(abstract))return false;Object.assign(reference,enrich(reference,{...candidate,abstract},options));remaining-=reference.text.length;return true;};
  const pending=references.filter(row=>row.documentType!=='unparsed'&&row.confirmed!==false&&!String(row.text||'').trim()).slice(0,8);
  const invoke=async query=>{
   if(await isCurrent()!==true)throw Object.assign(Error('论文信息已变化，请重新打开后生成。'),{status:409});
   try{const result=await search.search(query,{clientKey:'writing-reference:'+userId,allowAminer:false,allowSemanticScholar:false});if(result.sources?.some(row=>['error','rate_limited','budget_exhausted'].includes(row.status)))unavailable=true;return result.items||[];}
   catch{unavailable=true;return [];}
  };
  let next=0;await Promise.all(Array.from({length:Math.min(2,pending.length)},async()=>{
   while(next<pending.length&&remaining>=40){const reference=pending[next++];if(body(reference.abstract)){if(adopt(reference,{abstract:reference.abstract}))retrieved.push(reference.id);continue;}
    const rows=await invoke({q:validDoi(reference.doi)||plain(reference.title,200),source:lookupSources(),limit:'5'}),match=rows.find(row=>sameAcademicReference(reference,row)&&body(row.abstract));
    if(match&&adopt(reference,match))retrieved.push(reference.id);
   }
  }));
  const added=[];
  if(remaining>=40&&before===0&&!references.some(row=>row.confirmed!==false&&body(row.text)&&relevantAcademicReference(snapshot.title,{title:row.title,abstract:row.text}))&&(references.length===0||references.some(row=>row.confirmed!==false))){
   const sources=['arxiv','crossref','openalex'].filter(source=>available().includes(source)).join(',')||'crossref';
   const rows=await invoke({q:referenceTopicQuery(snapshot.title),source:sources,limit:'10'}),identities=new Set(references.flatMap(row=>[validDoi(row.doi)?'doi:'+validDoi(row.doi):'',normalized(row.title)?'title:'+normalized(row.title):'']).filter(Boolean));
   for(const row of rows){if(added.length>=3||references.length>=40||remaining<40)break;if(!body(row.abstract)||!relevantAcademicReference(snapshot.title,row))continue;
    const keys=[validDoi(row.doi)?'doi:'+validDoi(row.doi):'',normalized(row.title)?'title:'+normalized(row.title):''].filter(Boolean);if(!keys.length||keys.some(key=>identities.has(key)))continue;
    const id='reference:auto-'+shortId(keys[0]),reference={id,title:plain(row.title,500),authors:plain(row.authors,1000),year:String(row.year||''),doi:validDoi(row.doi),url:plain(row.url,2000)};if(!adopt(reference,row,{added:true}))continue;references.push(reference);added.push(id);keys.forEach(key=>identities.add(key));
   }
  }
  if(await isCurrent()!==true)throw Object.assign(Error('论文信息已变化，未替换当前文献。'),{status:409});
  const readableCount=references.filter(row=>row.confirmed!==false&&readable(row.text)).length;
  return {references,summary:{readableCount,existingReadableCount:before,retrievedCount:retrieved.length,addedCount:added.length,unresolvedIds:references.filter(row=>row.confirmed!==false&&!readable(row.text)).map(row=>row.id),unavailable,fullTextRead:false}};
 }};
}
