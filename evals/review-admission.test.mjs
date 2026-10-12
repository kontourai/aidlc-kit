import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runAidlc,snapshotWorkspace} from '../scripts/runtime.mjs';
import {readSnapshot,digest,requestBindingDigest} from '../scripts/compile.mjs';
import {createControllerAuthority} from '../scripts/authority.mjs';
import {retainRequestAdmission} from '../scripts/request-admission.mjs';
import {inspectRequirementsReview} from '../scripts/review-admission.mjs';
import {loadRun} from '@kontourai/flow';

test('requirements presentation admits the real current signed visit and refuses changed evidence, scope, history and deadline without decisions',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-review-admission-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const workspace=path.join(root,'workspace'),controllerRoot=path.join(root,'controller');
  fs.mkdirSync(workspace);fs.mkdirSync(controllerRoot);
  const snapshot=readSnapshot();
  const request={run_id:'review-admission',workspace,prompt:'Controlled requirements review fixture',execution:{max_turns:32,timeout_s:3600},engine_sandbox:{image:'node-subprocess-fixture'},parameters:{profile:'bugfix',project_type:'greenfield',repair_checks:false,ceremony:{sensors:'off',review_cap:'advisory',summary_confirmation:'off',learnings:'off',skeleton:'off',collaborators:'off'},stage_decisions:snapshot.profiles.bugfix.stages.filter(id=>!['workspace-scaffold','workspace-detection','state-init','requirements-analysis'].includes(id)).map(stage=>({stage,execute:false,reason:'Focused review admission fixture'})),authority_policy:{reference:'fixture-policy',purposes:['stage-selection']}}};
  const identities=new Map(),starts=[];
  const executor={
    async admit(input){const id=randomUUID(),identity={actor:{runtime:'actual-node-subprocess',session_id:id,host:'fixture'},instance_id:id};identities.set(input.request_digest,identity);return identity;},
    async snapshotBasis({artifacts=[]}){return {source_digest:snapshotWorkspace(workspace).source_digest,artifacts:artifacts.map(ref=>({path:ref.path,digest:digest(fs.readFileSync(path.join(workspace,ref.path)))}))};},
    async execute(input){
      const worker=spawnSync(process.execPath,['-e',`const fs=require('fs'),p=require('path');for(const target of JSON.parse(process.argv[1])){fs.mkdirSync(p.dirname(target.path),{recursive:true});fs.writeFileSync(target.path,'# Requirements\\n\\n## Functional\\nActual fixture bytes.\\n');}`,JSON.stringify(input.phase==='review'?[]:input.context.artifact_targets)],{cwd:workspace,encoding:'utf8'});
      assert.equal(worker.status,0,worker.stderr);
      starts.push({worker:{terminal:{status:worker.status},observed:{execution_profile:'host-native'},engine_outcome:'completed'}});
      const result={status:'completed',identity:identities.get(input.request_digest),identity_basis:'executor-observed',input_basis:input.basis,receipt:{id:randomUUID(),digest:digest(worker.stdout),request_digest:input.request_digest}};
      return input.phase==='review'?{...result,verdict:'ready',findings:[],basis:input.basis,artifacts:[]}:{...result,artifacts:input.context.artifact_targets.map(ref=>({path:ref.path,digest:digest(fs.readFileSync(path.join(workspace,ref.path)))}))};
    },
  };
  const authority=createControllerAuthority({policy:request.parameters.authority_policy,requestDigest:requestBindingDigest(request),controllerRoot});
  const result=await runAidlc({request,controllerRoot,executor,authority,controllerWorkerCustody:'none'});
  assert.equal(result.status,'waiting',JSON.stringify(result.failure));
  const pendingFile=result.failure.detail.pending.file;
  retainRequestAdmission({request,originalDigest:requestBindingDigest(request),controllerRoot});
  // Controlled host ledger from the actual subprocess observations above. This
  // is admission mechanism evidence, never provider or human qualification.
  const history={binding:digest({run_id:request.run_id,execution:request.execution,image:request.engine_sandbox.image,workspace:fs.realpathSync(workspace)}),started_at:Date.now(),starts};
  const historyFile=path.join(controllerRoot,'executor-history.json');
  const saveHistory=value=>fs.writeFileSync(historyFile,JSON.stringify({history:value,digest:digest(value)}));
  saveHistory(history);
  const authorityFiles=fs.readdirSync(path.join(controllerRoot,'authority')).sort();
  const state=structuredClone((await loadRun(request.run_id,controllerRoot)).state);
  const inspect=()=>inspectRequirementsReview({controllerRoot,pendingFile});
  const admitted=await inspect();
  assert.ok(admitted.documents.length>0);
  assert.equal(admitted.budget.remaining_workers,32-starts.length);
  const ref=admitted.documents[0],file=path.join(workspace,ref.path),original=fs.readFileSync(file);
  fs.writeFileSync(file,'changed requirements');await assert.rejects(inspect,/basis changed|artifact bytes changed/);fs.writeFileSync(file,original);
  saveHistory({...history,started_at:Date.now()-3600_000});await assert.rejects(inspect,/deadline expired/);saveHistory(history);
  saveHistory({...history,starts:[...starts,{worker:{terminal:null}}]});await assert.rejects(inspect,/observed and settled/);saveHistory(history);
  const saved=JSON.parse(fs.readFileSync(historyFile));saved.digest='changed';fs.writeFileSync(historyFile,JSON.stringify(saved));await assert.rejects(inspect,/history changed/);saveHistory(history);
  const pending=fs.readFileSync(pendingFile),forged=JSON.parse(pending);forged.payload.input.stage='code-generation';fs.writeFileSync(pendingFile,JSON.stringify(forged));await assert.rejects(inspect,/signature or exact binding/);fs.writeFileSync(pendingFile,pending);
  assert.deepEqual((await inspect()).documents,admitted.documents);
  assert.deepEqual(fs.readdirSync(path.join(controllerRoot,'authority')).sort(),authorityFiles);
  assert.deepEqual((await loadRun(request.run_id,controllerRoot)).state,state);
});
