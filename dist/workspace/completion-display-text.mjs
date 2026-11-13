// Only for presentation: the saved source markers and exact-match locations remain unchanged.
export function visibleCompletionSources(value,references=[]){
 const titles=new Map(references.map(row=>[String(row.id||''),String(row.title||row.name||'').trim().slice(0,100)]));
 return String(value??'').replace(/\[source:([^\]\s，。；、：！？…]*)(\])?/gu,(_,id,close)=>{if(!close)return '〔来源信息〕';const title=titles.get(id);return title?'〔文献：'+title+'〕':id.startsWith('material:')?'〔研究资料〕':'〔来源信息〕';});
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
