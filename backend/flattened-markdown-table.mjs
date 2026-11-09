// Recover only the unmistakable form emitted as one line by some models:
// prose| header | header || --- | --- || cell | cell || cell | cell |prose.
// Ambiguous pipes, incomplete rows, code and already multiline tables are left alone.
export function recoverFlattenedMarkdownTables(value){
 return String(value).split('\n').map(line=>{
  if(!line.includes('||')||line.includes('`')||line.includes('\\|')||line.includes('$'))return line;
  const marker=/\|\|\s*((?::?-{3,}:?\s*\|\s*)+:?-{3,}:?)\s*\|\|/.exec(line);
  if(!marker)return line;
  const separators=marker[1].split('|').map(s=>s.trim());
  const count=separators.length;if(count<2||count>20)return line;
  const before=line.slice(0,marker.index),pieces=before.split('|');
  if(pieces.length!==count+1||pieces.slice(1).some(s=>!s.trim()))return line;
  const rest=line.slice(marker.index+marker[0].length),chunks=rest.split('||');
  if(chunks.length<2)return line;
  const rows=[];let suffix='';
  for(let i=0;i<chunks.length;i++){
   const cells=chunks[i].split('|');
   if(i===chunks.length-1){if(cells.length!==count+1)return line;suffix=cells.pop();}
   else if(cells.length!==count)return line;
   if(cells.some(s=>!s.trim()))return line;rows.push(cells.map(s=>s.trim()));
  }
  const format=cells=>'| '+cells.join(' | ')+' |';
  return [pieces[0].trimEnd(),format(pieces.slice(1).map(s=>s.trim())),format(separators),...rows.map(format),suffix.trimStart()].filter(Boolean).join('\n');
 }).join('\n');
}
