// Reuse only exact user-authorized snippets found during this same review.
// They are candidates for independent review, never evidence that a claim is true.
export function attachSupplementReviewEvidence(task,{snapshot={},chapters=[],batch=[],supplementCheck}={}){
 if(supplementCheck?.phase!=='final'||supplementCheck?.coverage?.complete!==true||!task?.context?.sourceEvidence)return 0;
 const all=[...(snapshot.materials||[]),...(snapshot.references||[])],pieces=new Map();
 for(const piece of batch){const id=piece.originalSectionId;if(!id)continue;if(!pieces.has(id))pieces.set(id,[]);pieces.get(id).push(piece);}
 const candidates=[];
 for(const item of supplementCheck.items||[]){const match=/^check-(\d+)-(\d+)(-recovery-\d+)*$/.exec(item.id||''),chapter=match?chapters[Number(match[1])]:null,provided=chapter&&pieces.get(chapter.id)||[];if(!chapter)continue;
  for(const proof of item.evidence||[]){if(typeof proof?.sourceId!=='string'||typeof proof?.quote!=='string'||proof.quote.trim().length<4||proof.quote.length>500)continue;
   const sources=all.filter(row=>row?.id===proof.sourceId);if(sources.length!==1||sources[0].confirmed!==true||typeof sources[0].text!=='string')continue;
   const source=sources[0],direct=provided.some(piece=>String(piece.text||'').includes('[source:'+proof.sourceId+']'));
   // An author-linked fragment remains an independent, unverified source. It
   // can be useful when the chapter cites its parent reference, but must never
   // be presented as the reference's own text or as proof of its provenance.
   const parentId=source.referenceSegment===true&&typeof source.relatedReferenceId==='string'?source.relatedReferenceId:'';
   const parents=parentId?(snapshot.references||[]).filter(row=>row?.id===parentId):[];
   const linked=!direct&&parents.length===1&&parents[0].confirmed===true&&all.filter(row=>row?.id===parentId).length===1&&batch.some(piece=>String(piece.text||'').includes('[source:'+parentId+']'));
   if(!direct&&!linked)continue;const firstOffset=source.text.indexOf(proof.quote);if(firstOffset<0)continue;const unique=source.text.indexOf(proof.quote,firstOffset+1)<0;
   // Give the later independent review surrounding user-provided text, not a
   // potentially mid-sentence quote alone. Ambiguous matches stay unexpanded:
   // choosing an occurrence would invent a location. The window is bounded and
   // is not proof that either its provenance or the claim has been verified.
   const short=source.text.length<=1200;
   const start=unique?(short?0:Math.max(0,firstOffset-160)):null,end=unique?(short?source.text.length:Math.min(source.text.length,firstOffset+proof.quote.length+160)):null;
   const candidateText=unique?source.text.slice(start,end):proof.quote,offset=start;
   const positions=[];
   // Recovery section IDs do not encode each later split's absolute offset;
   // only attach a position when the exact chapter mapping can be proven.
   if(!match[3])for(const claim of item.citationClaimReview?.items||[]){if(claim.sectionId!==item.id||claim.sourceId!==proof.sourceId||claim.candidateExcerpt!==proof.quote||!Number.isSafeInteger(claim.offset)||claim.offset<0)continue;const absolute=Number(match[2])+claim.offset,marker='[source:'+proof.sourceId+']';if(String(chapter.text||'').slice(absolute,absolute+marker.length)!==marker)continue;
    for(const piece of provided){const relative=absolute-(Number.isSafeInteger(piece.originalOffset)?piece.originalOffset:0);if(relative>=0&&String(piece.text||'').slice(relative,relative+marker.length)===marker&&typeof piece.id==='string')positions.push({sectionId:piece.id,offset:relative});}
   }
   const existing=candidates.find(row=>row.id===proof.sourceId&&row.text===candidateText);if(existing){for(const position of positions)if(!existing.citationPositions.some(row=>row.sectionId===position.sectionId&&row.offset===position.offset))existing.citationPositions.push(position);}
   else candidates.push({id:proof.sourceId,text:candidateText,offset,totalCharacters:source.text.length,scope:source.scope==='abstract'?'abstract':'excerpt',citationPositions:positions,...(linked?{relatedReferenceId:parentId,authorLinkedUnverified:true}:{})});
  }
 }
 const context=task.context,sourceEvidence=context.sourceEvidence,originalInstructions=task.instructions;let added=0,limited=false;
 for(const entry of candidates){if(added>=20){limited=true;break;}let row=sourceEvidence.items.find(source=>source.id===entry.id),created=false,appended=false;
  const window={text:entry.text,...(entry.offset!==null?{offset:entry.offset}:{positionAmbiguous:true}),excerpted:true,scope:entry.scope,...(entry.citationPositions.length?{citationPositions:entry.citationPositions}:{})};
  if(!row){row={id:entry.id,scope:entry.scope,text:entry.text,...(entry.offset!==null?{offset:entry.offset}:{positionAmbiguous:true}),excerpted:true,totalCharacters:entry.totalCharacters,...(entry.citationPositions.length?{citationPositions:entry.citationPositions}:{}),...(entry.authorLinkedUnverified?{relatedReferenceId:entry.relatedReferenceId,authorLinkedUnverified:true}:{})};sourceEvidence.items.push(row);created=true;}
  else if(entry.citationPositions.length||!row.text.includes(entry.text)&&!(row.additionalWindows||[]).some(value=>value.text.includes(entry.text))){(row.additionalWindows??=[]).push(window);appended=true;}
  else continue;
  if(JSON.stringify(context).length>38000){if(created)sourceEvidence.items.pop();else if(appended){row.additionalWindows.pop();if(!row.additionalWindows.length)delete row.additionalWindows;}limited=true;break;}added++;
 }
 if(added){sourceEvidence.providedCount=sourceEvidence.items.length;sourceEvidence.limited=true;sourceEvidence.supplementExcerptCount=added;task.instructions=originalInstructions+'sourceEvidence 中补充的原文摘录以本次资料检查所定位的文字为线索，可能包含同一用户资料的前后文；前后文未必已由资料检查读取。均是用户提供的有限连续片段，可能取自同章其他引用位置，不是全文、来源真实性或论断已证实的证明。authorLinkedUnverified 表示作者将独立片段关联到 relatedReferenceId，其出处未经独立核验、与题录原文不一定连续；不得将片段冒充题录原文或据此断言来源真实。citationPositions 仅在可逐字定位时标记本批正文的引用位置；即使有此标记，也不能自动认定摘录支持该处论断。请独立核对正文每处引用的论断与摘录；不相关、缺失或不一致时保留 source_support 检查项。';}
 if(limited)sourceEvidence.supplementExcerptsLimited=true;
 return added;
}
