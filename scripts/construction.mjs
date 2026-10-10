import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
const retain=(file,value)=>{const tmp=`${file}.${randomUUID()}.tmp`;fs.writeFileSync(tmp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file);};
import {readArtifact} from './artifacts.mjs';
import {snapshotWorkspace} from './workspace.mjs';
import { loadRun } from '@kontourai/flow';
import { digest, requestBindingDigest } from './compile.mjs';
import { validateUnits } from './dispatch.mjs';
import {validateVerificationCommand,verifyConstructionUnit} from './construction-checkpoints.mjs';

/** Pinned usesStageLevelPerUnitArtifacts: the approved effective plan may
 * omit Units, but a completed producer keeps its unit authority after a skip.
 * Invalidating its artifacts never silently converts it to stage-level work. */
export function requiresConstructionUnits(stageIds,records,runState={}){
  return stageIds.includes('units-generation')||records.some(record=>record.stage==='units-generation'&&['pass','disabled'].includes(record.sensors?.status))||[...(runState.gate_outcomes??[]),...(runState.gate_outcome_history??[])].some(outcome=>outcome.gate_id==='units-generation-gate'&&outcome.status==='pass');
}

/** Deterministic dependency-first order; source custody is exclusive per Bolt. */
export function constructionOrder(units) {
  const manifest=validateUnits(units),ordered=[],seen=new Set();
  function visit(unit){if(seen.has(unit.id))return;for(const id of unit.depends_on??[])visit(manifest.find(entry=>entry.id===id));seen.add(unit.id);ordered.push(unit);}
  for(const unit of manifest)visit(unit);
  return ordered;
}
export function constructionBlock(snapshot,stageIds,firstStage) {
  const start=stageIds.indexOf(firstStage),block=[];
  for(const id of stageIds.slice(start)){const stage=snapshot.stages.find(stage=>stage.slug===id);if(stage.phase!=='construction'||!stage.for_each)break;block.push(id);}
  return block;
}

/**
 * A reusable serial child-workflow composition port. Each admitted child runs
 * the entire block for one unit using the same conductor, checks and authority.
 * Parent advancement remains separate. No child completion is a parent gate.
 */
export async function executeConstruction({request,controllerRoot,stageIds,units,runSlice,authority,signal,snapshotBasis,checkpointPolicy,commandRunner,testingContractDigest,skeleton=true}) {
  const ordered=constructionOrder(units),parent=await loadRun(request.run_id,controllerRoot);
  if(parent.state.current_step!==stageIds[0]||['completed','cancelled'].includes(parent.state.status))throw new Error('Construction parent admission changed');
  const cacheRoot=path.join(controllerRoot,'construction-child-completions');fs.mkdirSync(cacheRoot,{recursive:true,mode:0o700});
  const children=[];let verificationCommand,commandGrant,commandAuthorization;
  if(checkpointPolicy?.enabled){
    const input={purpose:'construction-verification-command',stage:stageIds[0],stage_ids:stageIds,unit_ids:ordered.map(unit=>unit.id),command:checkpointPolicy.command,testing_contract_digest:testingContractDigest,request_digest:requestBindingDigest(request)};
    commandGrant=await authority?.authorize?.(input);
    if(!commandGrant?.authorized||authority.verify?.(commandGrant.receipt,input)!==true)return {status:'waiting',children,failure:{stage:stageIds[0],reason:'authority_required',detail:commandGrant,checkpoint:'construction-verification-command'}};
    const selected=checkpointPolicy.command??commandGrant.receipt?.payload?.disposition?.verification_command;
    if(selected==null)return {status:'waiting',children,failure:{stage:stageIds[0],reason:'authority_required',detail:{reason:'verification_command_required'},checkpoint:'construction-verification-command'}};
    verificationCommand=validateVerificationCommand(selected);commandAuthorization={input_digest:commandGrant.receipt.payload.input_digest,request_digest:requestBindingDigest(request),command_digest:digest(verificationCommand)};
  }

  const baselineFile=path.join(cacheRoot,'source-baseline.json');
  if(!fs.existsSync(baselineFile)){const baseline={request_digest:requestBindingDigest(request),source:snapshotWorkspace(request.workspace).files.map(({path,digest})=>({path,digest}))};fs.writeFileSync(baselineFile,JSON.stringify({baseline,digest:digest(baseline)})+'\n',{flag:'wx',mode:0o600});}
  const assertPublicationLineage=async()=>{
    const retained=JSON.parse(fs.readFileSync(baselineFile,'utf8'));if(retained.digest!==digest(retained.baseline)||retained.baseline.request_digest!==requestBindingDigest(request))throw new Error('Construction initial source baseline changed');
    const expected=new Map(retained.baseline.source.map(ref=>[ref.path,ref.digest]));
    for(const owner of ordered){const file=path.join(cacheRoot,`${owner.id}.json`);if(!fs.existsSync(file))break;const saved=JSON.parse(fs.readFileSync(file,'utf8')),childRequest={...structuredClone(request),run_id:`${request.run_id.slice(0,65)}-bolt-${digest({unit:owner,stageIds,parentAdmission:parent.state.transitions}).slice(0,24)}`};
      if(saved.binding!==digest({request:requestBindingDigest(childRequest),unit:owner,stageIds,testingContractDigest})||saved.digest!==digest(saved.child))throw new Error('Construction publication lineage binding changed');
      const canonical=await loadRun(childRequest.run_id,saved.child.controller_root);if(canonical.state.status!=='completed')throw new Error('Construction publication lineage child is not completed');
      for(const ref of saved.child.construction_source_refs??[]){if((expected.get(ref.path)??null)!==ref.before_digest)throw new Error('Construction publication lineage has an unobserved source transition');if(ref.digest===null)expected.delete(ref.path);else expected.set(ref.path,ref.digest);}
    }
    const observed=snapshotWorkspace(request.workspace).files.map(({path,digest})=>[path,digest]).sort((a,b)=>a[0].localeCompare(b[0])),planned=[...expected].sort((a,b)=>a[0].localeCompare(b[0]));
    if(digest(observed)!==digest(planned))throw new Error('Construction source changed outside publication lineage');
  };
  await assertPublicationLineage();
  for(const [index,unit] of ordered.entries()){
    if(signal?.aborted)return {status:'cancelled',children};
    const before=await loadRun(request.run_id,controllerRoot);if(before.state.current_step!==stageIds[0]||before.state.status!==parent.state.status)throw new Error('Construction parent admission changed during walk');
    const childRequest={...structuredClone(request),run_id:`${request.run_id.slice(0,65)}-bolt-${digest({unit,stageIds,parentAdmission:parent.state.transitions}).slice(0,24)}`};
    const childDigest=requestBindingDigest(childRequest),parentDigest=requestBindingDigest(request);
    const translate=input=>{if(input.request_digest!==childDigest)throw new Error('Child authority request substituted');return {...input,request_digest:parentDigest,construction_child:{run_id:childRequest.run_id,unit:unit.id,stage_ids:stageIds}};};
    const childAuthority={authorize:input=>authority?.authorize?.(translate(input)),verify:(receipt,input)=>authority?.verify?.(receipt,translate(input)),authorizeFinding:authority?.authorizeFinding};
    const cacheFile=path.join(cacheRoot,`${unit.id}.json`),childBinding=digest({request:requestBindingDigest(childRequest),unit,stageIds,testingContractDigest});let child,cached;
    if(fs.existsSync(cacheFile)){cached=JSON.parse(fs.readFileSync(cacheFile,'utf8'));if(cached.binding!==childBinding||cached.digest!==digest(cached.child))throw new Error('Construction child completion binding or receipt changed');child=cached.child;}
    else child=await runSlice({request:childRequest,authority:childAuthority,unit:{...unit,depends_on:[],context:{dependency_units:unit.depends_on??[]}},children});
    children.push({unit:unit.id,result:child});
    if(child.status!=='completed')return {status:child.status,children,failure:child.failure};
    const canonical=await loadRun(childRequest.run_id,child.controller_root);
    if(canonical.state.status!=='completed'||stageIds.some(id=>!canonical.state.gate_outcomes.some(outcome=>outcome.gate_id===`${id}-gate`&&outcome.status==='pass')))throw new Error('Construction child is not canonically completed');
    const sourceRefs=child.construction_source_refs??[];
    const lineageExpected=new Map(sourceRefs.map(ref=>[ref.path,ref.digest]));
    for(const later of ordered.slice(index+1)){
      const laterFile=path.join(cacheRoot,`${later.id}.json`);if(!fs.existsSync(laterFile))break;
      const next=JSON.parse(fs.readFileSync(laterFile,'utf8')),nextRequest={...structuredClone(request),run_id:`${request.run_id.slice(0,65)}-bolt-${digest({unit:later,stageIds,parentAdmission:parent.state.transitions}).slice(0,24)}`};
      if(next.binding!==digest({request:requestBindingDigest(nextRequest),unit:later,stageIds,testingContractDigest})||next.digest!==digest(next.child))throw new Error('Construction publication lineage binding changed');
      const published=await loadRun(nextRequest.run_id,next.child.controller_root);if(published.state.status!=='completed'||stageIds.some(id=>!published.state.gate_outcomes.some(outcome=>outcome.gate_id===`${id}-gate`&&outcome.status==='pass')))throw new Error('Construction publication lineage lacks completed canonical child authority');
      for(const ref of next.child.construction_source_refs??[])if(lineageExpected.has(ref.path)){
        if(ref.before_digest!==lineageExpected.get(ref.path))throw new Error('Construction publication lineage has an unobserved source transition');lineageExpected.set(ref.path,ref.digest);
      }
    }
    const lineageSnapshot=async basis=>{
      const artifacts=basis.map(ref=>{const value=readArtifact(request.workspace,ref.path);if(value.digest!==ref.digest)throw new Error('Construction unit artifact basis changed');return {path:ref.path,digest:value.digest};});
      const currentSource=new Map(snapshotWorkspace(request.workspace).files.map(file=>[file.path,file]));
      const sources=[...lineageExpected].map(([file,expected])=>{if(expected===null){if(fs.existsSync(path.join(request.workspace,file)))throw new Error('Construction deleted source reappeared outside publication lineage');return {path:file,digest:null};}const value=currentSource.get(file);if(value?.digest!==expected)throw new Error('Construction unit source basis changed outside publication lineage');return {path:file,digest:expected};});
      return {source_digest:digest(sources),source_refs:sources,artifacts};
    };
    const scopedSnapshot=async basis=>{
      const artifacts=basis.map(ref=>{const value=readArtifact(request.workspace,ref.path);if(value.digest!==ref.digest)throw new Error('Construction unit artifact basis changed');return {path:ref.path,digest:value.digest};});
      const currentSource=new Map(snapshotWorkspace(request.workspace).files.map(file=>[file.path,file]));
      const sources=sourceRefs.map(ref=>{if(ref.digest===null){if(fs.existsSync(path.join(request.workspace,ref.path)))throw new Error('Construction unit deleted source reappeared');return ref;}const value=currentSource.get(ref.path);if(value?.digest!==ref.digest)throw new Error('Construction unit source basis changed');return {path:ref.path,digest:value.digest};});
      return {source_digest:digest(sources),source_refs:sources,artifacts};
    };
    await lineageSnapshot(child.records.flatMap(record=>record.artifacts??[]));
    if(!fs.existsSync(cacheFile))fs.writeFileSync(cacheFile,JSON.stringify({binding:childBinding,child,digest:digest(child)})+'\n',{flag:'wx',mode:0o600});
    await assertPublicationLineage();
    if(cached?.admission){
      if(cached.admission_digest!==digest(cached.admission)||checkpointPolicy?.enabled&&(!cached.admission.verification||cached.admission.verification.record?.status!=='verified'||cached.admission.unit_input?.verification_digest!==digest(cached.admission.verification.record)||cached.admission.unit_input?.command_digest!==digest(verificationCommand)||!cached.admission.unit_checkpoint||authority.verify?.(cached.admission.unit_checkpoint.receipt,cached.admission.unit_input)!==true)||index===0&&skeleton&&(!cached.admission.skeleton_checkpoint||authority.verify?.(cached.admission.skeleton_checkpoint.receipt,cached.admission.skeleton_input)!==true))throw new Error('Historical construction checkpoint authority changed');
      Object.assign(children.at(-1),{verification:cached.admission.verification?{...cached.admission.verification,replayed:true,evidence_class:'historical-checkpoint-observation'}:null,unit_checkpoint:cached.admission.unit_checkpoint??null,checkpoint:cached.admission.skeleton_checkpoint??null});
      continue;
    }
    const admission={};
    if(checkpointPolicy?.enabled){
      const basis=child.records.filter(record=>stageIds.includes(record.stage)).flatMap(record=>record.artifacts??[]);
      const verified=await verifyConstructionUnit({request,controllerRoot,stage:stageIds.at(-1),unit:unit.id,basis,command:verificationCommand,commandAuthority:commandAuthorization,snapshotBasis:scopedSnapshot,commandRunner,testingContractDigest,signal});
      children.at(-1).verification=verified;
      if(verified.status!=='verified')return {status:'failed',children,failure:{stage:stageIds[0],reason:verified.reason,detail:verified}};
      const current=await scopedSnapshot(basis),input={purpose:'construction-checkpoint',stage:stageIds.at(-1),stage_ids:stageIds,unit:unit.id,basis,source_digest:current.source_digest,verification_id:verified.record.id,verification_digest:digest(verified.record),command_digest:digest(verificationCommand),command_authority:commandAuthorization,testing_contract_digest:testingContractDigest,request_digest:requestBindingDigest(request)};
      const grant=await authority?.authorize?.(input);
      if(!grant?.authorized||authority.verify?.(grant.receipt,input)!==true)return {status:'waiting',children,failure:{stage:stageIds[0],reason:'authority_required',detail:grant,checkpoint:'construction-checkpoint',unit:unit.id}};
      if(digest(await scopedSnapshot(basis))!==digest(current))throw new Error('Construction checkpoint basis changed during authority decision');
      children.at(-1).unit_checkpoint=grant;admission.unit_checkpoint=grant;admission.unit_input=input;admission.verification=verified;
    }
    if(index===0&&skeleton){
      const basis=child.records.filter(record=>stageIds.includes(record.stage)).flatMap(record=>record.artifacts??[]);
      const current=await scopedSnapshot(basis);if(!current||!current.source_digest)throw new Error('Skeleton checkpoint requires observed source and artifact basis');
      const input={purpose:'skeleton-checkpoint',stage:stageIds[0],basis,source_digest:current.source_digest,child_run_id:childRequest.run_id,unit:unit.id,request_digest:parentDigest};
      const grant=await authority?.authorize?.(input);
      if(!grant?.authorized||authority.verify?.(grant.receipt,input)!==true)return {status:'waiting',children,failure:{stage:stageIds[0],reason:'authority_required',detail:grant}};
      if(digest(await scopedSnapshot(basis))!==digest(current))throw new Error('Skeleton checkpoint basis changed during authority decision');
      children.at(-1).checkpoint=grant;admission.skeleton_checkpoint=grant;admission.skeleton_input=input;
    }
    const retained=JSON.parse(fs.readFileSync(cacheFile,'utf8'));retained.admission=admission;retained.admission_digest=digest(admission);retain(cacheFile,retained);
  }
  return {status:'completed',children};
}
