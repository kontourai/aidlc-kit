import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {resolveTestingPostureFromSections,resolveTestingContract,assertTestingPolicyCurrent,readPlanTestingContract,stampTestingPlan,validateTestingPlans} from '../scripts/testing-posture.mjs';
import {readSnapshot} from '../scripts/compile.mjs';
const options={scope:'bugfix',testStrategy:'standard',projectType:'brownfield'};
test('pinned upstream fallback preserves exact standard obligations and runner posture independent of depth',()=>{
 const contract=resolveTestingPostureFromSections({},options);assert.equal(contract.source,'fallback');assert.equal(contract.methodology,'test-after');assert.equal(contract.test_strategy,'standard');assert.match(contract.plan_profile.runner_step,/Verify the existing/);assert.match(contract.obligations.scope_floor[0],/targeted regression/);assert.equal(contract.contract_sha256,'sha256:6217aeed35df31a9cb85d2aa485e7a4ed11ea70a32e8a7407c6e15e225351970');
 const green=resolveTestingPostureFromSections({},{...options,scope:'enterprise',testStrategy:'comprehensive',projectType:'greenfield'});assert.match(green.plan_profile.runner_step,/Bootstrap/);assert.match(green.obligations.scope_floor[0],/80%/);
});
test('upstream project precedence retains additive notes and refuses team-project methodology conflict',()=>{
 const contract=resolveTestingPostureFromSections({org:'Methodology: test-after\nCoverage: baseline',team:'Methodology: tdd',project:'Methodology: tdd\nOrdering: Red then Green then Refactor'},options);assert.equal(contract.source,'project');assert.equal(contract.methodology,'tdd');assert.equal(contract.applicable_notes.length,3);
 assert.throws(()=>resolveTestingPostureFromSections({team:'Methodology: tdd',project:'Methodology: bdd'},options),/conflict/);
 assert.equal(resolveTestingPostureFromSections({org:'Methodology: test-after',project:'Methodology: bdd'},options).methodology,'bdd');
 assert.throws(()=>resolveTestingPostureFromSections({project:'Methodology: typo'},options),/Invalid Testing Posture/);
});
test('commented and fenced methodology examples cannot select policy; custom ordered specialization preserved',()=>{
 assert.equal(resolveTestingPostureFromSections({project:'<!-- Methodology: tdd -->\n```\nMethodology: bdd\n```'},options).source,'fallback');
 const custom=resolveTestingPostureFromSections({team:'Methodology: tdd',project:'Methodology: custom\nOrdering: tdd for domain, test-after for adapters'},options);assert.equal(custom.methodology,'custom');assert.equal(custom.ordering,'tdd for domain, test-after for adapters');
});
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-testing-posture-'));return {root,workspace:root,request:{parameters:{profile:'bugfix'}},snapshot:readSnapshot(),profile:'bugfix'};};
test('policy byte and presence changes invalidate contract; application code alone leaves posture current',()=>{const input=fixture();try{
 const resolved=resolveTestingContract(input);fs.writeFileSync(path.join(input.workspace,'app.js'),'new implementation');assert.equal(assertTestingPolicyCurrent(resolved,input).contract_digest,resolved.contract_digest);
 fs.mkdirSync(path.join(input.workspace,'.aidlc/memory'),{recursive:true});fs.writeFileSync(path.join(input.workspace,'.aidlc/memory/project.md'),'## Testing Posture\nMethodology: tdd\n');assert.throws(()=>assertTestingPolicyCurrent(resolved,input),/policy or scope changed/);
 const current=resolveTestingContract(input);assert.equal(current.contract.source,'project');fs.appendFileSync(path.join(input.workspace,'.aidlc/memory/project.md'),'<!-- audit change -->');assert.throws(()=>assertTestingPolicyCurrent(current,input),/policy or scope changed/);
 assert.throws(()=>resolveTestingContract({...input,request:{parameters:{testing_policy:{team:'missing.md'}}}}),/unavailable/);
 }finally{fs.rmSync(input.root,{recursive:true,force:true});}});
test('host renders exact contract before plan approval; changed contract, malformed JSON and hidden headings refuse',()=>{const input=fixture();try{
 const resolved=resolveTestingContract(input),stamped=stampTestingPlan('# Implementation plan\n\n## Change\nGeneric authorized work.',resolved);assert.deepEqual(readPlanTestingContract(stamped),resolved.contract);
 assert.throws(()=>readPlanTestingContract('# Plan\n```\n## Testing Contract\n```'),/exactly one real/);
 assert.throws(()=>readPlanTestingContract('## Testing Contract\n```json\n{bad}\n```'),/malformed/);
 assert.throws(()=>stampTestingPlan(stamped.replace('"methodology": "test-after"','"methodology": "tdd"'),resolved),/fingerprint mismatch/);
 fs.writeFileSync(path.join(input.workspace,'plan.md'),stamped);fs.writeFileSync(path.join(input.workspace,'tests.md'),'# Test instructions\n```bash\nnode --test\n```');
 const params={workspace:input.workspace,plans:[{path:'plan.md'}],instructions:[{path:'tests.md'}],resolved,sourceDigest:'a'.repeat(64)},basis=validateTestingPlans(params);assert.equal(basis.testing_contract_digest,resolved.contract_digest);
 fs.appendFileSync(path.join(input.workspace,'tests.md'),'changed instructions');assert.notEqual(validateTestingPlans(params).fingerprint,basis.fingerprint);
 fs.writeFileSync(path.join(input.workspace,'plan.md'),'# Missing contract');assert.throws(()=>validateTestingPlans(params),/exactly one real/);
 }finally{fs.rmSync(input.root,{recursive:true,force:true});}});

import {runAidlc} from '../scripts/runtime.mjs';
import {createControllerAuthority} from '../scripts/authority.mjs';
import {createDockerExecutor} from '../scripts/executor.mjs';
import {requestBindingDigest,digest} from '../scripts/compile.mjs';
import {spawnSync} from 'node:child_process';

test('actual subprocess planning receives authoritative contract; host stamps, validates and approves before implementation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-testing-runtime-')),workspace=path.join(root,'source'),controllerRoot=path.join(root,'controller');fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);
 try{
 const snapshot=readSnapshot(),request={schema:'kontour.kit.execution_request',version:'1.0',run_id:'testing-contract-subprocess',workspace,source_root:workspace,prompt:'Generic authorized component fixture',execution:{model:'host-subprocess-fixture',max_turns:10,timeout_s:120},engine_sandbox:{image:`sha256:${'a'.repeat(64)}`,artifact_root:path.join(root,'capture')},parameters:{profile:'bugfix',repair_checks:false,ceremony:{sensors:'off',review_cap:'none',learnings:'on',collaborators:'off',skeleton:'off'},stage_decisions:snapshot.profiles.bugfix.stages.filter(stage=>stage!=='code-generation').map(stage=>({stage,execute:false,reason:'Focused public runtime component proof'}))}};
 let planningContract=null,implementationContract=null,calls=0;
 const workerRunner=async input=>{
  calls++;const context=JSON.parse(fs.readFileSync(input.contextFile,'utf8')),dispatch=context.dispatch;
  assert.match(context.instructions.join('\n'),/## Testing Contract\n\n```json/);
  if(dispatch.context.planning_only){planningContract=dispatch.context.testing_contract;assert.equal(dispatch.context.learning_diary,undefined);assert.equal(dispatch.context.learning_diaries,undefined);assert.equal(dispatch.context.learning_protocol,undefined);assert.ok(dispatch.context.artifact_targets.every(target=>['code-generation-plan','unit-test-instructions'].includes(target.id)));assert.ok(!context.instructions.some(line=>/Diary:/.test(line)));assert.ok(context.instructions.some(line=>/learning ritual is deferred/i.test(line)));}else{implementationContract=dispatch.context.testing_contract;assert.ok(dispatch.context.learning_diary?.endsWith('/memory.md'));assert.ok(dispatch.context.artifact_targets.some(target=>target.id==='memory'));assert.ok(context.instructions.some(line=>/Diary:/.test(line)));}
  const child=spawnSync(process.execPath,['-e',`const fs=require('node:fs'),path=require('node:path');const c=JSON.parse(fs.readFileSync(process.argv[1],'utf8')).dispatch.context;for(const target of c.artifact_targets){if(c.approved_plan_basis?.some(ref=>ref.path===target.path))continue;let text=target.id==='unit-test-instructions'?'# Unit Test Instructions\\n\\n## Commands\\n\x60\x60\x60bash\\nnode --test app.test.mjs\\n\x60\x60\x60\\n':'# Observed stage output\\n\\n## Change\\nGeneric component implementation.\\n';fs.mkdirSync(path.dirname(target.path),{recursive:true});fs.writeFileSync(target.path,text);}if(!c.planning_only){fs.writeFileSync('app.mjs','export const value=1;');fs.writeFileSync('app.test.mjs','import assert from "node:assert/strict";import {value} from "./app.mjs";assert.equal(value,1);');}`,input.contextFile],{cwd:input.workspace,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  return {observed:{container_id:'actual-node-subprocess',context_digest:digest(fs.readFileSync(input.contextFile)),stdin_digest:digest('fixture'),source_fork_digest:digest('observed-process')},provider_thread_id:`subprocess-${calls}`,terminal:{status:child.status,timeout:false,overflow:false},container_removed:true,usage:{complete:false},final:JSON.stringify({status:'completed',artifacts:dispatch.context.artifact_targets.map(ref=>({path:ref.path}))})};
 };
 const executor=createDockerExecutor({request,controllerRoot,workerRunner}),authority=createControllerAuthority({policy:{reference:'authorized-component-test',purposes:['stage-selection','code-plan']},requestDigest:requestBindingDigest(request),controllerRoot});
 const result=await runAidlc({request,executor,authority,controllerRoot});assert.equal(result.status,'completed',JSON.stringify(result.failure));assert.equal(calls,2);assert.deepEqual(planningContract,implementationContract);assert.equal(planningContract.methodology,'test-after');
 const plan=fs.readFileSync(path.join(workspace,'.aidlc/artifacts/code-generation/code-generation-plan.md'),'utf8');assert.deepEqual(readPlanTestingContract(plan),planningContract);
 const planningReceipt=result.executions.find(receipt=>receipt.phase==='inline'||receipt.phase==='draft');assert.ok(planningReceipt.observation.host_testing_contract_rendering.length);
 const inputs=fs.readdirSync(path.join(controllerRoot,'authority')).filter(file=>file.endsWith('.input.json')).map(file=>JSON.parse(fs.readFileSync(path.join(controllerRoot,'authority',file),'utf8')));const approval=inputs.find(input=>input.purpose==='code-plan');assert.equal(approval.testing_basis.testing_contract_digest,planningContract.contract_sha256);assert.deepEqual(approval.testing_basis.plans[0].instructions[0].commands,['node --test app.test.mjs']);
 assert.equal((await runAidlc({request,executor:createDockerExecutor({request,controllerRoot,workerRunner}),authority,controllerRoot})).status,'completed');assert.equal(calls,2);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('malformed model contract is refused before any code-plan authority or implementation invocation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-testing-refusal-')),workspace=path.join(root,'source'),controllerRoot=path.join(root,'controller');fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);
 try{
 const snapshot=readSnapshot(),request={run_id:'bad-testing-plan',workspace,prompt:'Generic guarded implementation boundary',parameters:{profile:'bugfix',repair_checks:false,ceremony:{sensors:'off',review_cap:'none',learnings:'off',collaborators:'off'},stage_decisions:snapshot.profiles.bugfix.stages.filter(stage=>stage!=='code-generation').map(stage=>({stage,execute:false,reason:'Focused contract guard test'}))}};
 const ids=new Map();let authorizations=0,implementations=0;
 const signed=createControllerAuthority({policy:{reference:'test-host-policy',purposes:['stage-selection','code-plan']},requestDigest:requestBindingDigest(request),controllerRoot});
 const authority={...signed,async authorize(input){if(input.purpose==='code-plan')authorizations++;return signed.authorize(input);}};
 const executor={async admit(req){const id=String(ids.size),identity={actor:{runtime:'test-host',host:'localhost',session_id:id},instance_id:id};ids.set(req.request_digest,identity);return identity;},async snapshotBasis({artifacts=[]}){return {source_digest:digest('stable-source'),artifacts:artifacts.map(ref=>({path:ref.path,digest:digest(fs.readFileSync(path.join(workspace,ref.path)))}))};},async execute(req){if(!req.context.planning_only)implementations++;for(const ref of req.context.artifact_targets){fs.mkdirSync(path.dirname(path.join(workspace,ref.path)),{recursive:true});fs.writeFileSync(path.join(workspace,ref.path),ref.id==='code-generation-plan'?'# Plan\n\n## Testing Contract\n```json\n{bad-json}\n```':'# Tests\n```bash\nnode --test\n```');}return {status:'completed',identity:ids.get(req.request_digest),identity_basis:'executor-observed',receipt:{id:'host-'+ids.size,digest:digest(req.request_digest),request_digest:req.request_digest},input_basis:req.basis,artifacts:req.context.artifact_targets.map(ref=>({path:ref.path,digest:digest(fs.readFileSync(path.join(workspace,ref.path)))}))};}};
 const result=await runAidlc({request,executor,authority,controllerRoot});assert.equal(result.status,'failed');assert.equal(result.failure.reason,'plan_failed');assert.equal(authorizations,0);assert.equal(implementations,0);assert.match(result.failure.detail.units[0].error,/JSON malformed/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('worker cannot alter a registered testing policy even in a source-authorized stage',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-testing-policy-jail-')),workspace=path.join(root,'source'),controllerRoot=path.join(root,'controller');fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);
 try{
 fs.writeFileSync(path.join(workspace,'testing-policy.md'),'## Testing Posture\nMethodology: tdd\n');
 const request={run_id:'testing-policy-jail',workspace,source_root:workspace,execution:{model:'test-host',max_turns:2,timeout_s:30},engine_sandbox:{image:`sha256:${'a'.repeat(64)}`,artifact_root:path.join(root,'capture')}};
 const workerRunner=async input=>{fs.writeFileSync(path.join(input.workspace,'testing-policy.md'),'## Testing Posture\nMethodology: test-after\n');return {observed:{container_id:'test-host-observed',context_digest:digest(fs.readFileSync(input.contextFile)),stdin_digest:digest('fixture'),source_fork_digest:digest('fixture')},provider_thread_id:'actual-policy-jail-port',terminal:{status:0,timeout:false,overflow:false},container_removed:true,usage:{complete:false},final:JSON.stringify({status:'completed',artifacts:[]})};};
 const executor=createDockerExecutor({request,controllerRoot,workerRunner}),dispatch={request_digest:digest('immutable-dispatch'),stage:'code-generation',role:'aidlc-developer-agent',unit:'stage',phase:'draft',context:{stage:{workspace_requires:true},artifact_targets:[],testing_policy_basis:{sources:[{layer:'project',path:'testing-policy.md'}]}},basis:await executor.snapshotBasis({})};dispatch.expected_identity=await executor.admit(dispatch);
 await assert.rejects(executor.execute(dispatch),/host-bound Testing Posture policy/);assert.match(fs.readFileSync(path.join(workspace,'testing-policy.md'),'utf8'),/Methodology: tdd/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
