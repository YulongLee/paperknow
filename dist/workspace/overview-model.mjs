// Overview groups only identical saved content; every record remains in My Assets.
export function recentAssets(assets,filter='all'){
 const seen=new Set();return assets.filter(a=>{if(filter==='writing'&&(a.type!=='draft'||['ppt','research','format','posting','resume'].includes(a.tool)))return false;if(filter==='detection'&&a.type!=='report')return false;if(filter==='presentation'&&a.tool!=='ppt')return false;
 const d=a.data||{};const signature=a.type==='report'?'report:'+a.id:JSON.stringify([a.title,a.tool,a.projectId,d.mode,d.stage,d.text||d.html||'',d.requirements||'',d.material||'']);if(seen.has(signature))return false;seen.add(signature);return true;});
}
export function researchStage(asset){if(!asset)return null;if(asset.type==='report')return 'detection';const d=asset.data||{};if(asset.tool==='writing')return ['draft','body'].includes(d.stage)?'writing':d.text||d.html?'outline':'writing';return {topic:'topic',proposal:'proposal',ppt:'defense',course:'writing',journal:'writing',review:'writing',rewrite:'writing',reduce:'writing'}[asset.tool]||null;}
export const stages=[['topic','选题'],['proposal','开题'],['outline','大纲'],['writing','写作'],['detection','检测'],['defense','答辩']];
