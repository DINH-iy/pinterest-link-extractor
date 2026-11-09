import { ImportError } from './errors.mjs';
export const MAX_PINS = 100;
const reserved = new Set(['pin', 'ideas', 'search', 'settings', 'login', 'signup', 'business', 'multi-pin-share', 'resource']);
export function isBoardPath(path) {
    const match = /^\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/?$/.exec(path);
    return !!match && !reserved.has(match[1].toLowerCase());
}
function cdn(value, video = false) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash
            && url.hostname === (video ? 'v1.pinimg.com' : 'i.pinimg.com')
            && (!video || url.pathname.endsWith('.mp4')) ? url.href : null;
    } catch { return null; }
}
export function pinMedia(pin, includeVideos = false) {
    if (!pin || !/^(?:\d{1,30}|e1_[a-zA-Z0-9_-]{1,93})$/.test(pin.id ?? '')) return null;
    const images = Object.values(pin.images ?? {}).filter(image => cdn(image?.url));
    const thumbnailUrl = cdn(pin.images?.['236x']?.url) ?? cdn(images[0]?.url);
    const imageUrl = cdn(pin.images?.orig?.url) ?? cdn(images.sort((a,b) => (b.width*b.height)-(a.width*a.height))[0]?.url);
    if (!thumbnailUrl || !imageUrl) return null;
    const result = {pinId:pin.id, pinUrl:`https://www.pinterest.com/pin/${pin.id}/`,
        title:String(pin.title ?? pin.grid_title ?? '').slice(0,128),thumbnailUrl,imageUrl,mediaType:'image'};
    if (pin.videos) {
        if (!includeVideos) throw new ImportError(422,'video_client_required','This board or selection contains videos. Update the sticker app to import them.');
        const variants = Object.values(pin.videos.video_list ?? {}).filter(item => cdn(item?.url,true));
        const video = variants.find(item => item.width <= 1280 && item.height <= 1280) ?? variants.sort((a,b)=>(a.width*a.height)-(b.width*b.height))[0];
        if (!video) throw new ImportError(422,'unsupported_video','A video has no directly downloadable MP4. Nothing was imported.');
        result.mediaType='video';result.videoUrl=cdn(video.url,true);
        const duration=video.duration ?? pin.videos.duration;
        if (Number.isFinite(duration) && duration > 0) result.durationMs=Math.round(duration);
    }
    return result;
}
export function boardSelection(initial, resolvedUrl, options = {}) {
    const state=initial?.initialReduxState;
    const url=new URL(resolvedUrl),canonical=url.pathname.replace(/\/$/,'').toLowerCase();
    const board=Object.values(state?.boards ?? {}).find(b => String(b.url).replace(/\/$/,'').toLowerCase()===canonical);
    if (!board || board.privacy!=='public') throw new ImportError(422,'board_unavailable','Only public boards can be previewed.');
    const total=board.pin_count;
    // Check the declared full board count before touching its feed or pin media.
    if (!Number.isSafeInteger(total) || total < 1) throw new ImportError(422,'unknown_board_size','Could not verify the board size. Share a smaller pin selection instead.');
    if (total > MAX_PINS) throw new ImportError(422,'board_too_large',`This board has ${total} pins. The limit is ${MAX_PINS}; share a smaller selection instead.`);
    if (!options.acceptBoards) throw new ImportError(422,'board_client_required','Update the sticker app to preview whole boards.');
    const feeds=Object.entries(state.resources?.BoardFeedResource ?? {}).filter(([key])=>{
        try{return String(Object.fromEntries(JSON.parse(key)).board_id)===String(board.id);}catch{return false;}
    }).map(([,feed])=>feed);
    if (!feeds.length || feeds.some(feed=>feed.nextBookmark!=='-end-')) throw new ImportError(422,'board_incomplete','Pinterest has not exposed the complete public board preview. Share a smaller selection instead.');
    const pins=new Map();
    for (const feed of feeds) for (const pin of feed.data ?? []) {
        if(pin?.type!=='pin')continue;
        const media=pinMedia(pin,options.includeVideos);
        if(!media)throw new ImportError(422,'unsupported_pin','A pin has no supported image or video. Nothing was imported.');
        pins.set(media.pinId,media);
    }
    if (!pins.size || pins.size>total) throw new ImportError(422,'board_count_mismatch','Pinterest returned inconsistent board contents. Nothing was imported.');
    return {schemaVersion:2,sourceKind:'board',title:String(board.name ?? '').slice(0,128),
        sourceUrl:`https://www.pinterest.com${board.url}`,expectedCount:total,count:pins.size,
        unavailableCount:total-pins.size,collectionComplete:true,images:[...pins.values()]};
}
export function selectionMedia(images, initial, options={}) {
    const pins=Object.values(initial?.initialReduxState?.pins ?? {});
    return images.map(image=>{
        const pin=pins.find(pin=>pin.id===image.pinId || (pin.image_signature && image.imageUrl.includes(pin.image_signature)));
        if(!pin)return {...image,mediaType:'image'};
        const media=pinMedia(pin,options.includeVideos);
        if(!media)throw new ImportError(422,'unsupported_pin','A selected pin has no supported image or video. Nothing was imported.');
        return {...media,pinId:image.pinId,pinUrl:image.pinUrl};
    });
}
