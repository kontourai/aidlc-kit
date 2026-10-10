import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolveComposition} from '../scripts/composition.mjs';
import {readSnapshot,digest,requestBindingDigest,generatedFiles} from '../scripts/compile.mjs';
import {createControllerAuthority,recordControllerDecision} from '../scripts/authority.mjs';
import {runAidlc,snapshotWorkspace} from '../scripts/runtime.mjs';
import {loadRun} from '@kontourai/flow';

test('composition defaults to classic, preserves stock bytes and base testing scope',()=>{
 const snapshot=readSnapshot(),before=generatedFiles(snapshot);
 assert.equal(resolveComposition(snapshot).profile,'feature');
 const result=resolveComposition(snapshot,{composition:{name:'project'}});
 assert.equal(result.composition.base,'classic');assert.equal(result.snapshot.profiles[result.profile].defaults.scope,'classic');
 assert.deepEqual(generatedFiles(snapshot),before);
 const feature=resolveComposition(snapshot,{profile:'feature',composition:{name:'feature-project'}});
 assert.equal(feature.snapshot.profiles[feature.profile].defaults.scope,'feature');
});

test('typed composition rejects unknown, duplicate, conflicting stages, skipped initialization and starvation',()=>{
 const snapshot=readSnapshot(),resolve=composition=>resolveComposition(snapshot,{profile:'poc',composition:{name:'project',...composition}});
 for(const composition of [{add:['fake']},{add:['market-research','market-research']},{add:['intent-capture']},{skip:['state-init']},{skip:['market-research']},{name:'../escape'},{strict_inputs:'yes'},{code:'custom engine'}])assert.throws(()=>resolve(composition));
 assert.throws(()=>resolve({add:['performance-validation'],strict_inputs:true}),/producer off path/);
 const advisory=resolve({add:['performance-validation']});assert.ok(advisory.composition.advisories.some(finding=>finding.stage==='performance-validation'));
 const cycle=structuredClone(snapshot);cycle.stages.find(stage=>stage.slug==='intent-capture').requires_stage=['market-research'];
 assert.throws(()=>resolveComposition(cycle,{profile:'poc',composition:{name:'cycle',add:['market-research']}}),/cycle/);
});

test('public runtime executes added stage through actual Flow, signed decision inbox, artifact lineage and bound resume',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-composition-')),workspace=path.join(root,'workspace'),controllerRoot=path.join(root,'controller');fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);
 try{
 const request={run_id:'composed-project',workspace,prompt:'Synthetic composition boundary fixture',parameters:{profile:'poc',project_type:'greenfield',composition:{name:'discovery',add:['market-research'],skip:['reverse-engineering','requirements-analysis','code-generation','build-and-test'],strict_inputs:true},ceremony:{sensors:'off',review_cap:'none',summary_confirmation:'off',plan_approval:'off',learnings:'off',collaborators:'off'},repair_checks:false}};
 const policy={reference:'synthetic-composition-policy',purposes:['input-confirmation'],input_confirmations:{}};
 let authority=createControllerAuthority({policy,requestDigest:requestBindingDigest(request),controllerRoot});
 const identities=new Map(),executed=[];
 const executor={async admit(req){const id=randomUUID(),identity={actor:{runtime:'node-subprocess',host:'fixture',session_id:id},instance_id:id};identities.set(req.request_digest,identity);return identity;},async snapshotBasis({artifacts=[]}){return {source_digest:snapshotWorkspace(workspace).source_digest,artifacts:artifacts.map(ref=>({path:ref.path,digest:digest(fs.readFileSync(path.join(workspace,ref.path)))}))};},async execute(req){executed.push(req.stage);const child=spawnSync(process.execPath,['-e','const fs=require("fs"),p=require("path");for(const t of JSON.parse(process.argv[1])){fs.mkdirSync(p.dirname(t.path),{recursive:true});fs.writeFileSync(t.path,"# Fixture observation\\n\\n## Findings\\nSynthetic actual subprocess output.\\n")} ',JSON.stringify(req.context.artifact_targets)],{cwd:workspace,encoding:'utf8'});assert.equal(child.status,0,child.stderr);return {status:'completed',identity:identities.get(req.request_digest),identity_basis:'executor-observed',receipt:{id:randomUUID(),digest:digest(child.stdout),request_digest:req.request_digest},input_basis:req.basis,artifacts:req.context.artifact_targets.map(ref=>({path:ref.path,digest:digest(fs.readFileSync(path.join(workspace,ref.path)))}))};}};
 let result=await runAidlc({request,executor,authority,controllerRoot});
 assert.equal(result.status,'waiting');assert.equal(result.failure.stage,'profile-composition');assert.equal(executed.length,0);assert.equal(fs.existsSync(path.join(controllerRoot,'binding.json')),false);
 const forged={authorize:async()=>({authorized:true,reference:'model-label',receipt:{}}),verify:()=>false};
 assert.equal((await runAidlc({request,executor,authority:forged,controllerRoot})).status,'waiting');
 const omitted=structuredClone(request);omitted.parameters.stage_decisions=[{stage:'intent-capture',execute:false,reason:'fixture starvation'}];
 const omitting=createControllerAuthority({policy:{reference:'fixture',purposes:['stage-selection','profile-composition']},requestDigest:requestBindingDigest(omitted),controllerRoot});
 await assert.rejects(runAidlc({request:omitted,executor,authority:omitting,controllerRoot}),/producer off path/);
 const missingInit=structuredClone(request);missingInit.parameters.stage_decisions=[{stage:'state-init',execute:false,reason:'fixture initialization bypass'}];
 const initAuthority=createControllerAuthority({policy:{reference:'fixture',purposes:['stage-selection']},requestDigest:requestBindingDigest(missingInit),controllerRoot});
 await assert.rejects(runAidlc({request:missingInit,executor,authority:initAuthority,controllerRoot}),/skip initialization/);
 recordControllerDecision({controllerRoot,pendingFile:result.failure.pending.file,reference:'fixture operator approved exact composition'});
 authority=createControllerAuthority({policy,requestDigest:requestBindingDigest(request),controllerRoot});
 result=await runAidlc({request,executor,authority,controllerRoot});
 // Intent capture has its own separate input-confirmation authority; approving
 // composition cannot silently supply operator answers.
 if(result.status==='waiting'){
  assert.equal(result.failure.stage,'intent-capture');
  const pending=fs.readdirSync(path.join(controllerRoot,'authority/pending')).map(name=>path.join(controllerRoot,'authority/pending',name)).find(file=>JSON.parse(fs.readFileSync(file)).payload.input.purpose==='input-confirmation');
  assert.ok(pending);recordControllerDecision({controllerRoot,pendingFile:pending,reference:'fixture supplied-input confirmation'});
  authority=createControllerAuthority({policy,requestDigest:requestBindingDigest(request),controllerRoot});
  result=await runAidlc({request,executor,authority,controllerRoot});
 }
 assert.equal(result.status,'completed',JSON.stringify(result.failure));assert.equal((await loadRun(request.run_id,controllerRoot)).state.status,'completed');
 assert.ok(executed.includes('market-research'));assert.ok(executed.indexOf('intent-capture')<executed.indexOf('market-research'));
 const market=result.records.find(record=>record.stage==='market-research');assert.ok(market.artifact_observation.inputs.some(input=>input.id==='intent-statement'));
 assert.equal((await runAidlc({request,executor,authority,controllerRoot})).status,'completed');
 const altered=structuredClone(request);altered.parameters.composition.name='changed';
 await assert.rejects(runAidlc({request:altered,executor,authority,controllerRoot}),/binding changed|input or definition changed/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
