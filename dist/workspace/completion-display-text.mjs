// Only for presentation: the saved source markers and exact-match locations remain unchanged.
export function visibleCompletionSources(value,references=[]){
 const titles=new Map(references.map(row=>[String(row.id||''),String(row.title||row.name||'').trim().slice(0,100)]));
 const clean=String(value??'').replace(/\[source:([^\]\s，。；、：！？…]*)(\])?/gu,(_,id,close)=>{if(!close)return '〔来源信息〕';const title=titles.get(id);return title?'〔文献：'+title+'〕':id.startsWith('material:')?'〔研究资料〕':'〔来源信息〕';});
 return clean.split(/(?<=[。；;！？\n])/u).map(part=>/\b(?:evidenceLimit|maxOutputTokens|checkedFigureIds|sourceId|manuscriptAnchorId|quoteAnchor|read_materials?)\b/iu.test(part)?'请继续核对引用来源及正文依据。':part.replace(/\b(?:reference|material):[a-z0-9_-]+/giu,id=>titles.get(id)?'《'+titles.get(id)+'》':'相关资料').replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,'相关资料').replace(/(?:本次)?逐引用检查将\s+(.+?)\s+标为\s+(unsupported|supported|uncertain)\b/giu,(_,source,status)=>source+'的引用'+({supported:'已有依据',unsupported:'未找到依据',uncertain:'尚需核对'}[status.toLowerCase()]))).join('');
}
export function completionQuoteContext(chapter,quote){
 const text=String(chapter??''),needle=String(quote??'').trim();if(!needle)return '';
 const at=text.indexOf(needle);if(at<0||text.indexOf(needle,at+1)>=0)return '';
 const left=Math.max(0,at-80),right=Math.min(text.length,at+needle.length+80),limit=500;
 let start=left,end=right;if(end-start>limit)end=start+limit;
 if(start>0&&/[\uDC00-\uDFFF]/u.test(text[start]))start--;
 if(end<text.length&&/[\uD800-\uDBFF]/u.test(text[end-1]))end--;
 return (start?'…':'')+text.slice(start,end)+(end<text.length?'…':'');
}
