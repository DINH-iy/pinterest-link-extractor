import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedBrowserUrl, prepareImages, validateShareUrl } from './extractor.mjs';

test('rejects arbitrary hosts, credentials and ports before opening a browser', () => {
    for (const url of ['http://pin.it/abc', 'https://pin.it.evil.test/abc', 'https://user:pass@pin.it/abc',
        'https://pin.it:8443/abc', 'http://127.0.0.1/', null]) {
        assert.throws(() => validateShareUrl(url), error => error.status === 400);
    }
    assert.equal(validateShareUrl('https://www.pinterest.com/user/board/'),'https://www.pinterest.com/user/board/');
    assert.throws(()=>validateShareUrl('https://www.pinterest.com/pin/123/'));
    assert.equal(validateShareUrl('https://pin.it/3b1AO6JOq'), 'https://pin.it/3b1AO6JOq');
    assert.equal(validateShareUrl('https://www.pinterest.com/multi-pin-share/123/?invite_code=abc'),
        'https://www.pinterest.com/multi-pin-share/123/?invite_code=abc');
});

test('browser requests cannot leave the exact Pinterest host allowlist', () => {
    assert.equal(allowedBrowserUrl('https://api.pinterest.com/v3/example'), true);
    for (const url of ['http://www.pinterest.com/', 'https://127.0.0.1/', 'https://i.pinimg.com.evil.test/',
        'https://localhost/', 'file:///etc/passwd', 'https://www.pinterest.com:8443/']) {
        assert.equal(allowedBrowserUrl(url), false);
    }
});

test('preserves selection order, deduplicates cards and uses advertised original images', () => {
    const image = { src: 'https://i.pinimg.com/236x/a.jpg', alt: 'Example',
        srcset: 'https://i.pinimg.com/736x/a.jpg 3x, https://i.pinimg.com/originals/a.jpg 4x' };
    const images = prepareImages([
        { pin: '/pin/22/', image }, { pin: '/pin/11/', image }, { pin: '/pin/22/', image },
        { pin: '/pin/99/', image: { src: 'https://evil.test/image.jpg' } },
        { pin: '/pin/33/', image: null },
    ]);
    assert.deepEqual(images.map(item => item.pinId), ['22', '11']);
    assert.equal(images[0].imageUrl, 'https://i.pinimg.com/originals/a.jpg');
    assert.equal(images[0].thumbnailUrl, image.src);
});
