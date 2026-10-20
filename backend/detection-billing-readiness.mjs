import {aigcDetectionConfigured} from './aigc-detection-client.mjs';
import {webSearchConfigured} from './web-similarity-search.mjs';

// Detection delivery has its own cloud settings. An unrelated writing model
// being ready must never make an unavailable detection entitlement saleable.
export function detectionBillingReady(key,config={}){
 if(key==='detection-aigc')return Boolean(aigcDetectionConfigured(config)&&(!config.aigcDetectionClient||config.aigcDetectionClient.ready!==false&&typeof config.aigcDetectionClient.detect==='function'));
 if(key==='detection-similarity')return Boolean(webSearchConfigured(config)&&config.storage?.provider==='aliyun_oss'&&typeof config.storage.bucket==='string'&&typeof config.storage.prefix==='string'&&['putArtifact','readArtifact','removeArtifact'].every(name=>typeof config.storage[name]==='function'));
 return false;
}
