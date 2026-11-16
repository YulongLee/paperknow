const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=issue=>issue.basis+':'+issue.id;
export function authorReviewMarkup(issue,{disabled=false}={}){
 if(!issue.authorReviewAllowed)return '';
 const record=issue.authorReview;
 if(record?.confirmed)return `<section aria-label="作者核对记录"><strong>作者已依据资料核对，保留原文</strong><p>${esc(record.reason)}</p><blockquote>${esc(record.sourceQuote)}</blockquote><small>依据：${esc(record.sourceName)}。原审校意见保留；此记录不代表平台已独立验证事实。</small><p><button type="button" class="btn secondary" data-author-review-revoke="${esc(issue.id)}" ${disabled?'disabled':''}>撤销本项核对</button></p></section>`;
 return `<details data-author-review="${esc(issue.id)}"><summary>根据资料核对这条意见</summary><p>如审校意见与已保存资料不符，请填写核对说明和原文依据。记录只适用于当前版本，不替代缺失资料、数值和引用检查。</p><label>核对依据<select data-author-source ${disabled?'disabled':''}><option value="">选择已保存并引用的资料</option>${(issue.authorReviewSources||[]).map(source=>`<option value="${esc(source.id)}">${esc(source.name)}</option>`).join('')}</select></label><label>资料原文摘录（8～500字）<textarea data-author-quote minlength="8" maxlength="500" rows="3" ${disabled?'disabled':''}></textarea></label><label>核对说明（20～500字）<textarea data-author-reason minlength="20" maxlength="500" rows="3" ${disabled?'disabled':''}></textarea></label><button type="button" class="btn secondary" data-author-review-submit="${esc(issue.id)}" ${disabled?'disabled':''}>提交依据，保留本处原文</button></details>`;
}
export function bindAuthorReview(root,{issues=[],drafts=new Map(),disabled=false,onSubmit}={}){
 for(const box of root.querySelectorAll('[data-author-review]')){
  const issue=issues.find(i=>i.id===box.dataset.authorReview);if(!issue)continue;
  const fields={sourceId:box.querySelector('[data-author-source]'),sourceQuote:box.querySelector('[data-author-quote]'),reason:box.querySelector('[data-author-reason]')},draft=drafts.get(key(issue));
  if(draft){for(const [name,input] of Object.entries(fields))input.value=draft[name]||'';box.open=true;}
  const values=()=>Object.fromEntries(Object.entries(fields).map(([name,input])=>[name,input.value]));
  for(const input of Object.values(fields))input.addEventListener('input',()=>drafts.set(key(issue),values()));
  box.querySelector('[data-author-review-submit]')?.addEventListener('click',()=>{if(disabled)return;const value=values();drafts.set(key(issue),value);onSubmit?.(issue,{confirmed:true,...value},()=>drafts.delete(key(issue)));});
 }
 for(const button of root.querySelectorAll('[data-author-review-revoke]'))button.addEventListener('click',()=>{if(disabled)return;const issue=issues.find(i=>i.id===button.dataset.authorReviewRevoke);if(issue)onSubmit?.(issue,{confirmed:false},()=>drafts.delete(key(issue)));});
}
