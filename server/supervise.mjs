/**
 * Keep Mappix Studio's servers running.
 *
 *   node server/supervise.mjs            (or: npm run serve)
 *
 * Starts the three local servers and keeps them up:
 *
 *   cache     server/cache-server.mjs     :8788   open data + world boundaries
 *   accounts  server/account-server.mjs   :8789   sign-in and saved maps
 *   studio    vite (dev server)           :5173   the app
 *
 * A server that exits is restarted (after 2 s, backing off to 60 s if it
 * keeps failing). Every 30 s each one is asked for its health URL; three
 * failures in a row and it is killed and restarted, which catches a process
 * that is alive but no longer answering. Output goes to server/data/logs/.
 *
 * Run at sign-in by the scheduled task that server/autostart.ps1 installs,
 * so the studio is there whenever the computer is. Production deployments use
 * Docker's restart policy instead (docker-compose.yml) and do not need this.
 */

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOGS = join(ROOT, 'server', 'data', 'logs');
mkdirSync(LOGS, { recursive: true });

const NODE = process.execPath;
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

const SERVICES = [
  { name: 'cache', port: 8788, health: 'http://localhost:8788/health', args: [join(ROOT, 'server', 'cache-server.mjs')] },
  { name: 'accounts', port: 8789, health: 'http://localhost:8789/health', args: [join(ROOT, 'server', 'account-server.mjs')] },
  { name: 'studio', port: 5173, health: 'http://localhost:5173/', args: [VITE, '--port', '5173', '--strictPort'] },
];

const CHECK_EVERY_MS = 30_000;
const FAILS_BEFORE_RESTART = 3;

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = createWriteStream(join(LOGS, 'supervisor.log'), { flags: 'a' });
const say = (msg) => { const line = `[${stamp()}] ${msg}`; console.log(line); log.write(`${line}\n`); };

/**
 * Is something already answering on this port (another copy, or a manual
 * start)? Asked by connecting to `localhost`, which covers both IPv4 and
 * IPv6 — Vite listens on IPv6 only, so a 127.0.0.1 probe would miss it.
 */
const portInUse = (port) => new Promise((done) => {
  const sock = connect({ port, host: 'localhost' });
  sock.setTimeout(1500);
  sock.once('connect', () => { sock.destroy(); done(true); });
  sock.once('timeout', () => { sock.destroy(); done(false); });
  sock.once('error', () => done(false));
});

function start(svc) {
  const out = createWriteStream(join(LOGS, `${svc.name}.log`), { flags: 'a' });
  out.write(`\n[${stamp()}] ---- starting ${svc.name} ----\n`);
  const child = spawn(NODE, svc.args, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0' }, windowsHide: true });
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  svc.child = child;
  svc.startedAt = Date.now();
  svc.fails = 0;
  say(`${svc.name} started (pid ${child.pid}) on :${svc.port}`);
  child.on('exit', (code, signal) => {
    if (svc.stopping) return;
    // Quick repeated crashes back off; a long healthy run resets the delay.
    const ranFor = Date.now() - svc.startedAt;
    svc.delay = ranFor > 120_000 ? 2000 : Math.min((svc.delay ?? 1000) * 2, 60_000);
    say(`${svc.name} exited (code ${code ?? signal}); restarting in ${Math.round(svc.delay / 1000)} s`);
    setTimeout(() => start(svc), svc.delay);
  });
}

async function check(svc) {
  if (!svc.child || Date.now() - svc.startedAt < 20_000) return;   // give it time to boot
  try {
    const res = await fetch(svc.health, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    svc.fails = 0;
  } catch (err) {
    svc.fails += 1;
    say(`${svc.name} health check failed (${svc.fails}/${FAILS_BEFORE_RESTART}): ${err.message}`);
    if (svc.fails >= FAILS_BEFORE_RESTART) {
      say(`${svc.name} is not answering — restarting it`);
      svc.fails = 0;
      svc.child.kill();            // the exit handler starts it again
    }
  }
}

say(`Mappix Studio supervisor starting in ${ROOT}`);
for (const svc of SERVICES) {
  if (await portInUse(svc.port)) {
    say(`${svc.name}: port ${svc.port} is already in use — leaving whatever is there alone`);
    continue;
  }
  start(svc);
}
setInterval(() => SERVICES.forEach((svc) => check(svc)), CHECK_EVERY_MS);

const shutdown = () => {
  say('supervisor stopping');
  for (const svc of SERVICES) { svc.stopping = true; svc.child?.kill(); }
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
