import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { startRun, loadRun, attachEvidence, evaluateRun, validateDefinition, definitionDigest } from '@kontourai/flow';
import { validateTrustBundle, buildTrustReport } from '@kontourai/surface';
import { readSnapshot, compileProfile, digest, requestBindingDigest } from './compile.mjs';
import { readArtifact, observeStage, projectInvalidation } from './artifacts.mjs';
import { runStageSensors, parseUnitEdges } from './sensors.mjs';
import { dispatchStage } from './dispatch.mjs';
import { createUnitFlow } from './unit-flow.mjs';
import { verifyFinalUnits } from './final-review.mjs';
import { plannedTestCommands } from './commands.mjs';
import { snapshotWorkspace } from './workspace.mjs';
import { resolveCeremony, effectiveStage, summaryTargets,deferCheckpointLearnings } from './ceremony.mjs';
import { constructionBlock, executeConstruction, requiresConstructionUnits } from './construction.mjs';
import {constructionCheckpointPolicy} from './construction-checkpoints.mjs';
import {resolveTestingContract,assertTestingPolicyCurrent,validateTestingPlans,stampTestingPlan} from './testing-posture.mjs';
import {resolveComposition} from './composition.mjs';
import {boundDefinition} from './definition.mjs';
import {verifyRecompositionLedger,pendingRecomposition,childExecutionSnapshot} from './recomposition.mjs';
import {withControllerLock} from './controller-lock.mjs';
import {retainedQuestionnaire,questionnaireSubject,materializeQuestionnaireReply,questionnaireOverlayBasis} from './questionnaire-replies.mjs';
import {unitReviewInput} from './review-dispositions.mjs';
import {verifyControllerCheckpoint} from './authority.mjs';
import {createIntentInputCheckpoint} from './intent-inputs.mjs';
import {retainedDispatch,checkpointRetryIdentity,checkpointContextBinding,loadRetainedDispatch,saveRetainedDispatch} from './dispatch-checkpoints.mjs';

const safeId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);
const inside = (root, file) => { const rel=path.relative(root,file);return rel!== '..'&&!rel.startsWith(`..${path.sep}`)&&!path.isAbsolute(rel); };
const json = file => JSON.parse(fs.readFileSync(file,'utf8'));
const write = (file,value) => {fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.${randomUUID()}.tmp`;fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file);};

export { snapshotWorkspace } from './workspace.mjs';

export function artifactPaths(stage, unit=null) {
  const prefix=`.aidlc/artifacts/${stage.slug}${unit&&unit!=='stage'?`/${unit}`:''}`;
  return [...new Set([...(stage.produces??[]),...(stage.optional_produces??[])])].map(id=>({id,stage:stage.slug,unit:unit??null,path:`${prefix}/${id}.${id==='traceability'?'json':'md'}`}));
}

function currentRefs(workspace,refs){return refs.flatMap(ref=>{try{const value=readArtifact(workspace,ref.path);return [{...ref,digest:value.digest}];}catch{return [];}});}

function observationBundle({runId,stage,kind,status,record,now,invalid=false}){
  const claimId=`${stage}-${kind}`;const passing=status==='pass';
  const evidenceType=kind==='review'?'runtime_observation':'test_output';
  return {schemaVersion:5,source:'kontour/aidlc-runtime;statusFunctionVersion=3',
    claims:[{id:claimId,subjectType:'flow-step',subjectId:`${runId}/${stage}`,facet:'quality',claimType:`aidlc.${stage}-${kind}`,fieldOrBehavior:`Observed AI-DLC ${kind} for ${stage}`,value:passing,createdAt:now,updatedAt:now,verificationPolicyId:'observed-policy',metadata:{workflow_subject_ref:runId,record_digest:digest(record)}}],
    evidence:[{id:'observation',claimId,evidenceType,method:'validation',sourceRef:`sha256:${digest(record)}`,excerptOrSummary:'Runtime-observed bytes, checks and execution receipts; semantic correctness is independently graded.',observedAt:now,collectedBy:'aidlc-runtime',passing}],
    events:[{id:'observed',claimId,status:passing?'verified':'disputed',actor:'aidlc-runtime',method:'validation',evidenceIds:['observation'],createdAt:now,verifiedAt:now},...(invalid?[{id:'invalidated',claimId,type:'invalidation',status:'stale',actor:'aidlc-runtime',method:'validation',evidenceIds:[],createdAt:new Date(Date.parse(now)+1).toISOString()}]:[])],
    policies:[{id:'observed-policy',claimType:`aidlc.${stage}-${kind}`,requiredEvidence:[evidenceType],acceptanceCriteria:['Current runtime observations and their required checks pass.'],reviewAuthority:'system',validityRule:{kind:'manual'},stalenessTriggers:[],conflictRules:[],impactLevel:'low'}]};
}

/** Stage observations -> Surface -> actual persisted Flow evidence. No run-state edits. */
export async function attachObservation({controllerRoot,runId,stage,kind='completion',status,record,supersede,invalid=false}){
  const now=new Date().toISOString();const bundle=observationBundle({runId,stage,kind,status,record,now,invalid});
  validateTrustBundle(bundle);
  const observationId=randomUUID();const recordFile=path.join(controllerRoot,'observations',`${stage}-${kind}-${observationId}.record.json`);write(recordFile,record);
  const file=path.join(controllerRoot,'observations',`${stage}-${kind}-${observationId}.json`);write(file,bundle);
  const report=buildTrustReport(bundle,{now:new Date(Date.parse(now)+(invalid?2:0))});
  const evidence=await attachEvidence(runId,{cwd:controllerRoot,gate:`${stage}-gate`,file,kind:'trust.bundle',...(supersede?{supersede}:{}),producer:'aidlc-runtime'});
  return {evidence_id:evidence.id,file,record_file:recordFile,record_digest:digest(record),status:report.claims?.[0]?.status??null};
}

export async function refreshArtifactValidity({controllerRoot,runId,workspace,records}){
  const observations=records.filter(record=>record.artifact_observation);
  const projection=projectInvalidation(observations.map(record=>record.artifact_observation),workspace);
  const invalidated=[];
  for(const record of observations){if(projection[record.stage].status!=='stale'||record.invalidated)continue;
    const entry=await attachObservation({controllerRoot,runId,stage:record.stage,status:'fail',record:{prior:record.digest,validity:projection[record.stage]},invalid:true,supersede:record.evidence.completion.evidence_id});
    record.invalidated=true;record.invalidation=entry;invalidated.push(record.stage);}
  const deferred=[];
  for(const stage of invalidated){
    try{await evaluateRun(runId,{cwd:controllerRoot,gate:`${stage}-gate`});break;}
    catch(error){if(error.code!=='flow.evaluate.gate.reentry_pending')throw error;deferred.push(stage);}
  }
  return {projection,invalidated,deferred};
}


export function stageContext(snapshot,profile,stage,workspace,allArtifacts,request){
  const upstreamArtifacts={};for(const entry of allArtifacts){try{readArtifact(workspace,entry.path);(upstreamArtifacts[entry.id]??=[]).push(entry.path);}catch{}}
  return {upstreamArtifacts,writeSensorPolicy:request.parameters?.write_sensor_policy,commands:request.parameters?.commands??{},claims:{statePath:'.aidlc/state.md',descriptionPath:'.aidlc/project-description.json',questionsPath:artifactPaths(stage).find(a=>a.id==='intent-capture-questions')?.path,memoryPaths:request.parameters?.memory_paths??{}},profile,projectType:request.parameters?.project_type??'brownfield'};
}

export function restoreUnits(workspace,records){
  const record=records.find(r=>r.stage==='units-generation'&&!r.invalidated&&['pass','disabled'].includes(r.sensors?.status));
  const dag=record?.artifacts?.find(a=>a.id==='unit-of-work-dependency');
  if(!dag)return null;
  const observed=readArtifact(workspace,dag.path);
  if(observed.digest!==dag.digest)throw new Error('Approved unit DAG bytes changed');
  return parseUnitEdges(observed.text).map(unit=>({id:unit.name,kind:unit.kind,depends_on:unit.depends_on,mutable_resources:['source/workspace']}));
}

/** Complete lifecycle conductor. Flow's persisted cursor remains the authority. */
export async function runAidlc(options){
 return withControllerLock(options.controllerRoot,()=>runAidlcUnlocked(options),{inheritedOwner:options.controllerExecutionOwner,workerCustody:options.controllerWorkerCustody});
}

async function runAidlcUnlocked({request,executor,commandRunner,authority,controllerRoot,signal,executionSlice,operationProvider,knowledge}){
  const workspace=fs.realpathSync(request.workspace);controllerRoot=path.resolve(controllerRoot);
  fs.mkdirSync(controllerRoot,{recursive:true,mode:0o700});controllerRoot=fs.realpathSync(controllerRoot);
  if(inside(workspace,controllerRoot)||inside(controllerRoot,workspace))throw new Error('Controller state must be separate from model workspace');
  if(!safeId(request.run_id)||typeof request.prompt!=='string'||!request.prompt.trim())throw new Error('Bound run id and task prompt required');
  let {snapshot,profile,composition}=resolveComposition(readSnapshot(),request.parameters??{});
  const originalProfileStages=[...snapshot.profiles[profile].stages];
  if(executionSlice?.parentAdmission)snapshot=await childExecutionSnapshot({request,executionSlice});
  const defaults=snapshot.profiles[profile]?.defaults;
  if(!defaults)throw new Error('Unknown profile');
  const settings=resolveCeremony(defaults,request.parameters?.ceremony??{});
  const projectType=request.parameters?.project_type??'brownfield';const omitted=new Set();
  const testingInput={workspace,request,snapshot,profile},testing=resolveTestingContract(testingInput);
  if(executionSlice){
    if(!Array.isArray(executionSlice.stageIds)||!executionSlice.stageIds.length||executionSlice.stageIds.some(id=>!snapshot.profiles[profile].stages.includes(id)))throw new Error('Invalid host execution slice');
    for(const id of snapshot.profiles[profile].stages)if(!executionSlice.stageIds.includes(id))omitted.add(id);
  }
  for(const decision of request.parameters?.stage_decisions??[]){if(!originalProfileStages.includes(decision.stage)||decision.execute!==false||!decision.reason)throw new Error('Invalid scoped stage decision');
    if(executionSlice?.parentAdmission&&!snapshot.profiles[profile].stages.includes(decision.stage))continue;
    const input={purpose:'stage-selection',stage:decision.stage,decision,request_digest:requestBindingDigest(request)};const grant=await authority?.authorize?.(input);
    if(!grant?.authorized||!grant.reference||authority.verify?.(grant.receipt,input)!==true)throw new Error('Stage selection needs verified host authority');omitted.add(decision.stage);}
  let {flow,stageIds,selectedSnapshot}=boundDefinition(snapshot,profile,request.run_id,projectType,omitted,settings);
  if(composition&&!executionSlice&&['workspace-scaffold','workspace-detection','state-init'].some(id=>!stageIds.includes(id)))throw new Error('Composition cannot skip initialization');
  if(composition?.strict_inputs&&!executionSlice)for(const [index,id]of stageIds.entries()){
    const stage=selectedSnapshot.stages.find(stage=>stage.slug===id);
    for(const input of stage.consumes??[])if(input.required&&(!input.conditional_on||input.conditional_on===projectType)&&!selectedSnapshot.stages.some(producer=>stageIds.slice(0,index).includes(producer.slug)&&[...(producer.produces??[]),...(producer.optional_produces??[])].includes(input.artifact)))throw new Error(`Required producer off path: ${id}/${input.artifact}`);
  }
  let checkpointPolicy=constructionCheckpointPolicy(snapshot,stageIds,request.parameters??{});
  const bindingFile=path.join(controllerRoot,'binding.json');const binding={request_digest:requestBindingDigest(request),definition_digest:digest(flow),profile,project_type:projectType,upstream_commit:snapshot.upstream.commit,testing_policy_digest:testing.policy_digest,testing_contract_digest:testing.contract_digest};
  if(composition&&!executionSlice){
    const approvalFile=path.join(controllerRoot,'composition-approval.json');
    const retained=fs.existsSync(bindingFile)&&fs.existsSync(approvalFile)?json(approvalFile):null;
    const input={purpose:'profile-composition',stage:'profile-composition',request_digest:binding.request_digest,composition,definition_digest:binding.definition_digest,settings,testing_policy_digest:testing.policy_digest,testing_contract_digest:testing.contract_digest,source_digest:retained?.input?.source_digest??snapshotWorkspace(workspace).source_digest};
    if(retained){if(digest(retained.input)!==digest(input)||authority?.verify?.(retained.grant.receipt,input)!==true)throw new Error('Composition approval binding changed');}
    else {const grant=await authority?.authorize?.(input);if(!grant?.authorized||!grant.reference||authority?.verify?.(grant.receipt,input)!==true)return {schema_version:'1.0',run_id:request.run_id,profile,ceremony:settings,definition_digest:binding.definition_digest,status:'waiting',failure:{reason:'awaiting_decision',stage:'profile-composition',pending:grant?.pending??null},records:[],executions:[],semantic_quality:'not_verified'};write(approvalFile,{input,grant});}
  }
  if(fs.existsSync(bindingFile)){if(JSON.stringify(json(bindingFile))!==JSON.stringify(binding))throw new Error('Resume input or definition changed');}
  else{write(bindingFile,binding);const definitionFile=path.join(controllerRoot,'definition.json');write(definitionFile,flow);await startRun(definitionFile,{cwd:controllerRoot,runId:request.run_id,params:{subject:request.run_id}});}
  if(!executionSlice){
    const effective=await verifyRecompositionLedger({request,controllerRoot,authority});
    const pending=pendingRecomposition({request,controllerRoot,authority,run:effective.run});
    if(pending)return {schema_version:'1.0',run_id:request.run_id,profile,ceremony:settings,definition_digest:effective.definition_digest,status:'waiting',failure:{reason:'awaiting_decision',stage:'live-recomposition',pending},records:fs.existsSync(path.join(controllerRoot,'stage-records.json'))?json(path.join(controllerRoot,'stage-records.json')):[],executions:[],canonical_state:effective.run.state,semantic_quality:'not_verified'};
    if(effective.run.state.definition_amendments?.length){flow=effective.run.definition;stageIds=effective.stages;binding.definition_digest=effective.definition_digest;selectedSnapshot=structuredClone(selectedSnapshot);selectedSnapshot.profiles[profile].stages=stageIds;checkpointPolicy=constructionCheckpointPolicy(snapshot,stageIds,request.parameters??{});}
  }
  fs.mkdirSync(path.join(workspace,'.aidlc'),{recursive:true});fs.writeFileSync(path.join(workspace,'.aidlc/project-description.json'),JSON.stringify(request.prompt)+'\n');
  const recordsFile=path.join(controllerRoot,'stage-records.json');let records=fs.existsSync(recordsFile)?json(recordsFile):[];
  const executions=[];let failure=null,units=null;
  const refuse=async(stage,detail)=>{
    const prior=records.find(r=>r.stage===stage);const record={stage,profile,failure:detail,artifacts:[],sensors:{status:'fail',checks:[]},evidence:{},invalidated:false};record.digest=digest(record);
    if(['authority_required','awaiting_decision','operator_input_required','mob_judgment','advisory_review'].includes(detail.reason)){record.waiting=true;records=records.filter(r=>r.stage!==stage);records.push(record);write(recordsFile,records);return;}
    record.evidence.completion=await attachObservation({controllerRoot,runId:request.run_id,stage,status:'fail',record,supersede:prior?.invalidation?.evidence_id??prior?.evidence?.completion?.evidence_id});
    if(snapshot.stages.find(s=>s.slug===stage)?.reviewer)record.evidence.review=await attachObservation({controllerRoot,runId:request.run_id,stage,kind:'review',status:'fail',record});
    records=records.filter(r=>r.stage!==stage);records.push(record);write(recordsFile,records);await evaluateRun(request.run_id,{cwd:controllerRoot});
  };
  const stageLimit=request.parameters?.max_gate_visits??128;let visits=0;
  while(!signal?.aborted&&visits++<stageLimit){
    const admitted=await loadRun(request.run_id,controllerRoot);
    if(!['active','completed'].includes(admitted.state.status)){failure={reason:admitted.state.status==='paused'?'authority_required':'canonical_run_inactive',stage:admitted.state.current_step,status:admitted.state.status};break;}
    await refreshArtifactValidity({controllerRoot,runId:request.run_id,workspace,records});write(recordsFile,records);
    units=executionSlice?.units??restoreUnits(workspace,records);
    const run=await loadRun(request.run_id,controllerRoot);if(run.state.status==='completed'){failure=null;break;}
    if(run.state.status!=='active'){failure={reason:run.state.status==='paused'?'authority_required':'canonical_run_inactive',stage:run.state.current_step,status:run.state.status};break;}
    const stageId=run.state.current_step;if(!stageIds.includes(stageId)){failure={reason:'invalid_cursor',stage:stageId};break;}
    const retained=records.find(record=>record.stage===stageId&&!record.invalidated&&['pass','disabled'].includes(record.sensors?.status));
    if(retained){await evaluateRun(request.run_id,{cwd:controllerRoot});continue;}
    const original=snapshot.stages.find(s=>s.slug===stageId);const stage=effectiveStage(original,settings);
    if(!executionSlice&&!units&&stage.phase==='construction'&&stage.for_each){
      if(requiresConstructionUnits(stageIds,records,run.state)){failure={stage:stageId,reason:'unit_manifest_missing'};await refuse(stageId,failure);break;}
      delete stage.for_each;
    }
    if(!executionSlice&&(settings.skeleton==='on'||checkpointPolicy.enabled)&&units&&stage.phase==='construction'&&stage.for_each){
      const block=constructionBlock(snapshot,stageIds,stageId),initialArtifacts=records.filter(record=>!record.invalidated).flatMap(record=>record.artifacts??[]);
      const walk=await executeConstruction({request,controllerRoot,stageIds:block,units,authority,signal,checkpointPolicy,commandRunner,testingContractDigest:testing.contract_digest,skeleton:settings.skeleton==='on',snapshotBasis:async refs=>{const current=currentRefs(workspace,refs);if(current.length!==refs.length||current.some((ref,index)=>ref.digest!==refs[index].digest))throw new Error('Skeleton checkpoint artifact basis changed');return {source_digest:snapshotWorkspace(workspace).source_digest,artifacts:current};},
        runSlice:async({request:childRequest,authority:childAuthority,unit,children})=>{
          const childRoot=path.join(controllerRoot,'construction',childRequest.run_id);
          const beforeSource=snapshotWorkspace(workspace);
          const result=await runAidlc({request:childRequest,executor,commandRunner,authority:childAuthority,controllerRoot:childRoot,signal,operationProvider,knowledge,executionSlice:{stageIds:block,units:[unit],observationSnapshot:selectedSnapshot,initialArtifacts,checkpointPolicy,parentAdmission:{request:structuredClone(request),controllerRoot,definition:{id:flow.id,version:flow.version,digest:definitionDigest(flow)}}}});
          const afterSource=snapshotWorkspace(workspace),prior=new Map(beforeSource.files.map(file=>[file.path,file])),next=new Map(afterSource.files.map(file=>[file.path,file]));
          const sourceRefs=[...new Set([...prior.keys(),...next.keys()])].filter(file=>prior.get(file)?.digest!==next.get(file)?.digest).map(file=>({path:file,before_digest:prior.get(file)?.digest??null,digest:next.get(file)?.digest??null}));
          return {...result,controller_root:childRoot,construction_source_refs:sourceRefs};
        }});
      executions.push(...walk.children.flatMap(child=>child.result.executions??[]));
      if(walk.status!=='completed'){failure=walk.failure??{stage:stageId,reason:walk.status};await refuse(stageId,failure);break;}
      for(const id of block){
        const contract=effectiveStage(snapshot.stages.find(stage=>stage.slug===id),settings),parts=walk.children.map(child=>child.result.records.find(record=>record.stage===id));
        const combined={stage:id,profile,ceremony:settings,artifacts:parts.flatMap(record=>record.artifacts),sensors:{status:parts.every(record=>record.sensors.status==='disabled')?'disabled':'pass',checks:parts.flatMap(record=>record.sensors.checks)},tests:parts.flatMap(record=>record.tests),dispatch:{status:'completed',units:parts.flatMap(record=>record.dispatch.units),executions:parts.reduce((sum,record)=>sum+record.dispatch.executions,0)},construction_children:walk.children.map(child=>({unit:child.unit,run_id:child.result.run_id,checkpoint:child.checkpoint??null,unit_checkpoint:child.unit_checkpoint??null,verification:child.verification??null})),evidence:{},invalidated:false};
        if(contract.reviewer){
          let context={shared:{task:request.prompt,profile,defaults:settings,stage:contract,upstream_artifacts:[...initialArtifacts,...combined.artifacts]},units:Object.fromEntries(units.map(unit=>[unit.id,{artifact_targets:artifactPaths(contract,unit.id)}]))};
          const verification=await verifyFinalUnits({stage:contract,units,dispatched:combined.dispatch,context,executor,controllerRoot,parentRunId:request.run_id,parentAdmissionStage:id,signal,policy:request.parameters?.dispatch_policy??{}});
          if(verification.status!=='completed'){failure={stage:id,reason:'final_source_review_failed',detail:verification};await refuse(id,failure);break;}
          combined.dispatch.final_verification=verification;executions.push(...(verification.dispatch?.units??[]).flatMap(unit=>unit.receipts??[]));
        }
        const finalArtifacts=[...initialArtifacts,...walk.children.flatMap(child=>child.result.records.flatMap(record=>record.artifacts??[]))];
        const observations=units.map(unit=>observeStage({snapshot:selectedSnapshot,profile,stage:id,root:workspace,artifacts:finalArtifacts.filter(ref=>!ref.unit||ref.unit===unit.id),projectType}));
        if(settings.sensors==='on'){
          const checks=await Promise.all(units.map(unit=>runStageSensors({stage:snapshot.stages.find(stage=>stage.slug===id),workspace,artifacts:combined.artifacts.filter(ref=>ref.unit===unit.id),context:{...stageContext(snapshot,profile,contract,workspace,finalArtifacts.filter(ref=>!ref.unit||ref.unit===unit.id),request),skippedStages:snapshot.stages.map(stage=>stage.slug).filter(slug=>!stageIds.includes(slug)),unit:unit.id,codeArtifacts:[...new Set(combined.dispatch.units.flatMap(record=>(record.receipts??[]).flatMap(receipt=>receipt.changed_source??[])))].map(file=>({path:file,digest:readArtifact(workspace,file).digest}))},commandRunner})));
          combined.sensors={status:checks.every(check=>check.status==='pass')?'pass':checks.some(check=>check.status==='fail')?'fail':'not_verified',checks:checks.flatMap((result,index)=>result.checks.map(check=>({...check,unit:units[index].id})))};
        }
        if(observations.some(observation=>observation.structural_status!=='pass')||!['pass','disabled'].includes(combined.sensors.status)){failure={stage:id,reason:'required_checks_failed',sensors:combined.sensors};await refuse(id,failure);break;}
        combined.artifact_observation={...observations[0],...(parts.some(record=>record.artifact_observation.source_digest)?{source_digest:snapshotWorkspace(workspace).source_digest}:{}),inputs:observations.flatMap(observation=>observation.inputs),outputs:observations.flatMap(observation=>observation.outputs),findings:observations.flatMap(observation=>observation.findings),structural_status:'pass'};
        combined.digest=digest(combined);
        combined.evidence.completion=await attachObservation({controllerRoot,runId:request.run_id,stage:id,status:'pass',record:combined});
        if(contract.reviewer)combined.evidence.review=await attachObservation({controllerRoot,runId:request.run_id,stage:id,kind:'review',status:'pass',record:combined.dispatch.final_verification});
        records=records.filter(record=>record.stage!==id);records.push(combined);write(recordsFile,records);
        await evaluateRun(request.run_id,{cwd:controllerRoot});
      }
      if(failure)break;
      continue;
    }


    if(stage.for_each&&!units){delete stage.for_each;}
    const allArtifacts=[...(executionSlice?.initialArtifacts??[]),...records.filter(record=>!record.invalidated).flatMap(record=>record.artifacts??[])];let artifacts=artifactPaths(stage);
    if(stage.for_each)artifacts=units.flatMap(unit=>artifactPaths(stage,unit.id));
    fs.writeFileSync(path.join(workspace,'.aidlc/state.md'),`# AI-DLC State\n\n## Project\n- **Project**: ${request.prompt.replace(/\n/g,' ')}\n- **Project Description Source**: project-description.json\n- **Scope**: ${testing.contract.scope}\n- **Profile**: ${profile}\n- **Depth**: ${defaults.depth??'unspecified'}\n- **Test Strategy**: ${testing.contract.test_strategy}\n- **Project Type**: ${projectType}\n- **Current Stage**: ${stageId}\n${(executionSlice?.checkpointPolicy??checkpointPolicy).enabled?'- **Construction Checkpoints**: enabled\n- **Construction Iteration**: unit-major\n- **Construction Execution**: serial\n':''}`);
    let context={shared:{task:request.prompt,profile,defaults:settings,testing_contract:testing.contract,testing_contract_rendered:testing.rendered,testing_policy_basis:testing.policy_basis,construction_checkpoint_policy:{enabled:(executionSlice?.checkpointPolicy??checkpointPolicy).enabled,iteration:'unit-major',execution:'serial'},workspace:'/workspace',stage,artifact_targets:artifacts,upstream_artifacts:allArtifacts,permissions:request.parameters?.permissions??{},plan_approval:'unapproved',prior_check_failures:records.find(record=>record.stage===stageId)?.sensors?.checks??[]},units:{}};
    if(settings.learnings==='on'){
      const diaries=(stage.for_each?units:[{id:'stage'}]).map(unit=>({id:'memory',stage:stageId,unit:unit.id==='stage'?null:unit.id,path:`.aidlc/artifacts/${stageId}${unit.id==='stage'?'':`/${unit.id}`}/memory.md`}));
      for(const diary of diaries){fs.mkdirSync(path.dirname(path.join(workspace,diary.path)),{recursive:true});if(!fs.existsSync(path.join(workspace,diary.path)))fs.writeFileSync(path.join(workspace,diary.path),'# Stage Learnings\n\n## Observations\n\n## Decisions\n\n## Follow-up\n');}
      artifacts.push(...diaries);context.shared.learning_diaries=diaries;context.shared.learning_diary=stage.for_each?null:diaries[0].path;
      context.shared.learning_protocol='At the first gate showing ask the operator for learnings; record only real observations and decisions in the stage diary. Capture through the Knowledge host port when configured.';
    }
    if(stage.for_each)for(const unit of units)context.units[unit.id]={artifact_targets:artifacts.filter(a=>a.unit===unit.id),upstream_artifacts:allArtifacts.filter(a=>!a.unit||a.unit===unit.id),learning_diary:context.shared.learning_diaries?.find(diary=>diary.unit===unit.id)?.path??null};
    const initialContext=structuredClone(context),reviewBinding=()=>({request_digest:binding.request_digest,stage,context:initialContext,testing_contract_digest:testing.contract_digest,source_digest:snapshotWorkspace(workspace).source_digest}),reviewBasis=()=>currentRefs(workspace,[...allArtifacts,...artifacts]);
    let reviewCurrent=reviewBasis(),operatorDerived=false;
    const reviewFile=path.join(controllerRoot,'review-checkpoints',`${stageId}.json`);
    if(fs.existsSync(reviewFile)){const stored=json(reviewFile);if(!verifyControllerCheckpoint({controllerRoot,checkpoint:stored.checkpoint,envelope:stored.envelope}))throw new Error('Retained review checkpoint changed');const original=questionnaireOverlayBasis({controllerRoot,checkpoint:stored.checkpoint,basis:reviewCurrent,authority});if(original){reviewCurrent=original;operatorDerived=true;}}
    const retainedReview=stage.phase==='initialization'?null:loadRetainedDispatch({controllerRoot,kind:'review',stage:stageId,binding:reviewBinding(),admission:checkpointRetryIdentity(run),basis:reviewCurrent});
    if(!retainedReview&&fs.existsSync(reviewFile)){
      const saved=json(reviewFile).checkpoint,subjects=[{purpose:'review-disposition',run_id:request.run_id,workspace,review_admission:digest(checkpointRetryIdentity(run)),stage:stageId,decision:saved.prepared,request_digest:binding.request_digest},...saved.prepared.units.filter(record=>record.status==='awaiting_decision').map(record=>unitReviewInput({record,stage:stageId,run_id:request.run_id,workspace,review_admission:digest(checkpointRetryIdentity(run)),request_digest:binding.request_digest,max_review_revisions:saved.prepared.max_review_revisions}))];
      for(const subject of subjects){const grant=await authority?.authorize?.(subject);if(grant?.authorized&&grant.receipt.payload.disposition?.review_disposition&&authority.verify(grant.receipt,subject))throw new Error('Authorized review revision changed basis before a durable progress checkpoint; automatic replay refused');}
    }
    if(retainedReview&&operatorDerived)for(const record of retainedReview.prepared.units){if(record.continuation?.phase!=='before-review')continue;const old=structuredClone({basis:record.basis,artifacts:record.artifacts});record.operator_input_derivations??=[];record.operator_input_derivations.push({original:old,input:record.before_review.input});record.artifacts=record.artifacts.map(ref=>({...ref,digest:readArtifact(workspace,ref.path).digest}));record.basis={...record.basis,artifacts:record.basis.artifacts.map(ref=>({...ref,digest:readArtifact(workspace,ref.path).digest}))};}

    if(retainedReview)context=retainedReview.context;
    if(!retainedReview&&(request.parameters?.source_write_stages??[]).includes(stageId)){
      const input={purpose:'source-change',stage:stageId,basis:snapshotWorkspace(workspace).source_digest,request_digest:binding.request_digest};const grant=await authority?.authorize?.(input);
      if(!grant?.authorized||authority.verify?.(grant.receipt,input)!==true){failure={stage:stageId,reason:'authority_required',detail:grant};await refuse(stageId,failure);break;}
      context.shared.source_write_authority=grant.reference;
    }
    let dispatched;
    if(stage.phase==='initialization'){
      for(const id of stageIds)fs.mkdirSync(path.join(workspace,'.aidlc/artifacts',id),{recursive:true});
      dispatched={status:'completed',units:[],executions:0,bootstrap:{workspace_digest:snapshotWorkspace(workspace).source_digest,definition_digest:binding.definition_digest}};
    }else{
      if(!retainedReview){
      const questions=stageId==='intent-capture'?artifacts.filter(ref=>ref.id.endsWith('-questions')):summaryTargets(stage,artifacts,settings);
      if(questions.length){
        const checkpoint={...stage,workspace_requires:false,reviewer:undefined,produces:questions.map(a=>a.id),optional_produces:[]};
        const checkpointContext=deferCheckpointLearnings(context);checkpointContext.shared.planning_only=true;checkpointContext.shared.summary_only=true;checkpointContext.shared.artifact_targets=questions;
        for(const entry of Object.values(checkpointContext.units))entry.artifact_targets=entry.artifact_targets.filter(a=>a.id.endsWith('-questions'));
        const questionnairePurpose=stageId==='intent-capture'&&settings.summary_confirmation==='off'?'input-confirmation':'summary-confirmation';
        const summaryBinding={request_digest:binding.request_digest,checkpoint,context:checkpointContextBinding(checkpointContext),source_digest:snapshotWorkspace(workspace).source_digest},admission=checkpointRetryIdentity(run);
        const answered=retainedQuestionnaire({controllerRoot,kind:'summary',stage:stageId,binding:summaryBinding,admission,workspace,authority,requestDigest:binding.request_digest,purpose:questionnairePurpose});
        const retained=answered?{dispatch:answered.dispatch,basis:answered.basis,replayed:true}:await retainedDispatch({controllerRoot,kind:'summary',stage:stageId,binding:summaryBinding,admission,observeBasis:()=>currentRefs(workspace,questions),execute:()=>dispatchStage({stage:checkpoint,units:stage.for_each?units:undefined,executor,context:checkpointContext,policy:request.parameters?.dispatch_policy??{},signal})});
        const prepared=retained.dispatch;let basis=retained.basis;
        if(!retained.replayed)executions.push(...prepared.units.flatMap(u=>u.receipts??[]));
        if(prepared.status!=='completed'){failure={stage:stageId,reason:'summary_failed',detail:prepared};await refuse(stageId,failure);break;}
        if(basis.length!==questions.length||basis.some(ref=>!readArtifact(workspace,ref.path).text.trim())){failure={stage:stageId,reason:'approval_basis_incomplete'};await refuse(stageId,failure);break;}
        const subject=answered?.input.questionnaire??questionnaireSubject({workspace,basis,producer:prepared,checkpointBinding:digest({kind:'summary',stage:stageId,binding:summaryBinding,admission}),admission});
        if(!(questionnairePurpose==='input-confirmation'&&!subject)){
        const input=answered?.input??{purpose:questionnairePurpose,run_id:request.run_id,stage:stageId,basis,source_digest:snapshotWorkspace(workspace).source_digest,request_digest:binding.request_digest,...(subject?{questionnaire:subject}:{})};
        const grant=await authority?.authorize?.(input);
        if(!grant?.authorized||authority.verify?.(grant.receipt,input)!==true){failure={stage:stageId,reason:'authority_required',detail:grant};await refuse(stageId,failure);break;}
        if(subject){context.shared.operator_questionnaire_reply=materializeQuestionnaireReply({input,receipt:grant.receipt});context.shared.operator_questionnaire_receipt=grant.receipt;context.shared.operator_questionnaire_subject=input;basis=currentRefs(workspace,questions);}
        context.shared.approved_summary_basis=basis;context.shared.summary_authority_reference=grant.reference;
        }
      }
      if(stageId==='code-generation'){
        assertTestingPolicyCurrent(testing,testingInput);
        const planning={...stage,workspace_requires:false,reviewer:undefined,for_each:stage.for_each,produces:['code-generation-plan','unit-test-instructions'],optional_produces:[]};
        const planningContext=deferCheckpointLearnings(context);planningContext.shared.planning_only=true;planningContext.shared.artifact_targets=artifacts.filter(a=>['code-generation-plan','unit-test-instructions'].includes(a.id));
        for(const unitContext of Object.values(planningContext.units))unitContext.artifact_targets=unitContext.artifact_targets.filter(a=>['code-generation-plan','unit-test-instructions'].includes(a.id));
        const planningExecutor={...executor,async execute(dispatch){
          const result=await executor.execute({...dispatch,beforePublication:async()=>{await dispatch.beforePublication?.();assertTestingPolicyCurrent(testing,testingInput);}});
          if(result.status!=='completed'||['review','contribute','dialogue'].includes(dispatch.phase))return result;
          const transforms=[];
          for(const plan of dispatch.context.artifact_targets.filter(ref=>ref.id==='code-generation-plan')){
            const prior=readArtifact(workspace,plan.path);if(!prior.text.trim())throw new Error('Code generation plan is empty before host contract rendering');
            const stamped=stampTestingPlan(prior.text,testing);if(stamped!==prior.text){fs.writeFileSync(path.join(workspace,plan.path),stamped);transforms.push({path:plan.path,before:prior.digest,after:readArtifact(workspace,plan.path).digest,contract_digest:testing.contract_digest});}
          }
          if(!transforms.length)return result;
          const observation={...(result.observation??{worker_receipt:result.receipt}),host_testing_contract_rendering:transforms};
          return {...result,observation,worker_receipt:result.receipt,receipt:{...result.receipt,digest:digest(observation)},host_testing_contract_rendering:transforms,artifacts:result.artifacts.map(ref=>({...ref,digest:readArtifact(workspace,ref.path).digest}))};
        }};
        const expected=artifacts.filter(a=>['code-generation-plan','unit-test-instructions'].includes(a.id));
        const retained=await retainedDispatch({controllerRoot,kind:'plan',stage:stageId,binding:{request_digest:binding.request_digest,planning,context:checkpointContextBinding(planningContext),source_digest:snapshotWorkspace(workspace).source_digest},admission:checkpointRetryIdentity(run),observeBasis:()=>currentRefs(workspace,expected),execute:()=>dispatchStage({stage:planning,units:stage.for_each?units:undefined,executor:planningExecutor,context:planningContext,policy:request.parameters?.dispatch_policy??{},signal})});
        const planned=retained.dispatch,basis=retained.basis;if(!retained.replayed)executions.push(...planned.units.flatMap(u=>u.receipts??[]));
        if(planned.status!=='completed'){failure={stage:stageId,reason:'plan_failed',detail:planned};await refuse(stageId,failure);break;}
        if(basis.length!==expected.length||basis.some(ref=>!readArtifact(workspace,ref.path).text.trim())){failure={stage:stageId,reason:'approval_basis_incomplete'};await refuse(stageId,failure);break;}
        assertTestingPolicyCurrent(testing,testingInput);
        let testingBasis;
        try{testingBasis=validateTestingPlans({workspace,plans:expected.filter(ref=>ref.id==='code-generation-plan'),instructions:expected.filter(ref=>ref.id==='unit-test-instructions'),resolved:testing,sourceDigest:snapshotWorkspace(workspace).source_digest,commandParser:plannedTestCommands});}
        catch(error){failure={stage:stageId,reason:'testing_plan_invalid',detail:{message:error.message}};await refuse(stageId,failure);break;}
        context.shared.testing_approval_basis=testingBasis;
        const input={purpose:'code-plan',stage:stageId,basis,testing_basis:testingBasis,source_digest:snapshotWorkspace(workspace).source_digest,request_digest:binding.request_digest};const grant=settings.plan_approval==='on'?await authority?.authorize?.(input):{authorized:true,reference:'registered-plan-approval-off'};
        if(!grant?.authorized||settings.plan_approval==='on'&&authority.verify?.(grant.receipt,input)!==true){failure={stage:stageId,reason:'authority_required',detail:grant};await refuse(stageId,failure);break;}
        assertTestingPolicyCurrent(testing,testingInput);
        context.shared.plan_approval='approved';context.shared.approved_plan_basis=basis;context.shared.authority_reference=grant.reference;
      }
      if(stage.phase==='operation'){
        const purpose=['environment-provisioning','deployment-execution'].includes(stageId)?'deployment':'operation';
        const input={purpose,stage:stageId,request_digest:binding.request_digest};const grant=await authority?.authorize?.(input);
        if(!grant?.authorized||authority.verify?.(grant.receipt,input)!==true){failure={stage:stageId,reason:'authority_required',detail:grant};await refuse(stageId,failure);break;}
        if(!operationProvider?.execute||!operationProvider?.verify){failure={stage:stageId,reason:'operation_provider_required'};await refuse(stageId,failure);break;}
        const operationInput={stage:structuredClone(stage),workspace,source_digest:snapshotWorkspace(workspace).source_digest,authority:grant,request_digest:binding.request_digest};
        const operation=await operationProvider.execute(operationInput,{signal});
        if(operation?.status!=='completed'||await operationProvider.verify(operation,operationInput)!==true){failure={stage:stageId,reason:'operation_not_verified',detail:operation};await refuse(stageId,failure);break;}
        context.shared.operation_receipt=operation;
      }
      }
      let unitFlow,inputReplayed=Boolean(retainedReview);
      try{
        let stageExecutor={...executor,async onProgress(observed){saveRetainedDispatch({controllerRoot,kind:'review',stage:stageId,binding:reviewBinding(),admission:checkpointRetryIdentity(run),basis:reviewBasis(),dispatch:observed,context});await executor.onProgress?.(observed);},beforeReview:createIntentInputCheckpoint({request,controllerRoot,authority,settings,requestDigest:binding.request_digest,admission:checkpointRetryIdentity(run)}),async execute(dispatch){return executor.execute({...dispatch,beforePublication:async()=>{await dispatch.beforePublication?.();assertTestingPolicyCurrent(testing,testingInput);}});}};
        if(stage.for_each){unitFlow=await createUnitFlow({controllerRoot,parentRunId:request.run_id,stage,units,snapshotBasis:executor.snapshotBasis});stageExecutor=unitFlow.bindExecutor(stageExecutor);}
        const historicalFile=unitFlow?path.join(controllerRoot,'unit-dispatch',`${unitFlow.runId}.json`):null;
        const executeStage=async()=>{
          if(historicalFile&&fs.existsSync(historicalFile)){
            const saved=json(historicalFile);const canonical=await unitFlow.load();
            if(saved.unit_run_id!==unitFlow.runId||saved.stage_contract_digest!==digest(stage)||saved.dispatch_digest!==digest(saved.dispatched)||canonical.state.status!=='completed'||!units.every(unit=>canonical.state.gate_outcomes.some(gate=>gate.gate_id===`${unit.id}-gate`&&gate.status==='pass')))throw new Error('Historical unit dispatch is not canonically completed');
            return structuredClone(saved.dispatched);
          }
          const observed=await dispatchStage({stage,units:stage.for_each?units:undefined,executor:stageExecutor,context,policy:{...request.parameters?.dispatch_policy,...(unitFlow?{requiresClaim:true}:{})},signal});
          if(historicalFile&&observed.status==='completed')write(historicalFile,{unit_run_id:unitFlow.runId,stage_contract_digest:digest(stage),dispatch_digest:digest(observed),dispatched:observed});
          return observed;
        };
        if(retainedReview)dispatched=retainedReview.prepared;
        else if(stageId==='intent-capture'){
          const retained=await retainedDispatch({controllerRoot,kind:'input',stage:stageId,binding:{request_digest:binding.request_digest,stage,context:checkpointContextBinding(context),source_digest:snapshotWorkspace(workspace).source_digest},admission:checkpointRetryIdentity(run),observeBasis:()=>currentRefs(workspace,artifacts),execute:executeStage});dispatched=retained.dispatch;inputReplayed=retained.replayed;
        }else dispatched=await executeStage();
        if(retainedReview?.prepared.units.some(record=>['before-review','revised-before-review'].includes(record.continuation?.phase))){
          const prior=structuredClone(dispatched);dispatched=await dispatchStage({stage,units:stage.for_each?units:undefined,executor:{...stageExecutor,verifyResume:observed=>digest(observed)===digest(prior)},context,policy:{...request.parameters?.dispatch_policy,...(unitFlow?{requiresClaim:true}:{})},signal,resume:prior});
        }
        if(dispatched.status==='awaiting_decision'&&dispatched.units.some(record=>record.continuation?.phase==='before-review')){
          saveRetainedDispatch({controllerRoot,kind:'review',stage:stageId,binding:reviewBinding(),admission:checkpointRetryIdentity(run),basis:reviewBasis(),dispatch:dispatched,context});dispatched.pending=dispatched.units.find(record=>record.continuation?.phase==='before-review')?.before_review?.pending??null;
        }else if(dispatched.status==='awaiting_decision'){
          saveRetainedDispatch({controllerRoot,kind:'review',stage:stageId,binding:reviewBinding(),admission:checkpointRetryIdentity(run),basis:reviewBasis(),dispatch:dispatched,context});
          const input={purpose:'review-disposition',run_id:request.run_id,workspace,review_admission:digest(checkpointRetryIdentity(run)),stage:stageId,decision:dispatched,request_digest:binding.request_digest};const grant=await authority?.authorize?.(input);
          const aggregateVerified=grant?.authorized&&authority.verify?.(grant.receipt,input)===true,unitGrants=new Map();
          if(authority)for(const record of dispatched.units.filter(record=>record.status==='awaiting_decision')){const subject=unitReviewInput({record,stage:stageId,run_id:request.run_id,workspace,review_admission:digest(checkpointRetryIdentity(run)),request_digest:binding.request_digest,max_review_revisions:dispatched.max_review_revisions}),observed=authority.lookupDecision?authority.lookupDecision(subject):await authority.authorize(subject);if(observed.receipt&&authority.verify(observed.receipt,subject))unitGrants.set(record.id,observed);}
          const aggregateDenied=grant?.reason==='explicit_operator_denial'&&authority.verify?.(grant.receipt,input)===true,hasCurrentGrant=!aggregateDenied&&dispatched.units.some(record=>record.status==='awaiting_decision'&&unitGrants.get(record.id)?.reason!=='explicit_operator_denial'&&(aggregateVerified||unitGrants.get(record.id)?.authorized));
          if(hasCurrentGrant){
            const prior=structuredClone(dispatched);for(const record of prior.units)if(unitGrants.get(record.id)?.reason==='explicit_operator_denial')record.resume_decision_checked=true;const approved=new Map(prior.units.filter(record=>record.status==='awaiting_decision').map(record=>[record.id,record]));
            const resumedExecutor={...stageExecutor,verifyResume:observed=>digest(observed)===digest(prior),async decide(decision){
              const record=approved.get(decision.unit);
              if(!record||decision.continuation_phase!==(record.continuation?.phase??null)||digest(decision.execution_receipts)!==digest(record.receipts.map(observed=>observed.receipt))||digest(decision.basis)!==digest(record.basis)||digest(decision.review_receipts)!==digest(record.reviews.map(review=>review.receipt))||digest(decision.findings)!==digest(record.findings)||digest(decision.dissent)!==digest(record.dissent))return {authorized:false,reason:'new_unit_requires_current_disposition'};
              const unitGrant=unitGrants.get(decision.unit);if((grant?.reason==='explicit_operator_denial'&&authority.verify(grant.receipt,input))||unitGrant?.reason==='explicit_operator_denial')return {authorized:false,reason:'explicit_operator_denial'};const scoped=aggregateVerified?grant:unitGrant;if(!scoped?.authorized)return {authorized:false,reason:'unit_without_current_disposition'};const revision=scoped.receipt.payload.disposition?.review_disposition?.units.find(unit=>unit.id===decision.unit);if(scoped.receipt.payload.disposition?.review_disposition&&!revision)return {authorized:false,reason:'unit_outside_revision_disposition'};return {authorized:true,decision:revision?'request_changes':'accept',reference:scoped.reference,...(revision?{revision:{...revision,receipt:scoped.receipt}}:{})};
            }};
            dispatched=await dispatchStage({stage,units:stage.for_each?units:undefined,executor:resumedExecutor,context,policy:{...request.parameters?.dispatch_policy,...(unitFlow?{requiresClaim:true}:{})},signal,resume:prior});
            if(!inputReplayed)executions.push(...prior.units.flatMap(record=>record.receipts));const priorReceipts=new Set(prior.units.flatMap(record=>record.receipts.map(receipt=>receipt.receipt.id)));executions.push(...dispatched.units.flatMap(record=>record.receipts.filter(receipt=>!priorReceipts.has(receipt.receipt.id))));inputReplayed=true;
            if(dispatched.status==='awaiting_decision'){
              saveRetainedDispatch({controllerRoot,kind:'review',stage:stageId,binding:reviewBinding(),admission:checkpointRetryIdentity(run),basis:reviewBasis(),dispatch:dispatched,context});
              const nextInput={purpose:'review-disposition',run_id:request.run_id,workspace,review_admission:digest(checkpointRetryIdentity(run)),stage:stageId,decision:dispatched,request_digest:binding.request_digest},next=await authority?.authorize?.(nextInput);dispatched.pending=next?.pending??null;
            }
          }else dispatched.pending=dispatched.units.flatMap(unit=>unit.decisions??[]).findLast(decision=>decision.response?.pending)?.response.pending??grant?.pending??null;
        }
        if(dispatched.status==='completed'&&unitFlow){
          const historicalJoin=await unitFlow.join();
          if(!historicalJoin.complete&&historicalJoin.status==='completed'&&historicalJoin.units.every(unit=>unit.gate_status==='pass'&&unit.settled)&&stage.reviewer){
            const verification=await verifyFinalUnits({stage,units,dispatched,context,executor,controllerRoot,parentRunId:request.run_id,signal,policy:request.parameters?.dispatch_policy??{}});
            dispatched.final_verification=verification;dispatched.historical_join=historicalJoin;
            if(verification.status!=='completed')dispatched={...dispatched,status:'blocked',reason:verification.failure?.reason??'final_source_review_failed'};
          }else if(!historicalJoin.complete)dispatched={...dispatched,status:'blocked',reason:'canonical_unit_join_incomplete'};
        }
      }catch(error){failure={stage:stageId,reason:error.code==='execution_budget'||error.code==='storage_budget'?'budget_exhausted':'execution_failed',detail:{message:error.message,code:error.code??null}};await refuse(stageId,failure);break;}finally{await unitFlow?.close();}
      if(!inputReplayed)executions.push(...dispatched.units.flatMap(u=>u.receipts??[]));executions.push(...(dispatched.final_verification?.dispatch?.units??[]).flatMap(u=>u.receipts??[]));
      if(dispatched.status!=='completed'){failure={stage:stageId,reason:dispatched.reason==='execution_budget'||dispatched.reason==='storage_budget'||dispatched.reason==='review_revision_budget'?'budget_exhausted':dispatched.reason??dispatched.status,detail:dispatched};await refuse(stageId,failure);break;}
      if(context.shared.approved_summary_basis?.some(ref=>readArtifact(workspace,ref.path).digest!==ref.digest&&!dispatched.units.some(record=>{const derived=record.before_review?.host_derivation;let expected=ref.digest;for(const entry of record.input_transform_history??[]){const derivation=entry.host_derivation;if(derivation&&verifyControllerCheckpoint({controllerRoot,checkpoint:derivation.checkpoint,envelope:derivation.envelope})&&derivation.checkpoint.original.path===ref.path&&derivation.checkpoint.original.digest===expected)expected=derivation.checkpoint.derived.digest;if(entry.operator_receipt&&entry.input&&authority.verify(entry.operator_receipt,entry.input))for(const doc of entry.operator_reply?.documents??[])if(doc.path===ref.path&&doc.original_digest===expected)expected=doc.reply_digest;}return expected===readArtifact(workspace,ref.path).digest;}))){failure={stage:stageId,reason:'approved_summary_changed'};await refuse(stageId,failure);break;}
      assertTestingPolicyCurrent(testing,testingInput);
      if(context.shared.approved_plan_basis?.some(ref=>readArtifact(workspace,ref.path).digest!==ref.digest)){failure={stage:stageId,reason:'approved_plan_changed'};await refuse(stageId,failure);break;}
    }
    const resolved=currentRefs(workspace,artifacts);
    if(stageId==='intent-capture'){
      const input={purpose:'input-confirmation',stage:stageId,basis:resolved,source_digest:snapshotWorkspace(workspace).source_digest,request_digest:binding.request_digest};const grant=await authority?.authorize?.(input);
      if(!grant?.authorized||authority.verify?.(grant.receipt,input)!==true){failure={stage:stageId,reason:'authority_required',detail:grant};await refuse(stageId,failure);break;}
    }
    let observation;
    if(stage.for_each){const perUnit=units.map(unit=>observeStage({snapshot:executionSlice?.observationSnapshot??selectedSnapshot,profile,stage:stageId,root:workspace,artifacts:[...allArtifacts.filter(a=>!a.unit||a.unit===unit.id),...resolved.filter(a=>a.unit===unit.id)],projectType}));observation={...perUnit[0],inputs:perUnit.flatMap(o=>o.inputs),outputs:perUnit.flatMap(o=>o.outputs),findings:perUnit.flatMap(o=>o.findings),structural_status:perUnit.every(o=>o.structural_status==='pass')?'pass':'fail'};}
    else observation=observeStage({snapshot:executionSlice?.observationSnapshot??selectedSnapshot,profile,stage:stageId,root:workspace,artifacts:[...allArtifacts,...resolved],projectType});
    const sensorContext=stageContext(snapshot,profile,stage,workspace,allArtifacts,request);
    sensorContext.skippedStages=snapshot.stages.map(stage=>stage.slug).filter(id=>!stageIds.includes(id));
    sensorContext.codeArtifacts=[...new Set(dispatched.units.flatMap(unit=>(unit.receipts??[]).flatMap(receipt=>receipt.changed_source??[])))].flatMap(file=>{try{return [{path:file,digest:readArtifact(workspace,file).digest}];}catch{return [];}});
    let sensors;
    if(settings.sensors==='off') sensors={status:'disabled',policy:'explicit-ceremony-setting',checks:[]};
    else if(stage.for_each){const results=await Promise.all(units.map(unit=>runStageSensors({stage:original,workspace,artifacts:resolved.filter(a=>a.unit===unit.id),context:{...stageContext(snapshot,profile,stage,workspace,allArtifacts.filter(a=>!a.unit||a.unit===unit.id),request),skippedStages:sensorContext.skippedStages,codeArtifacts:sensorContext.codeArtifacts,unit:unit.id},commandRunner})));sensors={status:results.every(r=>r.status==='pass')?'pass':results.some(r=>r.status==='fail')?'fail':'not_verified',checks:results.flatMap((r,i)=>r.checks.map(check=>({...check,unit:units[i].id})))};}
    else sensors=await runStageSensors({stage:original,workspace,artifacts:resolved,context:sensorContext,commandRunner});
    const tests=[];
    if(stageId==='build-and-test'){
      // A masked/unexecutable planned command fails this gate with the real
      // reason; it never aborts the adapter and never silently passes.
      let planned=null;
      try{planned=allArtifacts.filter(a=>a.id==='unit-test-instructions').map(instruction=>({instruction,commands:plannedTestCommands(readArtifact(workspace,instruction.path).text)}));}
      catch(error){planned=[];sensors={...sensors,status:'fail',checks:[...sensors.checks,{id:'planned-unit-tests',status:'fail',findings:[`Approved unit test instructions cannot be safely executed: ${error.message}`]}]};}
      for(const {instruction,commands} of planned)for(const command of commands){
        const result=await commandRunner?.({id:'planned-unit-test',command,cwd:workspace,timeoutMs:request.parameters?.check_timeout_ms??120000,maxOutputBytes:1024*1024,basis:[{path:instruction.path,sha256:readArtifact(workspace,instruction.path).digest}]});
        tests.push({command,unit:instruction.unit,passed:result?.exitCode===0&&!!result.receipt,receipt:result?.receipt??null});}
      if(sensors.status!=='fail'&&(!tests.length||tests.some(test=>!test.passed)))sensors={...sensors,status:tests.length?'fail':'not_verified',checks:[...sensors.checks,{id:'planned-unit-tests',status:tests.length?'fail':'not_verified',findings:tests.length?['Actual planned unit commands failed.']:['No executable unit test command in approved instructions.']}]};
    }
    if(stage.workspace_requires===true||context.shared.source_write_authority||context.shared.operation_receipt||dispatched.units.some(unit=>(unit.receipts??[]).some(receipt=>receipt.changed_source?.length)))observation.source_digest=snapshotWorkspace(workspace).source_digest;
    const passing=observation.structural_status==='pass'&&['pass','disabled'].includes(sensors.status);
    const record={stage:stageId,profile,ceremony:settings,artifacts:resolved,artifact_observation:observation,sensors,tests,dispatch:dispatched,operation_receipt:context.shared.operation_receipt??null,evidence:{},invalidated:false};record.digest=digest(record);
    if(settings.learnings==='on'&&knowledge?.capture&&context.shared.learning_diaries){record.learning_captures=[];for(const diaryRef of context.shared.learning_diaries){const diary=readArtifact(workspace,diaryRef.path);const captured=await knowledge.capture({stage:stageId,unit:diaryRef.unit,run_id:request.run_id,path:diaryRef.path,digest:diary.digest,text:diary.text,decision_basis:dispatched});if(!captured?.reference)throw new Error('Knowledge capture returned no durable reference');record.learning_captures.push(captured);}}
    record.digest=digest(record);
    const prior=records.find(r=>r.stage===stageId);
    record.evidence.completion=await attachObservation({controllerRoot,runId:request.run_id,stage:stageId,status:passing?'pass':'fail',record,supersede:prior?.invalidation?.evidence_id??prior?.evidence?.completion?.evidence_id});
    if(stage.reviewer)record.evidence.review=await attachObservation({controllerRoot,runId:request.run_id,stage:stageId,kind:'review',status:passing?'pass':'fail',record:{reviews:dispatched.final_verification?.dispatch?.units?.flatMap(u=>u.receipts??[])??dispatched.units.flatMap(u=>u.reviews??[]),final_source_acceptance:dispatched.final_verification?.join??null},supersede:prior?.evidence.review?.evidence_id});
    records=records.filter(r=>r.stage!==stageId);records.push(record);write(recordsFile,records);
    const outcome=await evaluateRun(request.run_id,{cwd:controllerRoot});
    if(!passing){failure={stage:stageId,reason:'required_checks_failed',sensors,findings:observation.findings};if(request.parameters?.repair_checks===false)break;continue;}
    if(stageId==='units-generation'){
      const dag=resolved.find(a=>a.id==='unit-of-work-dependency');if(!dag){failure={stage:stageId,reason:'unit_manifest_missing'};break;}
      units=parseUnitEdges(readArtifact(workspace,dag.path).text).map(unit=>({id:unit.name,kind:unit.kind,depends_on:unit.depends_on,mutable_resources:['source/workspace']}));
    }
  }
  const run=await loadRun(request.run_id,controllerRoot);
  return {schema_version:'1.0',run_id:request.run_id,profile,ceremony:settings,...(composition?{composition}:{}),definition_digest:binding.definition_digest,upstream_commit:snapshot.upstream.commit,
    status:signal?.aborted?'cancelled':run.state.status==='completed'?'completed':failure?.reason==='authority_required'||failure?.reason==='awaiting_decision'||failure?.reason==='operator_input_required'||failure?.reason==='mob_judgment'||failure?.reason==='advisory_review'?'waiting':failure?.reason==='budget_exhausted'||visits>stageLimit?'budget_exhausted':'failed',failure,records,executions,canonical_state:run.state,semantic_quality:'not_verified'};
}
