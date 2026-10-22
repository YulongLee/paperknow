import {pptMasterRuntimeReady} from './ppt-master-runtime.mjs';

// Shared by pricing/publication and task execution. Keep this independent of
// billing, task services and workers so checking catalogue delivery cannot
// introduce a billing -> tool service -> billing dependency cycle.
export function presentationGenerationStatus(config={}){
 const storage=config.storage;
 const storageReady=storage?.provider==='aliyun_oss'&&typeof storage.bucket==='string'&&typeof storage.prefix==='string'&&typeof storage.putArtifact==='function'&&typeof storage.readArtifact==='function'&&typeof storage.removeArtifact==='function';
 const rendererReady=config.pptMasterEnabled===true&&(typeof config.pptMasterRenderer==='function'||pptMasterRuntimeReady(config));
 return{ready:storageReady&&rendererReady,reason:!storageReady?'演示成果云存储暂不可用，请稍后重试':!rendererReady?'演示生成服务正在准备，请稍后重试':null};
}
