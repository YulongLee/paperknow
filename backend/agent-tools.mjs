export const agentToolNames=['list_materials','read_material','text_statistics'];
export function materialTool(snapshot,name,args={}){
  if(name==='list_materials')return {materials:snapshot.materials.map(m=>({id:m.id,name:m.name,characters:Array.from(m.text).length})),scope:'仅本次用户选定材料'};
  const material=snapshot.materials.find(m=>m.id===args.materialId);
  if(!material)throw new Error('材料不在本次任务授权范围内');
  if(name==='read_material'){
    const offset=args.offset??0,limit=args.limit??8000;
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>8000)throw new Error('读取范围无效');
    return {id:material.id,name:material.name,text:material.text.slice(offset,offset+limit),offset,nextOffset:offset+limit<material.text.length?offset+limit:null};
  }
  if(name==='text_statistics')return {id:material.id,characters:Array.from(material.text).length,paragraphs:material.text.split(/\n\s*\n/).filter(v=>v.trim()).length,scope:'确定性文本统计；不是语义、查重或学术质量评分'};
  throw new Error('工具不在允许列表中');
}
