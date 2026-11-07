import assert from 'node:assert/strict';
import test from 'node:test';
import {boardSelection,pinMedia,selectionMedia} from './board-media.mjs';
const pin=(id='123')=>({id,type:'pin',images:{'236x':{url:'https://i.pinimg.com/236x/a.jpg',width:236,height:236},orig:{url:'https://i.pinimg.com/originals/a.jpg',width:736,height:736}}});
const video=()=>({...pin('e1_Abcd-123'),videos:{duration:17467,video_list:{hls:{url:'https://v1.pinimg.com/video.m3u8'},mp4:{url:'https://v1.pinimg.com/videos/video.mp4',width:540,height:960,duration:17467}}}});
const state=(count=2,items=[pin(),video()],bookmark='-end-')=>({initialReduxState:{boards:{'7':{id:'7',url:'/user/crochet/',name:'Test board',pin_count:count,privacy:'public'}},resources:{BoardFeedResource:{'[["board_id","7"]]':{data:items,nextBookmark:bookmark}}}}});
const options={acceptBoards:true,includeVideos:true};
test('oversized and unknown board counts reject before reading feed or pin media',()=>{
 const large=state(101);Object.defineProperty(large.initialReduxState,'resources',{get(){throw new Error('feed must not be accessed');}});
 assert.throws(()=>boardSelection(large,'https://www.pinterest.com/user/crochet/',options),e=>e.code==='board_too_large');
 for(const count of [0,null,'16',-1])assert.throws(()=>boardSelection(state(count),'https://www.pinterest.com/user/crochet/',options),e=>e.code==='unknown_board_size');
});
test('mixed board preserves photos and MP4 videos and declares unavailable pins',()=>{
 const result=boardSelection(state(3),'https://www.pinterest.com/user/crochet/',options);
 assert.equal(result.expectedCount,3);assert.equal(result.count,2);assert.equal(result.unavailableCount,1);
 assert.equal(result.images[0].mediaType,'image');assert.equal(result.images[1].mediaType,'video');
 assert.equal(result.images[1].durationMs,17467);assert.equal(result.images[1].videoUrl,'https://v1.pinimg.com/videos/video.mp4');
});
test('unfinished board pages, unrelated feed and private boards fail closed',()=>{
 assert.throws(()=>boardSelection(state(2,[pin(),video()],'next-page'),'https://www.pinterest.com/user/crochet/',options),e=>e.code==='board_incomplete');
 const privateState=state();privateState.initialReduxState.boards['7'].privacy='secret';assert.throws(()=>boardSelection(privateState,'https://www.pinterest.com/user/crochet/',options),e=>e.code==='board_unavailable');
 const unrelated=state();unrelated.initialReduxState.resources.BoardFeedResource={'[["board_id","999"]]':{data:[pin()],nextBookmark:'-end-'}};
 assert.throws(()=>boardSelection(unrelated,'https://www.pinterest.com/user/crochet/',options),e=>e.code==='board_incomplete');
});
test('older clients never silently receive a video poster in place of the video',()=>{
 assert.throws(()=>pinMedia(video()),e=>e.code==='video_client_required');
 assert.throws(()=>boardSelection(state(),'https://www.pinterest.com/user/crochet/'),e=>e.code==='board_client_required');
});
test('video URL allowlist rejects credentials, arbitrary hosts, redirects, HLS and unsafe identifiers',()=>{
 for(const url of ['https://evil.test/a.mp4','https://user:pass@v1.pinimg.com/a.mp4','http://v1.pinimg.com/a.mp4','https://v1.pinimg.com:8443/a.mp4','https://v1.pinimg.com/a.m3u8','https://v1.pinimg.com/a.mp4#fragment']){
  const value=video();value.videos.video_list={bad:{url}};assert.throws(()=>pinMedia(value,true),e=>e.code==='unsupported_video');
 }
 assert.equal(pinMedia({...pin(),id:'../../outside'}),null);
});
