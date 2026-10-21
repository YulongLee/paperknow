import {thesisError,thesisHash} from './thesis-model.mjs';

export function resolveTaskProject(db,value,user){
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string')throw thesisError(400,'项目编号无效');
 if(!db.prepare('SELECT id FROM projects WHERE id=? AND user_id=?').get(value,user.id))throw thesisError(404,'项目不存在');
 return value;
}

// Preserve hashes for historical independent tasks and their saved checkpoints.
export const projectTaskHash=(inputHash,projectId)=>projectId?thesisHash({inputHash,projectId}):inputHash;

export function taskProjectId(db,row){
 return db.prepare('SELECT project_id FROM jobs WHERE id=? AND user_id=?').get(row.id,row.user_id)?.project_id??null;
}
