// Billing identities are selected from normalized, server-owned writing profiles.
export const writingBillingLevels=Object.freeze({专科:'junior',本科:'bachelor',硕士:'master',博士:'doctor'});
const families=Object.freeze({thesis:'毕业论文',proposal:'开题报告',taskbook:'任务书','literature-review':'文献综述'});
export const writingBillingServiceTypes=Object.freeze(Object.entries(families).flatMap(([family,title])=>Object.entries(writingBillingLevels).map(([level,id])=>Object.freeze({key:family+'-'+id,title:title+'-'+level,group:'AI 写作'}))));
export function writingBillingKey(kind,operation,snapshot){
 const level=writingBillingLevels[snapshot?.profile?.level];
 const family=operation==='draft'?(kind==='thesis'?'thesis':({proposal:'proposal',taskbook:'taskbook',summary:'literature-review'})[kind]):null;
 return family&&level?family+'-'+level:null;
}
