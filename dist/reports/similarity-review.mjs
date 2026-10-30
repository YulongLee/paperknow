import {reportEscape as esc} from './report-document.mjs';
import {similarityLocations} from './report-locations.mjs';
import {highlightHtml,evidencePreview} from '../precheck/report-highlight.mjs';
import {rangeCount} from '../precheck/engine.mjs';
import {publicSourceHref} from '../precheck/source-url.mjs';

// Every matching source remains visible. Only quoted excerpts are bounded;
// original text, evidence offsets and stored report objects remain unchanged.
export function similarityReview(report,sourceMap){
 const rows=similarityLocations(report),byParagraph=new Map(rows.map(row=>[row.paragraph,row])),web=report.mode==='web';
 let excerpts=120,remaining=5000;const used=new Map(),sourceChars=new Map();
 const sourceCard=(source,matches,paragraph)=>{
  const href=publicSourceHref(source.url),first=evidencePreview(matches,1)[0];
  if(!sourceChars.has(source.id))sourceChars.set(source.id,Array.from(source.text||''));
  const chars=sourceChars.get(source.id);
  let snippet='',omitted=false;
  if(first&&excerpts>0&&Array.isArray(first.sourceRange)&&first.sourceRange.length===2&&first.sourceRange.every(Number.isSafeInteger)&&first.sourceRange[0]>=0&&first.sourceRange[1]>first.sourceRange[0]&&first.sourceRange[1]<=chars.length){
   const raw=chars.slice(...first.sourceRange).join(''),allow=web?Math.max(0,Math.min(240,1200-(used.get(source.id)||0),remaining)):240;
   snippet=Array.from(raw).slice(0,allow).join('');omitted=Array.from(snippet).length<Array.from(raw).length;
   if(snippet){excerpts--;const length=Array.from(snippet).length;remaining-=length;used.set(source.id,(used.get(source.id)||0)+length);}
  }
  const characters=rangeCount(paragraph.text,matches.map(match=>match.range));
  const metadata=[source.authors?.join('、'),source.year,source.doi?'DOI：'+source.doi:''].filter(Boolean);
  return `<article class="report-source-match" data-source-id="${esc(source.id)}"><header><b><a href="#source-${source.number}">[${source.number}] ${esc(source.fileName||source.title)}</a></b><span class="report-source-match-count">本段匹配 ${characters} 字符</span></header>${metadata.length?`<p class="report-source-info">${esc(metadata.join(' · '))}</p>`:''}${snippet?`<p class="report-source-excerpt"><mark class="matched">${esc(snippet)}</mark>${omitted?'…':''}</p>${omitted&&web?'<p class="report-muted">片段已省略；完整来源请访问原网页。</p>':''}`:'<p class="report-muted">匹配位置已标注，请结合来源原文核对。</p>'}<p class="report-source-info">${href?`<a href="${esc(href)}" target="_blank" rel="noreferrer noopener">查看来源原文 ↗</a>`:`<a href="#source-${source.number}">查看来源信息 ↓</a>`}</p></article>`;
 };
 return `<section class="report-panel report-page-break" id="report-text"><h2 class="report-section-title">五  正文与相似来源对照</h2><div class="report-legend"><span><i style="background:#efaea9"></i>实际文字匹配</span><span><i style="background:#a1d9c4"></i>匹配中的已识别引用</span><span><i style="background:#dce2eb"></i>未参与检测</span></div><p class="report-muted">左侧保留论文正文与标注，右侧仅在有实际匹配时列出相似来源和匹配片段，未匹配段落留空。正文标注保留匹配范围，并提供代表性片段的左右对照，方便逐段核对。</p><table class="report-review-table" aria-label="论文正文与相似来源逐段对照"><colgroup><col style="width:55%"><col style="width:45%"></colgroup><thead><tr><th>论文正文 · 相似内容标注</th><th>相似来源 · 对应匹配内容</th></tr></thead><tbody>${(report.sections||[]).map(section=>`<tr class="report-review-chapter"><th colspan="2">${esc(section.title)}${section.included?'':' · 未参与检测'}</th></tr>${(section.paragraphs||[]).map(paragraph=>{
  const row=byParagraph.get(paragraph),groups=new Map();
  for(const match of row.matches){if(!groups.has(match.sourceId))groups.set(match.sourceId,[]);groups.get(match.sourceId).push(match);}
  return `<tr class="report-review-row"><td class="report-paragraph report-review-original ${section.included?'':'report-excluded'}" id="${row.target}" data-cell-label="论文正文"><div class="report-paragraph-header">第 ${row.index} 段</div><p class="report-text">${section.included?highlightHtml(paragraph.text,row.matches):esc(paragraph.text)}</p></td><td class="report-comparisons report-review-detail" id="${row.comparisonTarget}" data-cell-label="相似来源">${section.included&&groups.size?[...groups].map(([id,matches])=>sourceMap.has(id)?sourceCard(sourceMap.get(id),matches,paragraph):'<p class="report-muted">本段匹配依据暂不可读取，请核对原报告。</p>').join(''):''}</td></tr>`;
 }).join('')}`).join('')}</tbody></table></section>`;
}
