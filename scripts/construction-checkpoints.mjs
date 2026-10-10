import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {digest,requestBindingDigest} from './compile.mjs';
import {snapshotWorkspace} from './workspace.mjs';
export function constructionCheckpointPolicy(snapshot,stageIds,parameters={}){
 const config=parameters.construction_checkpoints??{};if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(key=>!['enabled','verification_command'].includes(key))||config.enabled!==undefined&&typeof config.enabled!=='boolean')throw new Error('Invalid registered construction checkpoint policy');
 const sourceStages=stageIds.map(id=>snapshot.stages.find(stage=>stage.slug===id)).filter(stage=>stage?.phase==='construction'&&stage.for_each&&stage.workspace_requires===true);
 return {enabled:config.enabled??(stageIds.includes('units-generation')&&sourceStages.length>0),command:config.verification_command??null,sourceStages:sourceStages.map(stage=>stage.slug)};
}
export function validateVerificationCommand(command){
 if(typeof command==='string'){if(!command.trim()||command.length>8192||command.includes('\0'))throw new Error('Invalid operator verification command');return command;}
 if(!Array.isArray(command)||!command.length||command.length>128||command.some(arg=>typeof arg!=='string'||!arg||arg.length>8192||arg.includes('\0')))throw new Error('Operator verification command must be explicit bounded argv or shell text');return structuredClone(command);
}
const store=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=`${file}.${randomUUID()}.tmp`;fs.writeFileSync(tmp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file);};
/** Current-basis process proof; starts are durable before execution and never silently retried. */
export async function verifyConstructionUnit({request,controllerRoot,stage,unit,basis,command,commandAuthority,snapshotBasis,commandRunner,testingContractDigest,signal}){
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(unit)||!Array.isArray(basis)||basis.length>512)throw new Error('Invalid bounded construction unit basis');
 const source=await snapshotBasis(basis),input={request_digest:requestBindingDigest(request),stage,unit,basis:source,artifacts:basis,command,command_authority:commandAuthority,testing_contract_digest:testingContractDigest};
 const root=path.join(controllerRoot,'construction-checkpoints'),file=path.join(root,`${unit}.verification.json`),binding=digest(input);let saved;
 if(fs.existsSync(file)){
  saved=JSON.parse(fs.readFileSync(file,'utf8'));if(saved.digest!==digest(saved.record)||saved.record.binding!==binding)throw new Error('Construction verification basis or retained receipt changed');
  if(saved.record.status!=='verified')return {status:'failed',reason:'construction_verification_retry_requires_new_registration',record:saved.record};
  if(digest(await snapshotBasis(basis))!==digest(source))throw new Error('Construction verification source or artifact basis changed');return {status:'verified',record:saved.record,replayed:true};
 }
 if(typeof commandRunner!=='function')return {status:'not_verified',reason:'construction_verification_runner_required'};
 const wholeSourceBefore=snapshotWorkspace(request.workspace).source_digest;
 const record={version:'1.0',id:randomUUID(),binding,input,status:'started',whole_source_before:wholeSourceBefore,started_at:new Date().toISOString()};fs.mkdirSync(root,{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify({record,digest:digest(record)})+'\n',{flag:'wx',mode:0o600});
 try{
  const result=await commandRunner({id:'construction-verification',command,cwd:request.workspace,timeoutMs:request.parameters?.check_timeout_ms??120000,maxOutputBytes:1024*1024,basis:basis.map(ref=>({path:ref.path,sha256:ref.digest})),signal});
  const unchanged=digest(await snapshotBasis(basis))===digest(source)&&snapshotWorkspace(request.workspace).source_digest===wholeSourceBefore;
  record.result=result??null;record.evidence_unchanged=unchanged;record.finished_at=new Date().toISOString();
  const expectedCommand=Array.isArray(command)?command:['sh','-lc',command];
  const receiptValid=result?.receipt&&typeof result.receipt.id==='string'&&!!result.receipt.id&&digest(result.receipt.command)===digest(expectedCommand)&&result.receipt.exit_code===result.exitCode&&result.receipt.timed_out!==true&&result.receipt.timeout!==true&&!result.receipt.signal;
  record.receipt_valid=!!receiptValid;record.status=result?.exitCode===0&&receiptValid&&unchanged?'verified':'failed';store(file,{record,digest:digest(record)});
  return {status:record.status,reason:!unchanged?'construction_verification_basis_changed':result?.exitCode!==0?'construction_verification_failed':!receiptValid?'construction_verification_receipt_invalid':null,record,replayed:false};
 }catch(error){record.status='failed';record.error=error.message;record.finished_at=new Date().toISOString();store(file,{record,digest:digest(record)});return {status:'failed',reason:'construction_verification_failed',record,replayed:false};}
}
