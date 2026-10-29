import {esc} from './ui.mjs';
import {list,write,keys,hasDraftScope} from './state.mjs';
import {migrateWritingFlow} from './writing-flow-model.mjs';

const levels=['专科','本科','硕士','博士','研究工作者'];
const scopeNames={full:'用户提供正文',abstract:'仅用户确认摘要',metadata:'仅题录，未读全文'};

/** Transfer real source text, never generated notes or an implicitly adopted abstract. */
export function buildLiteratureReviewDraft({papers,title,level='本科',language='中文',targetWords=5000,id=crypto.randomUUID(),now=new Date().toISOString()}={}){
 if(!Array.isArray(papers)||!papers.length||papers.length>20)throw Error('请选择 1～20 篇文献。');
 title=String(title||'').trim();if(title.length<2||title.length>200)throw Error('综述题目应为 2～200 字符。');
 if(!levels.includes(level)||!['中文','English'].includes(language))throw Error('请选择有效的学位与写作语言。');
 targetWords=Number(targetWords);if(!Number.isSafeInteger(targetWords)||targetWords<200||targetWords>20000)throw Error('目标字数应为 200～20,000 的整数。');
 const seen=new Set(),references=[];let characters=0,readable=0;
 for(const paper of papers){
  if(!paper||typeof paper.id!=='string'||!paper.id||paper.id.length>200||typeof paper.title!=='string'||!paper.title.trim()||paper.title.length>300)throw Error('所选文献的信息不完整，请先在文献库核对。');
  const key=String(paper.doi||paper.id).toLocaleLowerCase();if(seen.has(key))continue;seen.add(key);
  const scope=Object.hasOwn(scopeNames,paper.scope)?paper.scope:'metadata',text=scope==='metadata'?'':String(paper.text||'').trim();
  if(text.replace(/\s/g,'').length>=20)readable++;characters+=text.length;
  if(characters>100000)throw Error('所选正文与摘要合计超过 100,000 字符，请减少文献或先按章节整理；系统不会静默截断。');
  references.push({id:'literature-reference-'+(references.length+1),title:paper.title.trim(),authors:String(paper.authors||'').slice(0,1000),year:String(paper.year||''),doi:String(paper.doi||''),url:String(paper.url||''),scope,text,sourceLabel:'文献库 · '+scopeNames[scope],purpose:'综述候选来源，需在参考文献步骤核对',confirmed:false});
 }
 if(!readable)throw Error('文献综述至少需要一份已确认的可读摘要或正文（20 字符以上）。仅有题录时，请先导入原文或明确采用摘要研读。');
 const writingFlow={...migrateWritingFlow('summary',{}),title,level,language,targetWords,targetWordsMode:'manual',references,materials:[],stage:0,unlocked:0,completed:[],outline:[],outlineConfirmed:false,instructions:'仅基于用户确认的可读资料组织综述，区分摘要与正文依据；题录不能当成全文，笔记与 AI 解读不是原始证据。',literatureOrigin:{paperIds:papers.map(p=>p.id),createdAt:now}};
 return{id,tool:'summary',title,degree:level,language,targetWords,major:'',projectId:'',stage:'draft',text:'',html:'',createdAt:now,updatedAt:now,date:new Date(now).toLocaleString('zh-CN'),writingResume:true,writingFlow};
}

export function openLiteratureReview({getPapers,modal,container,notify=()=>{},navigate=hash=>{location.hash=hash;}}={}){
 if(typeof getPapers!=='function'||!container&&typeof modal!=='function')throw Error('文献综述入口缺少文献库。');
 const route=location.hash,rows=getPapers(),snapshots=new Map(rows.map(p=>[p.id,JSON.stringify(p)]));
 const markup=`<section class="lit-review-bridge"><p class="hub-description">选择来源后，进入“基础信息 → 参考文献 → 综述提纲 → 生成版本”。本次只创建草稿，不调用 AI 或扣积分。</p><form id="lit-review-bridge-form" class="hub-form" data-unprotected><label for="lit-review-title">综述题目</label><input id="lit-review-title" name="title" required minlength="2" maxlength="200" placeholder="例如：检索增强生成的研究进展"><div class="hub-form-row"><label>学位 / 身份<select name="level">${levels.map(level=>`<option${level==='本科'?' selected':''}>${level}</option>`).join('')}</select></label><label>语言<select name="language"><option value="中文">中文</option><option value="English">English</option></select></label><label>目标字数<input name="targetWords" type="number" required min="200" max="20000" step="1" value="5000"></label></div><fieldset><legend>候选文献（最多 20 篇）</legend><div class="lit-compare-list">${rows.map(p=>`<label><input name="paperId" type="checkbox" value="${esc(p.id)}"><span>${esc(p.title)}<small>${esc(scopeNames[p.scope]||scopeNames.metadata)} · ${Number(p.text?.length)||0} 字符</small></span></label>`).join('')||'<p>先导入可读摘要或正文，再创建综述。</p>'}</div></fieldset><p class="hub-footnote">仅传入你已确认范围内的原始文本与题录；笔记、AI 答案和未采用的数据库摘要不会作为原始证据。材料合计最多 100,000 字符。参考文献仍需在下一步核对确认。</p><p data-review-bridge-error class="hub-error" role="alert"></p><button type="submit" class="btn primary"${rows.length?'':' disabled'}>创建综述草稿并继续</button></form></section>`;
 if(container)container.innerHTML=markup;else modal('从文献库创建综述',markup);
 const form=(container||document).querySelector('#lit-review-bridge-form');if(!form)return;
 let created=false;
 form.addEventListener('submit',event=>{event.preventDefault();if(created||!form.isConnected||location.hash!==route)return;const error=form.querySelector('[data-review-bridge-error]');error.textContent='';try{
  if(hasDraftScope())throw Error('请先保存并离开当前账户编辑，再从文献库创建本地综述草稿。');
  const fields=new FormData(form),ids=fields.getAll('paperId'),current=getPapers(),selected=ids.map(id=>current.find(p=>p.id===id));
  if(selected.some(p=>!p||JSON.stringify(p)!==snapshots.get(p.id)))throw Error('所选文献已变化，请关闭窗口后重新选择，避免传入旧材料。');
  const draft=buildLiteratureReviewDraft({papers:selected,title:fields.get('title'),level:fields.get('level'),language:fields.get('language'),targetWords:fields.get('targetWords')}),entries=list(keys.drafts);
  write(keys.drafts,[draft,...entries]);created=true;form.closest('dialog')?.close?.();notify('综述草稿已保存到当前浏览器，请继续核对基础信息与参考文献。');navigate('#draft/'+encodeURIComponent(draft.id));
 }catch(reason){error.textContent=reason.message||'草稿未能保存，当前选择已保留，请重试。';}});
 return{form};
}
