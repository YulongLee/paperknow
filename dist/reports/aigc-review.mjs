import {originalParagraphs} from './report-locations.mjs';
import {AIGC_PARAGRAPH_VERSION,effectiveAigcCharacters} from './aigc-partitions.mjs';
import {reportEscape as esc} from './report-document.mjs';
import {reportSentences,sentenceEditAdvice} from './sentence-advice.mjs';

export function aigcParagraphReview(text,item){
 const chars=Array.from(text),paragraphs=originalParagraphs(text),modern=item.analysisVersion===AIGC_PARAGRAPH_VERSION;
 if(modern)for(const part of item.parts){
  const row=paragraphs[part.paragraphNumber-1],start=part.paragraphNumber===1?0:row?.start,end=paragraphs[part.paragraphNumber]?.start??chars.length;
  if(!row||part.start<start||part.end>end||part.effectiveCharacters!==effectiveAigcCharacters(chars.slice(part.start,part.end).join('')))throw Error('段落位置与送检原文无法核对，暂不能导出报告。');
 }
 const labels={aigc:'疑似 AI 表达',ugc:'偏人工表达',mixed:'本段结果不一致',undetermined:'暂不能明确判定'},tag=label=>label==='aigc'?'risk':label==='ugc'?'human':'unknown';
 let fence='',displayMath=false;
 return paragraphs.map((paragraph,index)=>{
  const start=index?paragraph.start:0,end=paragraphs[index+1]?.start??chars.length;
  const parts=item.parts.filter(part=>part.start<paragraph.end&&part.end>paragraph.start),effective=parts.filter(part=>!part.skipped),types=[...new Set(effective.map(part=>part.label))];
  const showAnalysis=effective.some(part=>part.label!=='ugc');
  const label=!types.length||types.includes('undetermined')?'undetermined':types.length>1?'mixed':types[0];
  const marker=paragraph.text.trim().match(/^(`{3,}|~{3,})/),literal=Boolean(fence||marker||displayMath||/^\s*(?:\$\$|\\\[|\\begin\{|\[\d+\]\s*\S)/.test(paragraph.text));
  if(marker){if(!fence)fence=marker[1][0];else if(fence===marker[1][0])fence='';}
  if(!fence&&((paragraph.text.match(/\$\$/g)||[]).length%2||/^\s*\\\[$/.test(paragraph.text)||/^\s*\\\]$/.test(paragraph.text)))displayMath=!displayMath;
  const sentences=reportSentences(paragraph.text,{literal}).map(sentence=>({...sentence,start:paragraph.start+sentence.start,end:paragraph.start+sentence.end,target:`ai-sentence-${paragraph.number}-${sentence.index}`,adviceTarget:`ai-advice-${paragraph.number}-${sentence.index}`}));
  const details=effective.map(part=>`<div class="report-review-subresult"><b class="report-tag-${tag(part.label)}">${esc(labels[part.label])}</b><span class="report-review-score">判断置信分：${part.confidence===null?'—':esc(Number(part.confidence.toFixed(2)))+' / 100'}</span>${parts.length>1?`<small class="report-muted">对应本段字符 ${Math.max(paragraph.start,part.start)-paragraph.start+1}–${Math.min(paragraph.end,part.end)-paragraph.start}</small>`:''}</div>`).join('');
  const note=!modern?'这份历史记录保留原检测范围，本段没有独立判断结果。':label==='undetermined'?'本段尚无明确结论，不默认认定为人工表达。':label==='mixed'?'本段不同范围的检测结果不一致，标注保留其实际范围。':'';
  return sentences.map((sentence,sentenceIndex)=>{
   const first=sentenceIndex===0,from=first?start:sentence.start,to=sentenceIndex===sentences.length-1?end:sentence.end;
   const spans=item.parts.filter(part=>part.start<to&&part.end>from).map(part=>{
    const a=Math.max(from,part.start),b=Math.min(to,part.end),risk=part.label==='aigc'&&!part.skipped,s=Math.max(a,sentence.start),e=Math.min(b,sentence.end);
    const content=s<e?esc(chars.slice(a,s).join(''))+`<span class="report-sentence"${s===sentence.start?` id="${sentence.target}"`:''}>${esc(chars.slice(s,e).join(''))}</span>`+esc(chars.slice(e,b).join('')):esc(chars.slice(a,b).join(''));
    return `<span class="aigc-report-text aigc-report-text-${tag(part.label)}"${risk&&a===Math.max(start,part.start)?` id="ai-original-${paragraph.number}-${part.index+1}"`:''}>${content}</span>`;
   }).join('');
   const result=showAnalysis?sentenceEditAdvice(sentence.text,{literal}):null;
   const advice=showAnalysis?`<article class="report-sentence-card" id="${sentence.adviceTarget}"><header><a href="#${sentence.target}">第 ${sentence.index} 句 · 定位原文 ↓</a><span>${result.kind==='edit'?'可精简表达':result.kind==='retain'?'建议保留':'核对与完善'}</span></header><ul>${result.issues.map(issue=>`<li><strong>${esc(issue.title)}</strong>：${esc(issue.detail)}</li>`).join('')}</ul>${result.revised?`<div class="report-sentence-rewrite"><b>参考改写</b><p>${esc(result.revised)}</p></div>`:''}</article>`:'';
   return `<tr class="report-review-row"${first?` data-ai-paragraph="${paragraph.number}"`:''} data-ai-sentence-row="${paragraph.number}-${sentence.index}"><td class="report-review-original"${first?` id="ai-paragraph-${paragraph.number}"`:''} data-cell-label="论文正文"><div class="report-paragraph-header">原文第 ${paragraph.number} 段 · 第 ${sentence.index} 句</div><p class="report-text">${spans}</p></td><td class="report-review-detail report-review-analysis"${first?` id="ai-analysis-${paragraph.number}"`:''} data-cell-label="逐句修改建议">${showAnalysis&&first?`<div class="report-paragraph-verdict"><h3>${modern?'本段独立分析':'原检测范围参考'}</h3>${effective.length===1?'':`<span class="report-tag-${tag(label)}">${esc(labels[label])}</span>`}${details}${note?`<p class="report-muted">${esc(note)}</p>`:''}${effectiveAigcCharacters(paragraph.text)<40?'<p class="report-muted">本段文字较短，建议结合上下文核对。</p>':''}</div>`:''}${showAnalysis&&first?`<h4 class="report-sentence-heading">逐句修改建议 · 本段 ${sentences.length} 句</h4>`:''}${advice}</td></tr>`;
  }).join('');
 }).join('');
}
