// Clean installed public worker-context projection; no model/provider efficacy.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
const [consumer,scratch]=process.argv.slice(2),kit=path.join(consumer,'node_modules/@kontourai/aidlc-kit');
const {readSnapshot}=await import(pathToFileURL(path.join(kit,'scripts/compile.mjs')));
const {buildExecutionPrompt}=await import(pathToFileURL(path.join(kit,'scripts/authority.mjs')));
const {nativeEngineWorker}=await import(pathToFileURL(path.join(kit,'scripts/engine-worker.mjs')));
const snapshot=readSnapshot(),stage=snapshot.stages.find(x=>x.slug==='rough-mockups'),observed=[];
const worker=nativeEngineWorker({host:{isolation:'trusted-host',host_access_granted:true,engine:'fixture',model:'fixture'},runner:async input=>{
 const context=JSON.parse(input.prompt.slice(0,input.prompt.indexOf('\nNative host execution:'))),refs=context.methodology_references;
 const file=path.join(refs.root,refs.document_root,'core/aidlc-common/protocols/stage-protocol.md');
 observed.push({role:context.dispatch.role,text:fs.readFileSync(file,'utf8'),references:refs});
 return {outcome:'completed',terminal:{status:0},observed:{engine:'fixture',prompt_digest:'fixture-observation'},final:JSON.stringify({status:'completed',artifacts:[]})};
}});
for(const [role,phase]of [[stage.lead_agent,'inline'],[stage.reviewer,'review']]){
 const context=buildExecutionPrompt({dispatch:{stage:stage.slug,role,phase,context:{profile:'feature',stage}},workspace:scratch,sourceDigest:'fixture-source'}),contextFile=path.join(scratch,`references-${phase}.json`);fs.writeFileSync(contextFile,JSON.stringify(context));
 const receipt=await worker({contextFile,workspace:scratch,sourceRoot:kit,artifactRoot:path.join(scratch,'reference-captures'),timeoutMs:30000,ownerId:'fixture',invocationId:phase});assert.equal(receipt.terminal.status,0);assert.ok(receipt.final);
}
assert.notEqual(observed[0].role,observed[1].role);assert.deepEqual(observed[0].references,observed[1].references);assert.equal(observed[0].text,observed[1].text);assert.match(observed[0].text,/ASCII Diagram Standards/);
assert.equal(snapshot.stages.length,33);assert.equal(Object.keys(snapshot.profiles).length,11);
console.log(JSON.stringify({status:'pass',proof:'installed-reference-author-review-context',model_or_provider_invoked:false,stages:33,profiles:11,reference_count:observed[0].references.source_paths.length}));
