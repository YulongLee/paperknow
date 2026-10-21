export const methodSupplementStart='【研究方法建议（拟开展，AI 生成）】';
export const methodSupplementEnd='【研究方法建议结束】';
export const methodSupplementRepair='研究方法标记不完整或重复，请保留一组完整的方法标记后再确认；当前内容已保留。';

// Keep the editable proposal in the same input without promoting it to source text.
export function splitMethodSupplement(value){
 const text=String(value??''),starts=text.split(methodSupplementStart).length-1,ends=text.split(methodSupplementEnd).length-1;
 if(!starts&&!ends)return {userText:text.trim(),methodText:'',hasMethod:false,invalid:false};
 const start=text.indexOf(methodSupplementStart),end=text.indexOf(methodSupplementEnd);
 if(starts!==1||ends!==1||end<start)return {userText:'',methodText:'',hasMethod:true,invalid:true};
 return {userText:[text.slice(0,start).trim(),text.slice(end+methodSupplementEnd.length).trim()].filter(Boolean).join('\n\n'),methodText:text.slice(start+methodSupplementStart.length,end).trim(),hasMethod:true,invalid:false};
}

export function fillMethodSupplement(value,method){
 const parts=splitMethodSupplement(value),text=String(method??'').trim();
 if(parts.invalid)throw Error(methodSupplementRepair);
 if(text.includes(methodSupplementStart)||text.includes(methodSupplementEnd))throw Error('方法正文中不能包含方法区块标记，请删除重复标记后重试。');
 if(!text)return parts.userText;
 const block=methodSupplementStart+'\n'+text+'\n'+methodSupplementEnd;
 if(!parts.hasMethod)return [parts.userText,block].filter(Boolean).join('\n\n');
 const raw=String(value??''),start=raw.indexOf(methodSupplementStart),end=raw.indexOf(methodSupplementEnd)+methodSupplementEnd.length;
 return raw.slice(0,start)+block+raw.slice(end);
}
