import {aigcLocations} from '../reports/report-locations.mjs';
import {reportDocument,reportDate} from '../reports/report-document.mjs';
import {AIGC_NOTICE,aigcLabel,normalizeAigcResult,aigcLabelCoverage} from './aigc-detection-model.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const format=value=>Number(value).toLocaleString('en-US');
const tag=label=>label==='aigc'?'risk':label==='ugc'?'human':'unknown';
const score=value=>value===null?'—':`${Number(value.toFixed(2))} / 100`;
const metric=(label,value)=>`<div class="report-metric"><strong>${escape(value)}</strong><small>${escape(label)}</small></div>`;

// Confidence belongs to the service label for the entire submitted chunk.
// It is never an AI-written character percentage or sentence-level verdict.
export function aigcReportHtml(value,{text='',title=value?.title||'本次送检论文',demo=false}={}){
 const item=normalizeAigcResult(value);
 if(!item.fullyCompleted)throw Error('本次鉴别尚未完整结束，不能导出完成报告。');
 const parts=item.parts,coverage=aigcLabelCoverage(item);
 let offset=0;
 const validRanges=parts.every((part,index)=>{
  const valid=part.index===index&&part.start===offset&&part.end>part.start&&part.end<=item.characters&&part.characters===part.end-part.start;
  offset=part.end;return valid;
 })&&offset===item.characters;
 if(!validRanges)throw Error('分段位置与鉴别字符数无法核对，暂不能导出报告。');
 const characters=Array.from(typeof text==='string'?text:'');if(characters.length&&characters.length!==item.characters)throw Error('本次原文与鉴别字符数不一致，不能附加到报告。');const hasText=characters.length===item.characters;
 const locations=hasText&&coverage.available?aigcLocations(text,parts):{visible:[],total:0};
 const markedPart=part=>{
  let cursor=part.start,html='';
  for(const paragraph of locations.visible){const from=Math.max(part.start,paragraph.start),to=Math.min(part.end,paragraph.end);if(to<=from)continue;
   html+=escape(characters.slice(cursor,from).join(''));const id=part.index===paragraph.partIndex?` id="${paragraph.target}"`:'';
   html+=`<span class="report-original-segment"${id} data-paragraph-label="〔原文第${paragraph.number}段${from>paragraph.start?' 续':''}〕">${escape(characters.slice(from,to).join(''))}</span>`;cursor=to;
  }
  return html+escape(characters.slice(cursor,part.end).join(''));
 };
 const findingIndex=`<section class="report-panel" id="report-findings"><h2 class="report-section-title">二  疑似范围与原文定位</h2>${!hasText?'<p class="report-muted">本条历史记录缺少送检原文，暂不能提供原文定位；不会使用当前编辑器的其他文本替代。</p>':!coverage.available?'<p class="report-muted">尚未形成完整有效结论，暂无可发布的疑似范围定位。</p>':locations.total?`<p>本次疑似范围涉及 ${locations.total} 段原文。点击“定位原文”，查看对应文字与上下文。</p><p class="report-muted">以下段落落在实际被标记的送检片段范围内。结论以该片段为单位，不表示其中每一句话都单独判为 AI 生成。</p><table class="report-table report-findings-table"><thead><tr><th style="width:19%">原文位置</th><th>送检原文摘录</th><th style="width:19%">核对入口</th></tr></thead><tbody>${locations.visible.map(row=>`<tr><td>原文第 ${row.number} 段<br><small>字符 ${format(row.startOfRisk+1)}–${format(row.endOfRisk)}</small></td><td><p class="report-text">${escape(row.excerpt)}</p><small class="report-muted">所在送检片段 ${row.partIndices.map(index=>index+1).join('、')}</small></td><td><a class="report-locate-link" href="#${row.target}">定位原文 ↓</a></td></tr>`).join('')}</tbody></table>${locations.total>locations.visible.length?'<p class="report-muted">定位列表展示前300段；下方全文标注仍保留全部送检文字和实际片段标签。</p>':''}`:'<p>本次未标记疑似 AI 片段。可在“全文标注”中核对完整送检原文；这不代表作者身份或研究过程已获确认。</p>'}</section>`;
 const summary=`<section class="report-panel" id="report-summary"><h2 class="report-section-title">一  检测结果总览</h2><p class="report-verdict">${escape(aigcLabel(item.verdict))}</p><div class="report-metrics">${metric('疑似 AI 片段字符占比',coverage.available?(coverage.ratio*100).toFixed(1)+'%':'暂不能计算')}${metric('疑似 AI 片段字符数',coverage.available?format(coverage.aiCharacters):'未形成有效统计')}${metric('有效检测字符',coverage.available?format(coverage.testedCharacters):'未形成有效统计')}${metric('本次送检字符',format(item.characters))}</div><p class="report-notice">疑似 AI 片段字符占比 = 判为偏 AI 表达的分段字符数 ÷ 已完成且有明确标签的非空白分段字符数。该指标按整段标签统计，不是逐字或逐句的 AI 作者判定；置信分不可平均或换算成 AI 率。存在无法判定或未完成片段时，不给出占比。</p></section>`;
 const rows=parts.map((part,index)=>`<tr><td>${hasText&&coverage.available&&parts[index].label==='aigc'&&locations.visible.some(row=>row.partIndex===index)?`<a href="#${locations.visible.find(row=>row.partIndex===index).target}">${index+1} · 定位原文</a>`:index+1}</td><td>${format(part.start+1)}–${format(part.end)}</td><td>${format(part.characters)}</td><td><span class="report-tag-${tag(part.label)}">${escape(part.skipped?'空白分段，已跳过':aigcLabel(part.label))}</span></td><td>${score(part.confidence)}</td></tr>`).join('');
 const textSections=hasText?`<section class="report-panel report-page-break" id="report-text"><h2 class="report-section-title">四  全文标注</h2><div class="report-legend"><span><i style="background:#dc6a62"></i>疑似 AI 表达片段</span><span><i style="background:#35a788"></i>偏人工表达片段</span><span><i style="background:#c49742"></i>未判定或跳过</span></div><p class="report-muted">颜色表示整个送检片段的表达倾向；片段边界依据长度划分，不代表论文自然段或逐句判定。</p>${parts.map((part,index)=>`<section class="aigc-report-part"><div class="aigc-report-part-head"><h3>片段 ${index+1}</h3><span class="report-tag-${tag(part.label)}">${escape(part.skipped?'空白分段，已跳过':aigcLabel(part.label))}</span><span class="report-muted">字符 ${format(part.start+1)}–${format(part.end)} · 标签置信分 ${score(part.confidence)}</span><a class="report-original-back" href="#report-findings">返回疑似定位 ↑</a></div><div class="report-text aigc-report-text aigc-report-text-${tag(part.label)}">${markedPart(part)}</div></section>`).join('')}</section>`:`<section class="report-panel" id="report-text"><h2 class="report-section-title">四  原文核对说明</h2><p class="report-notice">当前历史记录不保存正文，报告仅包含实际鉴别结果和字符位置，不含原文标记。请结合送检原稿核对；当前编辑器中的其他文本不会被附加到此报告。</p></section>`;
 const body=`${findingIndex}<section class="report-panel" id="report-parts"><h2 class="report-section-title">三  检测明细</h2><table class="report-table"><thead><tr><th>片段</th><th>字符位置</th><th>字符数</th><th>表达倾向</th><th>标签置信分</th></tr></thead><tbody>${rows}</tbody></table></section>${textSections}<section class="report-panel" id="report-method"><h2 class="report-section-title">五  指标解释与检测说明</h2><p>偏 AI 表达、偏人工表达均为本次送检片段的倾向标签，不能证明作者身份或具体生成过程。暂不能明确判定的片段需要人工核对，不会被默认计入人工表达。</p><p>请结合研究过程、数据材料、引用来源和修改记录判断。保留真实数据、公式和必要术语，核查引用；不要仅凭本报告作出学术处分或身份判断。</p><p class="report-muted">结果适用于本次实际提交的文本；编辑后的版本需要重新检测。报告编号用于账户内记录核对，不是第三方认证编号。</p></section>`;
 return reportDocument({title,type:'论文 AI 率检测报告',id:item.id,createdAt:item.createdAt,scope:'本次提交文本的分段 AI 表达倾向鉴别',navigation:[['report-summary','检测总览'],['report-findings','疑似原文定位'],['report-parts','检测明细'],['report-text','全文标注'],['report-method','检测说明']],metadata:[['完成时间',reportDate(item.updatedAt)],['统计口径','疑似 AI 片段字符数 / 有明确标签的检测字符数'],['已处理片段',`${item.completedParts} / ${item.partCount}`],['原文呈现',hasText?'包含本次提交的原文分段':'历史摘要；未附原文'],['鉴别粒度','长度片段；不作逐句判定']],summary,body,notice:AIGC_NOTICE,demo});
}
