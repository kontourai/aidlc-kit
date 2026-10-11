import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {buildExecutionPrompt} from '../scripts/authority.mjs';
import { plannedTestCommands } from '../scripts/commands.mjs';

const plan = (command) => `## Planned tests\n\`\`\`sh\n${command}\n\`\`\`\n`;
test('planned tests refuse failure masking, pipelines, backgrounding, redirection and command expansion', () => {
  for (const command of ['node --test missing.test.mjs || true', 'npm test; exit 0', 'pytest | cat', 'go test ./... &', 'cargo test > /tmp/masked', 'npm test $(printf hidden)', 'npm test `printf hidden`', 'node --test "$(printf hidden)"', 'node --test missing.test.mjs && true', 'node --test missing.test.mjs \\', 'node --test "unfinished']) {
    assert.throws(() => plannedTestCommands(plan(command)), /Planned test/, command);
  }
});
test('quoted literal arguments and ordinary supported test invocations preserve their exact commands', () => {
  const commands = ['node --test "tests/some file.test.mjs"', 'npm run test:unit -- --runInBand', 'python3 -m pytest -k "happy or sad"', "pytest -k 'literal;value'", 'cargo test', 'go test ./...', 'dotnet test', 'mvn test', 'node --test missing.test.mjs # comment'];
  for (const command of commands) assert.deepEqual(plannedTestCommands(plan(command)), [command]);
});
test('non-test prose and unfenced commands cannot become host-run checks', () => {
  assert.deepEqual(plannedTestCommands('Run `node --test test/records.test.mjs`.'), []);
  for(const language of ['bash','sh','shell'])assert.deepEqual(plannedTestCommands('```'+language+'\nnode --test test/records.test.mjs\n```\n'), ['node --test test/records.test.mjs']);
  assert.deepEqual(plannedTestCommands('Run npm test later.\nnode --test missing.test.mjs'), []);
  assert.deepEqual(plannedTestCommands(plan('echo pretend pass')), []);
  assert.deepEqual(plannedTestCommands(plan('npm test\nnpm test')), ['npm test']);
});
test('the admitted single test command preserves an actual subprocess failure exit', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aidlc-test-command-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const [command] = plannedTestCommands(plan('node --test missing.test.mjs'));
  const observed = spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', timeout: 10000 });
  assert.equal(observed.error, undefined);
  assert.notEqual(observed.status, 0);
  assert.match(observed.stderr, /missing\.test\.mjs/);
});

test('native planning prompt declares supported fenced test syntax only for writable instructions',()=>{
 const target={id:'unit-test-instructions',path:'.aidlc/tests.md'},dispatch={phase:'inline',role:'fixture',context:{artifact_targets:[target]}};
 const prompt=buildExecutionPrompt({dispatch,workspace:'/workspace',sourceDigest:'source'});assert.ok(prompt.instructions.some(line=>line.includes('inside a fenced bash, sh or shell code block')));assert.ok(prompt.instructions.some(line=>line.includes('Inline code and prose are not executable commands')));
 const approved=buildExecutionPrompt({dispatch:{...dispatch,context:{...dispatch.context,approved_plan_basis:[{...target,digest:'approved'}]}},workspace:'/workspace',sourceDigest:'source'});assert.ok(!approved.instructions.some(line=>line.startsWith('Executable test instructions:')));
 const review=buildExecutionPrompt({dispatch:{...dispatch,phase:'review'},workspace:'/workspace',sourceDigest:'source'});assert.ok(!review.instructions.some(line=>line.startsWith('Executable test instructions:')));
});
