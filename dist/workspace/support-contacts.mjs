import {icon} from './ui.mjs';

export const supportContacts=Object.freeze({email:'contact@oneshowailab.com',wechat:'OneShowAILab'});
const wechatIcon='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 12.5c-1.2 1.4-3.1 2.3-5.3 2.3-1 0-2-.2-2.8-.5L3 16l.9-3A5.4 5.4 0 0 1 2 9c0-3.3 3.2-6 7.2-6 3.7 0 6.8 2.4 7.1 5.4"/><path d="M22 14c0-2.8-2.6-5-5.8-5s-5.8 2.2-5.8 5 2.6 5 5.8 5c.8 0 1.5-.1 2.2-.4L21 20l-.6-2.6A4.6 4.6 0 0 0 22 14Z"/><path d="M6.5 7.7h.1m4.5 0h.1m2.9 5.4h.1m3.6 0h.1"/></svg>';

export function supportContactsMarkup(){
 return `<div class="support-contact-list" data-support-contacts><a class="support-contact-row" href="mailto:${supportContacts.email}"><span class="support-contact-icon">${icon('mail',19)}</span><span class="support-contact-copy"><small>客服邮箱</small><b>${supportContacts.email}</b></span>${icon('arrow',15)}</a><div class="support-contact-row support-contact-wechat"><span class="support-contact-icon">${wechatIcon}</span><span class="support-contact-copy"><small>微信客服</small><b data-support-wechat>${supportContacts.wechat}</b><small>在微信中搜索并添加</small></span><button type="button" class="support-copy-button" data-copy-support-wechat>复制微信号</button></div><p class="support-copy-status" data-support-copy-status role="status" aria-live="polite"></p></div>`;
}

export function bindSupportContacts(root){
 root.querySelectorAll('[data-support-contacts]').forEach(contacts=>{
  const button=contacts.querySelector('[data-copy-support-wechat]'),status=contacts.querySelector('[data-support-copy-status]');
  button.onclick=async()=>{
   if(button.disabled)return;
   button.disabled=true;status.textContent='';status.classList.remove('error');
   try{
    const clipboard=contacts.ownerDocument.defaultView?.navigator?.clipboard;
    if(typeof clipboard?.writeText!=='function')throw new Error('clipboard_unavailable');
    await clipboard.writeText(supportContacts.wechat);
    status.textContent='微信号已复制，请在微信中搜索并添加。';
   }catch{
    status.textContent=`复制未成功，请手动复制微信号：${supportContacts.wechat}`;
    status.classList.add('error');
   }finally{button.disabled=false;}
  };
 });
}
