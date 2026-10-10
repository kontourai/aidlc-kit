/** Ordinary installed CLI and real Node subprocess proof; no model/provider efficacy claim. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const [consumer,scratch]=process.argv.slice(2),require=createRequire(path.join(consumer,'package.json'));
const kit=path.join(consumer,'node_modules/@kontourai/aidlc-kit'),cli=path.join(kit,'scripts/cli.mjs');
const {loadRun}=await import(pathToFileURL(require.resolve('@kontourai/flow')));
const {runAidlc,snapshotWorkspace}=await import(pathToFileURL(require.resolve('@kontourai/aidlc-kit')));
const {readSnapshot,digest,requestBindingDigest}=await import(pathToFileURL(require.resolve('@kontourai/aidlc-kit/compile')));
const {createControllerAuthority}=await import(pathToFileURL(path.join(kit,'scripts/authority.mjs')));
const {questionnaireCells,fillQuestionnaire}=await import(pathToFileURL(path.join(kit,'scripts/questionnaire-replies.mjs')));
const snapshot=readSnapshot(),proofs=[];
const pendingOf=result=>result.failure?.pending??result.failure?.detail?.pending;
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const workerCode=String.raw`
const fs=require('fs'),path=require('path'),{randomUUID}=require('crypto');
const input=JSON.parse(fs.readFileSync(0,'utf8')),nonce=randomUUID();
if(input.phase==='review'){
 const questions=fs.readFileSync(input.questionFile,'utf8');
 const answers=questions.match(/^\[Answer\]:\s*\S.*$/gm)||[];
 if(answers.length<input.initialCells||/^\[Answer\]:\s*$/m.test(questions))throw Error('Reviewer observed unanswered question cells');
 for(const file of input.outputs){const text=fs.readFileSync(file,'utf8');if(input.revised&&!text.includes('Actual operator follow-up answer'))throw Error('Revised artifacts omitted actual input');if(!input.revised&&!text.includes('[assumption]'))throw Error('Acceptance erased unresolved assumption label');}
 process.stdout.write(JSON.stringify({nonce,verdict:'ready'}));
}else{
 for(const target of input.targets){
  const file=path.join(process.cwd(),target.path);fs.mkdirSync(path.dirname(file),{recursive:true});
  let text;
  if(input.summary){
   const headings=input.initialCells===16?['Response Mode',...Array.from({length:12},(_,i)=>'Q'+(i+1)+'. Explicit fixture question '+(i+1)), 'Assumption Confirmation','Summary Confirmation','Operator Learnings']:['Q1. Explicit local fixture scope?','Summary Confirmation'];
   text='# Observed questionnaire '+nonce+'\n\n'+headings.map(h=>'## '+h+'\n\n[Answer]:\n').join('\n');
  }else{
   if(!input.reply?.documents?.every(doc=>doc.answers.every(answer=>answer.value.trim())))throw Error('Author has no actual completed operator reply');
   const followups=input.reply.documents.flatMap(doc=>doc.answers).filter(answer=>/^Q1[34]\./.test(answer.heading));
   if(input.revised&&followups.length!==2)throw Error('Revision missing both actual follow-ups');
   text='# Observed intent '+nonce+'\n\n## Findings\nExplicit observed operator scope.\n'+(input.revised?followups.map(answer=>answer.value).join('\n')+'\n':'')+'\n## Assumptions & Open Questions\n'+(input.revised?'None.':'- Ownership remains unknown [assumption].')+'\n';
  }
  fs.writeFileSync(file,text);
 }
 process.stdout.write(JSON.stringify({nonce,phase:input.phase,revision:input.revised}));
}`;
function fixture(name,{stage='market-research',summary='on'}={}){
 const root=path.join(scratch,`installed-questionnaire-${name}`),workspace=path.join(root,'workspace'),controllerRoot=path.join(root,'controller');fs.mkdirSync(workspace,{recursive:true});fs.mkdirSync(controllerRoot);
 const profile=stage==='intent-capture'?'poc':'feature',keep=new Set(['workspace-scaffold','workspace-detection','state-init',stage]);
 const request={run_id:`installed-${name.toLowerCase()}`,workspace,prompt:'Exercise explicit operator answers through the ordinary installed API.',parameters:{profile,project_type:'greenfield',ceremony:{sensors:'off',review_cap:stage==='intent-capture'?'advisory':'none',summary_confirmation:summary,skeleton:'off',learnings:'off',collaborators:'off'},stage_decisions:snapshot.profiles[profile].stages.filter(id=>!keep.has(id)).map(id=>({stage:id,execute:false,reason:'Bounded installed transport conformance fixture'})),authority_policy:{reference:'explicit-test-operator-stage-policy',purposes:['stage-selection']}}};
 const identities=new Map(),observed=[];
 const authority=()=>createControllerAuthority({policy:request.parameters.authority_policy,requestDigest:requestBindingDigest(request),controllerRoot});
 const executor={async admit(input){const instance=randomUUID(),identity={actor:{runtime:'actual-node-subprocess',host:'clean-installed-consumer',session_id:instance},instance_id:instance};identities.set(input.request_digest,identity);return identity;},async snapshotBasis({artifacts=[]}){return {source_digest:snapshotWorkspace(workspace).source_digest,artifacts:artifacts.map(ref=>({path:ref.path,digest:digest(fs.readFileSync(path.join(workspace,ref.path)))}))};},async execute(input){
  const summaryOnly=input.context.summary_only===true,revised=input.phase==='revise-input'||input.phase==='review'&&observed.some(item=>item.phase==='revise-input'),questionFile=path.join(workspace,`.aidlc/artifacts/${stage}/${stage}-questions.md`),outputs=input.context.artifact_targets.filter(ref=>!ref.id.endsWith('-questions')).map(ref=>path.join(workspace,ref.path));
  const targets=input.context.artifact_targets.filter(ref=>!input.context.approved_summary_basis?.some(approved=>approved.path===ref.path));
  const child=spawnSync(process.execPath,['-e',workerCode],{cwd:workspace,input:JSON.stringify({phase:input.phase,targets,summary:summaryOnly,revised,reply:input.context.operator_questionnaire_reply,questionFile,outputs,initialCells:stage==='intent-capture'?16:2}),encoding:'utf8',timeout:30000});assert.equal(child.status,0,child.stderr);
  const receipt={id:randomUUID(),digest:digest({stdout:child.stdout,stderr:child.stderr,exit_code:child.status}),request_digest:input.request_digest};observed.push({phase:input.phase,summary:summaryOnly,receipt,basis:structuredClone(input.basis),outputs:outputs.filter(fs.existsSync).map(file=>({path:path.relative(workspace,file),digest:digest(fs.readFileSync(file))}))});
  const response={status:'completed',identity:identities.get(input.request_digest),identity_basis:'executor-observed',input_basis:input.basis,receipt};
  return input.phase==='review'?{...response,basis:input.basis,verdict:JSON.parse(child.stdout).verdict,findings:[],artifacts:[]}:{...response,artifacts:input.context.artifact_targets.map(ref=>({path:ref.path,digest:digest(fs.readFileSync(path.join(workspace,ref.path)))}))};
 }};
 const execute=()=>runAidlc({request,executor,authority:authority(),controllerRoot});
 const decide=(pending,{mode='answers',decision='approve',choice='A. Accept assumptions',mutate,skipControlProbe=false}={})=>{
  const input=json(pending.file).payload.input,disposition=input.questionnaire?{questionnaire_reply:{version:'1.0',mode,documents:input.questionnaire.documents.map(doc=>({path:doc.path,answers:Object.fromEntries(doc.cells.filter(cell=>!Object.hasOwn(doc.confirmed_answers??{},cell.id)).map(cell=>[cell.id,cell.value.trim()|| (cell.heading==='Assumption Confirmation'?choice:cell.heading==='Summary Confirmation'&&input.intent_assumptions?'A. Confirm summary':/^Q1[34]\./.test(cell.heading)?`Actual operator follow-up answer for ${cell.heading}`:`Explicit test operator answer for ${cell.heading}`)]))}))}}:undefined;
  if(!skipControlProbe&&decision==='approve'&&input.questionnaire?.documents.some(doc=>Object.keys(doc.choice_constraints??{}).length)){
   const invalid=structuredClone(disposition),doc=input.questionnaire.documents.find(document=>Object.keys(document.choice_constraints??{}).length),cell=Object.keys(doc.choice_constraints)[0];invalid.questionnaire_reply.mode='answers';invalid.questionnaire_reply.documents.find(document=>document.path===doc.path).answers[cell]='A. Accept the actual expanded assumptions instead of the declared control';
   const controlFile=path.join(root,`invalid-control-${randomUUID()}.json`),questionFile=path.join(workspace,doc.path),beforeBytes=fs.readFileSync(questionFile),beforeFiles=fs.readdirSync(path.join(controllerRoot,'authority')).sort(),beforeObserved=structuredClone(observed);fs.writeFileSync(controlFile,JSON.stringify(invalid));
   const rejected=spawnSync(process.execPath,[cli,'decide','--controller-root',controllerRoot,'--pending',pending.file,'--reference','Explicit TEST operator supplied invalid declared choice','--disposition',controlFile],{cwd:consumer,encoding:'utf8',timeout:30000});assert.equal(rejected.status,1);assert.match(rejected.stderr,/Invalid declared choice/);assert.deepEqual(fs.readFileSync(questionFile),beforeBytes);assert.deepEqual(fs.readdirSync(path.join(controllerRoot,'authority')).sort(),beforeFiles);assert.deepEqual(observed,beforeObserved);
  }
  mutate?.(disposition,input);
  if(mode==='edit-files')for(const doc of disposition.questionnaire_reply.documents){const original=input.questionnaire.documents.find(item=>item.path===doc.path);fs.writeFileSync(path.join(workspace,doc.path),fillQuestionnaire(original.original_text,doc.answers));delete doc.answers;}
  const file=path.join(root,`reply-${randomUUID()}.json`);if(disposition)fs.writeFileSync(file,JSON.stringify(disposition));
  const result=spawnSync(process.execPath,[cli,'decide','--controller-root',controllerRoot,'--pending',pending.file,'--reference','Explicit TEST operator answers observed current signed questionnaire','--decision',decision,...(disposition?['--disposition',file]:[])],{cwd:consumer,encoding:'utf8',timeout:30000});if(result.status!==0)result.diagnostic=result.stderr;return {result,input,receipt:result.status===0?JSON.parse(result.stdout).receipt:null};
 };
 return {workspace,controllerRoot,request,observed,execute,decide};
}
for(const mode of ['answers','edit-files','missing','source','artifact','template','tamper','deny']){
 const f=fixture(mode),held=await f.execute();assert.equal(held.status,'waiting');const canonicalBefore=(await loadRun(f.request.run_id,f.controllerRoot)).state;const pending=pendingOf(held),input=json(pending.file).payload.input,doc=input.questionnaire.documents[0],checkpointFile=path.join(f.controllerRoot,'summary-checkpoints','market-research.json'),originalCheckpoint=fs.readFileSync(checkpointFile),originalReceipts=json(checkpointFile).checkpoint.prepared.units.flatMap(unit=>unit.receipts.map(entry=>entry.receipt));
 if(mode==='source')fs.writeFileSync(path.join(f.workspace,'new-source.mjs'),'export const changed=true;');
 if(mode==='artifact'||mode==='template')fs.writeFileSync(path.join(f.workspace,doc.path),doc.original_text.replace('Explicit local fixture scope?',mode==='artifact'?'Changed observed artifact?':'Changed question contract?'));
 const decided=f.decide(pending,{mode:mode==='edit-files'?'edit-files':'answers',decision:mode==='deny'?'deny':'approve',mutate:mode==='missing'?d=>{delete d.questionnaire_reply.documents[0].answers['answer-2'];}:undefined});
 if(['missing','source','artifact','template'].includes(mode)){assert.notEqual(decided.result.status,0);assert.equal(f.observed.length,1);assert.deepEqual((await loadRun(f.request.run_id,f.controllerRoot)).state.transitions,canonicalBefore.transitions);proofs.push({mode,rejected:true});continue;}
 assert.equal(decided.result.status,0,decided.result.stderr);
 if(mode==='tamper'){const receiptFile=path.join(f.controllerRoot,'authority',`${decided.receipt.payload.id}.json`),receipt=json(receiptFile);receipt.payload.disposition.questionnaire_reply.documents[0].text='Forged reply';fs.writeFileSync(receiptFile,JSON.stringify(receipt));}
 const result=await f.execute();assert.equal(result.status,['deny','tamper'].includes(mode)?'waiting':'completed',JSON.stringify(result.failure));assert.equal(f.observed.filter(item=>item.summary).length,1);assert.equal(f.observed.filter(item=>!item.summary).length,['deny','tamper'].includes(mode)?0:1);assert.deepEqual(fs.readFileSync(checkpointFile),originalCheckpoint);assert.deepEqual(json(checkpointFile).checkpoint.prepared.units.flatMap(unit=>unit.receipts.map(entry=>entry.receipt)),originalReceipts);if(['deny','tamper'].includes(mode))assert.deepEqual((await loadRun(f.request.run_id,f.controllerRoot)).state.transitions,canonicalBefore.transitions);if(result.status==='completed')assert.ok(questionnaireCells(fs.readFileSync(path.join(f.workspace,doc.path),'utf8')).every(cell=>cell.value.trim()));proofs.push({mode,status:result.status});
}
for(const choice of ['A. Accept assumptions','B. Convert to follow-up questions'])for(const summary of ['on','off']){
 const name=`intent-${choice[0]}-${summary}`,f=fixture(name,{stage:'intent-capture',summary});let result=await f.execute(),pending=pendingOf(result);assert.equal(result.status,'waiting');assert.equal(json(pending.file).payload.input.questionnaire.documents[0].cells.length,16);
 const initialCheckpoint=fs.readFileSync(path.join(f.controllerRoot,'summary-checkpoints','intent-capture.json'));assert.equal(f.decide(pending,{mode:summary==='off'?'edit-files':'answers'}).result.status,0);result=await f.execute();assert.equal(result.status,'waiting',JSON.stringify(result.failure));assert.equal(f.observed.filter(item=>item.phase==='review').length,0);pending=pendingOf(result);assert.ok(json(pending.file).payload.input.intent_assumptions);const originalAuthorReceipts=f.observed.filter(item=>!item.summary).map(item=>structuredClone(item.receipt));assert.equal(originalAuthorReceipts.length,1);const protectedOutput=json(pending.file).payload.input.basis.find(ref=>ref.path.endsWith('/intent-statement.md'));assert.ok(protectedOutput);const outputFile=path.join(f.workspace,protectedOutput.path),outputBytes=fs.readFileSync(outputFile),priorTransitions=(await loadRun(f.request.run_id,f.controllerRoot)).state.transitions;fs.appendFileSync(outputFile,'\nChanged substantive artifact after pending\n');const stale=f.decide(pending,{choice,skipControlProbe:true});assert.notEqual(stale.result.status,0,'A reply cannot approve substituted substantive artifact bytes');assert.match(stale.result.stderr,/Intent assumption artifact basis changed/);assert.equal(f.observed.filter(item=>item.phase==='review').length,0);assert.deepEqual((await loadRun(f.request.run_id,f.controllerRoot)).state.transitions,priorTransitions);fs.writeFileSync(outputFile,outputBytes);assert.equal(f.decide(pending,{choice}).result.status,0);
 result=await f.execute();if(choice.startsWith('B')){
  assert.equal(result.status,'waiting');const followup=json(pendingOf(result).file).payload.input;assert.equal(followup.purpose,'input-confirmation');assert.equal(followup.questionnaire.documents[0].cells.filter(cell=>!cell.value.trim()).length,2);assert.equal(f.observed.filter(item=>item.phase==='revise-input'||item.phase==='review').length,0);
  assert.equal(f.decide(pendingOf(result)).result.status,0,JSON.stringify(json(pendingOf(result).file).payload.input.intent_assumptions));result=await f.execute();assert.equal(f.observed.filter(item=>item.phase==='revise-input').length,1);
  if(summary==='on'){assert.equal(result.status,'waiting');const consolidated=json(pendingOf(result).file).payload.input;assert.equal(consolidated.purpose,'summary-confirmation');assert.ok(consolidated.intent_assumptions);assert.equal(f.observed.filter(item=>item.phase==='review').length,0);for(const output of ['intent-statement','stakeholder-map'])assert.match(fs.readFileSync(path.join(f.workspace,`.aidlc/artifacts/intent-capture/${output}.md`),'utf8'),/Actual operator follow-up answer/);assert.equal(f.decide(pendingOf(result)).result.status,0,JSON.stringify(json(pendingOf(result).file).payload.input.intent_assumptions));result=await f.execute();}
 }
 for(let interaction=0;result.status!=='completed'&&interaction<5;interaction++){assert.equal(result.status,'waiting',JSON.stringify(result.failure));assert.equal(f.decide(pendingOf(result)).result.status,0,JSON.stringify(json(pendingOf(result).file).payload.input.intent_assumptions));result=await f.execute();}
 assert.equal(result.status,'completed',JSON.stringify(result.failure));assert.equal(f.observed.filter(item=>item.summary).length,1,'Reply resume must not regenerate the nondeterministic questionnaire');assert.equal(f.observed.filter(item=>item.phase==='review').length,1);assert.equal(f.observed.filter(item=>!item.summary&&item.phase!=='review').length,choice.startsWith('B')?2:1);assert.deepEqual(f.observed.filter(item=>!item.summary)[0].receipt,originalAuthorReceipts[0]);assert.deepEqual(fs.readFileSync(path.join(f.controllerRoot,'summary-checkpoints','intent-capture.json')),initialCheckpoint);const retainedReview=json(path.join(f.controllerRoot,'review-checkpoints','intent-capture.json'));const originalObserved=f.observed.find(item=>!item.summary),retainedAuthor=retainedReview.checkpoint.prepared.units.flatMap(unit=>unit.receipts).find(entry=>entry.receipt.id===originalAuthorReceipts[0].id);assert.ok(retainedAuthor,'The original author receipt must remain in durable review history');assert.deepEqual(retainedAuthor.receipt,originalAuthorReceipts[0]);for(const output of originalObserved.outputs)assert.ok(retainedAuthor.artifacts.some(ref=>ref.path===output.path&&ref.digest===output.digest),'Original producer artifact hashes must remain in history after operator derivation');const review=f.observed.find(item=>item.phase==='review');for(const output of review.outputs)assert.ok(review.basis.artifacts.some(ref=>ref.path===output.path&&ref.digest===output.digest));if(choice.startsWith('A'))for(const file of ['intent-statement','stakeholder-map'])assert.match(fs.readFileSync(path.join(f.workspace,`.aidlc/artifacts/intent-capture/${file}.md`),'utf8'),/\[assumption\]/);proofs.push({mode:name,status:result.status,reviewers:1});
}
console.log(JSON.stringify({status:'pass',proof:'clean-installed-questionnaire-public-cli-real-subprocess',model_or_provider_invoked:false,proofs}));
