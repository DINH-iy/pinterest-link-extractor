import { createImportServer } from './app.mjs';

const port = Number(process.env.PORT ?? 3100);
const server = createImportServer();
server.listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`Pinterest importer listening on ${port}`));
