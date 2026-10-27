import {similarityLocations,aigcLocations,locationExcerpt} from '../reports/report-locations.mjs';
import {aigcLabelCoverage} from './aigc-detection-model.mjs';
import {esc} from './ui.mjs';
import {publicSourceHref} from '../precheck/source-url.mjs';
export function similarityFindingSummary(report){
 const findings=similarityLocations(report).filter(row=>row.matches.length);if(!findings.length)return '';
 return `<section class="detection-findings" aria-label="重复原文定位"><h4>原文问题定位</h4><p>本次有 ${findings.length} 段文字存在实际匹配，可直接查看原文与命中来源的左右对照。</p><ol>${findings.slice(0,5).map(row=>`<li><strong>${esc(row.section.title)} · 第 ${row.index} 段</strong><p>${esc(locationExcerpt(row.paragraph.text,...row.matches[0].range).text)}</p><button class="btn secondary" type="button" data-web-location="${row.comparisonTarget}">查看原文与来源对照</button></li>`).join('')}</ol>${findings.length>5?'<p>此处列出前5段，完整报告中可定位全部匹配段落。</p>':''}</section>`;
}
export function aigcFindingSummary(item,text){
 if(!text||Array.from(text).length!==item.characters||!aigcLabelCoverage(item).available)return '';
 const locations=aigcLocations(text,item.parts);if(!locations.total)return '';
 return `<section class="detection-findings" aria-label="疑似AI原文定位"><h4>疑似范围与原文定位</h4><p>疑似范围涉及 ${locations.total} 段原文。点击查看对应文字和上下文；结论仍以实际送检片段为单位。</p><ol>${locations.visible.slice(0,5).map(row=>`<li><strong>原文第 ${row.number} 段</strong><p>${esc(row.excerpt)}</p><button class="btn secondary" type="button" data-aigc-location="${row.target}">查看疑似范围原文</button></li>`).join('')}</ol>${locations.total>5?'<p>此处列出前5段，更多定位见完整报告。</p>':''}</section>`;
}
export function locateReportFrame(frame,fragment,isCurrent){
 frame.addEventListener('load',()=>{
  if(!isCurrent())return;const doc=frame.contentDocument;if(!doc)return;
  if(/^(?:original-paragraph-\d+|comparison-paragraph-\d+|ai-original-\d+-\d+)$/.test(fragment))doc.getElementById(fragment)?.scrollIntoView?.({block:'start'});
  // Keep the report's strict sandbox. Only an explicit customer click on a
  // validated public source may open a separate window in the parent context.
  doc.addEventListener('click',event=>{const anchor=event.target.closest?.('a[href]');if(!anchor)return;const href=publicSourceHref(anchor.getAttribute('href'));if(!href)return;event.preventDefault();if(isCurrent())frame.ownerDocument.defaultView.open(href,'_blank','noopener,noreferrer');});
 },{once:true});
}
