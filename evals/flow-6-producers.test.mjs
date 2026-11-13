import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startRun,attachEvidence,evaluateRun,loadRun} from '@kontourai/flow';
import {buildTrustReport} from '@kontourai/surface';
import {attachObservation} from '../scripts/runtime.mjs';
import {unitObservationBundle} from '../scripts/unit-flow.mjs';

// Exercise the actual producers, persisted bundles and public Flow gate, rather
// than substituting a hand-written policy/pass fixture for producer output.
for (const producer of ['completion','review','unit']) {
 test(`Flow 6 ${producer} producer retains verification and fails closed on lost requirements`,async t=>{
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-flow6-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const claimType=producer==='unit'?'aidlc.unit-completion':`aidlc.stage-${producer}`;
  const file=path.join(cwd,'definition.json');
  fs.writeFileSync(file,JSON.stringify({id:'producer-proof',version:'1',steps:[{id:'stage',next:null}],gates:{'stage-gate':{step:'stage',expects:[{id:'check',kind:'trust.bundle',required:true,description:'Actual producer observation',bundle_claim:{claimType,subjectType:'flow-step',subjectId:'proof/stage',accepted_statuses:['verified']}}]}}}));
  await startRun(file,{cwd,runId:'proof'});
  let bundle;
  if(producer==='unit')bundle=unitObservationBundle({runId:'proof',parentRunId:'parent',stage:'stage',unitId:'stage',record:{observed:true},passing:true});
  else {
   const observation=await attachObservation({controllerRoot:cwd,runId:'proof',stage:'stage',kind:producer,status:'pass',record:{observed:true}});
   assert.equal(observation.status,'verified');
   bundle=JSON.parse(fs.readFileSync(observation.file));
  }
  assert.match(bundle.source,/statusFunctionVersion=4$/);
  const scenarios=[['pass',b=>{},'verified'],['no-policy',b=>{b.policies=[];delete b.claims[0].verificationPolicyId;},'proposed'],['no-passing',b=>{delete b.evidence[0].passing;},'proposed'],['failed',b=>{b.evidence[0].passing=false;},'disputed'],['stale',b=>{b.events.push({id:'stale',claimId:b.claims[0].id,type:'invalidation',status:'stale',actor:'host',method:'validation',evidenceIds:[],createdAt:new Date(Date.now()+1000).toISOString()});},'stale']];
  let previous=(await loadRun('proof',cwd)).manifest.evidence.at(-1)?.id;
  // Evaluate negatives first so no completed-run replay can mask a failed gate.
  for(const [name,mutate,expected] of [...scenarios.slice(1),scenarios[0]]){
   const value=structuredClone(bundle);mutate(value);
   assert.equal(buildTrustReport(value,{now:new Date(Date.now()+2000)}).claims[0].status,expected,name);
   const evidenceFile=path.join(cwd,`${name}.json`);fs.writeFileSync(evidenceFile,JSON.stringify(value));
   const entry=await attachEvidence('proof',{cwd,gate:'stage-gate',file:evidenceFile,kind:'trust.bundle',...(previous?{supersede:previous}:{})});previous=entry.id;
   const evaluated=await evaluateRun('proof',{cwd,now:new Date(Date.now()+2000).toISOString()});
   assert.equal(evaluated.outcomes[0].status,name==='pass'?'pass':'block',name);
  }
 });
}
