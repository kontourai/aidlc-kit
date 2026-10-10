import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,lstatSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const command=(argv,cwd)=>{const r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:600000,maxBuffer:4*1024*1024});assert.equal(r.status,0,`${argv.join(' ')}\n${r.stdout}\n${r.stderr}`);return r.stdout;};
test('npm tarball installs away from source and activates through public kit contracts',()=>{
 const scratch=mkdtempSync(path.join(os.tmpdir(),'aidlc-package-'));
 try{
  const packed=JSON.parse(command(['npm','pack','--ignore-scripts','--json','--pack-destination',scratch],root))[0];
  const tarball=path.join(scratch,packed.filename);const consumer=path.join(scratch,'consumer');mkdirSync(consumer);
  writeFileSync(path.join(consumer,'package.json'),JSON.stringify({name:'clean-consumer',private:true,type:'module'}));
  const runtimeVersion=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).dependencies['@kontourai/flow-agents'];
  const engine=process.env.FLOW_AGENTS_PACKAGE??`@kontourai/flow-agents@${runtimeVersion}`;
  command(['npm','install','--ignore-scripts','--prefer-offline','--no-audit','--no-fund','--package-lock=false',tarball,engine],consumer);
  const kit=path.join(consumer,'node_modules/@kontourai/aidlc-kit');assert.equal(lstatSync(kit).isSymbolicLink(),false);
  const manifest=JSON.parse(readFileSync(path.join(kit,'package.json'),'utf8'));
  assert.deepEqual(manifest.bin,{'kontour-aidlc':'scripts/cli.mjs'});
  assert.match(command([path.join(consumer,'node_modules/.bin/kontour-aidlc'),'--help'],consumer),/kontour-aidlc profiles/);
  assert.equal(manifest.dependencies['@kontourai/flow'],'5.2.0');assert.equal(manifest.dependencies['@kontourai/surface'],'5.0.0');
  command([process.execPath,'scripts/cli.mjs','profiles'],kit);
  command([process.execPath,'--input-type=module','-e',"await import('@kontourai/flow-agents/docker-worker');await import('@kontourai/flow-agents/provider-broker');"],consumer);
  command([process.execPath,'scripts/compile.mjs','--check'],kit);
  command([process.execPath,'evals/public-flow-conformance.mjs'],kit);
  command([process.execPath,'--test','evals/dispatch-checkpoints.test.mjs','evals/review-request-changes.test.mjs','evals/stage-level-construction.test.mjs'],kit);
  const cli=path.join(consumer,'node_modules/@kontourai/flow-agents/build/src/cli.js');const workspace=consumer;
  command([process.execPath,cli,'kit','install',kit,'--dest',workspace],consumer);
  const activation=JSON.parse(command([process.execPath,cli,'kit','activate','--dest',workspace,'--format','json'],consumer));
  const recomposition=JSON.parse(command([process.execPath,path.join(root,'test/installed-recomposition-proof.mjs'),consumer,scratch],consumer));assert.equal(recomposition.status,'pass');assert.equal(recomposition.model_or_provider_invoked,false);
  for(const mode of ['input-source','input-artifact','recomputed-input']){const proof=JSON.parse(command([process.execPath,path.join(root,'test/installed-recomposition-proof.mjs'),consumer,scratch,mode],consumer));assert.equal(proof.status,'pass');assert.equal(proof.mode,mode);}
  const questionnaire=JSON.parse(command([process.execPath,path.join(root,'test/installed-questionnaire-proof.mjs'),consumer,scratch],consumer));assert.equal(questionnaire.status,'pass');assert.equal(questionnaire.model_or_provider_invoked,false);
  assert.ok(activation);const registry=JSON.parse(readFileSync(path.join(workspace,'kits/local/installed-kits.json'),'utf8'));assert.ok(JSON.stringify(registry).includes('aidlc'));
  const requestFile=path.join(scratch,'request.json');writeFileSync(requestFile,JSON.stringify({schema:'kontour.kit.execution_request',version:'1.0',kit_id:'aidlc',workspace,run_id:'package-proof',prompt:'Probe',execution:{max_turns:1,timeout_s:30,model:'probe',runtime:'docker'},engine_sandbox:{}}));
  const probe=spawnSync(process.execPath,[cli,'kit','run','aidlc','--dest',workspace,'--request',requestFile,'--controller-root',path.join(scratch,'private')],{encoding:'utf8'});assert.notEqual(probe.status,0,probe.stderr);assert.match(probe.stderr,/Explicit immutable worker image required/);
  assert.equal(JSON.parse(readFileSync(path.join(workspace,'kits/local/repositories/aidlc/kit.json'),'utf8')).flows.length,11);
 }finally{rmSync(scratch,{recursive:true,force:true});}
});
