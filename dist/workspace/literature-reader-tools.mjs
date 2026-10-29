import {esc,icon} from './ui.mjs';

export function readingHeadings(parts){
 return parts.filter(p=>{const text=p.text.trim();return text.length<=100&&!/[。；;]/.test(text)&&/^(?:#{1,6}\s|(?:第[一二三四五六七八九十\d]+[章节]|[一二三四五六七八九十]+[、.]|\d+(?:\.\d+){0,3}[.、]?\s)\S|abstract\b|introduction\b|methods?\b|results?\b|discussion\b|conclusions?\b|references\b|摘要|引言|绪论|研究方法|结果|讨论|结论|参考文献)/i.test(text);}).slice(0,80);
}

export function mountReaderTools({container,parts,getPosition=()=>null,onPosition=()=>{},showText,signal}={}){
 const doc=container.ownerDocument,win=doc.defaultView,scroller=container.querySelector('.lit-reader-document-scroll'),host=container.querySelector('[data-reader-tools]');let index=-1,matches=[],timer=null,live=true;
 const current=()=>live&&container.isConnected&&!signal?.aborted;
 const headings=readingHeadings(parts);
 host.innerHTML=`<label class="lit-source-search">${icon('search',15)}<input type="search" data-reader-find placeholder="在正文中查找" aria-label="在文献正文中查找" maxlength="120"><span data-reader-find-count></span><button type="button" data-reader-find-prev aria-label="上一个匹配" disabled>↑</button><button type="button" data-reader-find-next aria-label="下一个匹配" disabled>↓</button></label><details class="lit-source-outline"><summary>${icon('menu',16)} 目录</summary><div>${headings.length?headings.map(p=>`<button type="button" data-reader-heading="${p.index}">${esc(p.text.replace(/^#+\s*/,''))}</button>`).join(''):'<p>这份正文没有可识别的独立标题，可用正文查找定位。</p>'}</div></details>`;
 const $=s=>host.querySelector(s),listen=(node,type,fn)=>node.addEventListener(type,fn,{signal});
 function locate(number,{highlight=true}={}){if(!current())return;showText();const node=doc.getElementById('lit-source-p'+number);if(!node)return;scroller.scrollTop=Math.max(0,scroller.scrollTop+node.getBoundingClientRect().top-scroller.getBoundingClientRect().top-18);if(highlight){node.classList.add('lit-ai-source-highlight');win.setTimeout(()=>node.classList.remove('lit-ai-source-highlight'),2000);}onPosition({paragraph:number});}
 function reveal(delta=0){if(!matches.length)return;index=(index+delta+matches.length)%matches.length;locate(matches[index]);$('[data-reader-find-count]').textContent=(index+1)+' / '+matches.length;}
 listen($('[data-reader-find]'),'input',event=>{const query=event.target.value.trim().toLocaleLowerCase();matches=query?parts.filter(p=>p.text.toLocaleLowerCase().includes(query)).map(p=>p.index):[];index=0;$('[data-reader-find-prev]').disabled=$('[data-reader-find-next]').disabled=!matches.length;$('[data-reader-find-count]').textContent=query?(matches.length?'1 / '+matches.length:'无匹配'):'';if(matches.length)reveal();});
 listen($('[data-reader-find]'),'keydown',event=>{if(event.key==='Enter'){event.preventDefault();reveal(event.shiftKey?-1:1);}if(event.key==='Escape'){event.target.value='';event.target.dispatchEvent(new win.Event('input',{bubbles:true}));}});
 listen($('[data-reader-find-prev]'),'click',()=>reveal(-1));listen($('[data-reader-find-next]'),'click',()=>reveal(1));
 host.querySelectorAll('[data-reader-heading]').forEach(button=>listen(button,'click',()=>{locate(Number(button.dataset.readerHeading));button.closest('details').open=false;}));
 let position=getPosition();if(Number.isInteger(position?.paragraph)&&position.paragraph>0&&position.paragraph<=parts.length&&!position.pdfPage)win.requestAnimationFrame?.(()=>locate(position.paragraph,{highlight:false}));
 function savePosition(){if(!current()||container.querySelector('#reader-text-pane').hidden)return;const top=scroller.getBoundingClientRect().top,rows=[...container.querySelectorAll('.lit-reader-paragraph')],visible=rows.find(node=>node.getBoundingClientRect().bottom>top+30),number=Number(visible?.querySelector('[data-reader-ask]')?.dataset.readerAsk);if(number&&number!==position?.paragraph){position={paragraph:number};onPosition(position);}}
 listen(scroller,'scroll',()=>{win.clearTimeout(timer);timer=win.setTimeout(savePosition,350);});
 return {locate,dispose(){if(!live)return;savePosition();live=false;win.clearTimeout(timer);}};
}
