import {validateDefinition} from '@kontourai/flow';
import {compileProfile} from './compile.mjs';
import {effectiveStage} from './ceremony.mjs';

export function boundDefinition(snapshot,profile,runId,projectType,omitted,settings){
  const selected=structuredClone(snapshot);selected.stages=selected.stages.map(stage=>effectiveStage(stage,settings));selected.profiles[profile].stages=selected.profiles[profile].stages.filter(id=>!omitted.has(id));
  const compiled=compileProfile(selected,profile,{projectType});
  for(const [i,step]of compiled.flow.steps.entries()){
    const source=selected.stages.find(s=>s.slug===step.id);const prior=compiled.flow.steps.slice(0,i).map(s=>s.id);
    const artifactDeps=(source.consumes??[]).flatMap(input=>selected.stages.filter(s=>prior.includes(s.slug)&&[...(s.produces??[]),...(s.optional_produces??[])].includes(input.artifact)).slice(-1).map(s=>s.slug));
    step.needs=[...new Set([...(step.needs??[]),...artifactDeps])];
    for(const expectation of compiled.flow.gates[`${step.id}-gate`].expects)expectation.bundle_claim.subjectId=`${runId}/${step.id}`;
  }
  return {flow:validateDefinition(compiled.flow),stageIds:compiled.stages,selectedSnapshot:selected};
}

