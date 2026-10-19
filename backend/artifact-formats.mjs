// Keep admission and exact private OSS key validation on the same extension set.
export const artifactKinds=Object.freeze(['txt','md','csv','json','html','svg','png','jpg','jpeg','pdf','docx','pptx','xlsx','zip','tex','mml']);
const mimeTypes=Object.freeze({txt:'text/plain;charset=utf-8',md:'text/markdown;charset=utf-8',csv:'text/csv;charset=utf-8',json:'application/json',html:'text/html;charset=utf-8',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',zip:'application/zip',tex:'text/plain;charset=utf-8',mml:'application/mathml+xml;charset=utf-8'});
// Informational metadata only. HTTP and OSS delivery always use an attachment
// with application/octet-stream, including XML and HTML-based file formats.
export const artifactMimeType=kind=>mimeTypes[kind]||'application/octet-stream';
