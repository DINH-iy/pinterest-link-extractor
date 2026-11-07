import http from 'node:http';
import { extractSelection, ImportError, validateShareUrl } from './extractor.mjs';

function readJson(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let length = 0;
        let rejected = false;
        request.on('data', chunk => {
            if (rejected) return;
            length += chunk.length;
            if (length > 4096) {
                rejected = true;
                reject(new ImportError(413, 'request_too_large', 'Request bodies are limited to 4 KiB.'));
            } else chunks.push(chunk);
        });
        request.on('end', () => {
            if (rejected) return;
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch { reject(new ImportError(400, 'invalid_json', 'Supply a JSON object containing url.')); }
        });
        request.on('error', reject);
    });
}

export function createImportServer({ extract = extractSelection } = {}) {
    let busy = false;
    const server = http.createServer(async (request, response) => {
        const send = (status, body) => {
            if (response.destroyed) return;
            response.writeHead(status, {
                'Content-Type': 'application/json', 'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
                ...(status === 429 ? { 'Retry-After': '5' } : {}),
            });
            response.end(JSON.stringify(body));
        };
        if (request.method === 'GET' && request.url === '/health') return send(200, { status: 'ok' });
        if (request.method !== 'POST' || !['/api/pinterest/import', '/extract'].includes(request.url)) {
            return send(404, { error: 'not_found' });
        }
        if (busy) return send(429, { error: 'busy', message: 'Another import is running. Try again shortly.' });
        if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
            return send(415, { error: 'json_required', message: 'Use Content-Type: application/json.' });
        }
        busy = true;
        try {
            const body = await readJson(request);
            const url = validateShareUrl(body?.url);
            send(200, await extract(url, {includeVideos:body.includeVideos===true,acceptBoards:body.acceptBoards===true}));
        } catch (error) {
            if (error instanceof ImportError) send(error.status, { error: error.code, message: error.message });
            else {
                console.error('Pinterest extraction failed:', error.name);
                send(502, { error: 'extraction_failed', message: 'Pinterest could not be read. Try again later.' });
            }
        } finally { busy = false; }
    });
    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    return server;
}
