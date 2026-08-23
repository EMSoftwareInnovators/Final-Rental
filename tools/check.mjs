/* Runs every automated check: renderer orientation, a gameplay soak, and a
   real-input playthrough. Boots its own static server. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const run = (cmd, args) => new Promise((res) => {
  const p = spawn(cmd, args, { stdio: 'inherit' });
  p.on('exit', (code) => res(code || 0));
});

const server = spawn(process.execPath, ['serve.cjs'], { stdio: 'ignore', env: { ...process.env, PORT: '8080' } });
await new Promise((r) => setTimeout(r, 700));

let failed = 0;
for (const t of ['tools/uvtest.mjs', 'tools/soak.mjs', 'tools/playthrough.mjs']) {
  console.log(`\n===== ${t} =====`);
  failed += await run(process.execPath, [t]);
}
server.kill();
console.log(failed ? '\nCHECKS FAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
