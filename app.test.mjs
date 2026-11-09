import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createImportServer } from './app.mjs';
import { ImportError } from './extractor.mjs';

async function withServer(extract, run) {
    const server = createImportServer({ extract });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (body, path = '/api/pinterest/import', contentType = 'application/json') =>
        fetch(base + path, { method: 'POST', headers: { 'Content-Type': contentType }, body });
    try { await run(post, base); }
    finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

test('HTTP validation rejects invalid and oversized inputs before invoking Chromium', async () => {
    let calls = 0;
    await withServer(async () => { calls++; }, async (post, base) => {
        assert.equal((await fetch(base + '/health')).status, 200);
        for (const [body, status, type] of [
            ['not-json', 400], ['null', 400], ['{"url":3}', 400],
            ['{"url":"https://127.0.0.1/"}', 400],
            ['{"url":"https://pin.it/abc"}', 415, 'text/plain'],
            [JSON.stringify({ url: 'https://pin.it/abc', padding: 'x'.repeat(4096) }), 413],
        ]) {
            const response = await post(body, '/api/pinterest/import', type);
            assert.equal(response.status, status);
            assert.ok((await response.json()).error);
        }
        assert.equal(calls, 0);
    });
});

test('both endpoint paths return the selected images without caching them', async () => {
    const result = { count: 1, expectedCount: 1, images: [{ pinId: '123' }] };
    await withServer(async url => {
        assert.equal(url, 'https://pin.it/abc');
        return result;
    }, async post => {
        for (const path of ['/extract', '/api/pinterest/import']) {
            const response = await post('{"url":"https://pin.it/abc"}', path);
            assert.equal(response.status, 200);
            assert.equal(response.headers.get('cache-control'), 'no-store');
            assert.deepEqual(await response.json(), result);
        }
    });
});

test('concurrent imports are rejected and capacity is released after completion', async () => {
    let started;
    let finish;
    const entered = new Promise(resolve => { started = resolve; });
    const completed = new Promise(resolve => { finish = resolve; });
    await withServer(async () => {
        started();
        await completed;
        return { count: 3 };
    }, async post => {
        const first = post('{"url":"https://pin.it/abc"}');
        await entered;
        const second = await post('{"url":"https://pin.it/abc"}');
        assert.equal(second.status, 429);
        assert.equal(second.headers.get('retry-after'), '5');
        finish();
        assert.equal((await first).status, 200);
        assert.equal((await post('{"url":"https://pin.it/abc"}')).status, 200);
    });
});

test('unavailable selection errors stay explicit and do not poison the next import', async () => {
    await withServer(async () => {
        throw new ImportError(422, 'incomplete_selection', 'Nothing was imported.');
    }, async post => {
        for (let attempt = 0; attempt < 2; attempt++) {
            const response = await post('{"url":"https://pin.it/abc"}');
            assert.equal(response.status, 422);
            assert.equal((await response.json()).error, 'incomplete_selection');
        }
    });
});
