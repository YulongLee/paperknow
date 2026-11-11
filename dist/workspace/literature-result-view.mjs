import {esc} from './ui.mjs';

// A deliberately small, escaped Markdown subset for model output. No HTML,
// external media or executable links can enter the reading workspace.
function visibleText(value){return String(value).replace(/\bp\d+-e\d+(?:(?:[、,，~～–—-])(?:p\d+-)?e\d+)*/gi,'原文片段');}
function inline(text){
 const tokens=String(text).split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
 return tokens.map(token=>token.startsWith('`')&&token.endsWith('`')?'<code>'+esc(token.slice(1,-1))+'</code>':token.startsWith('**')&&token.endsWith('**')?'<strong>'+esc(visibleText(token.slice(2,-2)))+'</strong>':esc(visibleText(token))).join('');
}
export function readingResultMarkup(value){
 const lines=String(value||'').replace(/\r\n?/g,'\n').split('\n'),out=[];let paragraph=[],list=[],ordered=false,orderStart=1,code=null;
 const flushParagraph=()=>{if(paragraph.length){out.push('<p>'+paragraph.map(inline).join('<br>')+'</p>');paragraph=[];}};
 const flushList=()=>{if(list.length){const tag=ordered?'ol':'ul';out.push('<'+tag+(ordered&&orderStart!==1?' start="'+orderStart+'"':'')+'>'+list.map(text=>'<li>'+inline(text)+'</li>').join('')+'</'+tag+'>');list=[];}};
 for(const line of lines){
  if(/^\s*```/.test(line)){flushParagraph();flushList();if(code){out.push('<pre><code>'+esc(code.join('\n'))+'</code></pre>');code=null;}else code=[];continue;}
  if(code){code.push(line);continue;}
  const heading=line.match(/^\s*#{1,6}\s+(.+)$/),bullet=line.match(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)(.+)$/);
  if(heading){flushParagraph();flushList();out.push('<h4>'+inline(heading[1])+'</h4>');}
  else if(bullet){flushParagraph();const next=/^\s*\d/.test(line),number=next?Number(line.match(/^\s*(\d+)/)[1]):null;if(list.length&&(next!==ordered||(next&&number!==1&&number!==orderStart+list.length)))flushList();ordered=next;if(!list.length&&ordered)orderStart=number;list.push(bullet[1]);}
  else if(!line.trim()){flushParagraph();flushList();}
  else{flushList();paragraph.push(line);}
 }
 flushParagraph();flushList();if(code)out.push('<pre><code>'+esc(code.join('\n'))+'</code></pre>');return out.join('');
}
