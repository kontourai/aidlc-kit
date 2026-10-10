import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {digest} from './compile.mjs';import {readArtifact} from './artifacts.mjs';import {snapshotWorkspace} from './workspace.mjs';
import {questionnaireSubject,materializeQuestionnaireReply,questionnaireContract,questionnaireCells} from './questionnaire-replies.mjs';
import {sealControllerCheckpoint,verifyControllerCheckpoint} from './authority.mjs';import {createPublicationJail} from './publication.mjs';
const section=(text,heading)=>{const lines=text.split(/\r?\n/),at=lines.findIndex(line=>line.trim()===`## ${heading}`);if(at<0)return null;const end=lines.slice(at+1).findIndex(line=>/^## /.test(line));return lines.slice(at+1,end<0?undefined:at+1+end).join('\n').trim();};
const replace=(text,heading,body)=>{const lines=text.split(/\r?\n/),at=lines.findIndex(line=>line.trim()===`## ${heading}`);if(at<0)return text.trimEnd()+`\n\n## ${heading}\n\n${body}\n`;let end=at+1;while(end<lines.length&&!/^## /.test(lines[end]))end++;return [...lines.slice(0,at+1),'',body,'',...lines.slice(end)].join('\n');};
const assumptionQuote=text=>text.split(/\r?\n/).map(line=>/^\s*(?:#{1,6}\s|\[Answer\]:)/.test(line)?`> ${line}`:line).join('\n');
const quote=text=>text.split(/\r?\n/).map(line=>`> ${line}`).join('\n');
const store=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=`${file}.${randomUUID()}.tmp`;fs.writeFileSync(tmp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file);};
/** Pinned intent-capture Step 5 belongs to the standalone methodology kit.
 * Shared dispatch owns bounded continuation/claims; the host owns actual input. */
export function createIntentInputCheckpoint({request,controllerRoot,authority,settings,requestDigest,admission}){
 const checkpoint=async ({stage,unit,artifacts,record})=>{
  if(stage.slug!=='intent-capture')return {status:'accepted'};
  const outputs=['intent-statement','stakeholder-map'].map(id=>artifacts.find(ref=>ref.path.endsWith(`/${id}.md`)));if(outputs.some(ref=>!ref))return {status:'accepted'};
  const question=artifacts.find(ref=>ref.path.endsWith('/intent-capture-questions.md'));if(!question)throw new Error('Intent requires its questions artifact');
  const currentRefs=()=>artifacts.map(ref=>({...ref,digest:readArtifact(request.workspace,ref.path).digest}));
  const source=snapshotWorkspace(request.workspace).source_digest,outputBasis=outputs.map(ref=>({path:ref.path,digest:readArtifact(request.workspace,ref.path).digest})),assumptions=outputs.map(ref=>({...ref,digest:readArtifact(request.workspace,ref.path).digest,text:section(readArtifact(request.workspace,ref.path).text,'Assumptions & Open Questions')}));
  function derive(type,text,original=readArtifact(request.workspace,question.path)){
   const cells=questionnaireCells(text);if(Buffer.byteLength(JSON.stringify({text,cells,confirmed_answers:record.initial_questionnaire_reply?.documents?.flatMap(doc=>doc.answers)??[]}))>40000)throw new Error('Intent questionnaire derivation exceeds bounded operator context');
   const draft={purpose:`intent-${type}`,source_digest:source,admission_digest:digest(admission),artifact_basis:outputBasis,producer_receipts:record.receipts.map(entry=>entry.receipt),original:{path:question.path,digest:original.digest,text:original.text},derived:{path:question.path,digest:digest(text),text}},file=path.join(controllerRoot,'intent-inputs',unit.id,`${digest(draft)}.json`);
   const saved={checkpoint:draft,envelope:sealControllerCheckpoint({controllerRoot,checkpoint:draft})};if(!fs.existsSync(file))store(file,saved);
   const current=readArtifact(request.workspace,question.path);if(current.digest!==draft.derived.digest){if(current.digest!==draft.original.digest)throw new Error('Intent input changed before host derivation');createPublicationJail(request.workspace).preflight([question.path]).write(question.path,Buffer.from(text));}
   return saved;
  }
  function subject(saved,purpose,type){
   const draft=saved.checkpoint,observed=readArtifact(request.workspace,question.path),packet=questionnaireSubject({workspace:request.workspace,basis:[{path:question.path,digest:observed.digest}],producer:draft.producer_receipts,checkpointBinding:digest(draft),admission});
   const doc=packet.documents[0];
   const confirmed={};for(const entry of [...(record.input_transform_history??[]),...(record.before_review?[record.before_review]:[])])if(entry.input&&entry.operator_receipt&&authority.verify(entry.operator_receipt,entry.input))for(const response of entry.operator_reply?.documents??[])if(response.path===question.path)for(const cell of response.answers)confirmed[cell.id]=cell.value;
   // The initial summary operator receipt is supplied in the author context.
   for(const response of record.initial_questionnaire_receipt&&record.initial_questionnaire_subject&&authority.verify(record.initial_questionnaire_receipt,record.initial_questionnaire_subject)?record.initial_questionnaire_reply?.documents??[]:[])if(response.path===question.path)for(const cell of response.answers)confirmed[cell.id]=cell.value;
   Object.assign(doc,{original_text:draft.derived.text,original_digest:draft.derived.digest,contract_digest:digest(questionnaireContract(draft.derived.text)),cells:questionnaireCells(draft.derived.text),confirmed_answers:Object.fromEntries(questionnaireCells(draft.derived.text).filter(cell=>confirmed[cell.id]===cell.value&&cell.value.trim()).map(cell=>[cell.id,cell.value]))});
   return {purpose,run_id:request.run_id,stage:stage.slug,request_digest:requestDigest,source_digest:source,basis:draft.artifact_basis,questionnaire:packet,intent_assumptions:{type,derived_digest:draft.derived.digest,original_digest:draft.original.digest,producer_receipts:draft.producer_receipts,admission_digest:digest(admission)}};
  }
  async function decide(saved,input,type){
   if(!verifyControllerCheckpoint({controllerRoot,checkpoint:saved.checkpoint,envelope:saved.envelope})||saved.checkpoint.source_digest!==source||saved.checkpoint.admission_digest!==digest(admission))throw new Error('Intent input producer/source/visit changed');
   for(const ref of input.basis)if(readArtifact(request.workspace,ref.path).digest!==ref.digest)throw new Error('Intent input artifact subject changed');
   const grant=await authority.authorize(input);if(!grant.authorized||!authority.verify(grant.receipt,input))return {status:'awaiting_input',pending:grant.pending,input,artifacts:currentRefs(),host_derivation:saved,state:{phase:type,input,host_derivation:saved}};
   const reply=materializeQuestionnaireReply({input,receipt:grant.receipt});return {status:'answered',input,authority_reference:grant.reference,operator_receipt:grant.receipt,operator_reply:reply,artifacts:currentRefs(),host_derivation:saved};
  }
  const state=record.input_state;
  if(state?.phase==='followup-answers'){
   const answered=await decide(state.host_derivation,state.input,'followup-answers');if(answered.status==='awaiting_input')return answered;
   return {...answered,status:'revise',state:{phase:'after-followup-revision',operator_reply:answered.operator_reply},revision_context:{operator_questionnaire_reply:answered.operator_reply,approved_summary_basis:answered.operator_reply.documents.map(doc=>({path:doc.path,digest:doc.reply_digest})),intent_assumption_resolution:'The actual operator answered the consecutive follow-ups. Revise BOTH intent artifacts using those exact confirmed Q<n> answers. Preserve question text and all answered cells. Keep unresolved assumptions labelled and never turn acceptance into fact.'}};
  }
  if(state?.phase==='revised-summary'){
   const answered=await decide(state.host_derivation,state.input,'revised-summary');if(answered.status==='awaiting_input')return answered;const answer=answered.operator_reply.documents[0].answers.find(cell=>cell.heading==='Summary Confirmation')?.value;
   if(answer==='B. Request changes'){
    const original=readArtifact(request.workspace,question.path),numbers=[...original.text.matchAll(/^## Q(\d+)\b/gm)].map(match=>Number(match[1])),number=Math.max(0,...numbers)+1;
    const next=derive('change-request-answers',original.text.trimEnd()+`\n\n## Q${number}. What changes should be made to the consolidated intent artifacts?\n\nThe operator requested changes to this exact consolidated summary. Supply the actual requested changes; an unconfirmed proposed change is not an answer.\n\n[Answer]:\n`,original),nextInput=subject(next,'input-confirmation','followup-answers');
    for(const doc of nextInput.questionnaire.documents)for(const previous of answered.operator_reply.documents.filter(item=>item.path===doc.path))for(const cell of previous.answers)if(doc.cells.some(current=>current.id===cell.id&&current.value===cell.value))doc.confirmed_answers[cell.id]=cell.value;
    return {...await decide(next,nextInput,'followup-answers'),prior_operator_observation:answered};
   }
   if(answer!=='A. Confirm summary')throw new Error('Revised intent summary requires one of its exact declared options');
   const remaining=assumptions.some(item=>item.text!==null&&!/^None\.?$/i.test(item.text));
   if(remaining){const next=await checkpoint({stage,unit,artifacts:currentRefs(),record:{...record,input_state:{phase:'summary-resolved'}}});return {...next,prior_operator_observation:answered};}
   return {...answered,status:'accepted',state:{phase:'resolved'},execution_context:{operator_questionnaire_reply:answered.operator_reply,approved_summary_basis:answered.operator_reply.documents.map(doc=>({path:doc.path,digest:doc.reply_digest}))}};
  }
  if(state?.phase==='after-followup-revision'&&settings.summary_confirmation==='on'){
   const original=readArtifact(request.workspace,question.path),body=outputs.map(ref=>`**${path.basename(ref.path)}**\n\n${quote(readArtifact(request.workspace,ref.path).text)}`).join('\n\n')+'\n\nA. Confirm summary\nB. Request changes\n\n[Answer]:',saved=derive('revised-summary',replace(original.text,'Summary Confirmation',body),original),input=subject(saved,'summary-confirmation','revised-summary');return decide(saved,input,'revised-summary');
  }
  const allNone=assumptions.every(item=>item.text!==null&&/^None\.?$/i.test(item.text));
  // Every explicit question cell requires real input, even summary-off mode.
  const original=readArtifact(request.workspace,question.path),blank=questionnaireCells(original.text).filter(cell=>!cell.value.trim());
  if(blank.some(cell=>/^Q\d+\b/.test(cell.heading))&&state?.phase!=='assumption-confirmation'){
   const saved=derive('followup-answers',original.text,original),input=subject(saved,'input-confirmation','followup-answers');return decide(saved,input,'followup-answers');
  }
  // Missing sections remain a structural/reviewer defect, not invented input.
  if(assumptions.some(item=>item.text===null)||allNone)return {status:'accepted',state:{phase:'resolved'}};
  let saved,input;
  if(state?.phase==='assumption-confirmation'){saved=state.host_derivation;input=state.input;}
  else{const body=assumptions.map(item=>`**${path.basename(item.path)}**\n\n${assumptionQuote(item.text)}`).join('\n\n')+'\n\nA. Accept assumptions\nB. Convert to follow-up questions\n\n[Answer]:',draft=derive('assumption-confirmation',replace(original.text,'Assumption Confirmation',body),original);saved=draft;input=subject(saved,'input-confirmation','assumption-confirmation');}
  const answered=await decide(saved,input,'assumption-confirmation');if(answered.status==='awaiting_input')return answered;const answer=answered.operator_reply.documents[0].answers.find(cell=>cell.heading==='Assumption Confirmation')?.value;
  if(answer==='A. Accept assumptions')return {...answered,status:'accepted',state:{phase:'resolved'},execution_context:{operator_questionnaire_reply:answered.operator_reply,approved_summary_basis:answered.operator_reply.documents.map(doc=>({path:doc.path,digest:doc.reply_digest})),input_authority:answered.authority_reference}};
  if(answer!=='B. Convert to follow-up questions')throw new Error('Assumption confirmation requires one of its exact declared options');
  const before=readArtifact(request.workspace,question.path),numbers=[...before.text.matchAll(/^## Q(\d+)\b/gm)].map(match=>Number(match[1]));let number=Math.max(0,...numbers);const prompts=assumptions.filter(item=>!/^None\.?$/i.test(item.text)).map(item=>`## Q${++number}. Clarify the unresolved assumptions from ${path.basename(item.path)}\n\n${assumptionQuote(item.text)}\n\n[Answer]:`),next=derive('followup-answers',before.text.trimEnd()+'\n\n'+prompts.join('\n\n')+'\n',before),nextInput=subject(next,'input-confirmation','followup-answers');for(const doc of nextInput.questionnaire.documents)for(const previous of answered.operator_reply.documents.filter(item=>item.path===doc.path))for(const cell of previous.answers)if(doc.cells.some(current=>current.id===cell.id&&current.value===cell.value))doc.confirmed_answers[cell.id]=cell.value;
  const waiting=await decide(next,nextInput,'followup-answers');return {...waiting,prior_operator_observation:answered};
 };
 return checkpoint;
}
