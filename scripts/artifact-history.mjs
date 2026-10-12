import fs from 'node:fs';import path from 'node:path';
import {digest,requestBindingDigest} from './compile.mjs';import {readArtifact} from './artifacts.mjs';import {DEFAULT_STORAGE,admitStorage} from '@kontourai/flow-agents/storage-admission';import {createPublicationJail} from './publication.mjs';import {loadRun} from '@kontourai/flow';import {checkpointRetryIdentity} from './dispatch-checkpoints.mjs';
import {verifyControllerCheckpoint} from './authority.mjs';
const must=(ok,message)=>{if(!ok)throw new Error(`Historical artifact input refused: ${message}`);};
const scopeUnit=value=>value??'stage';
const storedPath=(request,author,file)=>`artifact-versions/${requestBindingDigest(request)}/${author}/${digest(file)}.data`;
export async function observeExecutionVisit({request,controllerRoot,dispatch}){
 const host=dispatch.host_execution_context??{run_id:request.run_id,controller_root:controllerRoot,stage:dispatch.stage};
 const root=fs.realpathSync(controllerRoot),ownerRoot=fs.realpathSync(host.controller_root);
 if(host.run_id!==request.run_id||ownerRoot!==root){must(host.root_owner?.run_id===request.run_id&&host.root_owner.request_binding===requestBindingDigest(request)&&fs.realpathSync(host.root_owner.controller_root)===root&&ownerRoot===path.join(root,'construction',host.run_id),'execution owner is not the admitted construction child');}
 try{
  const owner=await loadRun(host.run_id,ownerRoot);must(host.stage===dispatch.stage,'execution stage changed');
  const ownerVisit={run_id:host.run_id,digest:digest(checkpointRetryIdentity(owner))};
  const unit=dispatch.canonical_unit_claim;if(!unit)return {kind:'canonical-flow-gate',...ownerVisit};
  must(unit.stage===dispatch.stage&&unit.unit===dispatch.unit&&unit.parent_run_id===host.run_id&&fs.realpathSync(unit.controller_root)===ownerRoot,'unit execution scope changed');
  must(owner.state.current_step===unit.parent_admission_stage&&!['completed','cancelled'].includes(owner.state.status),'parent unit admission is inactive');
  const child=await loadRun(unit.run_id,ownerRoot),claim=child.state.multi_cursor?.active_claims?.find(claim=>claim.claim_id===unit.claim?.claim_id);
  must(child.state.params?.parent_run_id===host.run_id&&child.state.params?.parent_stage===dispatch.stage&&claim&&Date.parse(claim.expires_at)>Date.now()&&claim.step_id===dispatch.unit&&claim.liveness_id===unit.claim.liveness_id&&digest(claim.actor)===digest(unit.claim.actor),'actual canonical unit claim changed');
  return {kind:'canonical-unit-claim',run_id:unit.run_id,unit:dispatch.unit,owner_visit:ownerVisit,claim_id:claim.claim_id,liveness_id:claim.liveness_id,actor:claim.actor,digest:digest(checkpointRetryIdentity(child))};
 }catch(error){if(dispatch.canonical_unit_claim||dispatch.host_execution_context||error.code!=='ENOENT'&&error.code!=='flow.run_location.not_found')throw error;return {kind:'executor-dispatch',digest:digest({request_digest:dispatch.request_digest,stage:dispatch.stage,unit:scopeUnit(dispatch.unit),basis:dispatch.basis})};}
}
/** Raw private payloads become authority only when a successful publication
 * subsequently seals these descriptors. An interrupted capture is an orphan. */
export async function captureArtifactVersions({request,controllerRoot,author,targets,artifacts,payloads}){
 const root=path.join(controllerRoot,'artifact-versions');if(!fs.existsSync(root))fs.mkdirSync(root,{mode:0o700});
 must(fs.lstatSync(root).isDirectory()&&!fs.lstatSync(root).isSymbolicLink(),'archive root changed');
 const budget={...DEFAULT_STORAGE,...request.engine_sandbox.storage_budget,roots:[root]},existing=await admitStorage(budget);
 const descriptors=artifacts.map(ref=>{const target=targets.find(target=>target.path===ref.path);must(target,'output lacks declared identity');const payload=payloads.get(ref.path).bytes;must(payload.length<=1024*1024&&digest(payload)===ref.digest,'output bytes changed');return {id:target.id??null,original_path:ref.path,digest:ref.digest,bytes:payload.length,stored_path:storedPath(request,author,ref.path)};});
 const newParents=new Set(descriptors.flatMap(row=>{const parents=[];let parent=path.dirname(row.stored_path);while(parent!=='artifact-versions'){if(!fs.existsSync(path.join(controllerRoot,parent)))parents.push(parent);parent=path.dirname(parent);}return parents;}));
 must(existing.observed_bytes+descriptors.reduce((sum,row)=>sum+row.bytes,0)<=budget.max_bytes&&existing.observed_entries+descriptors.length+newParents.size<=budget.max_entries&&descriptors.every(row=>row.bytes<=budget.max_file_bytes)&&existing.free_bytes-descriptors.reduce((sum,row)=>sum+row.bytes,0)>=budget.min_free_bytes,'finite archive snapshot budget exhausted');
 const jail=createPublicationJail(controllerRoot).preflight(descriptors.map(row=>row.stored_path));
 for(const row of descriptors){must(!fs.existsSync(jail.assert(row.stored_path)),'archive destination already exists');jail.write(row.stored_path,payloads.get(row.original_path).bytes,0o400);}
 await admitStorage(budget);return descriptors;
}
function publication({request,controllerRoot,history,stage,unit,author,file,expected}){
 const start=history.starts.findLast(start=>start.publication?.checkpoint.stage===stage&&scopeUnit(start.publication.checkpoint.unit)===scopeUnit(unit)&&(!author||start.invocation_id===author)&&start.publication.checkpoint.artifacts.some(row=>row.path===file&&row.digest===expected));
 must(start,'no successful own publication matches requested bytes');const p=start.publication,c=p.checkpoint;
 must(verifyControllerCheckpoint({controllerRoot,checkpoint:c,envelope:p.envelope})&&c.invocation_id===start.invocation_id&&c.request_digest===start.request_digest&&c.receipt.id===start.invocation_id&&c.receipt.request_digest===start.request_digest&&start.worker?.terminal?.status===0&&!start.worker.terminal.timeout&&!start.worker.terminal.cancelled&&!start.worker.terminal.overflow,'publication custody changed');
 must(c.run_id===request.run_id&&c.request_binding===requestBindingDigest(request)&&c.author?.id===start.invocation_id&&c.author.role===start.author_role&&c.visit&&typeof c.visit.digest==='string'&&/^[a-f0-9]{64}$/.test(c.source_digest)&&/^[a-f0-9]{64}$/.test(c.before_source_digest),'run, author, source or visit binding changed');
 return {start,checkpoint:c,publication_digest:digest(c)};
}
/** Only own declared outputs are selected. Approved current inputs stay on
 * their original immutable channel. Reviewers inherit the exact history used
 * by the current author, rather than treating current output as its own past. */
export async function projectArtifactHistory({request,controllerRoot,history,dispatch,targets,approvedInputs,fork,sourceDigest,visit}){
 const desired=new Map(),selected=[],archiveRoot=path.join(controllerRoot,'artifact-versions'),budget={...DEFAULT_STORAGE,...request.engine_sandbox.storage_budget};if(fs.existsSync(archiveRoot))await admitStorage({...budget,roots:[archiveRoot]});
 const historyTargets=[...targets];if(dispatch.phase==='review')for(const ref of dispatch.reviewed_artifacts??[]){if(historyTargets.some(target=>target.path===ref.path))continue;const producer=history.starts.findLast(start=>start.publication?.checkpoint.stage===dispatch.stage&&scopeUnit(start.publication.checkpoint.unit)===scopeUnit(dispatch.unit)&&start.publication.checkpoint.artifact_versions?.some(row=>row.original_path===ref.path&&row.digest===ref.digest));const row=producer?.publication.checkpoint.artifact_versions.find(row=>row.original_path===ref.path&&row.digest===ref.digest);if(row)historyTargets.push({path:ref.path,id:row.id});}
 const own=ref=>historyTargets.some(target=>target.path===ref.path)&&!approvedInputs.has(ref.path);
 if(dispatch.phase==='review'){
  for(const ref of dispatch.reviewed_artifacts??[]){if(!own(ref))continue;const producer=history.starts.findLast(start=>start.publication?.checkpoint.stage===dispatch.stage&&scopeUnit(start.publication.checkpoint.unit)===scopeUnit(dispatch.unit)&&start.publication.checkpoint.artifacts.some(row=>row.path===ref.path&&row.digest===ref.digest));
   if(!producer)continue;const p=publication({request,controllerRoot,history,stage:dispatch.stage,unit:dispatch.unit,author:producer.invocation_id,file:ref.path,expected:ref.digest});for(const prior of p.checkpoint.historical_inputs??[])if(own({path:prior.original_path}))desired.set(prior.original_path,prior);
  }
 }else{
  for(const ref of dispatch.basis?.artifacts??[])if(own(ref)){const currentInput=(dispatch.context?.upstream_artifacts??[]).some(input=>input.path===ref.path&&input.digest===ref.digest),published=history.starts.some(start=>start.publication?.checkpoint.stage===dispatch.stage&&scopeUnit(start.publication.checkpoint.unit)===scopeUnit(dispatch.unit)&&start.publication.checkpoint.artifacts.some(row=>row.path===ref.path&&row.digest===ref.digest));if(!currentInput||published)desired.set(ref.path,{original_path:ref.path,digest:ref.digest});}
  for(const ref of dispatch.context?.prior_stage_outputs??[])if(own(ref)&&!desired.has(ref.path))desired.set(ref.path,{original_path:ref.path,digest:ref.digest});
  for(const target of targets){if(approvedInputs.has(target.path)||desired.has(target.path))continue;if(!history.starts.some(start=>start.publication?.checkpoint.stage===dispatch.stage&&scopeUnit(start.publication.checkpoint.unit)===scopeUnit(dispatch.unit)&&start.publication.checkpoint.artifacts.some(row=>row.path===target.path)))continue;let current;try{current=readArtifact(request.workspace,target.path);}catch(error){if(error.code==='ENOENT')continue;throw error;}
   const producer=history.starts.findLast(start=>start.publication?.checkpoint.stage===dispatch.stage&&scopeUnit(start.publication.checkpoint.unit)===scopeUnit(dispatch.unit)&&start.publication.checkpoint.artifacts.some(row=>row.path===target.path&&row.digest===current.digest));if(producer)desired.set(target.path,{original_path:target.path,digest:current.digest});
  }
 }
 for(const prior of desired.values()){
  const p=publication({request,controllerRoot,history,stage:dispatch.stage,unit:dispatch.unit,author:prior.author_id,file:prior.original_path,expected:prior.digest}),row=p.checkpoint.artifact_versions?.find(row=>row.original_path===prior.original_path&&row.digest===prior.digest),target=historyTargets.find(target=>target.path===prior.original_path);
  must(row&&row.id===(target.id??null)&&row.stored_path===storedPath(request,p.start.invocation_id,row.original_path),'missing or foreign retained version');
  const privateJail=createPublicationJail(controllerRoot).preflight([row.stored_path]);privateJail.assert(row.stored_path);const data=readArtifact(controllerRoot,row.stored_path);must(data.digest===row.digest&&data.bytes===row.bytes,'retained bytes changed');
  const snapshot_path=`.aidlc/read-only-history/${digest(dispatch.request_digest)}/${digest([p.start.invocation_id,row.original_path])}${path.extname(row.original_path)}`;
  createPublicationJail(fork).preflight([snapshot_path]).write(snapshot_path,fs.readFileSync(path.join(controllerRoot,row.stored_path)),0o400);
  selected.push({id:row.id,original_path:row.original_path,digest:row.digest,snapshot_path,author_id:p.start.invocation_id,publication_digest:p.publication_digest,source_digest:p.checkpoint.source_digest,publication_visit:p.checkpoint.visit,run_id:request.run_id,stage:dispatch.stage,unit:scopeUnit(dispatch.unit),receipt:p.checkpoint.receipt});
 }
 const projectedRoot=path.join(fork,'.aidlc/read-only-history'),projectedJail=createPublicationJail(fork).preflight(selected.map(ref=>ref.snapshot_path));
 if(selected.length)await admitStorage({...budget,roots:[fork]});const projection=selected.length?await admitStorage({...budget,roots:[projectedRoot]}):null;
 const check=async()=>{if(selected.length)await admitStorage({...budget,roots:[fork]});if(projection){const current=await admitStorage({...budget,roots:[projectedRoot]});must(current.observed_bytes===projection.observed_bytes&&current.observed_entries===projection.observed_entries,'read-only history inventory changed');}for(const ref of selected)projectedJail.assert(ref.snapshot_path);
 for(const ref of selected){must(readArtifact(fork,ref.snapshot_path).digest===ref.digest,'worker changed read-only history');const p=publication({request,controllerRoot,history,stage:dispatch.stage,unit:dispatch.unit,author:ref.author_id,file:ref.original_path,expected:ref.digest});must(p.publication_digest===ref.publication_digest,'publication changed during work');const row=p.checkpoint.artifact_versions.find(row=>row.original_path===ref.original_path&&row.digest===ref.digest);createPublicationJail(controllerRoot).preflight([row.stored_path]).assert(row.stored_path);must(readArtifact(controllerRoot,row.stored_path).digest===ref.digest,'private retained bytes changed during work');}};
 return {inputs:selected,binding:{run_id:request.run_id,stage:dispatch.stage,unit:scopeUnit(dispatch.unit),request_digest:dispatch.request_digest,source_digest:sourceDigest,visit},check};
}
