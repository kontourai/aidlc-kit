import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const cli=(...args)=>spawnSync(process.execPath,[new URL('../scripts/cli.mjs',import.meta.url).pathname,...args],{encoding:'utf8'});
const USAGE_EXIT=2;

for(const [name,args,message] of [
 ['run without arguments',['run'],/^kontour-aidlc: Usage: kontour-aidlc run --request /],
 ['decide without --pending and --reference',['decide','--controller-root','unused'],/^kontour-aidlc: Usage: kontour-aidlc decide /],
 ['decisions without --controller-root',['decisions'],/^kontour-aidlc: Usage: kontour-aidlc decisions /],
 ['recompose without arguments',['recompose'],/^kontour-aidlc: Usage: kontour-aidlc recompose /],
 ['revise-input without arguments',['revise-input'],/^kontour-aidlc: Usage: kontour-aidlc revise-input /],
 ['recover-controller without arguments',['recover-controller'],/^kontour-aidlc: Usage: kontour-aidlc recover-controller /],
 ['an unknown command',['bogus'],/^kontour-aidlc: Unknown command: bogus\nUsage: kontour-aidlc profiles /],
])test(`kontour-aidlc reports ${name} as a usage error without a stack trace`,()=>{
 const result=cli(...args);
 assert.equal(result.status,USAGE_EXIT,result.stderr);
 assert.match(result.stderr,message);
 assert.doesNotMatch(result.stderr,/\n\s+at |Node\.js v|throw new Error/);
 assert.equal(result.stdout,'');
});

test('kontour-aidlc help still prints usage to stdout and exits 0',()=>{
 for(const args of [[],['help'],['--help']]){
  const result=cli(...args);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/^kontour-aidlc profiles \| check /);
 }
});
