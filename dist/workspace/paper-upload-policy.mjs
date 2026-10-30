// Paper manuscripts share one format policy; detection reports keep their own
// provider formats and literature/PPT imports are intentionally unaffected.
export const PAPER_ACCEPT='.docx';
export const PAPER_MAX_BYTES=50*1024*1024;
export function validatePaperUpload(file){
 if(!file||!/\.docx$/i.test(String(file.name||'')))throw Object.assign(Error('论文原文仅支持 DOCX，请将文档另存为 .docx 后上传。'),{publicMessage:'论文原文仅支持 DOCX，请将文档另存为 .docx 后上传。'});
 if(!Number.isFinite(file.size)||file.size<=0||file.size>PAPER_MAX_BYTES)throw Object.assign(Error('请选择非空且不超过 50MB 的 DOCX 文档。'),{publicMessage:'请选择非空且不超过 50MB 的 DOCX 文档。'});
 return file;
}
