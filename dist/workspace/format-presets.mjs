import {defaultRules,validateRules} from './format-model.mjs';

export const formatPresets=[
 {id:'undergraduate',name:'本科论文通用规则',description:'正文小四、1.5倍行距，适合作为本科论文的起点。',category:'学位论文',accent:'blue',rules:{line:1.5}},
 {id:'graduate',name:'研究论文通用规则',description:'双倍行距、左侧预留装订空间，便于导师审阅。',category:'学位论文',accent:'purple',rules:{line:2,left:3}},
 {id:'custom',name:'自定义排版规则',description:'按学校要求设置，或导入你提供的DOCX格式样例。',category:'自定义',accent:'slate',rules:null},
 {id:'english',name:'英文论文通用规则',description:'Times New Roman正文、双倍行距，保留原有标题内容。',category:'英文文稿',accent:'teal',rules:{font:'Times New Roman',line:2,indent:0}},
 {id:'journal',name:'期刊初稿通用规则',description:'清晰的正文与三级标题，投稿前再核对期刊规范。',category:'期刊初稿',accent:'amber',rules:{line:1.5,indent:0}},
 {id:'report',name:'课程与研究报告规则',description:'统一正文字号和行距，适合课程报告与研究汇报。',category:'研究报告',accent:'cyan',rules:{line:1.5,h1:18,h2:16,h3:14}}
];
export function presetRules(id,current=defaultRules()){const preset=formatPresets.find(item=>item.id===id);if(!preset)throw Error('请选择支持的通用模板。');return preset.rules?{...defaultRules(),...preset.rules}:{...current};}
export function ruleSummary(rules){validateRules(rules);return `${rules.font} · ${rules.size}pt · ${rules.line}倍行距 · 首行${rules.indent}字符 · 页边距${rules.top}/${rules.bottom}/${rules.left}/${rules.right}cm`;}
export function exportFormatRules(rules){validateRules(rules);return JSON.stringify({format:'paperknow-format-rules',version:1,rules:Object.fromEntries(Object.keys(defaultRules()).map(key=>[key,rules[key]]))},null,2);}
export function importFormatRules(text){if(typeof text!=='string'||text.length>16000)throw Error('请选择16KB以内的PaperKnow规则JSON。');let data;try{data=JSON.parse(text);}catch{throw Error('规则文件不是有效JSON。');}if(data?.format!=='paperknow-format-rules'||data.version!==1||!data.rules||Array.isArray(data.rules))throw Error('不是支持的PaperKnow排版规则文件。');const defaults=defaultRules(),rules={...defaults};for(const key of Object.keys(defaults)){if(!Object.hasOwn(data.rules,key))throw Error('规则文件缺少必要字段，请重新导出。');const value=data.rules[key];if(typeof defaults[key]==='boolean'){if(typeof value!=='boolean')throw Error('应用范围必须是明确的开关。');rules[key]=value;}else if(typeof defaults[key]==='number'){if(typeof value!=='number'||!Number.isFinite(value))throw Error('排版数值格式不正确。');rules[key]=value;}else {if(typeof value!=='string')throw Error('字体设置不正确。');rules[key]=value;}}validateRules(rules);return rules;}

// These are suggestions, not a claim of perfect section recognition. Users can
// change every paragraph back to a body or heading role before applying.
export function suggestedFormatExclusions(paragraphs){let section='';const suggestions=[],firstChapter=paragraphs.findIndex(p=>/^(?:第[一1]章|chapter\s+(?:1|I)\b|1[.、\s]+\S)/i.test(p.text.trim()));const excludedTitle=/^(?:摘\s*要|中文摘要|英文摘要|abstract|目\s*录|contents|table\s+of\s+contents|参考文献|references|bibliography|致\s*谢|acknowledg(?:e)?ments?|附\s*录(?:\s*[A-Z一二三\d])?|appendix(?:\s+[A-Z\d])?|(?:学术诚信|原创性|版权|独创性|学位论文)?声明)$/i;for(const [index,p]of paragraphs.entries()){const text=p.text.trim().replace(/\s+/g,' ').replace(/^(?:第[一二三四五六七八九十百\d]+[章节]|\d+(?:\.\d+)*)[.、：:]?\s+/, '');if(excludedTitle.test(text))section=text;else if(p.level===1||index===firstChapter)section='';if(index<firstChapter&&!section)section='封面与前置内容';if(section)suggestions.push({index,section,reason:'识别为“'+section+'”部分，默认保留原样；请核对范围。'});}return suggestions;}
