export const presentationNoteModes=Object.freeze({
 none:Object.freeze({label:'不生成备注',requirements:'不生成演讲备注；每页 notes 为空字符串。'}),
 concise:Object.freeze({label:'简洁演讲备注',requirements:'请提供简洁的演讲备注。'}),
 detailed:Object.freeze({label:'详细演讲备注',requirements:'请为每页编写详细演讲备注，备注必须与页面和提供的材料一致。'})
});
export function presentationNotes(deck,tier='basic'){
 const mode=deck?.notesMode??(tier==='premium'?'detailed':'concise');
 if(typeof mode!=='string'||!Object.hasOwn(presentationNoteModes,mode))throw Error('请选择不生成、简洁或详细演讲备注。');
 return {mode,...presentationNoteModes[mode]};
}
export function normalizePresentationOutline(value,pages){
 if(!Array.isArray(value)||value.length<6||value.length>30||pages!==undefined&&value.length!==Number(pages))throw Error('提纲需要 6–30 个页面标题，且数量与目标页数一致。');
 return value.map((title,index)=>{if(typeof title!=='string'||!title.trim()||title.trim().length>120||/[\r\n\u2028\u2029\u0000-\u001f]/u.test(title))throw Error('第 '+(index+1)+' 页标题需要 1–120 字符的单行文字。');return title.trim();});
}
export function parsePresentationOutline(value){
 if(typeof value!=='string'||value.length>5000)throw Error('提纲最多 5,000 字符，请逐行填写完整标题。');
 return normalizePresentationOutline(value.replace(/\r\n?/g,'\n').split('\n').filter(line=>line.trim()));
}
export const presentationTemplateCatalog=Object.freeze([
 Object.freeze({id:'academic',industry:['学术研究','教育教学'],style:'简洁',color:'蓝色',description:'典雅书房与学位帽，适合毕业答辩。'}),
 Object.freeze({id:'formal',industry:['学术研究','项目汇报'],style:'正式',color:'红色',description:'校园建筑与学院红，适合开题及毕业汇报。'}),
 Object.freeze({id:'focus',industry:['学术研究','教育教学'],style:'清新',color:'青绿',description:'实验器皿与分子视觉，适合生命科学。'}),
 Object.freeze({id:'slate',industry:['项目汇报','学术研究'],style:'简洁',color:'石墨',description:'建筑模型与设计稿，适合设计方案汇报。'}),
 Object.freeze({id:'indigo',industry:['教育教学','项目汇报'],style:'正式',color:'靛紫',description:'智能芯片与神经网络，适合人工智能研究。'}),
 Object.freeze({id:'sand',industry:['教育教学','学术研究'],style:'清新',color:'暖棕',description:'典藏书籍与艺术雕塑，适合人文研究。'}),
 Object.freeze({id:'cobalt',industry:['学术研究','项目汇报'],style:'正式',color:'蓝色',description:'数据中心与数字设备，适合信息技术汇报。'}),
 Object.freeze({id:'crimson',industry:['学术研究','教育教学'],style:'正式',color:'红色',description:'水墨书院与梅花，适合国风人文主题。'}),
 Object.freeze({id:'forest',industry:['学术研究','项目汇报'],style:'清新',color:'绿色',description:'自然生态与显微镜，适合生态研究。'}),
 Object.freeze({id:'teal',industry:['学术研究','项目汇报'],style:'简洁',color:'青绿',description:'风电与光伏，适合新能源研究。'}),
 Object.freeze({id:'ink',industry:['学术研究','项目汇报'],style:'简洁',color:'石墨',description:'黑白会场空间，适合学术会议报告。'}),
 Object.freeze({id:'amber',industry:['教育教学','学术研究'],style:'正式',color:'暖棕',description:'暖色教室与书籍，适合教学与教育研究。'})
]);
export function filterPresentationTemplates(filters={}){
 return presentationTemplateCatalog.filter(row=>Object.entries(filters).every(([key,value])=>{if(!value||value==='all')return true;if(key==='industry')return row.industry.includes(value);return ['style','color'].includes(key)&&row[key]===value;}));
}

