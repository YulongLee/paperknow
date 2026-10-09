// Bound density changes so large displays show more content without stretching empty cards.
export function homeLayout(width,height){
 const desktop=width>1000;
 return {desktop,results:desktop?Math.max(3,Math.min(14,Math.floor((height-620)/78))):5,continuations:desktop&&height>=1200?3:1};
}
export function fitHomeRows({width,height,listTop,rowHeight=78,footerHeight=60}){
 if(width<=1000)return 5;
 if(!Number.isFinite(rowHeight)||rowHeight<=0)return homeLayout(width,height).results;
 return Math.max(3,Math.min(14,Math.floor((height-listTop-footerHeight)/rowHeight)));
}
export function continuationAssets(assets,projects,limit=1){
 const archived=new Set(projects.filter(p=>p.status==='archived').map(p=>p.id));const seen=new Set();
 return assets.filter(a=>{if(archived.has(a.projectId))return false;const key=a.projectId||'independent:'+a.tool;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,limit);
}
