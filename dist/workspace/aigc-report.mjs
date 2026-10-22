import {reportDocument,reportDate} from '../reports/report-document.mjs';
import {AIGC_NOTICE,aigcLabel,normalizeAigcResult} from './aigc-detection-model.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const format=value=>Number(value).toLocaleString('en-US');
const tag=label=>label==='aigc'?'risk':label==='ugc'?'human':'unknown';
const score=value=>value===null?'—':`${Number(value.toFixed(2))} / 100`;
const metric=(label,value)=>`<div class="report-metric"><strong>${escape(value)}</strong><small>${escape(label)}</small></div>`;

// Confidence belongs to the service label for the entire submitted chunk.
// It is never an AI-written character percentage or sentence-level verdict.
export function aigcReportHtml(value,{text='',title='本次送检文本',demo=false}={}){
 const item=normalizeAigcResult(value);
 if(!item.fullyCompleted)throw Error('本次鉴别尚未完整结束，不能导出完成报告。');
 const parts=item.parts;
 let offset=0;
 const validRanges=parts.every((part,index)=>{
  const valid=part.index===index&&part.start===offset&&part.end>part.start&&part.end<=item.characters&&part.characters===part.end-part.start;
  offset=part.end;return valid;
 })&&offset===item.characters;
 if(!validRanges)throw Error('分段位置与鉴别字符数无法核对，暂不能导出报告。');
 const characters=Array.from(typeof text==='string'?text:'');if(characters.length&&characters.length!==item.characters)throw Error('本次原文与鉴别字符数不一致，不能附加到报告。');const hasText=characters.length===item.characters;
 const summary=`<section class="report-panel"><h2 class="report-section-title">鉴别概览</h2><p class="report-verdict">${escape(aigcLabel(item.verdict))}</p><div class="report-metrics">${metric('本次鉴别字符',format(item.characters))}${metric('偏 AI 表达片段',item.counts.aigc)}${metric('偏人工表达片段',item.counts.ugc)}${metric('待核对片段',item.counts.undetermined)}</div><p class="report-notice">本报告不提供全篇 AI 字符占比。下列置信分仅描述单个片段标签的把握程度，不可相加、平均或换算成全篇 AI 率。</p></section>`;
 const rows=parts.map((part,index)=>`<tr><td>${index+1}</td><td>${format(part.start+1)}–${format(part.end)}</td><td>${format(part.characters)}</td><td><span class="report-tag-${tag(part.label)}">${escape(part.skipped?'空白分段，已跳过':aigcLabel(part.label))}</span></td><td>${score(part.confidence)}</td></tr>`).join('');
 const textSections=hasText?`<section class="report-panel"><h2 class="report-section-title">原文分段标记</h2><p class="report-muted">颜色表示整个送检片段的表达倾向；片段边界依据长度划分，不代表论文自然段或逐句判定。</p>${parts.map((part,index)=>`<section class="aigc-report-part"><div class="aigc-report-part-head"><h3>片段 ${index+1}</h3><span class="report-tag-${tag(part.label)}">${escape(part.skipped?'空白分段，已跳过':aigcLabel(part.label))}</span><span class="report-muted">字符 ${format(part.start+1)}–${format(part.end)} · 标签置信分 ${score(part.confidence)}</span></div><div class="report-text aigc-report-text aigc-report-text-${tag(part.label)}">${escape(characters.slice(part.start,part.end).join(''))}</div></section>`).join('')}</section>`:`<section class="report-panel"><h2 class="report-section-title">原文核对说明</h2><p class="report-notice">当前历史记录不保存正文，报告仅包含实际鉴别结果和字符位置，不含原文标记。请结合送检原稿核对；当前编辑器中的其他文本不会被附加到此报告。</p></section>`;
 const body=`<section class="report-panel"><h2 class="report-section-title">分段结果明细</h2><table class="report-table"><thead><tr><th>片段</th><th>字符位置</th><th>字符数</th><th>表达倾向</th><th>标签置信分</th></tr></thead><tbody>${rows}</tbody></table></section>${textSections}<section class="report-panel"><h2 class="report-section-title">指标解释与复核建议</h2><p>偏 AI 表达、偏人工表达均为本次送检片段的倾向标签，不能证明作者身份或具体生成过程。暂不能明确判定的片段需要人工核对，不会被默认计入人工表达。</p><p>请结合研究过程、数据材料、引用来源和修改记录判断。保留真实数据、公式和必要术语，核查引用；不要仅凭本报告作出学术处分或身份判断。</p><p class="report-muted">结果适用于本次实际提交的文本；编辑后的版本需要重新检测。报告编号用于账户内记录核对，不是第三方认证编号。</p></section>`;
 return reportDocument({title,type:'AIGC 文本鉴别报告',id:item.id,createdAt:item.createdAt,scope:'本次提交文本的分段 AI 表达倾向鉴别',metadata:[['完成时间',reportDate(item.updatedAt)],['已处理片段',`${item.completedParts} / ${item.partCount}`],['原文呈现',hasText?'包含本次提交的原文分段':'历史摘要；未附原文'],['鉴别粒度','长度片段；不作逐句判定']],summary,body,notice:AIGC_NOTICE,demo});
}
