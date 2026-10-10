import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sha=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
/** Native engine execution is an explicitly authorized host profile. It does
 * not inherit the Docker profile's filesystem or credential confinement. */
export function nativeEngineWorker({host,environment={},runner,redactValues=[]}){
 if(host.isolation!=='trusted-host'||host.host_access_granted!==true||typeof runner!=='function')throw new Error('Explicit native host execution required');
 return async options=>{
  const bytes=fs.readFileSync(options.contextFile),context=JSON.parse(bytes);
  const prompt=JSON.stringify(context)+'\nNative host execution: your actual working directory is '+JSON.stringify(options.workspace)+'. The /workspace path in the methodology denotes this supplied snapshot. Use relative output paths here; do not access or modify the canonical workspace or private controller. This is a trusted host profile without OS filesystem confinement.';
  const result=await runner({engine:host.engine,workspace:options.workspace,prompt,model:host.model,timeoutMs:options.timeoutMs,executionProfile:'host-native',hostAccessGranted:true,allowTools:true,readOnlyWorkspace:options.readOnlyWorkspace,signal:options.signal,environment,redactValues});
  const success=result.outcome==='completed'&&result.terminal.status===0&&!result.terminal.timeout&&!result.terminal.cancelled&&!result.terminal.overflow&&result.observed.engine===host.engine&&typeof result.final==='string';
  fs.mkdirSync(options.artifactRoot,{recursive:true,mode:0o700});
  for(const [suffix,value]of [['stdout.jsonl',result.stdout??''],['stderr.log',result.stderr??''],['engine-receipt.json',JSON.stringify(result)]])fs.writeFileSync(path.join(options.artifactRoot,`${options.invocationId}.${suffix}`),value,{flag:'wx',mode:0o600});
  return {observed:{...result.observed,execution_owner:options.ownerId,invocation_id:options.invocationId,context_digest:sha(bytes),stdin_digest:result.observed.prompt_digest,argv_model:host.model,model_observation:'Native CLI requested model; physical model unverified',provider:host.provider,provider_observation:'Configured native provider label; native engine owns routing, provider identity unverified',harness:host.engine,harness_version:result.observed.harness_version,container_id:null,image:null,mounts:[],controller_mounted:null,credentials_mounted:null,execution_profile:'host-native',isolation:'none',credential_confinement:false,canonical_workspace:context.canonical_workspace,unit_scope:context.unit_scope},terminal:{status:success?0:result.terminal.status===0?1:result.terminal.status,timeout:result.terminal.timeout,overflow:result.terminal.overflow,signal:result.terminal.signal,cancelled:result.terminal.cancelled},provider_thread_id:result.session_id,usage:result.usage,final:success?result.final:null,container_removed:null,engine_outcome:result.outcome,process_settlement:'parent-close-observed; descendants-unverified',stdout_digest:result.stdout_digest,stderr_digest:result.stderr_digest};
 };
}
