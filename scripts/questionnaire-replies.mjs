import fs from 'node:fs';
import path from 'node:path';
import {createPublicKey,verify} from 'node:crypto';
import {digest} from './compile.mjs';
import {readArtifact} from './artifacts.mjs';
import {snapshotWorkspace} from './workspace.mjs';
import {loadRun} from '@kontourai/flow';
import {checkpointRetryIdentity} from './dispatch-checkpoints.mjs';
import {createPublicationJail} from './publication.mjs';
import {verifyControllerCheckpoint,decisionBindingDigest} from './authority.mjs';
const must=(value,message)=>{if(!value)throw new Error(message);};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

/** Stable answer cells are a document contract, never inferred answers. */
export function questionnaireCells(text){
 must(typeof text==='string'&&Buffer.byteLength(text)<=262144,'Questionnaire exceeds bounded document size');
 const cells=[];let heading='';for(const line of text.split(/\r?\n/)){if(/^#{1,6}\s/.test(line))heading=line.replace(/^#{1,6}\s+/,'');const match=/^[ \t]*\[Answer\]:[ \t]*(.*)$/.exec(line);if(match)cells.push({id:`answer-${cells.length+1}`,heading,value:match[1]});}
 must(cells.length<=128,'Questionnaire exceeds bounded answer inventory');return cells;
}
export function questionnaireContract(text){return text.replace(/^([ \t]*\[Answer\]:)[ \t]*[^\r\n]*/gm,'$1');}
const explicitAnswer=value=>typeof value==='string'&&value.trim()&&value.length<=4096&&!/[\r\n\u0000]/.test(value)&&!/^\s*(?:_+|\[answer\]|<answer>)\s*$/i.test(value);
export function fillQuestionnaire(text,answers,confirmed={}){
 const cells=questionnaireCells(text),keys=Object.keys(answers??{}),required=cells.filter(cell=>!Object.hasOwn(confirmed,cell.id));must(answers&&typeof answers==='object'&&!Array.isArray(answers)&&required.every(cell=>keys.includes(cell.id))&&keys.every(key=>cells.some(cell=>cell.id===key)),'Questionnaire reply must answer the exact cell inventory');
 let index=0;return text.replace(/^([ \t]*\[Answer\]:)[ \t]*[^\r\n]*/gm,(_line,prefix)=>{const cell=cells[index++],answer=answers[cell.id]??confirmed[cell.id];must(!Object.hasOwn(confirmed,cell.id)||answer===confirmed[cell.id],'Reply changed previously confirmed answer cells');must(explicitAnswer(answer),'Explicit bounded questionnaire answer required');return `${prefix} ${answer}`;});
}
export function questionnaireSubject({workspace,basis,producer,checkpointBinding,admission}){
 createPublicationJail(workspace).preflight(basis.map(ref=>ref.path));
 const documents=basis.map(ref=>{const observed=readArtifact(workspace,ref.path);must(observed.digest===ref.digest,'Questionnaire producer basis changed');const cells=questionnaireCells(observed.text);return {path:ref.path,original_digest:ref.digest,original_text:observed.text,contract_digest:digest(questionnaireContract(observed.text)),confirmed_answers:{},cells};}).filter(document=>document.cells.length);
 must(Buffer.byteLength(JSON.stringify(documents))<=49152,'Questionnaire aggregate subject exceeds bounded operator context');
 return documents.length?{version:'1.0',workspace:fs.realpathSync(workspace),workspace_identity:(()=>{const stat=fs.lstatSync(fs.realpathSync(workspace));return `${stat.dev}:${stat.ino}`;})(),producer_digest:digest(producer),checkpoint_binding:checkpointBinding,admission_digest:digest(admission),documents}:undefined;
}
/** Only a host-declared control cell has an enum. Ordinary questionnaire
 * answers remain free-form. Control values are exact declared strings. */
function questionnaireChoiceConstraints(document){
 const constraints=document.choice_constraints??{},required=document.required_choice_cells??[];
 must(constraints&&typeof constraints==='object'&&!Array.isArray(constraints),'Malformed questionnaire choice constraints');
 must(Array.isArray(required)&&new Set(required).size===required.length&&required.every(id=>document.cells.some(cell=>cell.id===id)&&Object.hasOwn(constraints,id)),'Required questionnaire control choice constraint missing');
 for(const [id,constraint]of Object.entries(constraints)){
  must(document.cells.some(cell=>cell.id===id)&&constraint&&typeof constraint==='object'&&!Array.isArray(constraint)&&Object.keys(constraint).every(key=>key==='values')&&Array.isArray(constraint.values)&&constraint.values.length>0&&constraint.values.length<=16&&new Set(constraint.values).size===constraint.values.length&&constraint.values.every(explicitAnswer),'Malformed questionnaire control choice');
 }
 return constraints;
}
export function validateQuestionnaireChoices(document,text,submittedAnswers){
 const constraints=questionnaireChoiceConstraints(document),cells=questionnaireCells(text),lines=text.split(/\r?\n/).filter(line=>/^[ \t]*\[Answer\]:/.test(line));
 for(const [id,constraint]of Object.entries(constraints)){
  const cell=cells.find(cell=>cell.id===id),index=cells.findIndex(cell=>cell.id===id),line=lines[index],raw=/^[ \t]*\[Answer\]:(.*)$/.exec(line??'')?.[1],canonicalRaw=raw?.startsWith(' ')?raw.slice(1):raw;
  must(cell&&constraint.values.includes(cell.value)&&constraint.values.includes(canonicalRaw)&&(!submittedAnswers||!Object.hasOwn(submittedAnswers,id)||constraint.values.includes(submittedAnswers[id])),`Invalid declared choice for ${id} (${cell?.heading??id})`);
 }
}
function validateCurrentSubject(input){
 const subject=input.questionnaire;must(subject?.version==='1.0'&&Array.isArray(subject.documents)&&subject.documents.length>0&&subject.documents.length<=128,'Invalid questionnaire subject');
 const stat=fs.lstatSync(subject.workspace);must(!stat.isSymbolicLink()&&stat.isDirectory()&&`${stat.dev}:${stat.ino}`===subject.workspace_identity,'Questionnaire workspace custody changed');createPublicationJail(subject.workspace).preflight(subject.documents.map(doc=>doc.path));
 must(snapshotWorkspace(subject.workspace).source_digest===input.source_digest,'Questionnaire source basis changed');
 if(input.intent_assumptions)for(const ref of input.basis){must(readArtifact(subject.workspace,ref.path).digest===ref.digest,'Intent assumption artifact basis changed');}
 for(const doc of subject.documents){must(digest(doc.original_text)===doc.original_digest&&digest(questionnaireContract(doc.original_text))===doc.contract_digest&&digest(questionnaireCells(doc.original_text))===digest(doc.cells),'Questionnaire original contract changed');const current=readArtifact(subject.workspace,doc.path);must(questionnaireContract(current.text)===questionnaireContract(doc.original_text),'Questionnaire edits changed protected question text or answer inventory');}
 return subject;
}
/** Existing decide --disposition intake. Both Chat/Guide Me answers and Edit
 * File use the same exact signed subject; approval is not an answer. */
export function intakeQuestionnaireReply({input,disposition}){
 const subject=validateCurrentSubject(input),reply=disposition?.questionnaire_reply;
 must(reply?.version==='1.0'&&['answers','edit-files'].includes(reply.mode),'Explicit questionnaire_reply required for answered-input approval');
 must(Object.keys(reply).every(key=>['version','mode','documents'].includes(key))&&Array.isArray(reply.documents)&&reply.documents.length===subject.documents.length,'Questionnaire reply document inventory changed');
 const documents=subject.documents.map(doc=>{const selected=reply.documents.filter(item=>item.path===doc.path);must(selected.length===1,'Questionnaire reply has unknown or duplicate document');const item=selected[0];must(Object.keys(item).every(key=>['path','answers'].includes(key)),'Unknown questionnaire reply field');
  const text=reply.mode==='answers'?fillQuestionnaire(doc.original_text,item.answers,doc.confirmed_answers):readArtifact(subject.workspace,doc.path).text;
  validateQuestionnaireChoices(doc,text,reply.mode==='answers'?item.answers:undefined);
  must(questionnaireContract(text)===questionnaireContract(doc.original_text)&&questionnaireCells(text).every(cell=>explicitAnswer(cell.value)),'Every required answer cell must be explicitly completed');
  must([doc.original_digest,digest(text)].includes(readArtifact(subject.workspace,doc.path).digest),'Questionnaire answer edits conflict with this exact reply');
  must(Object.entries(doc.confirmed_answers??{}).every(([id,value])=>questionnaireCells(text).find(cell=>cell.id===id)?.value===value),'Reply changed previously confirmed answer cells');
  return {path:doc.path,original_digest:doc.original_digest,reply_digest:digest(text),text,answers:questionnaireCells(text)};
 });
 must(reply.documents.every(item=>subject.documents.some(doc=>doc.path===item.path)),'Unknown questionnaire reply document');
 must(Buffer.byteLength(JSON.stringify(documents))<=49152,'Questionnaire aggregate reply exceeds bounded operator context');
 return {...disposition,questionnaire_reply:{version:'1.0',source_digest:input.source_digest,producer_digest:subject.producer_digest,documents}};
}
export function materializeQuestionnaireReply({input,receipt}){
 const subject=validateCurrentSubject(input),reply=receipt.payload.disposition?.questionnaire_reply;must(receipt.payload.decision==='approve'&&reply?.version==='1.0'&&reply.source_digest===input.source_digest&&reply.producer_digest===subject.producer_digest,'Questionnaire reply is not an exact approved host observation');
 must(reply.documents.length===subject.documents.length,'Questionnaire reply inventory changed');
 const publication=createPublicationJail(subject.workspace).preflight(reply.documents.map(doc=>doc.path));
 for(const doc of reply.documents){const original=subject.documents.find(item=>item.path===doc.path);must(original&&doc.original_digest===original.original_digest&&digest(doc.text)===doc.reply_digest&&questionnaireContract(doc.text)===questionnaireContract(original.original_text)&&questionnaireCells(doc.text).every(cell=>explicitAnswer(cell.value)),'Questionnaire reply contract or digest changed');validateQuestionnaireChoices(original,doc.text);const current=readArtifact(subject.workspace,doc.path);must([original.original_digest,doc.reply_digest].includes(current.digest),'Questionnaire answer basis changed after operator decision');}
 for(const doc of reply.documents)if(readArtifact(subject.workspace,doc.path).digest!==doc.reply_digest)publication.write(doc.path,Buffer.from(doc.text));
 return reply;
}
/** Recover an exact pending subject against its host-sealed producer. Edited
 * answer cells hold dispatch, including before decide; they are never erased
 * by regenerating the questions worker. */
export function retainedQuestionnaire({controllerRoot,kind,stage,binding,admission,workspace,authority,requestDigest,purpose='summary-confirmation'}){
 const file=path.join(controllerRoot,`${kind}-checkpoints`,`${stage}.json`);if(!fs.existsSync(file))return null;const saved=read(file);
 must(verifyControllerCheckpoint({controllerRoot,checkpoint:saved.checkpoint,envelope:saved.envelope}),`Retained ${kind} checkpoint changed`);
 const expected=digest({kind,stage,binding,admission});if(saved.checkpoint.binding!==expected)return null;
 const root=path.join(controllerRoot,'authority/pending');if(!fs.existsSync(root))return null;const key=createPublicKey(fs.readFileSync(path.join(controllerRoot,'authority/host-public-key.pem')));
 for(const name of fs.readdirSync(root).filter(name=>name.endsWith('.json'))){const pending=read(path.join(root,name));must(verify(null,Buffer.from(JSON.stringify(pending.payload)),key,Buffer.from(pending.signature??'','base64')),'Questionnaire pending signature changed');const input=pending.payload?.input,subject=input?.questionnaire;
  if(input?.purpose!==purpose||input.stage!==stage||input.request_digest!==requestDigest||!subject)continue;
  if(subject.checkpoint_binding!==expected||subject.admission_digest!==digest(admission)||subject.producer_digest!==digest(saved.checkpoint.prepared)||subject.workspace!==fs.realpathSync(workspace))continue;
  must(input.source_digest===snapshotWorkspace(workspace).source_digest,'Questionnaire source changed before operator reply');
  must(subject.documents.every(doc=>saved.checkpoint.basis.some(ref=>ref.path===doc.path&&ref.digest===doc.original_digest)),'Questionnaire subject differs from observed producer');validateCurrentSubject(input);
  return {input,dispatch:saved.checkpoint.prepared,basis:saved.checkpoint.basis};
 }
 return null;
}

export function verifiedQuestionnaireDecision({input,authority,controllerRoot}){
 const root=path.join(controllerRoot,'authority'),matched=fs.readdirSync(root).filter(name=>name.endsWith('.json')&&!name.endsWith('.input.json')).map(name=>read(path.join(root,name))).filter(receipt=>receipt.payload?.kind==='controller-decision'&&receipt.payload.request_digest===input.request_digest&&receipt.payload.input_digest===decisionBindingDigest(input)&&authority.verify(receipt,input));if(matched.some(receipt=>receipt.payload.decision==='deny'))return {denied:true};const receipt=matched.find(receipt=>receipt.payload.decision==='approve'&&receipt.payload.disposition?.questionnaire_reply);return receipt?{receipt}:null;
}
/** A pending before-review reply may transform only its sealed questionnaire
 * cells. Its author/reviewer cache still authenticates the original receipts. */
export function questionnaireOverlayBasis({controllerRoot,checkpoint,basis,authority}){
 if(!Array.isArray(basis)||basis.length!==checkpoint.basis.length||new Set(basis.map(ref=>ref.path)).size!==basis.length||digest(basis.map(ref=>ref.path).sort())!==digest(checkpoint.basis.map(ref=>ref.path).sort()))return null;
 const waiting=checkpoint.prepared.units.filter(record=>record.continuation?.phase==='before-review');if(!waiting.length)return null;
 const replaced=new Map();for(const record of waiting){const input=record.before_review?.input;if(!input?.questionnaire)return null;const decision=verifiedQuestionnaireDecision({input,authority,controllerRoot});if(!decision?.receipt)return null;const reply=materializeQuestionnaireReply({input,receipt:decision.receipt});for(const doc of reply.documents)replaced.set(doc.path,{original:doc.original_digest,derived:doc.reply_digest});}
 for(const ref of basis){const old=checkpoint.basis.find(item=>item.path===ref.path),change=replaced.get(ref.path);if(!old||ref.digest!==old.digest&&(!change||change.original!==old.digest||change.derived!==ref.digest))return null;}
 return checkpoint.basis;
}

export function validateQuestionnaireProducer({input,controllerRoot}){
 const subject=input.questionnaire;let observed=false;
 if(input.intent_assumptions){const root=path.join(controllerRoot,'intent-inputs');const visit=dir=>{for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),stat=fs.lstatSync(file);must(!stat.isSymbolicLink(),'Questionnaire producer custody contains symlink');if(stat.isDirectory())visit(file);else if(name.endsWith('.json')){const saved=read(file);if(digest(saved.checkpoint)===subject.checkpoint_binding&&verifyControllerCheckpoint({controllerRoot,checkpoint:saved.checkpoint,envelope:saved.envelope})&&digest(saved.checkpoint.producer_receipts)===subject.producer_digest)observed=true;}}};must(fs.existsSync(root),'Questionnaire producer observation missing');visit(root);}
 else{const file=path.join(controllerRoot,'summary-checkpoints',`${input.stage}.json`);must(fs.existsSync(file),'Questionnaire producer observation missing');const saved=read(file);observed=saved.checkpoint.binding===subject.checkpoint_binding&&digest(saved.checkpoint.prepared)===subject.producer_digest&&verifyControllerCheckpoint({controllerRoot,checkpoint:saved.checkpoint,envelope:saved.envelope});}
 must(observed,'Questionnaire producer signature or exact binding changed');
}
export async function validateQuestionnaireVisit({input,controllerRoot}){must(typeof input.run_id==='string','Questionnaire lacks canonical run identity');validateQuestionnaireProducer({input,controllerRoot});const run=await loadRun(input.run_id,controllerRoot);must(run.state.status==='active'&&run.state.current_step===input.stage&&digest(checkpointRetryIdentity(run))===input.questionnaire.admission_digest,'Questionnaire Flow visit changed before operator interaction');}
