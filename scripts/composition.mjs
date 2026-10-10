import {compileProfile,digest} from './compile.mjs';

/** Compose only installed, pinned methodology stages; Flow remains the engine. */
export function resolveComposition(snapshot,parameters={}) {
  const proposal=parameters.composition;
  const base=parameters.profile??(proposal?'classic':'feature');
  if(!Object.hasOwn(snapshot.profiles,base))throw new Error('Unknown profile');
  if(proposal===undefined)return {snapshot,profile:base,composition:null};
  if(!proposal||typeof proposal!=='object'||Array.isArray(proposal)||Object.keys(proposal).some(key=>!['name','add','skip','strict_inputs'].includes(key)))throw new Error('Invalid profile composition');
  if(typeof proposal.name!=='string'||! /^[a-z0-9][a-z0-9-]{0,63}$/.test(proposal.name))throw new Error('Composition needs a safe name');
  if(proposal.strict_inputs!==undefined&&typeof proposal.strict_inputs!=='boolean')throw new Error('strict_inputs must be boolean');
  const inventory=new Map(snapshot.stages.map((stage,index)=>[stage.slug,{stage,index}]));
  const list=key=>{const value=proposal[key]??[];if(!Array.isArray(value)||value.length>inventory.size||new Set(value).size!==value.length||value.some(id=>!inventory.has(id)))throw new Error(`Invalid composition ${key}`);return value;};
  const add=list('add'),skip=list('skip'),baseline=new Set(snapshot.profiles[base].stages);
  if(add.some(id=>skip.includes(id)||baseline.has(id))||skip.some(id=>!baseline.has(id)))throw new Error('Composition changes conflict with base');
  if(['workspace-scaffold','workspace-detection','state-init'].some(id=>skip.includes(id)))throw new Error('Composition cannot skip initialization');
  const projectType=parameters.project_type??'brownfield';
  if(!['brownfield','greenfield'].includes(projectType))throw new Error('Invalid composition project type');
  if(projectType==='greenfield'&&add.includes('reverse-engineering'))throw new Error('Greenfield cannot add reverse-engineering');
  const selected=new Set([...baseline].filter(id=>!skip.includes(id)&&!(projectType==='greenfield'&&id==='reverse-engineering')).concat(add));
  const dependencies=new Map(),advisories=[];
  for(const id of selected){
    const {stage,index}=inventory.get(id),deps=new Set((stage.requires_stage??[]).filter(dep=>selected.has(dep)));
    for(const input of stage.consumes??[]){
      if(input.conditional_on&&input.conditional_on!==projectType)continue;
      const producers=snapshot.stages.filter(candidate=>candidate.slug!==id&&[...(candidate.produces??[]),...(candidate.optional_produces??[])].includes(input.artifact));
      if(input.required&&!producers.length)throw new Error(`No producer for ${id}/${input.artifact}`);
      const producer=producers.filter(candidate=>selected.has(candidate.slug)&&inventory.get(candidate.slug).index<index).at(-1);
      if(producer)deps.add(producer.slug);
      else if(input.required){const finding={stage:id,artifact:input.artifact,reason:'producer_off_path'};if(proposal.strict_inputs)throw new Error(`Required producer off path: ${id}/${input.artifact}`);advisories.push(finding);}
    }
    dependencies.set(id,deps);
  }
  const stages=[],remaining=new Set(selected);
  while(remaining.size){const ready=[...remaining].filter(id=>[...dependencies.get(id)].every(dep=>!remaining.has(dep))).sort((a,b)=>inventory.get(a).index-inventory.get(b).index)[0];if(!ready)throw new Error('Composition stage dependency cycle');stages.push(ready);remaining.delete(ready);}
  const derived=structuredClone(snapshot),profile=`custom.${proposal.name}`;
  derived.profiles[profile]={...structuredClone(snapshot.profiles[base]),stages,defaults:{...snapshot.profiles[base].defaults,scope:snapshot.profiles[base].defaults.scope??base}};
  const compiled=compileProfile(derived,profile,{projectType});
  return {snapshot:derived,profile,composition:{version:'1.0',name:proposal.name,base,stages,advisories,strict_inputs:proposal.strict_inputs??false,definition_digest:digest(compiled.flow)}};
}
