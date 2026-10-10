import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {digest} from './compile.mjs';
import {sealControllerCheckpoint,verifyControllerCheckpoint} from './authority.mjs';

/** One host execution or operator mutation owns the private controller boundary. */
export async function withControllerLock(controllerRoot,operation,{inheritedOwner,workerCustody='unknown'}={}){
 fs.mkdirSync(controllerRoot,{recursive:true,mode:0o700});controllerRoot=fs.realpathSync(controllerRoot);
 const file=path.join(controllerRoot,'execution.lock');
 if(inheritedOwner!==undefined){
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||lockOwner(fs.readFileSync(file,'utf8'))!==inheritedOwner)throw new Error('Inherited controller execution lock custody changed');
  return operation();
 }
 const owner=randomUUID();try{createControllerLock(controllerRoot,owner,{workerCustody});}catch(error){if(error.code==='EEXIST')throw new Error('Controller is executing; recomposition requires stopped workers');throw error;}
 try{return await operation();}finally{if(lockOwner(fs.readFileSync(file,'utf8'))!==owner)throw new Error('Controller execution lock custody changed');fs.unlinkSync(file);}
}

const lockOwner=bytes=>{try{return JSON.parse(bytes).owner;}catch{return bytes;}};
export function createControllerLock(controllerRoot,owner,{workerCustody='unknown',requestDigest,engineImage}={}){
 const file=path.join(controllerRoot,'execution.lock'),checkpoint={version:'1.0',owner,pid:process.pid,hostname:os.hostname(),worker_custody:workerCustody,...(requestDigest?{request_digest:requestDigest}:{}),...(engineImage?{engine_image:engineImage}:{})};fs.writeFileSync(file,JSON.stringify({...checkpoint,envelope:sealControllerCheckpoint({controllerRoot,checkpoint})})+'\n',{flag:'wx',mode:0o600});
}
export function releaseControllerLock(controllerRoot,owner){const file=path.join(controllerRoot,'execution.lock');if(lockOwner(fs.readFileSync(file,'utf8'))!==owner)throw new Error('Execution lock custody changed');fs.unlinkSync(file);}
/** Explicit recovery observes a dead same-host owner and settled host workers.
 * It never kills processes, removes containers, or alters execution evidence. */
export function recoverControllerLock(controllerRoot){
 controllerRoot=fs.realpathSync(controllerRoot);const file=path.join(controllerRoot,'execution.lock'),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Recovery lock is not a private regular file');const bytes=fs.readFileSync(file,'utf8');let record;try{record=JSON.parse(bytes);}catch{throw new Error('Legacy controller lock lacks recoverable owner evidence');}
 const {envelope,...checkpoint}=record;if(!verifyControllerCheckpoint({controllerRoot,checkpoint,envelope}))throw new Error('Recovery owner admission signature changed');
 if(record.version!=='1.0'||typeof record.owner!=='string'||!Number.isSafeInteger(record.pid)||record.pid<1||record.hostname!==os.hostname())throw new Error('Recovery requires same-host owner custody');
 try{process.kill(record.pid,0);throw new Error('Controller owner is still live');}catch(error){if(error.code!=='ESRCH')throw error;}
 if(record.worker_custody==='docker'){
  const admissionFile=path.join(controllerRoot,'request-admission.json');if(!fs.existsSync(admissionFile)||JSON.parse(fs.readFileSync(admissionFile,'utf8')).effective_request_digest!==record.request_digest||JSON.parse(fs.readFileSync(admissionFile,'utf8')).request?.engine_sandbox?.image!==record.engine_image)throw new Error('Recovery worker owner lacks admitted request custody');
  const inventory=spawnSync('docker',['ps','-aq','--filter',`label=kontour.worker.owner=${record.owner}`],{encoding:'utf8',timeout:30000,maxBuffer:1048576});if(inventory.status!==0||inventory.error)throw new Error('Docker owner inventory is unavailable');if(inventory.stdout.trim())throw new Error('Controller owned workers are not removed');
 }
 const historyFile=path.join(controllerRoot,'executor-history.json');
 if(fs.existsSync(historyFile)){const saved=JSON.parse(fs.readFileSync(historyFile,'utf8'));if(saved.digest!==digest(saved.history)||!Array.isArray(saved.history?.starts)||saved.history.starts.some(start=>record.worker_custody==='docker'&&(!start.execution_owner||start.engine_image!==record.engine_image||start.worker?.observed?.execution_owner!==start.execution_owner||start.worker?.observed?.image!==start.engine_image||start.worker?.observed?.invocation_id!==start.invocation_id)||!start.worker||start.worker.container_removed!==true||!Number.isInteger(start.worker.terminal?.status)))throw new Error('Controller worker settlement is unobserved');}
 else if(!['none','docker'].includes(record.worker_custody))throw new Error('Controller worker settlement is unobserved');
 const current=fs.lstatSync(file);if(current.dev!==stat.dev||current.ino!==stat.ino||fs.readFileSync(file,'utf8')!==bytes)throw new Error('Recovery lock custody changed');fs.unlinkSync(file);return {status:'recovered',owner_pid:record.pid,workers:'settled'};
}
