# Pinterest link extractor

A small self-hosted HTTP service that turns a **public multi-pin Pinterest share link**
into the selected pins' image URLs. Intended for importing images into a sticker maker.
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

- HTTPS `pin.it/...` links that resolve to a public multi-pin selection, or a direct
  `https://www.pinterest.com/multi-pin-share/...` link.
- Up to 100 selected pins per request, with a 4 KiB JSON request limit.
- The extracted image count must match Pinterest's declared selection size. Missing or
  unsupported media causes an error instead of silently returning a partial selection.
- Whole-board links, individual-pin links, private/login-required content, videos, and
  carousel expansion are not supported in this version.
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
