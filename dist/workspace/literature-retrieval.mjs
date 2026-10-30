import {literatureParagraphs,selectReadingMaterials} from './literature-ai-model.mjs';
export const isReadingFollowUp=question=>!/^(这篇|该篇|这项研究|this (?:paper|article)|the (?:paper|article))/i.test(String(question))&&/^(那|这|它|他们|为什么|还有|具体|进一步|what about|why|how so|and\b)/i.test(String(question))&&String(question).length<80;
const cache=new Map(),stop=new Set('the and for with this that from what which how why are was were does paper study article please explain these those using research'.split(' '));
const concepts=[[/方法|模型|架构|机制|算法|method|approach|architecture|algorithm/i,'method approach architecture algorithm model mechanism'],[/结果|发现|结论|性能|准确|精度|分数|多少|效果|result|finding|accuracy|score|performance/i,'result finding conclusion accuracy precision recall performance score bleu f1'],[/数据|样本|训练|实验|dataset|experiment|training/i,'data dataset sample training experiment evaluation'],[/图表|图片|架构图|figure|diagram/i,'figure diagram architecture'],[/表格|数据表|table/i,'table data result'],[/公式|方程|formula|equation/i,'equation formula attention'],[/局限|不足|缺点|限制|limitation|weakness/i,'limitation weakness discussion future limitation'],[/研究了什么|问题|贡献|创新|目的|摘要|总结|概括|贡献|abstract|contribution|summary|overview/i,'abstract introduction conclusion contribution problem objective purpose summary']];
function terms(text){const low=String(text).toLowerCase(),out=new Set((low.match(/[a-z][a-z0-9_-]{1,40}|\d+(?:\.\d+)?/g)||[]).filter(t=>!stop.has(t)));for(const run of low.match(/[\p{Script=Han}]+/gu)||[])for(let i=0;i<run.length-1;i++)out.add(run.slice(i,i+2));return out;}
function indexFor(paper){let index=cache.get(paper.id);if(index?.text===paper.text){cache.delete(paper.id);cache.set(paper.id,index);return index;}const parts=literatureParagraphs(paper.text);let heading='';const rows=parts.map(part=>{if(/^#{1,6}\s+/.test(part.text))heading=part.text;return {...part,heading,words:terms(part.text+' '+heading),body:!/^#{1,6}\s+[^\n]{1,180}$/.test(part.text)&&part.text.length>=5};});index={text:paper.text,parts,rows,answers:new Map()};cache.set(paper.id,index);while(cache.size>3)cache.delete(cache.keys().next().value);return index;}
/** Local full-document lexical/section retrieval. All returned text is exact, never rewritten. */
export function retrieveLiteratureMaterials(paper,question,{previousQuestion='',maxCharacters=5500,maxSources=6}={}){
 if(!paper||paper.scope==='metadata'||!paper.text?.trim())return selectReadingMaterials(paper);
 const index=indexFor(paper),query=String(question||'').trim(),follow=isReadingFollowUp(query);
 const effective=query+(follow&&previousQuestion?' '+previousQuestion:''),key=effective+'\n'+maxCharacters+'\n'+maxSources;
 if(index.answers.has(key))return structuredClone(index.answers.get(key));
 const words=terms(effective),extra=new Set();for(const [pattern,vocabulary]of concepts)if(pattern.test(effective))for(const term of vocabulary.split(' '))extra.add(term);
 const frequency=new Map();for(const row of index.rows)for(const term of new Set([...words,...extra]))if(row.words.has(term))frequency.set(term,(frequency.get(term)||0)+1);
 const ranked=index.rows.filter(r=>r.body).map(row=>{let score=0;for(const term of words)if(row.words.has(term))score+=2+Math.log(1+index.rows.length/(frequency.get(term)||1));for(const term of extra)if(row.words.has(term))score+=1.4+Math.log(1+index.rows.length/(frequency.get(term)||1))*.3;const heading=row.heading.toLowerCase();if(/abstract|摘要|conclusion|结论/.test(heading))score+=1.5;if(/公式|方程|formula|equation/i.test(effective)&&row.text.includes('$$')){score+=8;const number=effective.match(/(?:公式|方程|formula|equation)\s*[（(]?\s*(\d+)/i)?.[1];if(number&&row.text.includes('tag{'+number+'}'))score+=30;}if(/references|bibliography|参考文献/i.test(heading)&&!/参考|引用|作者|文献列表|reference|bibliograph|author/i.test(effective))score-=20;if(/^Acknowledg/i.test(row.text))score-=10;if(row.index===1)score+=.2;return {row,score};}).sort((a,b)=>b.score-a.score||a.row.index-b.row.index);
 const selected=new Set();let chars=0;
 const add=row=>{if(!row||!row.body||selected.has(row.index)||selected.size>=maxSources||chars+row.text.length>maxCharacters)return;selected.add(row.index);chars+=row.text.length;};
 // Preserve one nearby context paragraph for the strongest match, then diversify.
 if(ranked[0]){add(ranked[0].row);const at=ranked[0].row.index;add(index.rows[at]);}
 for(const {row}of ranked)add(row);
 const materials=[...selected].sort((a,b)=>a-b).flatMap(at=>selectReadingMaterials(paper,at,at,index.parts));
 if(!materials.length)throw Error('未找到可用于回答的原文，请补充或重新选择正文。');
 index.answers.set(key,materials);while(index.answers.size>12)index.answers.delete(index.answers.keys().next().value);return structuredClone(materials);
}
