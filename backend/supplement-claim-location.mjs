import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId=value=>typeof value==='string'&&value.trim().length>0&&value.length<=200;
const uniqueOffset=(body,part)=>{if(typeof body!=='string'||typeof part!=='string'||!part)return -1;const at=body.indexOf(part);return at>=0&&body.indexOf(part,at+1)<0?at:-1;};

// Provenance-only candidate. All inputs must be loaded by the server from the
// current account/run snapshot and an already validated checker output. This
// never assesses entailment or classifies a missing item as confirmable.
export function locateSupplementClaim({identity,chapters,snapshot,ruleVersion,issue,source,trace}={}){
 if(!identity||![identity.userId,identity.thesisId,identity.runId,identity.chapterId,identity.chapterVersion,ruleVersion].every(validId)||!Array.isArray(chapters)||!snapshot||!issue||!source||!Array.isArray(trace))return null;
 if(!Array.isArray(issue.missing)||issue.missing.length!==1||typeof issue.missing[0]!=='string'||!issue.missing[0].trim()||issue.status!=='missing')return null;
 const matches=chapters.filter(row=>row?.id===identity.chapterId);if(matches.length!==1||!Array.isArray(issue.evidence)||issue.evidence.length!==1)return null;
 const chapter=matches[0],claim=issue.manuscriptQuote,proof=issue.evidence[0],excerpt=proof?.quote;
 if(chapter.versionId!==identity.chapterVersion)return null;
 if(!validId(source.id)||proof?.sourceId!==source.id||source.confirmed===false||typeof claim!=='string'||claim.length>500||typeof excerpt!=='string'||excerpt.length>500)return null;
 // Complex multi-sentence anchors cannot provide a precise review target.
 if(/[\n;；]/u.test(claim)||((claim.replace(/\[source:[^\]]+\]/gu,'').match(/[。！？!?]/gu)||[]).length>1))return null;
 const citations=[...claim.matchAll(/\[source:([^\]\r\n]+)\]/gu)].map(row=>row[1]);
 if(citations.length!==1||citations[0]!==source.id)return null;
 const snapSources=[...(Array.isArray(snapshot.materials)?snapshot.materials:[]),...(Array.isArray(snapshot.references)?snapshot.references:[])].filter(row=>row?.id===source.id);
 if(snapSources.length!==1||snapSources[0].confirmed===false||snapSources[0].text!==source.text)return null;
 const chapterOffset=uniqueOffset(chapter.text,claim),sourceOffset=uniqueOffset(source.text,excerpt);
 if(chapterOffset<0||sourceOffset<0)return null;
 const read=trace.some(row=>row?.tool==='read_material'&&row.status==='completed'&&row.materialId===source.id&&Number.isSafeInteger(row.offset)&&row.offset>=0&&Number.isSafeInteger(row.limit)&&row.limit>0&&row.offset<=sourceOffset&&row.offset+row.limit>=sourceOffset+excerpt.length);
 if(!read)return null;
 const binding=hash({version:1,identity,ruleVersion,chapters,snapshot,issue,sourceId:source.id,chapterOffset,sourceOffset,excerpt});
 return {version:1,binding,chapterId:identity.chapterId,chapterOffset,sourceId:source.id,sourceOffset,claim,excerpt,confirmationAllowed:false};
}
