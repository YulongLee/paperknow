import {serviceMessage} from './service-message.mjs';
// Quotes are shown only for the exact input and account that requested them.
export function billingQuoteLabel(quote){
 if(quote.source==='credits')return `本次消耗 ${quote.creditCost} 科研积分`;
 const units=Number.isSafeInteger(quote.entitlementUnits)&&quote.entitlementUnits>0?quote.entitlementUnits:1;
 const unit=quote.entitlementKey==='translation-pages'?'页':'次';
 if(quote.source==='membership')return `本次使用 ${units} ${unit}会员权益`;
 if(quote.source==='bundle')return `本次使用 ${units} ${unit}套餐权益`;
 if(quote.source==='free')return '本次免费';
 throw Error('费用信息不完整');
}
export function mountBillingNotice({container,getQuote,getIdentityKey,validateQuote,formatQuote=billingQuoteLabel,isCurrent=()=>true,onStateChange=()=>{}}={}){
 if(!container||!getQuote||!getIdentityKey||!validateQuote)throw Error('费用提示配置不完整');
 const win=container.ownerDocument.defaultView;let live=true,sequence=0,entry=null,timer=null,expiry=null;
 const clearTimers=()=>{if(timer!==null)win.clearTimeout(timer);if(expiry!==null)win.clearTimeout(expiry);timer=expiry=null;};
 const show=message=>{if(live&&isCurrent())container.textContent=message;};
 const identity=()=>{try{return getIdentityKey()||null;}catch{return null;}};
 function current(){const key=identity();return live&&isCurrent()&&entry&&key&&key===entry.key&&validateQuote(entry.quote)?entry.quote:null;}
 function invalidate(message='输入已更新，正在核对费用…'){sequence++;entry=null;clearTimers();show(message);onStateChange('loading');}
 async function refresh(){clearTimers();entry=null;const seq=++sequence,key=identity();if(!key){show('填写必要信息后显示本次费用。');onStateChange('idle');return null;}show('正在核对本次费用…');onStateChange('loading');try{const quote=await getQuote();if(!live||!isCurrent()||seq!==sequence)return null;if(key!==identity()){schedule();return null;}if(!validateQuote(quote))throw Error('费用信息暂不可用');entry={key,quote};onStateChange('ready');show(`${formatQuote(quote)} · 成功后结算，失败或取消释放预占`);const delay=Math.max(0,Date.parse(quote.expiresAt)-Date.now());expiry=win.setTimeout(()=>{if(seq===sequence){entry=null;onStateChange('expired');show('费用已过期，请稍候重新核对。');void refresh();}},Math.min(delay+1,2147483647));return quote;}catch(error){if(live&&isCurrent()&&seq===sequence){entry=null;onStateChange('error');show(error?.status===401?'登录后可查看本次费用。':[402,403].includes(error?.status)?serviceMessage(error.message||'当前账户暂不可使用，请核对权益。'):'暂时无法确认费用，请稍后重试。');}return null;}}
 function schedule(){invalidate();if(identity())timer=win.setTimeout(()=>void refresh(),450);else{show('填写必要信息后显示本次费用。');onStateChange('idle');}}
 function dispose(){live=false;sequence++;entry=null;clearTimers();}
 return {refresh,invalidate,schedule,current,dispose};
}
