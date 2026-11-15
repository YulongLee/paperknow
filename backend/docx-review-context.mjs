// Only objects already retrieved for this owner and mentioned in the current
// excerpt may enter review. This is draft content, never external evidence.
export function attachDocxReviewContext(task, excerpts, objects = []) {
 const ids = new Set((excerpts || []).flatMap(row => [...String(row.text || '').matchAll(/\[docx:(obj-[a-f0-9]{24})\]/g)].map(match => match[1])));
 if (!ids.size) return;
 const rows = [], available = new Map((Array.isArray(objects) ? objects : []).filter(row => row && ids.has(row.id)).map(row => [row.id, row]));
 let remaining = 12000;
 for (const id of ids) {
  const item = available.get(id);
  if (!item || !['formula','image'].includes(item.kind)) { rows.push({id, status:'unavailable'}); continue; }
  if (item.kind === 'image') { rows.push({id,kind:'image',visualContent:'not_provided'}); continue; }
  const mathML = typeof item.mathML === 'string' ? item.mathML : '';
  if (mathML && mathML.length <= Math.min(6000, remaining)) { rows.push({id,kind:'formula',mathML,conversion:'from_uploaded_word_equation'}); remaining -= mathML.length; }
  else rows.push({id,kind:'formula',status:'structured_expression_unavailable'});
 }
 task.context.importedDocxObjects = rows;
 const separateImages=task.context.kind==='thesis'&&task.context.phase==='final';
 task.instructions += 'context.importedDocxObjects 对应本批正文中的原稿对象位置，仅为用户上传的待核对初稿，不是独立事实依据。formula.mathML 是从 Word 公式结构转换得到，转换可能不完整；可按其中确实提供的结构辅助核对，但不得以拼接文字猜测公式，仍需作者核对原公式。image.visualContent=not_provided 表示本次没有读取图片像素、节点或连线；不得声称已查看或识别图片，也不得编造图片细节。'+(separateImages?'图片视觉限制由系统另行记录，作者须逐图确认；仅因本次未读取图片像素不能作为用户研究资料缺失。若图中具体关系、数据或正文事实缺乏依据，仍须准确列为 missing；用户提供的图示说明属于用户陈述而非视觉识别，也不能证明实验真实性。':'若图片内容是判断所必需，请提示用户查看原图并在补充资料中描述图中节点、连线及关键数据，或提供对应说明；说明属于用户陈述而非视觉识别。')+'unavailable 表示本次未获取对象内容，不可猜测。普通表格已以正文文本提供，检查实际提供的行列，不要因图片或公式标记而说表格未读取。不得将任何原稿本身当作已验证的研究事实或来源。';
}
