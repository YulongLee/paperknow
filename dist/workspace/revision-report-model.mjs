export const reportSources=Object.freeze({paperknow:'PaperKnow（用户提供）',cnki:'知网（用户声明）',wanfang:'万方（用户声明）',vip:'维普（用户声明）',gzd:'格子达（用户声明）',other:'其他报告（用户声明）'});
export const revisionReportLimits=Object.freeze({rawText:100000,candidates:120,candidateCharacters:32000,confirmedCharacters:10000,excerpt:2000});
const fail=message=>{throw Error(message);},plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const controls=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const effective=value=>Array.from(String(value).normalize('NFKC').replace(/[\s\p{Default_Ignorable_Code_Point}]/gu,'')).length;
const label=value=>String(value||'').split(/[\\/]/).at(-1).normalize('NFKC').replace(/[<>\u0000-\u001f\u007f-\u009f]/g,'').replace(/\s+/g,' ').trim().slice(0,200);
const keyOf=value=>String(value).normalize('NFKC').replace(/\s/gu,'');

/** Every normalized UTF-16 unit points to the original complete grapheme. */
export function normalizeRevisionReportText(value){
 const text=String(value),spans=[];let key='';
 const segments=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(row=>({text:row.segment,start:row.index})):Array.from(text.matchAll(/[^\p{M}]\p{M}*|\p{M}+/gu),match=>({text:match[0],start:match.index}));
 for(const segment of segments){const normalized=segment.text.normalize('NFKC');for(const character of normalized){if(/\s/u.test(character))continue;key+=character;for(let i=0;i<character.length;i++)spans.push({start:segment.start,end:segment.start+segment.text.length});}}
 // Unsupported old engines must not invent offsets for cross-segment composition.
 if(key!==keyOf(text))return{key:'',spans:[],unsupported:true};return{key,spans};
}
export function normalizeRevisionReport(input={}){
 if(!plain(input)||!Object.hasOwn(reportSources,input.source))fail('请选择报告来源；来源仅代表你的声明。');
 if(typeof input.text!=='string'||!input.text.trim()||input.text.length>revisionReportLimits.rawText||controls.test(input.text))fail('报告文本应为 1～100,000 字符，不能包含控制字符。');
 const text=input.text.trim(),leading=input.text.indexOf(text),format=['paste','txt','docx','pdf','html'].includes(input.format)?input.format:'paste',explicitExcerpts=[];
 if(input.explicitExcerpts!==undefined){if(!Array.isArray(input.explicitExcerpts)||input.explicitExcerpts.length>120)fail('显式报告片段最多 120 项。');for(const part of input.explicitExcerpts){if(!plain(part)||!Number.isSafeInteger(part.start)||!Number.isSafeInteger(part.end)||part.start<leading||part.end<=part.start||part.end>leading+text.length)fail('报告片段位置无效，请重新提取报告。');explicitExcerpts.push({start:part.start-leading,end:part.end-leading});}}
 // Unmarked text can only match a complete original paragraph. Partial snippets
 // need an explicit report label or an HTML mark, never a score or title guess.
 for(const match of text.matchAll(/(?:^|\n)[ \t]*(?:原文片段|疑似片段|检测片段|命中片段|标注片段|原文摘录|片段|摘录|原文)[ \t]*[:：][ \t]*([^\n]+)/g)){const value=match[1].trim(),start=match.index+match[0].indexOf(match[1])+match[1].indexOf(value);if(value)explicitExcerpts.push({start,end:start+value.length});}
 const unique=[...new Map(explicitExcerpts.map(part=>[part.start+':'+part.end,part])).values()];if(unique.length>120)fail('显式报告片段超过 120 项，请缩小报告范围。');
 return{source:input.source,fileName:label(input.fileName),format,text,explicitExcerpts:unique};
}

/** Resource-bearing markup never reaches DOMParser; only attr-free text tags do. */
export function extractRevisionReportHtml(html,DOMParserClass=globalThis.DOMParser){
 if(typeof html!=='string'||html.length>revisionReportLimits.rawText||controls.test(html))fail('HTML 报告最多 100,000 字符。');if(typeof DOMParserClass!=='function')fail('当前环境不能本地提取 HTML，请粘贴报告文本。');
 const allowed=new Set(['p','div','section','article','li','tr','td','blockquote','pre','h1','h2','h3','h4','h5','h6','mark','span','b','i','strong','em','u','s','table','tbody','thead','ul','ol','dl','dt','dd','br']);
 const tokens=[],prefix='\u0000report-tag-';let sanitized=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript|template|iframe|object|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
 sanitized=sanitized.replace(/<![^>]*>|<\/?([a-z][\w:-]*)\b[^>]*>/gi,(all,name)=>{const tag=String(name||'').toLowerCase();if(!allowed.has(tag))return '';const token=(all.startsWith('</')?'</':'<')+tag+'>';tokens.push(token);return prefix+(tokens.length-1)+'\u0000';}).replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/\u0000report-tag-(\d+)\u0000/g,(_,index)=>tokens[Number(index)]);
 const document=new DOMParserClass().parseFromString(sanitized,'text/html'),blocks=new Set(['p','div','section','article','li','tr','blockquote','pre','h1','h2','h3','h4','h5','h6','ul','ol','dl','dt','dd']),explicitExcerpts=[];let text='';
 const newline=()=>{if(text&&!text.endsWith('\n'))text+='\n';};
 function visit(node){if(node.nodeType===3){text+=node.nodeValue;return;}if(node.nodeType!==1)return;const tag=node.tagName.toLowerCase();if(tag==='br'){newline();return;}if(blocks.has(tag))newline();const start=text.length;for(const child of node.childNodes)visit(child);if(tag==='mark'&&text.length>start)explicitExcerpts.push({start,end:text.length});if(tag==='td')text+='\t';else if(blocks.has(tag))newline();}
 for(const child of document.body.childNodes)visit(child);
 if(text.length>revisionReportLimits.rawText)fail('提取后的报告超过 100,000 字符，请缩小范围。');return{text,explicitExcerpts,warnings:['HTML 仅在本地提取文本与显式 mark 标记；不会执行脚本或加载报告中的资源。','不解析专有 PDF / HTML 视觉标色或检测算法，定位结果必须人工核对。']};
}

function documentParagraphs(doc){
 if(!plain(doc)||!Array.isArray(doc.paragraphs)||doc.paragraphs.length>500)fail('请先提供有效的论文原文段落。');const seen=new Set();let total=0;
 return doc.paragraphs.map((paragraph,index)=>{const original=typeof paragraph?.original==='string'?paragraph.original:paragraph?.text;if(typeof paragraph?.id!=='string'||!/^[-\p{L}\p{N}_.:]{1,160}$/u.test(paragraph.id)||seen.has(paragraph.id)||typeof original!=='string'||original.length>20000)fail('论文原文段落编号或文本无效。');seen.add(paragraph.id);total+=original.length;if(total>100000)fail('本次论文原文最多 100,000 字符。');return{id:paragraph.id,index,original,mapped:normalizeRevisionReportText(original),heading:paragraph.heading===true||['title','heading'].includes(paragraph.type)||keyOf(original)===keyOf(doc.title||'')};});
}
function located(mapped,at,length,text){if(at<0||!length||!mapped.spans[at+length-1])return null;const start=mapped.spans[at].start,end=mapped.spans[at+length-1].end;return keyOf(text.slice(start,end))===mapped.key.slice(at,at+length)?{start,end}:null;}
function findLocated(mapped,key,text,from=0){let at=mapped.key.indexOf(key,from);while(at>=0){const position=located(mapped,at,key.length,text);if(position)return{...position,at};at=mapped.key.indexOf(key,at+1);}return null;}
function scoreOnly(value){const text=value.normalize('NFKC');if(/^[\d\s.,，。%％:：/分率比相似重复检测结果总文字数AIaigc_-]+$/iu.test(text))return true;if(!/(?:重复率|相似度|检测结果|\b(?:score|similarity|probability|rate)\b)/i.test(text))return false;const remainder=text.replace(/(?:\b(?:overall|total|similarity|score|rate|percentage|overlap|ai|aigc|probability|likelihood|reference|references|with|word|words|count|result|results)\b|重复率|相似度|检测结果|总文字数|总字数|检测分数)/gi,'').replace(/[\p{N}\p{P}\p{S}\s\p{Default_Ignorable_Code_Point}]+/gu,'');return remainder.length<10;}
const eligible=paragraph=>!paragraph.heading&&effective(paragraph.original)>=20&&/\p{L}/u.test(paragraph.original)&&!scoreOnly(paragraph.original);

export function matchRevisionReport(doc,input){
 const report=normalizeRevisionReport(input),paragraphs=documentParagraphs(doc),mappedReport=normalizeRevisionReportText(report.text),candidates=[],warnings=[],seen=new Set();let candidateCharacters=0,truncated=false;
 function add(paragraph,span,reportSpan,kind){
  let excerpt=paragraph.original.slice(span.start,span.end),reportExcerpt=report.text.slice(reportSpan.start,reportSpan.end);if(effective(excerpt)<20||keyOf(excerpt)!==keyOf(reportExcerpt))return;
  let excerptTruncated=false;if(excerpt.length>revisionReportLimits.excerpt||reportExcerpt.length>revisionReportLimits.excerpt){const mapped=normalizeRevisionReportText(excerpt);let count=mapped.spans.length;while(count>0&&(mapped.spans[count-1].end>revisionReportLimits.excerpt||count<mapped.spans.length&&mapped.spans[count]?.start===mapped.spans[count-1]?.start))count--;if(!count)return;const prefix=mapped.key.slice(0,count),a=located(mapped,0,count,excerpt),b=findLocated(normalizeRevisionReportText(reportExcerpt),prefix,reportExcerpt);if(!a||!b||b.start!==0||b.end>revisionReportLimits.excerpt)return;span={start:span.start+a.start,end:span.start+a.end};reportSpan={start:reportSpan.start+b.start,end:reportSpan.start+b.end};excerpt=paragraph.original.slice(span.start,span.end);reportExcerpt=report.text.slice(reportSpan.start,reportSpan.end);excerptTruncated=true;}
  const identity=paragraph.id+':'+span.start+':'+span.end;if(seen.has(identity))return;seen.add(identity);
  if(candidates.length>=revisionReportLimits.candidates||candidateCharacters+excerpt.length+reportExcerpt.length>revisionReportLimits.candidateCharacters){truncated=true;return;}candidateCharacters+=excerpt.length+reportExcerpt.length;
  candidates.push({id:'match-'+(candidates.length+1),paragraphId:paragraph.id,paragraphIndex:paragraph.index,excerpt,start:span.start,end:span.end,reportExcerpt,reportStart:reportSpan.start,reportEnd:reportSpan.end,kind,excerptTruncated,ambiguous:false});
 }
 for(const paragraph of paragraphs){if(!eligible(paragraph)||!paragraph.mapped.key)continue;const found=findLocated(mappedReport,paragraph.mapped.key,report.text);if(found){const span=located(paragraph.mapped,0,paragraph.mapped.key.length,paragraph.original);if(span)add(paragraph,span,found,'full-paragraph');}}
 for(const explicit of report.explicitExcerpts){const fragment=report.text.slice(explicit.start,explicit.end),key=keyOf(fragment);if(effective(fragment)<20||key===keyOf(doc.title||'')||scoreOnly(fragment))continue;for(const paragraph of paragraphs){if(!eligible(paragraph))continue;let from=0;for(let count=0;count<121;count++){const found=findLocated(paragraph.mapped,key,paragraph.original,from);if(!found)break;add(paragraph,found,explicit,'explicit-excerpt');from=found.at+1;}}}
 const groups=new Map();for(const candidate of candidates){const key=keyOf(candidate.excerpt),group=groups.get(key)||[];group.push(candidate);groups.set(key,group);}for(const group of groups.values())if(group.length>1)for(const candidate of group){candidate.ambiguous=true;candidate.matchCount=group.length;}
 const ambiguous=candidates.some(candidate=>candidate.ambiguous);if(ambiguous)warnings.push('相同摘录对应多个原文位置，无法自动确定目标，请逐项人工选择。');if(truncated)warnings.push('候选已达到 120 项或 32,000 字符展示范围，请缩小报告范围；未展示位置未被确认。');if(candidates.some(candidate=>candidate.excerptTruncated))warnings.push('较长匹配仅展示并保存前部摘录，原文段落和报告全文均不会被覆盖。');if(!candidates.length)warnings.push('没有找到可逐字核对的原文片段。请粘贴报告明确标注的片段（至少 20 个非空白字符），或人工选择原文；本次未定位成功。');
 return{source:report.source,fileName:report.fileName,candidates,ambiguous,truncated,candidateCharacters,warnings};
}

/** Safe persistence / callback boundary: no raw report text or unknown fields survive. */
export function normalizeConfirmedRevisionReport(value,doc){
 if(!plain(value)||!Object.hasOwn(reportSources,value.source)||!Array.isArray(value.evidence)||!value.evidence.length||value.evidence.length>120)fail('请至少勾选一项已核对的报告摘录。');const paragraphs=doc?new Map(documentParagraphs(doc).map(p=>[p.id,p.original])):null,seen=new Set();
 const evidence=value.evidence.map(part=>{if(!plain(part)||typeof part.paragraphId!=='string'||!/^[-\p{L}\p{N}_.:]{1,160}$/u.test(part.paragraphId)||typeof part.excerpt!=='string'||part.excerpt.length>2000||controls.test(part.excerpt)||effective(part.excerpt)<20||!Number.isSafeInteger(part.start)||!Number.isSafeInteger(part.end)||part.start<0||part.end-part.start!==part.excerpt.length||part.end>20000)fail('已确认摘录或原文位置无效。');if(paragraphs&&paragraphs.get(part.paragraphId)?.slice(part.start,part.end)!==part.excerpt)fail('论文原文已变化，原报告定位不能继续使用，请重新核对。');const key=part.paragraphId+':'+part.start+':'+part.end;if(seen.has(key))fail('确认记录包含重复摘录。');seen.add(key);const output={paragraphId:part.paragraphId,excerpt:part.excerpt,start:part.start,end:part.end};
  if(part.reportExcerpt!==undefined||part.reportStart!==undefined||part.reportEnd!==undefined){if(typeof part.reportExcerpt!=='string'||part.reportExcerpt.length>2000||controls.test(part.reportExcerpt)||keyOf(part.reportExcerpt)!==keyOf(part.excerpt)||!Number.isSafeInteger(part.reportStart)||!Number.isSafeInteger(part.reportEnd)||part.reportStart<0||part.reportEnd>100000||part.reportEnd-part.reportStart!==part.reportExcerpt.length)fail('报告摘录与原文不一致，请重新核对。');Object.assign(output,{reportExcerpt:part.reportExcerpt,reportStart:part.reportStart,reportEnd:part.reportEnd});}return output;});
 const confirmedAt=typeof value.confirmedAt==='string'&&Number.isFinite(Date.parse(value.confirmedAt))?new Date(value.confirmedAt).toISOString():new Date().toISOString(),output={version:1,source:value.source,fileName:label(value.fileName),paragraphIds:[...new Set(evidence.map(part=>part.paragraphId))],evidence,confirmedAt};
 if(JSON.stringify(output).length>revisionReportLimits.confirmedCharacters)fail('确认记录最多保存 10,000 字符（含定位信息），请减少勾选片段。');return output;
}
