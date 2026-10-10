import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {startRun,loadRun,definitionIdentity,definitionDigest,claimReadyStep,releaseStepClaim} from '@kontourai/flow';
import {readSnapshot,digest,requestBindingDigest} from '../scripts/compile.mjs';
import {boundDefinition} from '../scripts/definition.mjs';
import {resolveCeremony} from '../scripts/ceremony.mjs';
import {resolveTestingContract} from '../scripts/testing-posture.mjs';
import {planRecomposition,requiredInputStarvation,recomposeRun,verifyRecompositionLedger} from '../scripts/recomposition.mjs';
import {createControllerAuthority,recordControllerDecision} from '../scripts/authority.mjs';
import {runAidlc,snapshotWorkspace} from '../scripts/runtime.mjs';
const proposal={add:['market-research'],skip:[],reason:'Include market context for the pending task'};
async function fixture(t,{profile='poc',projectType='greenfield',settings={},stageDecisions=[]}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-live-recomposition-')),workspace=path.join(root,'workspace'),controllerRoot=path.join(root,'controller');fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(workspace,'README.md'),'Ordinary project');
 const request={run_id:'live-plan-fixture',workspace,prompt:'Bounded plan amendment fixture',parameters:{profile,project_type:projectType,authority_policy:{reference:'fixture-registered-policy',purposes:['live-recomposition','stage-selection']},ceremony:settings,stage_decisions:stageDecisions}},snapshot=readSnapshot(),ceremony=resolveCeremony(snapshot.profiles[profile].defaults,settings),compiled=boundDefinition(snapshot,profile,request.run_id,projectType,new Set(stageDecisions.map(decision=>decision.stage)),ceremony),file=path.join(controllerRoot,'definition.json');fs.writeFileSync(file,JSON.stringify(compiled.flow));await startRun(file,{cwd:controllerRoot,runId:request.run_id});
 const testing=resolveTestingContract({workspace,request,snapshot,profile});fs.writeFileSync(path.join(controllerRoot,'binding.json'),JSON.stringify({request_digest:requestBindingDigest(request),definition_digest:digest(compiled.flow),profile,project_type:projectType,upstream_commit:snapshot.upstream.commit,testing_policy_digest:testing.policy_digest,testing_contract_digest:testing.contract_digest}));
 const authority=()=>createControllerAuthority({policy:request.parameters.authority_policy,requestDigest:requestBindingDigest(request),controllerRoot});
 return {root,workspace,controllerRoot,request,snapshot,authority,load:()=>loadRun(request.run_id,controllerRoot)};
}
function approve(f,pending,decision='approve'){return recordControllerDecision({controllerRoot:f.controllerRoot,pendingFile:pending.file,reference:'fixture actual CLI operator action',decision});}

test('live plan addition and skip use actual signed inbox, public pending-forward amendment and verified ledger replay',async t=>{
 const f=await fixture(t),before=await f.load(),binding=fs.readFileSync(path.join(f.controllerRoot,'binding.json')),original=JSON.stringify(f.request);
 let result=await recomposeRun({...f,proposal});assert.equal(result.status,'waiting');assert.equal(result.reason,'live_recomposition_requires_operator_interaction');approve(f,result.pending);
 result=await recomposeRun({...f,proposal});assert.equal(result.status,'applied');assert.ok(result.stages.includes('market-research'));
 const amended=await f.load();assert.equal(amended.state.definition_amendments.length,1);assert.equal(amended.state.definition_amendments[0].compatibility_mode,'pending_forward');assert.deepEqual(amended.startDefinition,before.definition);assert.equal(JSON.stringify(f.request),original);assert.deepEqual(fs.readFileSync(path.join(f.controllerRoot,'binding.json')),binding);
 assert.deepEqual(amended.state.transitions,before.state.transitions);assert.equal(amended.state.route_back_attempt,before.state.route_back_attempt);
 const cache=path.join(f.controllerRoot,'recomposition',`${result.receipt.payload.id}.json`);fs.unlinkSync(cache);assert.ok((await verifyRecompositionLedger({...f,authority:f.authority()})).stages.includes('market-research'));assert.ok(fs.existsSync(cache));
 const skip={add:[],skip:['market-research'],reason:'Remove the still-pending optional research'};const waiting=await recomposeRun({...f,proposal:skip});approve(f,waiting.pending);const skipped=await recomposeRun({...f,proposal:skip});assert.equal(skipped.status,'applied');assert.ok(!skipped.stages.includes('market-research'));assert.equal((await f.load()).state.definition_amendments.length,2);
});

test('new required-input starvation rejects without requiring preexisting stock omissions to disappear',async t=>{
 const f=await fixture(t,{projectType:'brownfield'}),run=await f.load(),baseline=requiredInputStarvation(f.snapshot,run.definition.steps.map(step=>step.id),'brownfield');assert.ok(baseline.includes('code-generation/unit-of-work'));
 assert.doesNotThrow(()=>planRecomposition({...f,run,proposal}));
 assert.throws(()=>planRecomposition({...f,run,proposal:{add:[],skip:['requirements-analysis'],reason:'Bad requirement producer removal'}}),/starvation/);
 assert.throws(()=>planRecomposition({...f,run,proposal:{add:['functional-design'],reason:'Move construction anchor'}}),/anchor/);
 assert.throws(()=>planRecomposition({...f,run,proposal:{skip:['workspace-scaffold'],reason:'Remove current stage'}}),/pending future/);
 assert.throws(()=>planRecomposition({...f,run,proposal:{add:['invented-stage'],reason:'Unknown stage'}}),/Invalid/);
});

test('source/state drift, denied operator action and tampered decision/cache never apply an amendment',async t=>{
 const f=await fixture(t),pending=await recomposeRun({...f,proposal});approve(f,pending.pending);fs.writeFileSync(path.join(f.workspace,'README.md'),'Concurrent source update');const stale=await recomposeRun({...f,proposal});assert.equal(stale.status,'waiting');assert.notEqual(stale.pending.file,pending.pending.file);assert.equal((await f.load()).state.definition_amendments?.length??0,0);
 approve(f,stale.pending,'deny');assert.equal((await recomposeRun({...f,proposal})).reason,'explicit_operator_denial');assert.equal((await f.load()).state.definition_amendments?.length??0,0);
 const another={add:['feasibility'],reason:'Separate pending proposal'};const fresh=await recomposeRun({...f,proposal:another}),grant=approve(f,fresh.pending);const receiptFile=path.join(f.controllerRoot,'authority',`${grant.receipt.payload.id}.json`),saved=JSON.parse(fs.readFileSync(receiptFile));saved.signature='tampered';fs.writeFileSync(receiptFile,JSON.stringify(saved));assert.equal((await recomposeRun({...f,proposal:another})).status,'waiting');
});

test('active controller custody and public claims refuse recomposition',async t=>{
 const f=await fixture(t);fs.writeFileSync(path.join(f.controllerRoot,'execution.lock'),'other-active-owner');await assert.rejects(recomposeRun({...f,proposal}),/stopped workers/);fs.unlinkSync(path.join(f.controllerRoot,'execution.lock'));
 const childFile=path.join(f.controllerRoot,'child.json');fs.writeFileSync(childFile,JSON.stringify({id:'child',version:'1',execution:{mode:'multi-cursor',claim_contract_version:'1'},steps:[{id:'unit',next:null,mutable_resources:['fixture-unit']}],gates:{'unit-gate':{step:'unit',expects:[]}}}));await startRun(childFile,{cwd:f.controllerRoot,runId:'active-child'});
 const actor={key:'fixture-child'},claim=(await claimReadyStep('active-child',{cwd:f.controllerRoot,step_id:'unit',claim_id:'fixture-claim',liveness_id:'fixture-live',actor,lease_seconds:300})).claim;
 await assert.rejects(recomposeRun({...f,proposal}),/settled child runs|claims/);await releaseStepClaim('active-child',{cwd:f.controllerRoot,claim_id:claim.claim_id,liveness_id:claim.liveness_id,actor});
});

test('ordinary runtime resumes effective stages after signed immediate-next insert and skip, retaining provider budget bytes',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-live-runtime-')),workspace=path.join(root,'workspace'),controllerRoot=path.join(root,'controller');fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const request={run_id:'live-runtime-fixture',workspace,prompt:'Actual subprocess plan mutation fixture',parameters:{profile:'poc',project_type:'greenfield',composition:{name:'initial',add:[],skip:['reverse-engineering','code-generation','build-and-test']},authority_policy:{reference:'fixture policy',purposes:[]},ceremony:{sensors:'off',review_cap:'none',summary_confirmation:'off',plan_approval:'off',learnings:'off',collaborators:'off'}}};
 const authority=()=>createControllerAuthority({policy:request.parameters.authority_policy,requestDigest:requestBindingDigest(request),controllerRoot});
 const ids=new Map(),executed=[];const executor={async admit(req){const id=randomUUID(),identity={actor:{runtime:'node-subprocess',host:'fixture',session_id:id},instance_id:id};ids.set(req.request_digest,identity);return identity;},async snapshotBasis({artifacts=[]}){return {source_digest:snapshotWorkspace(workspace).source_digest,artifacts:artifacts.map(ref=>({path:ref.path,digest:digest(fs.readFileSync(path.join(workspace,ref.path)))}))};},async execute(req){executed.push(req.stage);const result=spawnSync(process.execPath,['-e','const fs=require("fs"),p=require("path");for(const t of JSON.parse(process.argv[1])){fs.mkdirSync(p.dirname(t.path),{recursive:true});fs.writeFileSync(t.path,"# Actual fixture output\\n\\n## Findings\\nBounded subprocess observation.\\n")}',JSON.stringify(req.context.artifact_targets)],{cwd:workspace,encoding:'utf8'});assert.equal(result.status,0);return {status:'completed',identity:ids.get(req.request_digest),identity_basis:'executor-observed',input_basis:req.basis,receipt:{id:randomUUID(),digest:digest(result.stdout),request_digest:req.request_digest},artifacts:req.context.artifact_targets.map(ref=>({path:ref.path,digest:digest(fs.readFileSync(path.join(workspace,ref.path)))}))};}};
 let result=await runAidlc({request,controllerRoot,executor,authority:authority()});assert.equal(result.failure.stage,'profile-composition');recordControllerDecision({controllerRoot,pendingFile:result.failure.pending.file,reference:'fixture initial composition'});
 result=await runAidlc({request,controllerRoot,executor,authority:authority()});assert.equal(result.status,'waiting');assert.equal(result.failure.stage,'intent-capture');
 fs.writeFileSync(path.join(controllerRoot,'provider-budget.json'),'immutable accumulated budget fixture');const budget=fs.readFileSync(path.join(controllerRoot,'provider-budget.json'));
 const delta={add:['market-research'],skip:['requirements-analysis'],reason:'Pending discovery replaces unstarted requirements stage'};const pending=await recomposeRun({request,controllerRoot,proposal:delta});recordControllerDecision({controllerRoot,pendingFile:pending.pending.file,reference:'fixture operator pending delta'});assert.equal((await recomposeRun({request,controllerRoot,proposal:delta})).status,'applied');
 const inputPending=fs.readdirSync(path.join(controllerRoot,'authority/pending')).map(name=>path.join(controllerRoot,'authority/pending',name)).find(file=>JSON.parse(fs.readFileSync(file)).payload.input.purpose==='input-confirmation');recordControllerDecision({controllerRoot,pendingFile:inputPending,reference:'fixture source input answers'});
 result=await runAidlc({request,controllerRoot,executor,authority:authority()});assert.equal(result.status,'completed',JSON.stringify(result.failure));assert.ok(executed.includes('market-research'));assert.ok(!executed.includes('requirements-analysis'));assert.deepEqual(fs.readFileSync(path.join(controllerRoot,'provider-budget.json')),budget);assert.equal((await loadRun(request.run_id,controllerRoot)).state.definition_amendments.length,1);
 // Completed admission must still refresh actual artifact validity and route
 // back through Flow, rather than returning a stale completed result.
 const market=result.records.find(record=>record.stage==='market-research'),target=market.artifacts[0];assert.ok(target);
 fs.appendFileSync(path.join(workspace,target.path),'\nChanged retained artifact basis.\n');const priorExecutions=executed.length;
 result=await runAidlc({request,controllerRoot,executor,authority:authority()});assert.equal(result.status,'completed',JSON.stringify(result.failure));assert.ok(executed.length>priorExecutions);assert.ok(executed.slice(priorExecutions).includes('market-research'));
});

test('public request-file admission preserves raw input and CLI recomposition survives runtime access augmentation',async t=>{
 const {executeRequestFile}=await import('../scripts/run.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-recompose-cli-')),workspace=path.join(root,'source'),controllerRoot=path.join(root,'controller');fs.mkdirSync(workspace);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const request={schema:'kontour.kit.execution_request',version:'1.0',kit_id:'aidlc',run_id:'cli-recomposition-fixture',workspace,prompt:'Ordinary CLI input fixture',parameters:{profile:'poc',composition:{name:'initial',add:[],skip:['reverse-engineering','code-generation','build-and-test']},project_type:'greenfield',authority_policy:{reference:'fixture policy',purposes:[]},ceremony:{sensors:'off',review_cap:'none',summary_confirmation:'off',plan_approval:'off',learnings:'off',collaborators:'off'}},execution:{model:'fixture',runtime:'fixture',max_turns:8,max_provider_requests:16,timeout_s:60},engine_sandbox:{image:`sha256:${'a'.repeat(64)}`,providerProxy:{model:'fixture',baseUrl:'http://host.docker.internal:1',capability:'b'.repeat(64)}}};
 const requestFile=path.join(root,'request.json'),original=JSON.stringify(request);fs.writeFileSync(requestFile,original);
 const result=await executeRequestFile({requestFile,controllerRoot,workerRunner:async()=>{throw new Error('No model worker should start before composition approval');}});assert.equal(result.status,'waiting');assert.equal(fs.readFileSync(requestFile,'utf8'),original);
 const admission=JSON.parse(fs.readFileSync(path.join(controllerRoot,'request-admission.json')));assert.equal(admission.original_request_digest,requestBindingDigest(request));assert.notEqual(admission.effective_request_digest,admission.original_request_digest);assert.equal(admission.request.engine_sandbox.providerProxy.capability,undefined);assert.equal(admission.request.engine_sandbox.owner_id,undefined);
 // Initial composition creates no canonical Flow until approved. Use the same
 // ordinary private request admission to start the bound Flow, then let CLI act.
 const effective=admission.request,snapshot=readSnapshot(),{resolveComposition}=await import('../scripts/composition.mjs'),resolved=resolveComposition(snapshot,effective.parameters),settings=resolveCeremony(resolved.snapshot.profiles[resolved.profile].defaults,effective.parameters.ceremony),compiled=boundDefinition(resolved.snapshot,resolved.profile,effective.run_id,'greenfield',new Set(),settings),definitionFile=path.join(controllerRoot,'definition.json');fs.writeFileSync(definitionFile,JSON.stringify(compiled.flow));await startRun(definitionFile,{cwd:controllerRoot,runId:effective.run_id});
 const testing=resolveTestingContract({workspace,request:effective,snapshot:resolved.snapshot,profile:resolved.profile});fs.writeFileSync(path.join(controllerRoot,'binding.json'),JSON.stringify({request_digest:admission.effective_request_digest,definition_digest:digest(compiled.flow),profile:resolved.profile,project_type:'greenfield',testing_policy_digest:testing.policy_digest,testing_contract_digest:testing.contract_digest}));
 const proposalFile=path.join(root,'proposal.json');fs.writeFileSync(proposalFile,JSON.stringify(proposal));
 const cli=(command,args)=>spawnSync(process.execPath,[new URL('../scripts/cli.mjs',import.meta.url).pathname,command,...args],{encoding:'utf8'});
 let proposed=cli('recompose',['--request',requestFile,'--controller-root',controllerRoot,'--proposal',proposalFile]);assert.equal(proposed.status,0,proposed.stderr);const pending=JSON.parse(proposed.stdout);assert.equal(pending.status,'waiting');
 const decided=cli('decide',['--controller-root',controllerRoot,'--pending',pending.pending.file,'--reference','fixture CLI operator approval']);assert.equal(decided.status,0,decided.stderr);
 const applied=cli('recompose',['--request',requestFile,'--controller-root',controllerRoot,'--proposal',proposalFile]);assert.equal(applied.status,0,applied.stderr);assert.equal(JSON.parse(applied.stdout).status,'applied');assert.equal(fs.readFileSync(requestFile,'utf8'),original);
});

test('pending proposal holds ordinary runtime with zero new execution until applied or explicitly denied',async t=>{
 const f=await fixture(t);const pending=await recomposeRun({...f,proposal});let called=false;
 const executor={execute:async()=>{called=true;throw new Error('Pending proposal must not start a worker');}};
 const result=await runAidlc({...f,authority:f.authority(),executor});assert.equal(result.status,'waiting');assert.equal(result.failure.stage,'live-recomposition');assert.equal(called,false);
 const file=pending.pending.file,record=JSON.parse(fs.readFileSync(file)),original=structuredClone(record);
 for(const field of ['purpose','request_digest']){const changed=structuredClone(original);changed.payload.input[field]='hidden-by-unverified-filter';fs.writeFileSync(file,JSON.stringify(changed));await assert.rejects(runAidlc({...f,authority:f.authority(),executor}),/pending signature/);assert.equal(called,false);}
 record.signature='changed';fs.writeFileSync(file,JSON.stringify(record));await assert.rejects(runAidlc({...f,authority:f.authority(),executor}),/pending signature/);assert.equal(called,false);
});

test('amendment replay rejects private decision input and ledger cache tampering',async t=>{
 const f=await fixture(t),pending=await recomposeRun({...f,proposal});approve(f,pending.pending);const applied=await recomposeRun({...f,proposal});
 const cache=path.join(f.controllerRoot,'recomposition',`${applied.receipt.payload.id}.json`),saved=fs.readFileSync(cache);fs.writeFileSync(cache,'{}');await assert.rejects(verifyRecompositionLedger({...f,authority:f.authority()}),/cache tampered/);fs.writeFileSync(cache,saved);
 const inputFile=path.join(f.controllerRoot,'authority',`${applied.receipt.payload.id}.input.json`),input=JSON.parse(fs.readFileSync(inputFile));input.proposal.reason='Altered approval';fs.writeFileSync(inputFile,JSON.stringify(input));await assert.rejects(verifyRecompositionLedger({...f,authority:f.authority()}),/signature/);
});

test('state-bound decisions become stale after a real public pause/resume boundary',async t=>{
 const f=await fixture(t),{pauseRun,resumeRun}=await import('@kontourai/flow');const pending=await recomposeRun({...f,proposal});approve(f,pending.pending);
 const lifecycle={cwd:f.controllerRoot,reason:'Synthetic public lifecycle boundary',authority:{kind:'operator_request',actor:'fixture controller',request_ref:'fixture lifecycle proof',requested_at:new Date().toISOString()}};await pauseRun(f.request.run_id,lifecycle);await assert.rejects(recomposeRun({...f,proposal}),/running/);await resumeRun(f.request.run_id,{...lifecycle,authority:{...lifecycle.authority,requested_at:new Date().toISOString()}});
 const current=await recomposeRun({...f,proposal});assert.equal(current.status,'waiting');assert.notEqual(current.input_digest,pending.input_digest);assert.equal((await f.load()).state.definition_amendments?.length??0,0);
});

test('controller lock serializes proposal submission and direct runtime dispatch',async t=>{
 const f=await fixture(t),{withControllerLock}=await import('../scripts/controller-lock.mjs');let entered,finish;const acquired=new Promise(resolve=>entered=resolve),release=new Promise(resolve=>finish=resolve);
 const held=withControllerLock(f.controllerRoot,async()=>{entered();await release;});await acquired;
 await assert.rejects(recomposeRun({...f,proposal}),/stopped workers/);await assert.rejects(runAidlc({...f,authority:f.authority(),executor:{}}),/stopped workers/);
 const pending=await f.authority().authorize({purpose:'live-recomposition',stage:'workspace-scaffold',request_digest:requestBindingDigest(f.request)}),decided=spawnSync(process.execPath,[new URL('../scripts/cli.mjs',import.meta.url).pathname,'decide','--controller-root',f.controllerRoot,'--pending',pending.pending.file,'--reference','Concurrent actual CLI denial','--decision','deny'],{encoding:'utf8'});assert.equal(decided.status,1);assert.match(decided.stderr,/stopped workers/);finish();await held;
 assert.equal(fs.existsSync(path.join(f.controllerRoot,'execution.lock')),false);
});

test('actual artifact changes invalidate a signed proposal even when source files and retained digests stay fixed',async t=>{
 const f=await fixture(t),artifacts=path.join(f.workspace,'.aidlc/artifacts');fs.mkdirSync(artifacts,{recursive:true});const file=path.join(artifacts,'current.md');fs.writeFileSync(file,'current reviewed bytes');
 const pending=await recomposeRun({...f,proposal});approve(f,pending.pending);fs.writeFileSync(file,'changed actual artifact bytes');const stale=await recomposeRun({...f,proposal});assert.equal(stale.status,'waiting');assert.notEqual(stale.input_digest,pending.input_digest);
 fs.writeFileSync(path.join(f.controllerRoot,'stage-records.json'),JSON.stringify([{stage:'intent-capture',artifacts:[{path:'.aidlc/artifacts/current.md',digest:digest('current reviewed bytes')}]}]));await assert.rejects(recomposeRun({...f,proposal}),/artifact basis changed/);
});

test('paused, canceled and exhausted blocked canonical runs admit no worker execution',async t=>{
 const {pauseRun,cancelRun}=await import('@kontourai/flow');
 for(const operation of ['pause','cancel','block']){
  const f=await fixture(t),authority={kind:'operator_request',actor:'fixture actor',request_ref:`fixture ${operation}`,requested_at:new Date().toISOString()};if(operation==='block'){const {attachEvidence,evaluateRun}=await import('@kontourai/flow');let prior;for(let attempt=0;attempt<5;attempt++){const failed=spawnSync(process.execPath,['-e','process.exit(1)']);assert.equal(failed.status,1);const file=path.join(f.controllerRoot,`actual-failure-${attempt}.json`);fs.writeFileSync(file,JSON.stringify({exit_code:failed.status,attempt}));const evidence=await attachEvidence(f.request.run_id,{cwd:f.controllerRoot,gate:'workspace-scaffold-gate',file,kind:'file',status:'failed',supersede:prior,route_reason:'fixture_command_failure'});prior=evidence.id;await evaluateRun(f.request.run_id,{cwd:f.controllerRoot});if((await f.load()).state.status==='blocked')break;}assert.equal((await f.load()).state.status,'blocked');}else await (operation==='pause'?pauseRun:cancelRun)(f.request.run_id,{cwd:f.controllerRoot,reason:'Synthetic inactive boundary',authority});
  let executed=0;const result=await runAidlc({...f,authority:f.authority(),executor:{execute:async()=>{executed++;throw new Error('Inactive Flow must not execute');}}});assert.equal(executed,0);assert.equal(result.failure.status,operation==='pause'?'paused':operation==='block'?'blocked':'canceled');
 }
});

test('added construction slices derive from exact amended parent while original skipped-stage policy stays bound',async t=>{
 const f=await fixture(t,{profile:'refactor',stageDecisions:[{stage:'deployment-execution',execute:false,reason:'Original deferred deployment policy'}],settings:{sensors:'off',review_cap:'none',summary_confirmation:'off',plan_approval:'off',learnings:'off',collaborators:'off'}});
 const {attachObservation}=await import('../scripts/runtime.mjs'),{evaluateRun}=await import('@kontourai/flow'),{childExecutionSnapshot}=await import('../scripts/recomposition.mjs'),{constructionBlock}=await import('../scripts/construction.mjs');
 const delta={add:['nfr-requirements','nfr-design'],reason:'Add pending nonfunctional design'};const pending=await recomposeRun({...f,proposal:delta});approve(f,pending.pending);await recomposeRun({...f,proposal:delta});
 let parent=await f.load();while(parent.state.current_step!=='functional-design'){
  await attachObservation({controllerRoot:f.controllerRoot,runId:f.request.run_id,stage:parent.state.current_step,status:'pass',record:{fixture:'public Flow parent admission proof'}});await evaluateRun(f.request.run_id,{cwd:f.controllerRoot});parent=await f.load();
 }
 const effective=parent.definition.steps.map(step=>step.id),block=constructionBlock(f.snapshot,effective,parent.state.current_step),childRequest={...structuredClone(f.request),run_id:'child-construction-fixture'},executionSlice={stageIds:block,units:[{id:'a',mutable_resources:['source/workspace']}],parentAdmission:{request:f.request,controllerRoot:f.controllerRoot,definition:definitionIdentity(parent.definition)}};
 const derived=await childExecutionSnapshot({request:childRequest,executionSlice});assert.ok(derived.profiles.refactor.stages.includes('nfr-requirements'));assert.ok(derived.profiles.refactor.stages.includes('nfr-design'));
 const childRoot=path.join(f.controllerRoot,'construction','child-construction-fixture'),abort=new AbortController();abort.abort();
 const result=await runAidlc({request:childRequest,controllerRoot:childRoot,executor:{},authority:createControllerAuthority({policy:childRequest.parameters.authority_policy,requestDigest:requestBindingDigest(childRequest),controllerRoot:f.controllerRoot}),signal:abort.signal,executionSlice});assert.equal(result.status,'cancelled');const child=await loadRun(childRequest.run_id,childRoot);assert.deepEqual(child.definition.steps.map(step=>step.id),block);
 const wrong=structuredClone(executionSlice);wrong.parentAdmission.definition.digest='a'.repeat(64);await assert.rejects(childExecutionSnapshot({request:childRequest,executionSlice:wrong}),/parent definition/);
 const changed=structuredClone(childRequest);changed.prompt='Substituted child scope';await assert.rejects(childExecutionSnapshot({request:changed,executionSlice}),/scope differs/);
 const forged=structuredClone(executionSlice);forged.parentAdmission.request.prompt=changed.prompt;await assert.rejects(childExecutionSnapshot({request:changed,executionSlice:forged}),/original request binding/);
});
