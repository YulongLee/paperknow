const labels=Object.freeze({draft:'待撰写',draft_ready:'初稿已保存',generating:'处理中',needs_materials:'待补充资料',check_required:'待检查完善',awaiting_confirmation:'待确认终稿',confirmed:'终稿已确认',review_ready:'待核对正文',interrupted:'待继续完善',cancelled:'已停止',failed:'处理未完成'});
export function documentStateLabel(row){return labels[row?.documentState?.status]||null;}
export function documentStateGroup(row){
 const status=row?.documentState?.status;
 if(['needs_materials','check_required','awaiting_confirmation','review_ready'].includes(status)&&row?.historical!==true)return 'attention';
 return ['preparing','queued','running'].includes(row?.status)?'active':row?.status;
}
