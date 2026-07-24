#!/usr/bin/env node
/**
 * Punto de entrada `npm start`.
 * En Render delega en render-start.sh (disco /data, e-fact, comprobaciones).
 * En local ejecuta server/index.js directamente.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const isRender = String(process.env.RENDER || '').toLowerCase() === 'true';

function run(cmd, args, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  process.exit(typeof result.status === 'number' ? result.status : 1);
}

if (isRender) {
  run('bash', [path.join(root, 'scripts', 'render-start.sh')]);
}

run(process.execPath, [path.join(root, 'server', 'index.js')], { _RENDER_START_WRAPPER: '1' });
