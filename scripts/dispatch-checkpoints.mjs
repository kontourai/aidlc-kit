import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest} from './compile.mjs';
import {sealControllerCheckpoint,verifyControllerCheckpoint} from './authority.mjs';
const safe=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,127}$/.test(value);

/** Operator decisions do not reset a gate visit. Canonical reentry/retry does:
 * bind its recorded transitions/outcomes so a rejected producer executes anew. */
/** Rotating verified grant references are transport identities. Their exact
 * artifact/source subjects and registered policy remain bound separately. */
export function checkpointContextBinding(context){
 const bound=structuredClone(context);for(const key of ['source_write_authority','summary_authority_reference','authority_reference'])delete bound.shared?.[key];return bound;
}

export function checkpointRetryIdentity(run){
 return {current_step:run.state.current_step,transitions:run.state.transitions??[],gate_outcomes:run.state.gate_outcomes??[],gate_outcome_history:run.state.gate_outcome_history??[],pending_gate_rechecks:run.state.pending_gate_rechecks??[]};
}

/** Host-sealed observed dispatch, reused only during its exact operator wait.
 * A signature authenticates the retained producer observation; current basis
 * and a separate exact operator grant remain necessary for advancement. */
export function checkpointFile(controllerRoot,kind,stage){if(!safe(kind)||!safe(stage))throw new Error('Invalid retained dispatch identity');return path.join(controllerRoot,`${kind}-checkpoints`,`${stage}.json`);}
export function loadRetainedDispatch({controllerRoot,kind,stage,binding,admission,basis}){
 const file=checkpointFile(controllerRoot,kind,stage),saved=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
 if(saved&&(!verifyControllerCheckpoint({controllerRoot,checkpoint:saved.checkpoint,envelope:saved.envelope})||!['completed','awaiting_decision'].includes(saved.checkpoint.prepared?.status)))throw new Error(`Retained ${kind} checkpoint changed`);
 return saved&&saved.checkpoint.binding===digest({kind,stage,binding,admission})&&digest(basis)===digest(saved.checkpoint.basis)?structuredClone(saved.checkpoint):null;
}
export function saveRetainedDispatch({controllerRoot,kind,stage,binding,admission,basis,dispatch,context}){
 const file=checkpointFile(controllerRoot,kind,stage),checkpoint={binding:digest({kind,stage,binding,admission}),basis,prepared:dispatch,...(context?{context}: {})},record={checkpoint,envelope:sealControllerCheckpoint({controllerRoot,checkpoint})};
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=`${file}.${randomUUID()}.tmp`;fs.writeFileSync(tmp,JSON.stringify(record)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file);
}
export async function retainedDispatch({controllerRoot,kind,stage,binding,admission,observeBasis,execute}){
 let basis=await observeBasis();const saved=loadRetainedDispatch({controllerRoot,kind,stage,binding,admission,basis});
 if(saved)return {dispatch:saved.prepared,basis,replayed:true};
 const dispatch=await execute();basis=await observeBasis();
 if(dispatch.status==='completed')saveRetainedDispatch({controllerRoot,kind,stage,binding,admission,basis,dispatch});
 return {dispatch,basis,replayed:false};
}
