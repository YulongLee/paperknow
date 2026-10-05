export const defaults={degree:'本科',major:'',density:'comfortable',fontSize:'normal'};
export function normalizeSettings(p={}){return {degree:['专科','本科','硕士','博士','科研人员'].includes(p.degree)?p.degree:'本科',major:typeof p.major==='string'?p.major.slice(0,100):'',density:p.density==='compact'?'compact':'comfortable',fontSize:['normal','large','larger'].includes(p.fontSize)?p.fontSize:'normal'};}
