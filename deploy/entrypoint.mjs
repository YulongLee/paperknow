import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// The installed entrypoint is reached through /opt/paperknow/current.
// Node resolves the module to its release path but keeps argv[1] as supplied.
// Imports must remain side-effect free; compare actual files before running.
export function isMainModule(moduleUrl,argument=process.argv[1]){
 if(typeof argument!=='string'||!argument)return false;
 try{return pathToFileURL(realpathSync(argument)).href===moduleUrl;}catch{return false;}
}
