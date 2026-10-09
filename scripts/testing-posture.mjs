import fs from 'node:fs';
import path from 'node:path';
import {digest} from './compile.mjs';
import {readArtifact} from './artifacts.mjs';
import {resolveTestingPostureFromSections,renderTestingContract,extractTestingPostureSection,canonicalize,hashObject,structuralMarkdownLines,fenceOpening,closesFence} from './testing-posture-upstream.mjs';
export {resolveTestingPostureFromSections,renderTestingContract};
const LAYERS=['org','team','project'];

/** Registered workspace policy sources; absent defaults are observed explicitly. */
export function resolveTestingContract({workspace,request,snapshot,profile}){
  const parameters=request.parameters??{},configured=parameters.testing_policy??{};
  if(Object.keys(configured).some(key=>!LAYERS.includes(key)))throw new Error('Unknown Testing Posture memory layer');
  const paths=Object.fromEntries(LAYERS.map(layer=>[layer,configured[layer]??`.aidlc/memory/${layer}.md`]));
  const sections={},sources=[];
  for(const layer of LAYERS){
    const file=paths[layer];if(typeof file!=='string'||!file||path.isAbsolute(file)||file.split(/[\\/]/).includes('..'))throw new Error('Testing policy must be workspace-local registered memory paths');
    let observed;
    try{observed=readArtifact(workspace,file);}catch(error){
      if(error.code!=='ENOENT')throw error;
      if(Object.hasOwn(configured,layer))throw new Error(`Configured Testing Posture policy unavailable: ${layer}`);
      sources.push({layer,path:file,status:'absent'});sections[layer]='';continue;
    }
    sections[layer]=extractTestingPostureSection(observed.text);sources.push({layer,path:file,status:'observed',digest:observed.digest,section_digest:digest(sections[layer])});
  }
  const options={scope:(parameters.scope??snapshot.profiles[profile]?.defaults?.scope??profile).trim().toLowerCase(),testStrategy:parameters.test_strategy??'standard',projectType:parameters.project_type??'brownfield'};
  if(!options.scope||!['minimal','standard','comprehensive'].includes(options.testStrategy)||!['greenfield','brownfield'].includes(options.projectType))throw new Error('Invalid registered testing scope, strategy or project type');
  const contract=resolveTestingPostureFromSections(sections,options);
  const policyBasis={schema:'kontour.testing-policy-basis',version:'1.0',upstream_commit:snapshot.upstream.commit,scope:options.scope,test_strategy:options.testStrategy,project_type:options.projectType,sources};
  return {contract,rendered:renderTestingContract(contract),policy_basis:policyBasis,policy_digest:digest(policyBasis),contract_digest:contract.contract_sha256};
}

export function assertTestingPolicyCurrent(expected,input){
  const current=resolveTestingContract(input);
  if(current.policy_digest!==expected.policy_digest||current.contract_digest!==expected.contract_digest)throw new Error('Testing policy or scope changed; current contract and fresh plan approval required');
  return current;
}

/** Read one real Markdown section. Fenced examples/comments cannot supply authority. */
export function readPlanTestingContract(plan){
  const raw=plan.replace(/\r\n/g,'\n').split('\n'),lines=structuralMarkdownLines(plan);let fence=null,start=-1,end=raw.length,count=0;
  for(let index=0;index<lines.length;index++){
    const line=lines[index];if(fence){if(closesFence(line,fence))fence=null;continue;}
    const opening=fenceOpening(line);if(opening){fence=opening;continue;}
    if(line.trimEnd()==='## Testing Contract'){count++;if(start<0)start=index+1;continue;}
    if(start>=0&&end===raw.length&&/^## [^\n]*$/.test(line))end=index;
  }
  if(count!==1)throw new Error('Plan requires exactly one real ## Testing Contract section');
  const body=raw.slice(start,end).join('\n'),blocks=[...body.matchAll(/^ {0,3}```json[ \t]*\n([^]*?)^ {0,3}```[ \t]*$/gm)];
  if(blocks.length!==1)throw new Error('Testing Contract requires exactly one JSON block');
  let contract;try{contract=JSON.parse(blocks[0][1]);}catch{throw new Error('Testing Contract JSON malformed');}
  if(!contract||typeof contract!=='object'||Array.isArray(contract)||contract.version!==1||!/^sha256:[a-f0-9]{64}$/.test(contract.contract_sha256??''))throw new Error('Testing Contract shape invalid');
  const {contract_sha256,...bodyContract}=contract;if(hashObject(bodyContract)!==contract_sha256)throw new Error('Testing Contract content fingerprint mismatch');
  return contract;
}

export function validateTestingPlans({workspace,plans,instructions,resolved,sourceDigest,commandParser}){
  if(!plans.length||!instructions.length)throw new Error('Testing Contract approval requires plan and executable test instructions');
  const fingerprints=[];
  for(const plan of plans){
    const observed=readArtifact(workspace,plan.path),contract=readPlanTestingContract(observed.text);
    if(JSON.stringify(canonicalize(contract))!==JSON.stringify(canonicalize(resolved.contract)))throw new Error('Plan Testing Contract differs from current host-resolved policy');
    const unitInstructions=instructions.filter(instruction=>(instruction.unit??null)===(plan.unit??null));if(!unitInstructions.length)throw new Error('Plan unit has no bound test instructions');
    fingerprints.push({unit:plan.unit??null,plan:{path:plan.path,digest:observed.digest},instructions:unitInstructions.map(instruction=>{const observed=readArtifact(workspace,instruction.path),commands=commandParser?commandParser(observed.text):undefined;if(commandParser&&!commands.length)throw new Error('Unit test instructions contain no executable test command');return {path:instruction.path,digest:observed.digest,...(commands?{commands}:{})};}),testing_contract_digest:resolved.contract_digest,testing_policy_digest:resolved.policy_digest,planned_source_digest:sourceDigest});
  }
  return {schema:'kontour.code-plan-testing-basis',version:'1.0',testing_contract_digest:resolved.contract_digest,testing_policy_digest:resolved.policy_digest,plans:fingerprints,fingerprint:digest(fingerprints)};
}

/** The host may add its own generated block; conflicting model blocks are never blessed. */
export function stampTestingPlan(plan,resolved){
  const lines=structuralMarkdownLines(plan);let fence=null,found=false;
  for(const line of lines){if(fence){if(closesFence(line,fence))fence=null;continue;}const opening=fenceOpening(line);if(opening){fence=opening;continue;}if(line.trimEnd()==='## Testing Contract')found=true;}
  if(found){const current=readPlanTestingContract(plan);if(JSON.stringify(canonicalize(current))!==JSON.stringify(canonicalize(resolved.contract)))throw new Error('Model plan carries a different Testing Contract');return plan;}
  return `${plan.replace(/\s+$/,'')}\n\n${resolved.rendered}`;
}
