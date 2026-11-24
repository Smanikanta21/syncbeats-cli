import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('packed CLI includes compiled code and starts its help/version commands', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'syncbeats-pack-'));
  try {
    const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', temp], { encoding: 'utf8', timeout: 30000 });
    assert.equal(packed.status, 0, packed.stderr);
    const artifact = JSON.parse(packed.stdout)[0];
    assert.ok(artifact.files.some(file => file.path === 'dist/index.js'));
    assert.ok(!artifact.files.some(file => /^(music|tests|node_modules)\//.test(file.path)));
    const unpacked = spawnSync('tar', ['-xzf', path.join(temp, artifact.filename), '-C', temp]); assert.equal(unpacked.status, 0);
    const bin = path.join(temp, 'package/bin/index.js');
    const version = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' }); assert.equal(version.status, 0); assert.equal(version.stdout.trim(), '1.0.1');
    const help = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' }); assert.equal(help.status, 0); assert.match(help.stdout, /Node.js 22/);
    assert.equal(spawnSync(process.execPath, [bin, '--bad-option']).status, 1);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
