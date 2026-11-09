import {thesisFigureTitle} from './thesis-figure.mjs';
// A numbered caption is adopted only when it is the single adjacent caption
// and its entire title matches the associated figure title. Ambiguous labels
// are retained in the document for review instead of silently guessed.
export function planFigureCaptions(lines,figures){
 const byId=new Map((figures||[]).map(figure=>[figure.id,figure])),matches=[],counts=new Map();let fence='';
 const norm=value=>String(value||'').normalize('NFKC').replace(/\s+/gu,'').trim(),read=value=>String(value||'').trim().match(/^图\s*(\d+(?:[.\-－]\d+)?)\s+(.+?)\s*$/u);
 for(let i=0;i<lines.length;i++){const text=typeof lines[i]==='string'?lines[i]:lines[i].text,mark=text.match(/^\s*(`{3,}|~{3,})/);if(mark){if(!fence)fence=mark[1];else if(mark[1][0]===fence[0]&&mark[1].length>=fence.length)fence='';continue;}if(fence)continue;const id=text.trim().match(/^\[figure:([A-Za-z][A-Za-z0-9_-]{0,39})\]$/)?.[1],figure=byId.get(id);if(!figure)continue;const adjacent=[];for(const direction of [-1,1]){let j=i+direction;while(j>=0&&j<lines.length&&!(typeof lines[j]==='string'?lines[j]:lines[j].text).trim())j+=direction;if(j<0||j>=lines.length)continue;const line=typeof lines[j]==='string'?lines[j]:lines[j].text,caption=read(line);if(caption&&norm(caption[2])===norm(thesisFigureTitle(figure.title)))adjacent.push({line:j,number:caption[1].replace(/－/g,'-')});}const match={line:i,id,adjacent:adjacent.length===1?adjacent[0]:null};matches.push(match);if(match.adjacent)counts.set(match.adjacent.number,(counts.get(match.adjacent.number)||0)+1);}
 const reserved=new Set(matches.filter(row=>row.adjacent&&counts.get(row.adjacent.number)===1).map(row=>row.adjacent.number)),used=new Set(),skipped=new Set(),numbers=new Map();let next=1;
 for(const row of matches){const candidate=row.adjacent&&counts.get(row.adjacent.number)===1?row.adjacent:null;let number;if(candidate){number=candidate.number;skipped.add(candidate.line);}else{while(reserved.has(String(next))||used.has(String(next)))next++;number=String(next++);}used.add(number);numbers.set(row.line,number);}
 return {numbers,skipped};
}
