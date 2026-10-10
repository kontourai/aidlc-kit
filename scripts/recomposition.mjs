import fs from 'node:fs';
import path from 'node:path';
import {createPublicKey,verify} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {loadRun,listRunsWithDiagnostics,amendRunDefinition,definitionIdentity,definitionDigest,flowRunHead} from '@kontourai/flow';
import {readSnapshot,digest,requestBindingDigest} from './compile.mjs';
import {resolveComposition} from './composition.mjs';
import {resolveCeremony} from './ceremony.mjs';
import {boundDefinition} from './definition.mjs';
import {snapshotWorkspace} from './workspace.mjs';
import {resolveTestingContract} from './testing-posture.mjs';
import {createControllerAuthority,decisionBindingDigest} from './authority.mjs';
import {withControllerLock} from './controller-lock.mjs';
import {admittedRecompositionRequest} from './request-admission.mjs';
import {readArtifact} from './artifacts.mjs';
import {constructionBlock} from './construction.mjs';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const must=(condition,message)=>{if(!condition)throw new Error(message);};
const writeExclusive=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});};

export function validateRecompositionProposal(proposal,snapshot=readSnapshot()){
 must(proposal&&typeof proposal==='object'&&!Array.isArray(proposal)&&Object.keys(proposal).every(key=>['add','skip','reason'].includes(key)),'Invalid live recomposition proposal');
 must(typeof proposal.reason==='string'&&proposal.reason.trim()&&proposal.reason.length<=2048&&!/[\u0000-\u001f]/.test(proposal.reason),'Recomposition reason required');
 const ids=new Set(snapshot.stages.map(stage=>stage.slug));
 for(const key of ['add','skip'])must(Array.isArray(proposal[key]??[])&&(proposal[key]??[]).length<=ids.size&&new Set(proposal[key]??[]).size===(proposal[key]??[]).length&&(proposal[key]??[]).every(id=>ids.has(id)),`Invalid recomposition ${key}`);
 const add=proposal.add??[],skip=proposal.skip??[];must(add.length+skip.length>0&&!add.some(id=>skip.includes(id)),'Empty or conflicting recomposition');
 return {add:[...add],skip:[...skip],reason:proposal.reason};
}

/** Missing required producers are compared to the ACTUAL baseline. Existing
 * stock omissions are retained; only newly introduced starvation is refused. */
export function requiredInputStarvation(snapshot,stageIds,projectType){
 const findings=[];
 for(const [index,id] of stageIds.entries()){
  const stage=snapshot.stages.find(stage=>stage.slug===id);
  for(const input of stage.consumes??[])if(input.required&&(!input.conditional_on||input.conditional_on===projectType)&&!snapshot.stages.some(producer=>stageIds.slice(0,index).includes(producer.slug)&&[...(producer.produces??[]),...(producer.optional_produces??[])].includes(input.artifact)))findings.push(`${id}/${input.artifact}`);
 }
 return findings.sort();
}
function protectedStages(run,records){
 const ids=new Set([run.state.current_step,...records.map(record=>record.stage)]);
 for(const item of [...(run.state.transitions??[]),...(run.state.gate_outcomes??[]),...(run.state.gate_outcome_history??[]),...(run.state.exceptions??[]),...(run.state.multi_cursor?.claim_history??[])]){
  if(item.from_step)ids.add(item.from_step);if(item.to_step)ids.add(item.to_step);if(item.step_id)ids.add(item.step_id);if(item.gate_id){const gate=run.definition.gates[item.gate_id];if(gate)ids.add(gate.step);}
 }
 for(const entry of run.manifest?.evidence??[]){const gate=run.definition.gates[entry.gate_id];if(gate)ids.add(gate.step);}
 return ids;
}
export function planRecomposition({request,run,proposal,records=[]}){
 const resolved=resolveComposition(readSnapshot(),request.parameters??{}),snapshot=resolved.snapshot,profile=resolved.profile,settings=resolveCeremony(snapshot.profiles[profile].defaults,request.parameters?.ceremony??{}),projectType=request.parameters?.project_type??'brownfield';
 const delta=validateRecompositionProposal(proposal,snapshot),before=run.definition.steps.map(step=>step.id),inventory=snapshot.stages.map(stage=>stage.slug),currentIndex=inventory.indexOf(run.state.current_step),frozen=protectedStages(run,records);
 must(currentIndex>=0&&before.every(id=>inventory.includes(id)),'Run does not own pinned methodology stages');
 must(!request.parameters?.autonomous,'Autonomous execution cannot authorize live recomposition');
 for(const id of [...delta.add,...delta.skip])must(inventory.indexOf(id)>currentIndex&&!frozen.has(id),'Only untouched pending future stages may be recomposed');
 must(!delta.skip.some(id=>snapshot.stages.find(stage=>stage.slug===id).phase==='initialization'),'Recomposition cannot skip initialized runtime contracts');
 must(delta.add.every(id=>!before.includes(id))&&delta.skip.every(id=>before.includes(id)),'Recomposition does not match the effective stage grid');
 must(!(projectType==='greenfield'&&delta.add.includes('reverse-engineering')),'Greenfield cannot add reverse-engineering');
 const stages=inventory.filter(id=>before.includes(id)&&!delta.skip.includes(id)||delta.add.includes(id));
 const anchor=ids=>ids.find(id=>snapshot.stages.find(stage=>stage.slug===id)?.phase==='construction')??null;
 must(anchor(before)===anchor(stages),'Recomposition cannot move the walking-skeleton construction anchor');
 const existing=new Set(requiredInputStarvation(snapshot,before,projectType)),introduced=requiredInputStarvation(snapshot,stages,projectType).filter(finding=>!existing.has(finding));
 must(!introduced.length,`Recomposition introduces required-input starvation: ${introduced.join(', ')}`);
 const derived=structuredClone(snapshot);derived.profiles[profile].stages=stages;
 const compiled=boundDefinition(derived,profile,request.run_id,projectType,new Set(),settings),successor=compiled.flow;
 successor.id=run.definition.id;successor.version=`${run.startDefinition?.version??'1.0'}.recompose-${digest({prior:definitionIdentity(run.definition),delta}).slice(0,20)}`;
 for(const step of successor.steps)if(frozen.has(step.id)){
  const prior=run.definition.steps.find(old=>old.id===step.id);must(prior,'Protected stage missing');const next=step.next;Object.assign(step,structuredClone(prior));if(step.id===run.state.current_step)step.next=next;
  for(const [gateId,gate]of Object.entries(run.definition.gates))if(gate.step===step.id)successor.gates[gateId]=structuredClone(gate);
 }
 return {delta,before,stages,settings,profile,projectType,snapshot:derived,successor,successor_digest:definitionDigest(successor),baseline_starvation:[...existing],frozen:[...frozen].sort()};
}

function treeBasis(root){
 if(!fs.existsSync(root))return null;const files=[];
 function visit(file,relative){const stat=fs.lstatSync(file);must(!stat.isSymbolicLink(),'Recomposition control basis contains symlink');if(stat.isDirectory()){for(const name of fs.readdirSync(file).sort())visit(path.join(file,name),relative?relative+'/'+name:name);}else{must(stat.isFile()&&stat.size<=16*1024*1024&&files.length<10000,'Recomposition control basis exceeds budget');files.push({path:relative,digest:digest(fs.readFileSync(file))});}}
 visit(root,'');return digest(files);
}
async function assertQuiescent(controllerRoot,run){
 must(run.state.status==='active','Live recomposition requires a running nonterminal Flow');
 must(!(run.state.multi_cursor?.active_claims??[]).length,'Live recomposition refuses active claims');
 const containers=[];
 if(fs.existsSync(path.join(controllerRoot,'construction')))for(const name of fs.readdirSync(path.join(controllerRoot,'construction')))containers.push(path.join(controllerRoot,'construction',name));
 for(const root of [controllerRoot,...containers]){
  const listing=await listRunsWithDiagnostics(root);must(!listing.diagnostics.some(item=>item.severity==='error'),'Child Flow inventory cannot be verified');
  for(const summary of listing.runs)if(root!==controllerRoot||summary.run_id!==run.state.run_id){const child=await loadRun(summary.run_id,root);must(['completed','canceled','cancelled'].includes(child.state.status),'Live recomposition requires settled child runs');must(!(child.state.multi_cursor?.active_claims??[]).length,'Child Flow still owns claims');}
 }
}
async function currentInput({request,controllerRoot,run,proposal}){
 const binding=read(path.join(controllerRoot,'binding.json'));must(binding.request_digest===requestBindingDigest(request),'Recomposition request binding changed');
 const records=fs.existsSync(path.join(controllerRoot,'stage-records.json'))?read(path.join(controllerRoot,'stage-records.json')):[];
 for(const record of records.filter(record=>!record.invalidated))for(const ref of record.artifacts??[])must(ref.digest===readArtifact(request.workspace,ref.path).digest,'Retained stage artifact basis changed before recomposition');
 const plan=planRecomposition({request,run,proposal,records}),testing=resolveTestingContract({workspace:request.workspace,request,snapshot:plan.snapshot,profile:plan.profile});
 must(testing.policy_digest===binding.testing_policy_digest&&testing.contract_digest===binding.testing_contract_digest,'Recomposition cannot change testing policy');
 const control_basis=Object.fromEntries(['stage-records.json','construction','construction-child-completions','construction-checkpoints','summary-checkpoints','input-checkpoints','plan-checkpoints','review-checkpoints','intent-inputs','unit-flows'].map(name=>[name,name.endsWith('.json')?(fs.existsSync(path.join(controllerRoot,name))?digest(fs.readFileSync(path.join(controllerRoot,name))):null):treeBasis(path.join(controllerRoot,name))]));
 const input={purpose:'live-recomposition',stage:run.state.current_step,request_digest:binding.request_digest,run_id:request.run_id,expected_run_head:flowRunHead(run.state),expected_definition:definitionIdentity(run.definition),source_digest:snapshotWorkspace(request.workspace).source_digest,artifact_basis:treeBasis(path.join(request.workspace,'.aidlc/artifacts')),control_basis,settings:plan.settings,testing_policy_digest:testing.policy_digest,testing_contract_digest:testing.contract_digest,proposal:plan.delta,frozen_stages:plan.frozen,before_stages:plan.before,successor_stages:plan.stages,successor_digest:plan.successor_digest};
 return {input,plan};
}

/** Child slices may consume added stages only from their exact verified parent
 * revision. Original request/scope/settings are retained, not rewritten. */
export async function childExecutionSnapshot({request,executionSlice}){
 const admission=executionSlice.parentAdmission;must(admission&&admission.request&&typeof admission.controllerRoot==='string','Added child stages require canonical parent admission');
 const parentRequest=admission.request,childEquivalent={...structuredClone(parentRequest),run_id:request.run_id};
 must(requestBindingDigest(childEquivalent)===requestBindingDigest(request),'Child scope differs from its original parent request');
 const parent=await loadRun(parentRequest.run_id,admission.controllerRoot);must(parent.state.status==='active'&&isDeepStrictEqual(definitionIdentity(parent.definition),admission.definition),'Child parent definition admission changed');
 must(read(path.join(admission.controllerRoot,'binding.json')).request_digest===requestBindingDigest(parentRequest),'Child parent original request binding changed');
 // Existing public callers may supply an authority port without embedding a
 // policy in the request. Unamended parents have no signed ledger to replay.
 const authority=parent.state.definition_amendments?.length?createControllerAuthority({policy:parentRequest.parameters?.authority_policy,requestDigest:requestBindingDigest(parentRequest),controllerRoot:admission.controllerRoot}):undefined;
 const effective=await verifyRecompositionLedger({request:parentRequest,controllerRoot:admission.controllerRoot,authority,run:parent});
 const resolved=resolveComposition(readSnapshot(),parentRequest.parameters??{}),snapshot=structuredClone(resolved.snapshot);snapshot.profiles[resolved.profile].stages=effective.stages;
 must(isDeepStrictEqual(executionSlice.stageIds,constructionBlock(snapshot,effective.stages,parent.state.current_step)),'Child slice does not match the current canonical construction block');
 return snapshot;
}

/** The canonical Flow ledger is authoritative. Private entries supply signed
 * operator proof; missing cache publication after a crash is reconstructed from
 * the Flow entry's exact signed-decision reference, never from edited binding. */
export async function verifyRecompositionLedger({request,controllerRoot,authority,run}){
 run??=await loadRun(request.run_id,controllerRoot);
 const events=run.state.definition_amendments??[];let prior=run.startDefinition??run.definition;
 for(const event of events){
  must(event.compatibility_mode==='pending_forward','Kit run has unsupported definition amendment');
  const match=/^controller-decision:([a-f0-9-]+)$/.exec(event.authority.request_ref);must(match,'Kit amendment lacks exact operator decision');
  const receipt=read(path.join(controllerRoot,'authority',`${match[1]}.json`)),input=read(path.join(controllerRoot,'authority',`${match[1]}.input.json`));
  must(receipt.payload.kind==='controller-decision'&&receipt.payload.decision_kind==='host-observed-operator-interaction'&&receipt.payload.decision!=='deny'&&authority.verify(receipt,input),'Kit amendment decision signature invalid');
  must(input.purpose==='live-recomposition'&&input.request_digest===requestBindingDigest(request)&&input.run_id===request.run_id&&input.expected_run_head===event.prior_run_head&&isDeepStrictEqual(input.expected_definition,event.prior_definition)&&input.successor_digest===event.successor_definition.digest,'Kit amendment exact decision binding changed');
  const reconstructed=planRecomposition({request,run:{definition:prior,startDefinition:run.startDefinition,state:event.prior_state,manifest:{evidence:(event.protected_steps??[]).flatMap(id=>Object.entries(prior.gates).filter(([,gate])=>gate.step===id).map(([gate_id])=>({gate_id}))) }},proposal:input.proposal,records:(input.frozen_stages??[]).map(stage=>({stage}))});
  must(reconstructed.successor_digest===event.successor_definition.digest&&isDeepStrictEqual(input.before_stages,reconstructed.before)&&isDeepStrictEqual(input.successor_stages,reconstructed.stages),'Kit amendment stage contract changed');
  const file=path.join(controllerRoot,'recomposition',`${match[1]}.json`),entry={input,grant:{reference:event.authority.request_ref,receipt},successor_digest:event.successor_definition.digest};
  if(fs.existsSync(file))must(isDeepStrictEqual(read(file),entry),'Recomposition ledger cache tampered');else writeExclusive(file,entry);
  prior=event.successor;
 }
 return {run,stages:run.definition.steps.map(step=>step.id),definition_digest:digest(run.definition)};
}

/** Pending proposals come from signed inbox entries, not a deletable projection.
 * Approval alone never bypasses Flow amendment admission; until the ordinary
 * recompose command commits the ledger, runtime execution remains stopped. */
export function pendingRecomposition({request,controllerRoot,authority,run}){
 const root=path.join(controllerRoot,'authority/pending');if(!fs.existsSync(root))return null;
 const publicKey=createPublicKey(fs.readFileSync(path.join(controllerRoot,'authority/host-public-key.pem'))),applied=new Set((run.state.definition_amendments??[]).map(event=>event.authority.request_ref));
 for(const name of fs.readdirSync(root).filter(name=>name.endsWith('.json')).sort()){
  const file=path.join(root,name),pending=read(file),input=pending.payload?.input;
  must(pending.payload.kind==='decision-pending'&&pending.payload.input_digest===decisionBindingDigest(input)&&pending.payload.id===pending.payload.input_digest&&name===`${pending.payload.id}.json`&&verify(null,Buffer.from(JSON.stringify(pending.payload)),publicKey,Buffer.from(pending.signature??'','base64')),'Live recomposition pending signature changed');
  if(input?.purpose!=='live-recomposition'||input.request_digest!==requestBindingDigest(request))continue;
  const receipts=fs.readdirSync(path.join(controllerRoot,'authority')).filter(name=>name.endsWith('.json')&&!name.endsWith('.input.json')).map(name=>read(path.join(controllerRoot,'authority',name))).filter(receipt=>receipt.payload?.kind==='controller-decision'&&receipt.payload.input_digest===pending.payload.input_digest&&authority.verify(receipt,input));
  if(receipts.some(receipt=>applied.has(`controller-decision:${receipt.payload.id}`)||receipt.payload.decision==='deny'))continue;
  return {file,input_digest:pending.payload.input_digest,purpose:input.purpose,stage:input.stage,proposal:input.proposal};
 }
 return null;
}

export async function recomposeRun({request,controllerRoot,proposal}){
 controllerRoot=fs.realpathSync(controllerRoot);
 request=admittedRecompositionRequest({request,controllerRoot});
 return withControllerLock(controllerRoot,async()=>{
  const authority=createControllerAuthority({policy:request.parameters?.authority_policy,requestDigest:requestBindingDigest(request),controllerRoot}),run=await loadRun(request.run_id,controllerRoot);
  await verifyRecompositionLedger({request,controllerRoot,authority,run});await assertQuiescent(controllerRoot,run);
  const {input,plan}=await currentInput({request,controllerRoot,run,proposal}),grant=await authority.authorize(input);
  if(!grant.authorized||grant.decision_kind!=='host-observed-operator-interaction'||!authority.verify(grant.receipt,input))return {status:'waiting',reason:grant.reason??'awaiting_operator_recomposition',pending:grant.pending??null,input_digest:decisionBindingDigest(input)};
  const fresh=await loadRun(request.run_id,controllerRoot);await assertQuiescent(controllerRoot,fresh);const observed=await currentInput({request,controllerRoot,run:fresh,proposal});must(isDeepStrictEqual(observed.input,input),'Recomposition approval became stale');
  await amendRunDefinition(request.run_id,{cwd:controllerRoot,definition:plan.successor,request:{compatibility_mode:'pending_forward',reason:plan.delta.reason,expected_run_head:input.expected_run_head,expected_definition:input.expected_definition,successor_digest:plan.successor_digest,authority:{kind:'operator_request',actor:`aidlc-host-operator:${grant.receipt.payload.issuer}`,request_ref:grant.reference,requested_at:grant.receipt.payload.issued_at}}});
  const effective=await verifyRecompositionLedger({request,controllerRoot,authority});return {status:'applied',definition_digest:effective.definition_digest,stages:effective.stages,receipt:grant.receipt,reference:grant.reference};
 });
}
