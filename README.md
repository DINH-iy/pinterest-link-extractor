# Pinterest link extractor

A small self-hosted HTTP service that turns a **public Pinterest board or multi-pin share link**
into photo and video metadata for a sticker maker.
Runs independently of the sticker app, on a 64-bit Raspberry Pi with Docker and Chromium.

No Pinterest login, client secret, or OAuth app is needed. The service uses a fresh signed-out
browser context per request and does not store the images. It reads public Pinterest pages;
this is not an official Pinterest API integration, and page changes can break extraction.

## Run on the Pi

From this project's directory:

```bash
docker compose up -d --build
curl --fail http://127.0.0.1:8080/health
```

The health endpoint checks the HTTP process. Test an import to verify that Chromium and
Pinterest access work. Logs: `docker compose logs --tail=60`. Stop: `docker compose down`.
Use `sudo docker ...` if your account does not have Docker permission.

The service binds only to the Pi's loopback address. Run `cloudflared` on the Pi host and
route `stickers.dinnyvanhuizen.com` to **HTTP `localhost:8080`** using Cloudflare Tunnel.
Leave that hostname publicly accessible for native app requests. No router port forwarding
is needed. A tunnel running inside a different container needs a Docker-network service
address instead. Choose another loopback port in `compose.yml` if 8080 is already occupied.

Docker installs Debian's ARM64 Chromium package when built on a 64-bit Pi. One extraction
runs at a time, with a 45-second extraction deadline after browser launch. The container
has a 1 GiB memory limit. It has no persistent data volume or shared login session.

## API

```bash
curl --fail-with-body http://127.0.0.1:8080/api/pinterest/import \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://pin.it/3b1AO6JOq"}'
```

After routing the tunnel, use:

```text
https://stickers.dinnyvanhuizen.com/api/pinterest/import
```

The legacy `POST /extract` route accepts the same request for compatibility with the
sticker app's .NET backend. This standalone service does not need that .NET backend.

Response shape:

```json
{
  "sourceUrl": "https://www.pinterest.com/multi-pin-share/123/",
  "expectedCount": 2,
  "count": 2,
  "images": [
    {
      "pinId": "111",
      "pinUrl": "https://www.pinterest.com/pin/111/",
      "title": "",
      "thumbnailUrl": "https://i.pinimg.com/236x/example.jpg",
      "imageUrl": "https://i.pinimg.com/originals/example.jpg"
    },
    {
      "pinId": "222",
      "pinUrl": "https://www.pinterest.com/pin/222/",
      "title": "",
      "thumbnailUrl": "https://i.pinimg.com/236x/another.jpg",
      "imageUrl": "https://i.pinimg.com/originals/another.jpg"
    }
  ]
}
```

Titles may be empty. Original-resolution URLs are returned when the page advertises them.
The app should preview the results, let the user confirm, then download files directly from
Pinterest's image CDN into its local library. The Pi does not permanently host or relay the
files. Download promptly; the returned links are not a guaranteed permanent archive.

## Supported inputs and limits

- HTTPS `pin.it/...` links that resolve to a public board or multi-pin selection, direct
  `https://www.pinterest.com/username/board-slug/`, or `multi-pin-share/...` links.
- Up to 100 declared pins per board/selection, with a 4 KiB JSON request limit. Unknown or oversized boards reject before reading the feed.
- A multi-pin selection must match the declared count. Board previews explicitly report unavailable pins and require a terminal public feed bookmark. Incomplete pagination and unsupported media fail closed.
- Individual-pin links, private/login-required content, carousel expansion, HLS-only videos, and boards requiring further pagination are not supported. Direct MP4 videos are supported with the v2 opt-in below.
- Browser network requests are restricted to an exact allowlist of Pinterest/CDN hosts.
- The service has no user authentication or per-user quota; it rejects concurrent imports.
  Before broad public use, configure rate limiting for this hostname in Cloudflare.

Errors are JSON with `error` and usually `message`: 400 invalid input, 413 oversized request,
415 unsupported Content-Type, 422 unavailable/incomplete selection, 429 another import is
running (`Retry-After: 5`), 502 unexpected extraction failure, 504 extraction timeout.

## Local development

Requires Node.js 24+ and an installed Chrome/Chromium browser:

```bash
npm ci --ignore-scripts
npm test
CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm start
```

In Windows PowerShell:

```powershell
$env:CHROMIUM_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm start
```

Without Docker, the default listener is `127.0.0.1:3100`. Override `HOST` and `PORT` as needed.
Tests cover URL restrictions, image selection, HTTP validation, concurrency, and error
handling without contacting Pinterest. A separate live import is required to verify the
current Pinterest page structure.

## Connect the iOS sticker app

The native app needs a Share Extension to receive Pinterest's shared URL, then an import
screen that calls this endpoint and downloads the confirmed images. That iOS integration
is not included in this repository. The HTTP service can also be called manually or from
another native client. Browser origins are not enabled with wildcard CORS.

## GitHub

Create an empty GitHub repository (for example, `pinterest-link-extractor`). If working
from the prepared local Git repository, add its remote URL and push:

```bash
git remote add origin https://github.com/YOUR_ACCOUNT/pinterest-link-extractor.git
git push -u origin main
```

If using the source ZIP instead, first run `git init -b main`, `git add .`, and
`git commit -m "Add public Pinterest selection importer"` before adding the remote.
No GitHub repository has been created or pushed automatically.

## Mixed-media boards (v2)

The app can opt in with `{"url":"https://pin.it/example","acceptBoards":true,"includeVideos":true}`.
Direct public board URLs (`/username/board-slug/`) are accepted too. The board's declared
`pin_count` must be verified and must not exceed 100 **before** its feed is collected.
Unknown sizes, private boards, unfinished pagination and unrelated feeds are rejected.
Media requests are still blocked during extraction; only metadata is returned.

A board preview has `schemaVersion: 2`, `sourceKind: "board"`, `title`, `collectionComplete`,
`expectedCount` (Pinterest's declared board size), `count` (available media), and
`unavailableCount`. A signed-out feed can expose fewer items than the declared count.
The app must disclose that difference before selection; it must never label that preview
as an import of every pin. This version requires a terminal public feed bookmark;
boards needing further pagination should be shared as smaller pin selections.

Each item has `mediaType: "image"` or `"video"`. Video items retain their poster in `imageUrl`
and add an HTTPS `videoUrl` pointing to a direct MP4 on `v1.pinimg.com`, plus `durationMs`
when advertised. HLS-only videos fail explicitly. Older clients which have not opted in
are rejected for boards/videos, so a video cannot silently become a still poster.
Encrypted public Pinterest identifiers (`e1_…`) are supported alongside numeric pin IDs.

The sticker app downloads selected media, reuses its existing video-to-GIF editor to review
a clip of at most 10 seconds per video, and commits the entire mixed batch only after all
clips are ready. Its download limits are 10 MiB per image, 100 MiB per video, 250 MiB per
batch for both downloaded bytes and prepared clips, and a 10-minute batch deadline. The extractor does not download, proxy, convert or
store videos. Keep the service and client updates together when deploying this feature.

## Deploy the mixed-media version

After committing and pushing this branch from the Mac, update the extractor checkout on
the Pi (the branch is `codex/mixed-board-import`):

```bash
git fetch origin
git switch codex/mixed-board-import
git pull --ff-only
docker compose up -d --build
curl --fail http://127.0.0.1:8080/health
```

If Docker requires it on your Pi, use `sudo docker compose up -d --build`. Then verify a
real board preview, which checks Chromium and Pinterest as well as the HTTP process:

```bash
curl --fail-with-body http://127.0.0.1:8080/api/pinterest/import \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://pin.it/31w30freR","acceptBoards":true,"includeVideos":true}'
```

The response should identify `sourceKind: "board"`, report declared/available/unavailable
counts, and include `mediaType: "video"` plus a direct MP4 `videoUrl` for videos. Counts
can change as the owner edits the board. This request downloads no image or video files.
The Cloudflare Tunnel route and app endpoint remain unchanged. Deploying the service
is a separate step; changing files in VS Code does not update the running Pi container.

### Diagnose selection-only errors after deployment

Board/video support is on `codex/mixed-board-import`; `main` still contains the
selection-only importer. From the extractor checkout on the Pi, verify and rebuild:

```bash
git branch --show-current
git rev-parse --short HEAD
git fetch origin
git switch codex/mixed-board-import
git pull --ff-only
docker compose up -d --build --force-recreate
docker compose logs --tail=60
```

The Docker image must include `board-media.mjs` and `errors.mjs` alongside
`extractor.mjs`. Earlier Dockerfiles omitted these modules, preventing a newly built
board-support container from starting. `npm test` now checks that the files copied
by the Dockerfile can load the HTTP application.

Compare a board import through `http://127.0.0.1:8080/api/pinterest/import` with the
public HTTPS endpoint. A difference means the tunnel routes to another service.
The health response alone does not verify board support.

Live checks on 2026-11-09 with the board-support code:

| Short link | Board | Result |
| --- | --- | --- |
| `https://pin.it/ozD1q2COi` | Cool Shit | 132 declared pins; exceeds the 100-pin limit |
| `https://pin.it/31w30freR` | Crochet | 15 available of 16 declared; 1 video |
| `https://pin.it/ENue35Kpm` | Rebranding Campaign | 11 available of 11 declared; 6 videos |

These counts can change. Share a selection of at most 100 pins from the larger board.
