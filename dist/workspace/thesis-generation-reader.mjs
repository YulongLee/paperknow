const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// In-progress checkpoints are a draft preview only. They never replace saved
// chapters or satisfy the final-manuscript checks.
export function thesisPreviewItem(item={}){
 return {...item,chapters:(item.chapters||[]).map(chapter=>{
  if(String(chapter.text||'').trim())return chapter;
  const sections=(item.sections||[]).filter(row=>row.chapterId===chapter.id&&row.status==='completed'&&String(row.text||'').trim());
  return sections.length?{...chapter,text:sections.map(row=>row.text).join('\n\n'),figures:sections.flatMap(row=>row.figures||[]),sourceIds:[...new Set(sections.flatMap(row=>row.sourceIds||[]))],draftFromSections:true}:chapter;
 })};
}
export function readerTextHTML(text){
 const lines=String(text||'').split('\n'),out=[];let paragraph=[];
 const flush=()=>{if(paragraph.length)out.push('<p>'+esc(paragraph.join('\n')).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')+'</p>');paragraph=[];};
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(/^\s*```/.test(line)){flush();const code=[];while(++i<lines.length&&!/^\s*```/.test(lines[i]))code.push(lines[i]);out.push('<pre><code>'+esc(code.join('\n'))+'</code></pre>');continue;}
  if(line.includes('|')&&/^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[i+1]||'')){
   flush();const cells=value=>value.trim().replace(/^\||\|$/g,'').split('|').map(value=>value.trim()),headers=cells(line);i++;
   let table='<div class="thesis-reader-table"><table><thead><tr>'+headers.map(value=>'<th>'+esc(value)+'</th>').join('')+'</tr></thead><tbody>';
   while(i+1<lines.length&&lines[i+1].includes('|')&&lines[i+1].trim()){i++;table+='<tr>'+cells(lines[i]).map(value=>'<td>'+esc(value)+'</td>').join('')+'</tr>';}
   out.push(table+'</tbody></table></div>');continue;
  }
  if(/^#{1,6}\s+/.test(line)){flush();out.push('<h4>'+esc(line.replace(/^#{1,6}\s+/,''))+'</h4>');continue;}
  if(!line.trim()){flush();continue;}paragraph.push(line);
 }
 flush();return out.join('');
}
export function thesisReaderHTML(item,selected,{active=false,renderChapter=chapter=>readerTextHTML(chapter.text)}={}){
 const chapters=thesisPreviewItem(item).chapters,chapter=chapters.find(row=>row.id===selected)||chapters[0],hasText=chapters.some(row=>String(row.text||'').trim());
 return `<section class="thesis-reader" data-thesis-reader aria-label="论文内容预览"><header><div><h2>论文预览</h2><p>${active?'已生成的内容会陆续显示在这里。':hasText?'核对内容后，可在下方下载 Word 文档。':'生成完成后，可在这里阅读论文并下载。'}</p></div><button type="button" class="btn secondary" data-thesis-open-editor ${!hasText||active?'disabled':''}>编辑正文</button></header><div class="thesis-reader-layout"><nav aria-label="预览章节" data-scroll-key="thesis-reader-nav:${esc(item.id||'new')}">${chapters.map(row=>`<button type="button" data-thesis-preview-chapter="${esc(row.id)}" aria-current="${row.id===chapter?.id}"><span>${esc(row.title)}</span><small>${String(row.text||'').trim()?'已保存':active?'生成中':'待生成'}</small></button>`).join('')}</nav><div class="thesis-reader-scroll" data-scroll-key="thesis-reader:${esc(item.id||'new')}:${esc(chapter?.id||'')}" tabindex="0" role="region" aria-label="论文预览正文">${chapter?.text?.trim()?`<article class="thesis-reader-paper"><h3>${esc(chapter.title)}</h3>${renderChapter(chapter)}</article>`:`<div class="thesis-reader-empty"><span aria-hidden="true">▤</span><h3>${active?'正在撰写这一章':'论文将在这里生成'}</h3><p>${active?'进度会自动更新，可以切换章节查看已生成内容。':'已确认的提纲和研究资料将用于本次写作。'}</p></div>`}</div></div></section>`;
}
