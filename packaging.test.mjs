import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, copyFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

test('Docker copies every module needed to start the import server', async () => {
    const dockerfile = await readFile(path.join(root, 'Dockerfile'), 'utf8');
    const files = [...dockerfile.matchAll(/^COPY\s+(.+?)\s+\.\/\s*$/gm)]
        .flatMap(match => match[1].split(/\s+/)).filter(file => file.endsWith('.mjs'));
    assert.ok(files.includes('server.mjs'), 'Container entry point must be copied');
    const stage = await mkdtemp(path.join(tmpdir(), 'pinterest-container-check-'));
    try {
        for (const file of files) await copyFile(path.join(root, file), path.join(stage, file));
        await symlink(path.join(root, 'node_modules'), path.join(stage, 'node_modules'), 'dir');
        // Import the HTTP application from only the files copied into the image.
        // This resolves all its dependencies without launching Chromium or a listener.
        const result = spawnSync(process.execPath, ['--input-type=module', '-e',
            "await import('./app.mjs')"], { cwd: stage, encoding: 'utf8', timeout: 10_000 });
        assert.equal(result.status, 0, result.stderr || String(result.error));
    } finally {
        await rm(stage, { recursive: true, force: true });
    }
});
