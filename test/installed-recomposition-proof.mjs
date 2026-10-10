/** Clean installed-package adapter/CLI proof. The worker is a real subprocess,
 * not a model or Docker efficacy claim. No source checkout modules are loaded. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const [consumer,root,mode='none']=process.argv.slice(2),require=createRequire(path.join(consumer,'package.json'));
const kit=path.join(consumer,'node_modules/@kontourai/aidlc-kit'),cli=path.join(kit,'scripts/cli.mjs');
const {loadRun}=await import(pathToFileURL(require.resolve('@kontourai/flow')));
const {runAidlc,snapshotWorkspace}=await import(pathToFileURL(require.resolve('@kontourai/aidlc-kit')));
const {digest,requestBindingDigest}=await import(pathToFileURL(require.resolve('@kontourai/aidlc-kit/compile')));
const {createControllerAuthority}=await import(pathToFileURL(path.join(kit,'scripts/authority.mjs')));
const workspace=path.join(root,`subprocess-${mode}-workspace`),controllerRoot=path.join(root,`subprocess-${mode}-controller`);fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);
const request={run_id:'installed-cli-recomposition',workspace,prompt:'Actual subprocess observation of installed plan amendment',parameters:{profile:'poc',project_type:'greenfield',stage_decisions:[{stage:'code-generation',execute:false,reason:'No source construction in this installed adapter proof'},{stage:'build-and-test',execute:false,reason:'No implementation source in this installed adapter proof'}],authority_policy:{reference:'explicit-test-operator-policy',purposes:['stage-selection']},ceremony:{sensors:'off',review_cap:'none',summary_confirmation:'on',plan_approval:'off',learnings:'off',skeleton:'off',collaborators:'off'}}};
const requestFile=path.join(root,`subprocess-${mode}-request.json`);fs.writeFileSync(requestFile,JSON.stringify(request));const original=fs.readFileSync(requestFile);
const authority=()=>createControllerAuthority({policy:request.parameters.authority_policy,requestDigest:requestBindingDigest(request),controllerRoot});
const invoke=(command,...args)=>{const run=spawnSync(process.execPath,[cli,command,'--controller-root',controllerRoot,...args],{cwd:consumer,encoding:'utf8'});assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout);};
const decide=pending=>invoke('decide','--pending',pending.file,'--reference','Explicit test operator reviewed this exact retained fixture basis');
const identities=new Map(),observed=[];let generation=0;
const executor={async admit(input){const id=randomUUID(),identity={actor:{runtime:'actual-node-subprocess-fixture',host:'clean-consumer',session_id:id},instance_id:id};identities.set(input.request_digest,identity);return identity;},async snapshotBasis({artifacts=[]}){return {source_digest:snapshotWorkspace(workspace).source_digest,artifacts:artifacts.map(ref=>({path:ref.path,digest:digest(fs.readFileSync(path.join(workspace,ref.path)))}))};},async execute(input){observed.push({stage:input.stage,summary:input.context.summary_only===true});
 const targets=input.context.artifact_targets.filter(target=>!input.context.approved_summary_basis?.some(ref=>ref.path===target.path));
 const worker=spawnSync(process.execPath,['-e',String.raw`const fs=require('fs'),path=require('path');for(const target of JSON.parse(process.argv[1])){const file=path.join(process.cwd(),target.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,target.id.endsWith('-questions')?'# Questions\n\n## Scope\nActual generation '+process.argv[2]+'\n':'# Observation\n\n## Findings\nActual subprocess observed generation '+process.argv[2]+' of this bounded fixture.\n');}`,JSON.stringify(targets),String(++generation)],{cwd:workspace,encoding:'utf8'});assert.equal(worker.status,0,worker.stderr);
 return {status:'completed',identity:identities.get(input.request_digest),identity_basis:'executor-observed',input_basis:input.basis,receipt:{id:randomUUID(),digest:digest({stdout:worker.stdout,stderr:worker.stderr,exit_code:worker.status,generation}),request_digest:input.request_digest},artifacts:input.context.artifact_targets.map(target=>({path:target.path,digest:digest(fs.readFileSync(path.join(workspace,target.path)))}))};}};
const execute=()=>runAidlc({request:JSON.parse(fs.readFileSync(requestFile)),controllerRoot,authority:authority(),executor});
let result=await execute();assert.equal(result.status,'waiting');assert.equal(result.failure.stage,'intent-capture');assert.equal(result.failure.detail.pending.purpose,'summary-confirmation');
const prior=await loadRun(request.run_id,controllerRoot),initialDefinition=fs.readFileSync(path.join(controllerRoot,'definition.json')),initialBinding=fs.readFileSync(path.join(controllerRoot,'binding.json'));
fs.writeFileSync(path.join(controllerRoot,'provider-budget.json'),'{"fixture":"no provider invoked; unchanged budget custody marker"}\n');const budget=fs.readFileSync(path.join(controllerRoot,'provider-budget.json'));
const proposalFile=path.join(root,`subprocess-${mode}-proposal.json`);fs.writeFileSync(proposalFile,JSON.stringify({add:['market-research'],skip:['requirements-analysis'],reason:'Explicit test operator changes only untouched pending discovery'}));
const propose=()=>invoke('recompose','--request',requestFile,'--proposal',proposalFile);
const pending=propose();assert.equal(pending.status,'waiting');const deniedRun=await execute();assert.equal(deniedRun.failure.stage,'live-recomposition');assert.equal(observed.length,1);
const inbox=invoke('decisions');assert.ok(inbox.some(entry=>fs.realpathSync(entry.file)===fs.realpathSync(pending.pending.file)));decide(pending.pending);assert.equal(propose().status,'applied');
const amended=await loadRun(request.run_id,controllerRoot);assert.equal(amended.state.definition_amendments.length,1);assert.equal(amended.state.definition_amendments[0].compatibility_mode,'pending_forward');assert.deepEqual(amended.state.transitions,prior.state.transitions);assert.deepEqual(amended.state.gate_outcomes,prior.state.gate_outcomes);assert.deepEqual(fs.readFileSync(path.join(controllerRoot,'definition.json')),initialDefinition);assert.deepEqual(fs.readFileSync(path.join(controllerRoot,'binding.json')),initialBinding);assert.deepEqual(fs.readFileSync(requestFile),original);assert.deepEqual(fs.readFileSync(path.join(controllerRoot,'provider-budget.json')),budget);
// These are explicit TEST operator decisions, not fabricated human signatures.
// Authorize each actual observed fixture basis through the installed normal CLI.
decide(result.failure.detail.pending);
let invalidationProved=false;
for(let interaction=0;interaction<6;interaction++){
 result=await execute();if(result.status==='completed')break;assert.equal(result.status,'waiting',JSON.stringify(result.failure));assert.ok(['summary-confirmation','input-confirmation'].includes(result.failure.detail.pending.purpose));
 if(mode!=='none'&&result.failure.detail.pending.purpose==='input-confirmation'){
  const previous=result.failure.detail.pending.input_digest;decide(result.failure.detail.pending);
  if(mode==='input-source')fs.writeFileSync(path.join(workspace,'README.md'),'Changed source after exact input approval');
  else if(mode==='input-artifact'){const input=JSON.parse(fs.readFileSync(result.failure.detail.pending.file)).payload.input,target=input.basis.find(ref=>!ref.id.endsWith('-questions'));assert.ok(target);fs.appendFileSync(path.join(workspace,target.path),'Changed intent output after approval');}
  else {const file=path.join(controllerRoot,'input-checkpoints','intent-capture.json'),saved=JSON.parse(fs.readFileSync(file));saved.checkpoint.dispatched.units[0].receipts[0].receipt.digest='f'.repeat(64);saved.envelope.payload.checkpoint_digest=digest(saved.checkpoint);fs.writeFileSync(file,JSON.stringify(saved));}
  result=await execute();assert.notEqual(result.status,'completed');
  if(mode==='recomputed-input'){assert.equal(result.status,'failed');assert.match(result.failure.detail.message,/input checkpoint changed/);}else{assert.equal(result.status,'waiting');assert.notEqual(result.failure.detail.pending.input_digest,previous);}
  invalidationProved=true;break;
 }
 decide(result.failure.detail.pending);
}
if(mode==='none'){assert.equal(result.status,'completed',JSON.stringify(result.failure));assert.equal((await loadRun(request.run_id,controllerRoot)).state.status,'completed');assert.ok(observed.some(entry=>entry.stage==='market-research'));assert.ok(!observed.some(entry=>entry.stage==='requirements-analysis'));assert.equal(observed.filter(entry=>entry.stage==='intent-capture'&&entry.summary).length,1);assert.equal(observed.filter(entry=>entry.stage==='intent-capture'&&!entry.summary).length,1);}else assert.equal(invalidationProved,true);assert.deepEqual(fs.readFileSync(requestFile),original);assert.deepEqual(fs.readFileSync(path.join(controllerRoot,'provider-budget.json')),budget);
console.log(JSON.stringify({status:'pass',proof:'installed-subprocess-adapter-and-normal-cli',model_or_provider_invoked:false,mode,workers:observed,definition_amendments:1}));
