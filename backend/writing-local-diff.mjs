// Validate the scope of an existing full-text response. This cannot establish factual correctness.
const safeString=value=>typeof value==='string'&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const terminalMarkCounts=text=>{const counts=new Map();for(const hit of text.matchAll(/[。！？](?:(?:[ \t\u3000]+)|(?:\[source:[^\]\r\n]{1,160}\])|(?:〔(?:材料|文献)\d+〕)){0,10}[。！？、，；：]/gu)){const key=hit[0].replace(/[ \t\u3000]/gu,'');counts.set(key,(counts.get(key)||0)+1);}return counts;};

export function localReviewScope(original,findings){
 if(!safeString(original)||!Array.isArray(findings)||!findings.length||findings.length>6)return {eligible:false,reason:'no_located_findings'};
 // Any contact with a citation or figure token is forbidden, including a
 // quote containing only part of a token (such as just its identifier).
 const protectedSpans=[];
 for(const match of original.matchAll(/\[(?:source|figure):/gu)){
  const end=original.indexOf(']',match.index),newline=original.indexOf('\n',match.index);
  if(end<0||(newline>=0&&newline<end))return {eligible:false,reason:'malformed_object_marker'};
  protectedSpans.push({start:match.index,end:end+1});
 }
 const spans=[];
 for(const finding of findings){
  const quote=finding?.quote;
  if(!safeString(quote)||!quote.trim()||quote.length>500||/[\n\r|`$<>]|\[(?:source|figure):/u.test(quote))return {eligible:false,reason:'complex_or_invalid_anchor'};
  const start=original.indexOf(quote);
  if(start<0||original.indexOf(quote,start+1)!==-1)return {eligible:false,reason:'stale_or_ambiguous_anchor'};
  const end=start+quote.length,lineStart=original.lastIndexOf('\n',start-1)+1,lineEnd=original.indexOf('\n',start),line=original.slice(lineStart,lineEnd<0?original.length:lineEnd),before=original.slice(0,lineStart);
  if(protectedSpans.some(value=>start<value.end&&end>value.start))return {eligible:false,reason:'anchor_touches_object_marker'};
  // A source marker elsewhere on the line is immutable because it remains in
  // the verified prefix, suffix or separator. Markers inside the anchor remain
  // forbidden, as do changes to images, equations, code and tables.
  if((before.match(/^\s*```/gm)||[]).length%2||(before.match(/\$\$/g)||[]).length%2||/[|`$<>]|\[figure:/u.test(line))return {eligible:false,reason:'complex_object'};
  spans.push({start,end});
 }
 spans.sort((a,b)=>a.start-b.start);
 // Overlapping findings authorize exactly their union, never the intervening
 // text between separate findings. Each original anchor was already checked.
 for(let index=1;index<spans.length;){if(spans[index].start<spans[index-1].end){spans[index-1].end=Math.max(spans[index-1].end,spans[index].end);spans.splice(index,1);}else index++;}
 // Adjacent findings have no immutable separator and cannot be distinguished.
 if(spans.some((value,index)=>index&&value.start===spans[index-1].end))return {eligible:false,reason:'adjacent_anchors'};
 return {eligible:true,spans};
}

export function verifyLocalReviewCandidate(original,findings,candidate){
 const scope=localReviewScope(original,findings);
 if(!scope.eligible)return {...scope,accepted:false};
 if(!safeString(candidate))return {eligible:true,accepted:false,reason:'invalid_candidate'};
 const spans=scope.spans,prefix=original.slice(0,spans[0].start),suffix=original.slice(spans.at(-1).end);
 if(!candidate.startsWith(prefix)||!candidate.endsWith(suffix)||candidate.length<prefix.length+suffix.length)return {eligible:true,accepted:false,reason:'outside_scope_changed'};
 const limit=candidate.length-suffix.length;let cursor=prefix.length;const replacements=[];
 for(let index=0;index<spans.length-1;index++){
  const separator=original.slice(spans[index].end,spans[index+1].start),at=candidate.indexOf(separator,cursor);
  if(at<0||at+separator.length>limit||candidate.indexOf(separator,at+1)!==-1&&candidate.indexOf(separator,at+1)<limit)return {eligible:true,accepted:false,reason:'outside_scope_changed_or_ambiguous'};
  replacements.push(candidate.slice(cursor,at));
  cursor=at+separator.length;
 }
 replacements.push(candidate.slice(cursor,limit));
 if(replacements.some((value,index)=>/[\n\r|`$<>]|\[(?:source|figure):/u.test(value)||value.length>Math.max(500,(spans[index].end-spans[index].start)*3)))return {eligible:true,accepted:false,reason:'complex_replacement'};
 return {eligible:true,accepted:true,changed:candidate!==original,requiresFullReview:true};
}

// Patch output only controls replacements at pre-frozen anchors. It is never
// a final result: the merged full candidate must still pass the ordinary
// writing parser, source-read checks, length limits and final review.
export function materializeLocalReviewCandidate(original,findings,body){
 const scope=localReviewScope(original,findings);
 const reject=reason=>{throw Object.assign(Error('局部修订内容未通过核对'),{localPatchReason:reason});};
 if(!scope.eligible)reject('anchor');
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['complete','edits','source_ids','missing_evidence'].includes(key))||body.complete!==true||!Array.isArray(body.edits))reject('structure');
 if(body.edits.length!==scope.spans.length)reject('count');
 let text='',cursor=0;const changes=[];
 for(let index=0;index<scope.spans.length;index++){
  const span=scope.spans[index],edit=body.edits[index];
  if(!edit||typeof edit!=='object'||Array.isArray(edit)||Object.keys(edit).some(key=>!['index','replacement'].includes(key)))reject('structure');
  if(edit.index!==index+1)reject('order');
  if(!safeString(edit.replacement))reject('replacement');
  if(/[\n\r|`$<>]|\[(?:source|figure):/u.test(edit.replacement))reject('protected_content');
  if(edit.replacement.length>Math.max(500,(span.end-span.start)*3))reject('length');
  text+=original.slice(cursor,span.start);const start=text.length;text+=edit.replacement;changes.push({oldStart:span.start,oldEnd:span.end,newStart:start,newEnd:text.length});cursor=span.end;
 }
 text+=original.slice(cursor);
 if(!verifyLocalReviewCandidate(original,findings,text).accepted)reject('scope');
 const position=offset=>{let delta=0;for(const item of changes){if(offset<=item.oldStart)return offset+delta;if(offset<item.oldEnd)throw Error('invalid review window');delta+=(item.newEnd-item.newStart)-(item.oldEnd-item.oldStart);}return offset+delta;};
 for(const change of changes){
  let left=Math.max(0,change.oldStart-2000),right=Math.min(original.length,change.oldEnd+2000);
  for(const item of changes){if(item.oldStart<left&&left<item.oldEnd)left=item.oldStart;if(item.oldStart<right&&right<item.oldEnd)right=item.oldEnd;}
  const before=terminalMarkCounts(original.slice(left,right));
  const after=terminalMarkCounts(text.slice(position(left),position(right)));
  if([...after].some(([key,count])=>count>(before.get(key)||0)))reject('punctuation');
 }
 return {complete:true,text,source_ids:body.source_ids,missing_evidence:body.missing_evidence};
}
