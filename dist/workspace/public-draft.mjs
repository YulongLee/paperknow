// Strip only generated service metadata from an exported copy. User-authored
// research text and nested source/material records must remain unchanged.
const serviceKeys=['model','modelId','modelName','aiModel','provider','aiProvider','engine','agentEngine','settingsVersion','settings_version','settings_meta','providerCalls','provider_calls','runtime','runtimeConfig','baseURL','baseUrl','endpoint','apiURL','aiURL','trace'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function metadataCopy(value){
 if(!object(value))return value;
 const result={...value};
 for(const key of serviceKeys)delete result[key];
 return result;
}
export function publicDraftCopy(value){
 if(!object(value))return value;
 const result=metadataCopy(value);
 for(const key of ['outlineAIResult','methodSuggestion'])if(object(result[key]))result[key]=metadataCopy(result[key]);
 return result;
}
export function publicTaskCopy(value){return metadataCopy(value);}
export function publicBackupCopy(value){
 if(!object(value))return value;
 return {...value,...(Array.isArray(value.drafts)?{drafts:value.drafts.map(publicDraftCopy)}:{}),...(Array.isArray(value.tasks)?{tasks:value.tasks.map(publicTaskCopy)}:{})};
}
