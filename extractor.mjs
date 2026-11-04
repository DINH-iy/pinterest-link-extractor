import { chromium } from 'playwright-core';

export class ImportError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const browserHosts = new Set([
    'pin.it', 'pinterest.com', 'www.pinterest.com', 'api.pinterest.com',
    's.pinimg.com', 'i.pinimg.com',
]);

export function validateShareUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) {
        throw new ImportError(400, 'invalid_url', 'Supply a public Pinterest share URL.');
    }
    let url;
    try { url = new URL(value.trim()); } catch {
        throw new ImportError(400, 'invalid_url', 'Supply a public Pinterest share URL.');
    }
    const validPath = url.hostname === 'pin.it'
        ? /^\/[a-zA-Z0-9]+\/?$/.test(url.pathname)
        : ['www.pinterest.com', 'pinterest.com'].includes(url.hostname)
            && /^\/multi-pin-share\/\d+\/?$/.test(url.pathname);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !validPath) {
        throw new ImportError(400, 'invalid_url', 'Use an HTTPS pin.it link or Pinterest multi-pin-share link.');
    }
    url.hash = '';
    return url.href;
}

export function allowedBrowserUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port
            && browserHosts.has(url.hostname);
    } catch { return false; }
}

function imageUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'i.pinimg.com'
            && !url.port && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

export function prepareImages(cards) {
    const result = new Map();
    for (const card of cards) {
        const match = /^\/pin\/(\d+)\/?$/.exec(card.pin ?? '');
        if (!match || !card.image) continue;
        const thumbnailUrl = imageUrl(card.image.src);
        const candidates = (card.image.srcset ?? '').split(',').map(entry => {
            const [url, descriptor] = entry.trim().split(/\s+/);
            return { url: imageUrl(url), rank: Number.parseFloat(descriptor) || 0 };
        }).filter(item => item.url).sort((a, b) => b.rank - a.rank);
        const best = candidates.find(item => new URL(item.url).pathname.startsWith('/originals/'))
            ?? candidates[0];
        const fullUrl = best?.url ?? thumbnailUrl;
        if (!fullUrl || !thumbnailUrl) continue;
        result.set(match[1], {
            pinId: match[1],
            pinUrl: `https://www.pinterest.com/pin/${match[1]}/`,
            title: card.image.alt ?? '',
            thumbnailUrl,
            imageUrl: fullUrl,
        });
    }
    return [...result.values()];
}

export async function extractSelection(value, options = {}) {
    const url = validateShareUrl(value);
    const browser = await chromium.launch({
        headless: true,
        executablePath: options.executablePath ?? process.env.CHROMIUM_EXECUTABLE_PATH,
        channel: options.channel ?? process.env.CHROMIUM_CHANNEL,
        timeout: 15_000,
    });
    let timer;
    try {
        return await Promise.race([
            extractInBrowser(browser, url),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new ImportError(504, 'pinterest_timeout',
                    'Pinterest took too long to return the selection. Try again later.')), 45_000);
            }),
        ]);
    } finally {
        clearTimeout(timer);
        await browser.close();
    }
}

async function extractInBrowser(browser, url) {
    const context = await browser.newContext({ locale: 'en-US', serviceWorkers: 'block' });
    await context.route('**/*', async route => {
        const request = route.request();
        if (!allowedBrowserUrl(request.url())
            || ['font', 'media', 'image'].includes(request.resourceType())) {
            await route.abort();
        } else {
            await route.continue();
        }
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    const resolved = new URL(page.url());
    if (!['pinterest.com', 'www.pinterest.com'].includes(resolved.hostname)
        || !/^\/multi-pin-share\/\d+\/?$/.test(resolved.pathname)) {
        throw new ImportError(422, 'unsupported_selection', 'The link must open a public multi-pin selection.');
    }
    try {
        await page.locator('[data-test-id="pin"] img').first().waitFor({ state: 'attached', timeout: 20_000 });
    } catch {
        throw new ImportError(422, 'selection_unavailable',
            'No public images were found. The selection may be unavailable or require a login.');
    }
    const title = await page.title();
    const count = /\b(\d+)\s+Pins?\b/i.exec(title);
    if (!count) {
        throw new ImportError(422, 'unknown_selection_size',
            'Could not verify how many pins were selected. Nothing was imported.');
    }
    const expectedCount = Number(count[1]);
    if (expectedCount < 1 || expectedCount > 100) {
        throw new ImportError(422, 'selection_too_large', 'Select between 1 and 100 pins per import.');
    }
    const images = new Map();
    let unchanged = 0;
    for (let attempt = 0; attempt < 30 && unchanged < 5; attempt++) {
        const cards = await page.locator('[data-test-id="pin"]').evaluateAll(elements =>
            elements.map(element => {
                const image = element.querySelector('img');
                const link = element.matches('a[href*="/pin/"]') ? element
                    : element.querySelector('a[href*="/pin/"]');
                return {
                    pin: link?.getAttribute('href'),
                    image: image ? {
                        src: image.getAttribute('src'), srcset: image.getAttribute('srcset'),
                        alt: image.getAttribute('alt'),
                    } : null,
                };
            }));
        const previous = images.size;
        for (const image of prepareImages(cards)) images.set(image.pinId, image);
        if (images.size === expectedCount) {
            return { sourceUrl: page.url(), expectedCount, count: images.size, images: [...images.values()] };
        }
        if (images.size > expectedCount) break;
        unchanged = images.size === previous ? unchanged + 1 : 0;
        await page.mouse.wheel(0, 650);
        await page.waitForTimeout(450);
    }
    throw new ImportError(422, 'incomplete_selection',
        `Pinterest reports ${expectedCount} selected pins, but ${images.size} usable images were found. Nothing was imported.`);
}
