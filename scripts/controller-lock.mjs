import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

/** One host execution or operator mutation owns the private controller boundary. */
export async function withControllerLock(controllerRoot,operation,{inheritedOwner}={}){
 fs.mkdirSync(controllerRoot,{recursive:true,mode:0o700});controllerRoot=fs.realpathSync(controllerRoot);
 const file=path.join(controllerRoot,'execution.lock');
 if(inheritedOwner!==undefined){
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||fs.readFileSync(file,'utf8')!==inheritedOwner)throw new Error('Inherited controller execution lock custody changed');
  return operation();
 }
 const owner=randomUUID();try{fs.writeFileSync(file,owner,{flag:'wx',mode:0o600});}catch(error){if(error.code==='EEXIST')throw new Error('Controller is executing; recomposition requires stopped workers');throw error;}
 try{return await operation();}finally{if(fs.readFileSync(file,'utf8')!==owner)throw new Error('Controller execution lock custody changed');fs.unlinkSync(file);}
}
