import {originalParagraphs} from './report-locations.mjs';
import {AIGC_PARAGRAPH_VERSION,effectiveAigcCharacters} from './aigc-partitions.mjs';
import {reportEscape as esc} from './report-document.mjs';

export function aigcParagraphReview(text,item){
 const chars=Array.from(text),paragraphs=originalParagraphs(text),modern=item.analysisVersion===AIGC_PARAGRAPH_VERSION;
 if(modern)for(const part of item.parts){
  const row=paragraphs[part.paragraphNumber-1],start=part.paragraphNumber===1?0:row?.start,end=paragraphs[part.paragraphNumber]?.start??chars.length;
  if(!row||part.start<start||part.end>end||part.effectiveCharacters!==effectiveAigcCharacters(chars.slice(part.start,part.end).join('')))throw Error('段落位置与送检原文无法核对，暂不能导出报告。');
 }
 const labels={aigc:'疑似 AI 表达',ugc:'偏人工表达',mixed:'本段结果不一致',undetermined:'暂不能明确判定'},tag=label=>label==='aigc'?'risk':label==='ugc'?'human':'unknown';
 return paragraphs.map((paragraph,index)=>{
  const start=index?paragraph.start:0,end=paragraphs[index+1]?.start??chars.length;
  const parts=item.parts.filter(part=>part.start<paragraph.end&&part.end>paragraph.start),effective=parts.filter(part=>!part.skipped),types=[...new Set(effective.map(part=>part.label))];
  const label=!types.length||types.includes('undetermined')?'undetermined':types.length>1?'mixed':types[0];
  const spans=item.parts.filter(part=>part.start<end&&part.end>start).map(part=>{
   const from=Math.max(start,part.start),to=Math.min(end,part.end),risk=part.label==='aigc'&&!part.skipped;
   return `<span class="aigc-report-text aigc-report-text-${tag(part.label)}"${risk?` id="ai-original-${paragraph.number}-${part.index+1}"`:''}>${esc(chars.slice(from,to).join(''))}</span>`;
  }).join('');
  const details=effective.map(part=>`<div class="report-review-subresult"><b class="report-tag-${tag(part.label)}">${esc(labels[part.label])}</b><p class="report-review-score">判断置信分：${part.confidence===null?'—':esc(Number(part.confidence.toFixed(2)))+' / 100'}</p>${parts.length>1?`<small class="report-muted">对应本段字符 ${Math.max(paragraph.start,part.start)-paragraph.start+1}–${Math.min(paragraph.end,part.end)-paragraph.start}</small>`:''}</div>`).join('');
  const note=!modern?'这份历史记录保留原检测范围，本段没有独立判断结果。':label==='aigc'?'该段已标记疑似 AI 表达。建议结合研究过程、数据与引用来源核对，修改时保留真实事实和必要术语。':label==='ugc'?'该段本次未标记疑似 AI 表达，仍需核对事实、数据与引用是否准确。':label==='mixed'?'该段不同范围的结果不一致，请重点核对左侧标红内容及其上下文。':'本段尚无明确结论，不默认认定为人工表达。';
  return `<tr class="report-review-row" data-ai-paragraph="${paragraph.number}"><td class="report-review-original" id="ai-paragraph-${paragraph.number}" data-cell-label="论文正文"><div class="report-paragraph-header">原文第 ${paragraph.number} 段</div><p class="report-text">${spans}</p></td><td class="report-review-detail report-review-analysis" id="ai-analysis-${paragraph.number}" data-cell-label="段落分析"><h3>${modern?'本段独立分析':'原检测范围参考'}</h3>${effective.length===1?'':`<span class="report-tag-${tag(label)}">${esc(labels[label])}</span>`}${details}<p>${esc(note)}</p>${effectiveAigcCharacters(paragraph.text)<40?'<p class="report-muted">本段文字较短，建议结合上下文核对。</p>':''}<p class="report-muted">判断置信分不等于本段 AI 字数占比。</p></td></tr>`;
 }).join('');
}
