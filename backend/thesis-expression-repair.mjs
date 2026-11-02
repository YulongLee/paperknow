import {thesisError} from './thesis-model.mjs';
const protectedText=text=>{
 const blocks=String(text).match(/```[\s\S]*?```|~~~[\s\S]*?~~~|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$(?!\$)[^$\r\n]+\$|`[^`\r\n]+`|^[ \t]*\|.*$/gm)||[];
 const tokens=String(text).match(/\[source:[^\]\r\n]+\]|\[figure:[^\]\r\n]+\]|【(?:待补充|待核对|草稿说明)[：:][^】]+】|\[(?:To be supplied|To be verified|Draft note):[^\]]+\]|https?:\/\/[^\s<>]+|[-+]?\d+(?:[.,]\d+)*(?:%|％)?/g)||[];
 return {blocks,tokens:tokens.map(token=>token.startsWith('[figure:')?'[figure]':token)};
};
export function assertExpressionRepairUnchanged(checkpoint,content){
 const before=String(checkpoint.text||''),after=String(content.text||'');
 if(before===after)throw thesisError(502,'表达修正尚未写入正文，请按定位的问题修正文句后重新提交。','invalid_output');
 if(JSON.stringify(protectedText(before))!==JSON.stringify(protectedText(after)))throw thesisError(502,'表达修正须保留原有数字、引用、公式、代码、表格和待核对标记。','invalid_output');
 const figures=value=>(value||[]).map(({id,...figure})=>figure);
 if(JSON.stringify(figures(JSON.parse(checkpoint.figures||'[]')))!==JSON.stringify(figures(content.figures)))throw thesisError(502,'表达修正不能替换论文图表或改变其中的数据。','invalid_output');
}
