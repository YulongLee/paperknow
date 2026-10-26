// Read-only, high-specificity expression hints. Exact UTF-16 offsets refer to
// the original text; nothing here rewrites research or estimates an AI score.
function prose(text){
 return text.replace(/```[\s\S]*?(?:```|(?![\s\S]))|~~~[\s\S]*?(?:~~~|(?![\s\S]))|\$\$[\s\S]*?(?:\$\$|(?![\s\S]))|\\\[[\s\S]*?(?:\\\]|(?![\s\S]))|\\\([\s\S]*?(?:\\\)|(?![\s\S]))|\$(?!\$)[^$\r\n]*\$|`[^`\r\n]*`|“[^”]*(?:”|(?![\s\S]))|‘[^’]*(?:’|(?![\s\S]))|「[^」]*(?:」|(?![\s\S]))|『[^』]*(?:』|(?![\s\S]))|"[^"\r\n]*"|【[^】\r\n]*】|\[source:[^\]\r\n]*\]|^[ \t]*(?:>|\||#{1,6}[ \t]).*$/gm,match=>match.replace(/[^\r\n]/g,' '));
}
export function* academicExpressionFindings(sections){
 for(const section of sections){
  const masked=prose(section.text),starts=new Map();
  for(const line of masked.matchAll(/[^\r\n]+/g)){
   const start=line[0].search(/\S/);if(start<0)continue;
   const text=line[0].slice(start),offset=line.index+start;
   const lead=/^(首先|其次|此外|同时|值得注意的是|需要指出的是|综上所述|总而言之|总的来说)[，,：:]|^(Furthermore|Moreover|In conclusion|To sum up),/i.exec(text);
   if(lead){const key=(lead[1]||lead[2]).toLowerCase();if(!starts.has(key))starts.set(key,[]);starts.get(key).push({offset,characters:text.length});}
   if(/^(?:众所周知|毋庸置疑|不言而喻|显而易见)[，,：:]|^(?:It is (?:obvious|undeniable) that\b|As (?:we all know|is well known),)/i.test(text))yield {section,offset,quote:section.text.slice(offset,offset+Math.min(200,text.length)).trimEnd(),explanation:'此处以笼统的确定性判断起句，建议核对后续是否给出具体依据。',suggestion:'在有来源支持时直接说明具体对象、观察和适用条件；证据不足时保留限定，不增加事实或把推测改成结论。'};
  }
  for(const [lead,rows]of starts)if(rows.length>=3){
   const row=rows[1];yield {section,offset:row.offset,quote:section.text.slice(row.offset,row.offset+Math.min(200,row.characters)).trimEnd(),explanation:`本节有 ${rows.length} 段以“${lead}”起句，段落衔接可能重复。`,suggestion:'结合相邻段落的实际论证关系调整衔接；保留有必要的并列步骤、术语、事实和引用，不为了变化而打乱顺序。'};
  }
 }
}
