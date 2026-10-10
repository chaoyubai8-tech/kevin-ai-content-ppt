/* A fixed cinematic stage. Transitions explain relationships; controls stay manual. */
(()=>{'use strict';
const $=id=>document.getElementById(id),deck=window.DECK;
const clamp=n=>Math.max(0,Math.min(deck.length-1,Number(n)||0));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(Math.floor(n%60)).padStart(2,'0')}`;
let index=clamp((Number(location.hash.slice(1))||1)-1),step=0,maxStep=0;
let elapsed=0,running=false,lastTick=Date.now(),channel,animations=[],countFrames=[];
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let motion=!reducedMotion.matches,lastRenderedIndex=-1;
let presenter=new URLSearchParams(location.search).has('presenter');
let exerciseEnd=0,idleTimer,toastTimer;
const clientId=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`;
const peers=new Map(),forcedMute=new WeakMap(),retiredVideos=new WeakSet();
let mediaState=null;
const currentVideo=()=>$('slide').querySelector('video');
function post(data){channel?.postMessage({...data,sender:clientId,presenter})}
function isAudioOwner(){return [{id:clientId,presenter},...[...peers].map(([id,role])=>({id,presenter:role}))].sort((a,b)=>Number(a.presenter)-Number(b.presenter)||a.id.localeCompare(b.id))[0].id===clientId}
function updateAudio(){const video=currentVideo();if(!video)return;
 if(!isAudioOwner()){if(!forcedMute.has(video))forcedMute.set(video,video.muted);video.muted=true;video.title='此窗口为静音预览，声音由另一演示窗口播放';}
 else if(forcedMute.has(video)){video.muted=forcedMute.get(video);forcedMute.delete(video);video.removeAttribute('title');}
}
function videoSnapshot(){const video=currentVideo();return video?{slideId:deck[index].id,time:video.currentTime||0,paused:video.paused,rate:video.playbackRate||1,sentAt:Date.now()}:null}
function mediaTime(state){return Math.max(0,state.time+(state.paused?0:Math.max(0,Date.now()-state.sentAt)/1000*state.rate))}
function publishMedia(kind){const video=currentVideo();if(!video||retiredVideos.has(video))return;
 // Media events arrive asynchronously, so compare with the last applied state
 // instead of clearing a temporary flag before play/pause/seeked has fired.
 if(mediaState&&mediaState.slideId===deck[index].id){
  if(kind==='seeked'&&Math.abs(video.currentTime-mediaTime(mediaState))<.5)return;
  if(kind==='ratechange'&&video.playbackRate===mediaState.rate)return;
  if(!['seeked','ratechange'].includes(kind)&&video.paused===mediaState.paused)return;
 }
 mediaState=videoSnapshot();post({type:'media',media:mediaState});
}
function applyMedia(state){const video=currentVideo();if(!video||!state||state.slideId!==deck[index].id||!Number.isFinite(state.time)||!Number.isFinite(state.sentAt))return;
 mediaState={...state,paused:!!state.paused,rate:Number.isFinite(state.rate)&&state.rate>0?state.rate:1};
 updateAudio();if(video.readyState===0)return; // loadedmetadata applies the latest command.
 const target=Number.isFinite(video.duration)?Math.min(video.duration,mediaTime(mediaState)):mediaTime(mediaState);
 if(Math.abs(video.currentTime-target)>.25)video.currentTime=target;
 if(video.playbackRate!==mediaState.rate)video.playbackRate=mediaState.rate;
 if(mediaState.paused){if(!video.paused)video.pause();}
 else if(video.paused){const applied=mediaState;video.play().catch(()=>{
  if(currentVideo()!==video||mediaState!==applied)return;
  // Browsers may require one click in the audience window before audible play.
  mediaState={...applied,paused:true,time:video.currentTime,sentAt:Date.now()};
  toast('请在有声演示窗口点击一次播放，允许浏览器播放声音');
  post({type:'media-blocked',slideId:deck[index].id});
 });}
}
// Keep the chosen cover when returning to the opening or replaying its entrance.
let coverSelection=1;
function selectCover(n,broadcast=true,focus=false){
 coverSelection=((Number(n)||0)%3+3)%3;
 $('slide').querySelectorAll('[data-cover-card]').forEach(card=>{
  const id=Number(card.dataset.coverCard),selected=id===coverSelection;
  card.dataset.slot=selected?'front':(id-coverSelection+3)%3===1?'right':'left';
  card.setAttribute('aria-pressed',String(selected));
  card.setAttribute('aria-label',selected?`${card.dataset.cardName} 当前正面 点击切换下一张`:`展示 ${card.dataset.cardName}`);
  if(selected&&focus)card.focus({preventScroll:true});
 });
 if(broadcast)sync();
}
function bindCover(){
 selectCover(coverSelection,false);
 $('slide').querySelectorAll('[data-cover-card]').forEach(card=>{
  card.onclick=()=>{const id=Number(card.dataset.coverCard);selectCover(id===coverSelection?id+1:id);wake();};
  card.onkeydown=e=>{
   if(e.ctrlKey||e.metaKey||e.altKey||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
   e.preventDefault();e.stopPropagation();
   selectCover(e.key==='Home'?0:e.key==='End'?2:coverSelection+(e.key==='ArrowRight'?1:-1),true,true);wake();
  };
 });
}
function bindArchitecture(){
 $('slide').querySelectorAll('.arch-node[data-arch-step],.arch-picture[data-arch-step]').forEach(el=>{
  const phase=Number(el.dataset.archStep),name=el.querySelector('h2')?.textContent||el.querySelector('img')?.alt||'产线环节';
  el.setAttribute('role','button');el.tabIndex=0;el.title='点击聚焦此环节';el.setAttribute('aria-label',`聚焦：${name}`);
  const select=()=>{step=phase;reveal(true);wake();sync()};
  el.onclick=select;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();select()}};
 });
}
function fit(){const r=$('stage').getBoundingClientRect(),s=Math.min(r.width/1920,r.height/1080);$('deckStage').style.transform=`translate(${(r.width-1920*s)/2}px,${(r.height-1080*s)/2}px) scale(${s})`;}
function sync(){mediaState=videoSnapshot();post({type:'state',index,step,elapsed,running,coverSelection,motion,media:mediaState})}
function stopAnimations(){animations.forEach(a=>a.cancel());animations=[];countFrames.forEach(cancelAnimationFrame);countFrames=[];}
function animate(el,delay=0){if(!motion||el.closest('.pending'))return;const kind=el.dataset.animate||(el.matches('.flow-node,.p-stair>div,.k-nine>div')?'flow':el.matches('.p-storyboard figure')?'film':'up');
 const recipes={title:[{opacity:.25,translate:'0 18px'},{opacity:1,translate:'0 0'}],media:[{opacity:.3,translate:'42px 0',scale:'.97'},{opacity:1,translate:'0 0',scale:'1'}],wipe:[{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0 0 0)'}],quote:[{opacity:.25,translate:'-24px 0'},{opacity:1,translate:'0 0'}],flow:[{opacity:.15,translate:'-38px 0'},{opacity:1,translate:'0 0'}],film:[{opacity:.25,translate:'50px 0',rotate:'2deg'},{opacity:1,translate:'0 0',rotate:'0deg'}],up:[{opacity:.3,translate:'0 22px'},{opacity:1,translate:'0 0'}]};
 animations.push(el.animate(recipes[kind]||recipes.up,{duration:kind==='wipe'?650:kind==='media'?700:500,delay,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'}));
}
function count(el){const end=Number(el.dataset.count),dec=Number(el.dataset.decimals)||0,start=performance.now();
 const show=n=>el.textContent=n.toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec});
 if(!motion){show(end);return}const tick=now=>{const p=Math.min(1,(now-start)/1250);show(end*(1-Math.pow(1-p,4)));if(p<1)countFrames.push(requestAnimationFrame(tick));};countFrames.push(requestAnimationFrame(tick));
}
function reveal(animateNew=false){$('slide').dataset.step=step;$('slide').style.setProperty('--build',maxStep?step/maxStep:1);$('slide').querySelectorAll('[data-step]').forEach(el=>{const was=el.classList.contains('pending'),hide=Number(el.dataset.step)>step;el.classList.toggle('pending',hide);el.classList.toggle('build-focus',Number(el.dataset.step)===step);el.inert=hide;el.setAttribute('aria-hidden',String(hide));if(animateNew&&was&&!hide)animate(el);});
 $('slide').querySelectorAll('[data-arch-step]').forEach(el=>{const phase=Number(el.dataset.archStep);el.classList.toggle('arch-current',phase===step);el.classList.toggle('arch-done',phase<step);if(el.getAttribute('role')==='button')el.setAttribute('aria-pressed',String(phase===step));});
 $('slide').querySelectorAll('[data-arch-caption]').forEach(el=>{const current=Number(el.dataset.archCaption)===step;el.classList.toggle('is-current',current);el.setAttribute('aria-hidden',String(!current));});
 $('buildCount').textContent=maxStep?`${step} / ${maxStep}`:'';$('prevBtn').disabled=index===0&&step===0;$('nextBtn').disabled=index===deck.length-1&&step===maxStep;
}
function notesMarkup(s){return `<p class="cue">建议 ${fmt(s.seconds)} · ${esc(s.cue||'')}</p>${s.notes.map(p=>`<p>${esc(p)}</p>`).join('')}${s.footnote?`<p>补充说明：${esc(s.footnote)}</p>`:''}<p class="note-source">资料：${esc(s.source)}</p>`}
function render(broadcast=true){const s=deck[index];$('slide').querySelectorAll('video').forEach(v=>{retiredVideos.add(v);v.pause()});mediaState=null;stopAnimations();exerciseEnd=0;
 $('slide').className=`slide active ${s.type||''}`;
 $('slide').dataset.slideId=s.id;
 $('slide').innerHTML=`<div class="scene-body">${s.html}</div><footer class="slide-footer"><span class="slide-label">${esc(s.section)} · ${String(index+1).padStart(2,'0')}</span></footer>`;
 bindCover();bindArchitecture();maxStep=Math.max(0,...[...$('slide').querySelectorAll('[data-step],[data-arch-step]')].map(x=>Number(x.dataset.step??x.dataset.archStep)));step=Math.min(step,maxStep);reveal();fit();
 $('position').textContent=`${String(index+1).padStart(2,'0')} / ${deck.length}`;$('sectionLabel').textContent=s.section;$('progressFill').style.transform=`scaleX(${(index+1)/deck.length})`;
 $('notesTitle').textContent=s.title;$('presenterTitle').textContent=s.title;$('notesBody').innerHTML=notesMarkup(s);$('presenterNotes').innerHTML=notesMarkup(s);$('nextTitle').textContent=index+1<deck.length?'下一页：'+deck[index+1].title:'演示结束';
 history.replaceState(null,'',`#${index+1}`);document.title=`${s.title} | 内容产线`;
 if(motion&&lastRenderedIndex!==index&&lastRenderedIndex!==-1)animations.push($('slide').querySelector('.scene-body').animate([{opacity:.6,translate:`${index>lastRenderedIndex?18:-18}px 0`},{opacity:1,translate:'0 0'}],{duration:320,easing:'cubic-bezier(.16,1,.3,1)'}));
 lastRenderedIndex=index;
 [...$('slide').querySelectorAll('[data-animate]')].forEach((el,i)=>animate(el,Math.min(i*65,195)));$('slide').querySelectorAll('[data-count]').forEach(count);
 const video=$('slide').querySelector('video'),play=$('slide').querySelector('[data-play-video]');
 if(video&&play){play.onclick=()=>{if(!video.paused){video.pause();return}video.play().catch(()=>toast('请使用样片播放器中的播放按钮重试'));};
  for(const kind of ['play','pause','ended','seeked','ratechange'])video.addEventListener(kind,()=>{if(currentVideo()!==video||retiredVideos.has(video))return;play.textContent=video.ended?'重播样片':video.paused?'继续播放':'暂停样片';$('slide').classList.toggle('video-playing',!video.paused);publishMedia(kind)});
  video.addEventListener('loadedmetadata',()=>{if(currentVideo()===video&&mediaState)applyMedia(mediaState)});
  video.addEventListener('volumechange',()=>{if(currentVideo()===video&&!isAudioOwner()&&!video.muted)updateAudio()});
  video.addEventListener('error',()=>toast('样片暂时无法加载，请检查本地 assets 文件夹'));updateAudio();mediaState=videoSnapshot();}
 const videoFull=$('slide').querySelector('[data-fullscreen-video]');if(video&&videoFull)videoFull.onclick=async()=>{try{if(video.requestFullscreen)await video.requestFullscreen();else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();else toast('请使用视频播放器中的全屏按钮')}catch{toast('请使用视频播放器中的全屏按钮')}};
 const exercise=$('slide').querySelector('[data-exercise]');if(exercise)exercise.onclick=()=>{exerciseEnd=Date.now()+60000;exercise.textContent='重新计时 60 秒'};
 wake();if(broadcast)sync();
}
function next(){if(step<maxStep){step++;reveal(true);sync()}else if(index<deck.length-1){index++;step=0;render()}}
function prev(){if(step>0){step--;reveal();sync()}else if(index>0){index--;step=99;render()}}
function goto(i){const n=clamp(i);if(n===index)return;index=n;step=0;render()}
function replay(){step=0;render()}
function toast(t){clearTimeout(toastTimer);$('toast').textContent=t;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3500)}
function wake(){document.body.classList.remove('chrome-idle');clearTimeout(idleTimer);idleTimer=setTimeout(()=>document.body.classList.add('chrome-idle'),4500)}
function overview(){$('overviewGrid').innerHTML=deck.map((s,i)=>`<button data-slide="${i}" class="${i===index?'current':''}"><small>${String(i+1).padStart(2,'0')} · ${esc(s.section)} · ${fmt(s.seconds)}</small>${esc(s.title)}</button>`).join('');$('overview').showModal()}
function setMotion(value,broadcast=true){motion=!!value&&!reducedMotion.matches;document.body.classList.toggle('motion-paused',!motion);$('motionBtn').textContent=motion?'动效开':'动效关';$('motionBtn').setAttribute('aria-pressed',String(motion));if(!motion){stopAnimations();$('slide').querySelectorAll('[data-count]').forEach(count);}if(broadcast)post({type:'motion',motion});}
reducedMotion.addEventListener('change',e=>{if(e.matches)setMotion(false)});
function togglePresenter(value,broadcast=true){presenter=value;document.body.classList.toggle('presenter',value);$('presenterPanel').hidden=!value;const u=new URL(location.href);value?u.searchParams.set('presenter','1'):u.searchParams.delete('presenter');history.replaceState(null,'',u.href);fit();updateAudio();if(broadcast)post({type:'presence'});}
async function full(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{toast('当前浏览器不支持页面全屏，可使用浏览器的全屏功能')}}
$('nextBtn').onclick=next;$('prevBtn').onclick=prev;$('replayBtn').onclick=replay;$('motionBtn').onclick=()=>setMotion(!motion);$('overviewBtn').onclick=overview;$('notesBtn').onclick=()=>$('notes').showModal();$('fullBtn').onclick=full;
$('overviewGrid').onclick=e=>{const b=e.target.closest('[data-slide]');if(b){goto(Number(b.dataset.slide));$('overview').close()}};document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('presenterBtn').onclick=()=>togglePresenter(!presenter);$('presenterBack').onclick=()=>togglePresenter(false);
$('timerBtn').onclick=()=>{running=!running;lastTick=Date.now();sync()};
setInterval(()=>{const now=Date.now();if(running)elapsed+=(now-lastTick)/1000;lastTick=now;$('clock').textContent=fmt(elapsed);$('timerBtn').textContent=running?'暂停计时':elapsed?'继续计时':'开始计时';if(exerciseEnd&&$('exerciseClock')){$('exerciseClock').textContent=fmt(Math.max(0,Math.ceil((exerciseEnd-now)/1000)));if(now>=exerciseEnd){exerciseEnd=0;toast('60 秒到，分享一下你的交接物。')}}},200);
document.addEventListener('keydown',e=>{wake();if(e.ctrlKey||e.metaKey||e.altKey||document.querySelector('dialog[open]')||/INPUT|TEXTAREA|SELECT|VIDEO/.test(document.activeElement.tagName)||([' ','Enter'].includes(e.key)&&/BUTTON|A/.test(document.activeElement.tagName)))return;
 if(['ArrowRight',' ','PageDown'].includes(e.key)){e.preventDefault();e.shiftKey||e.key==='PageDown'?goto(index+1):next()}else if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();e.shiftKey||e.key==='PageUp'?goto(index-1):prev()}else if(e.key==='Home'){e.preventDefault();index=0;step=0;render()}else if(e.key==='End'){e.preventDefault();goto(deck.length-1)}else if(e.key.toLowerCase()==='g')overview();else if(e.key.toLowerCase()==='n')$('notes').showModal();else if(e.key.toLowerCase()==='f')full();else if(e.key.toLowerCase()==='r')replay();else if(e.key.toLowerCase()==='m')setMotion(!motion);
});
let startX=null;const interactive=e=>e.target.closest('button,a,video,input');$('stage').addEventListener('touchstart',e=>{startX=interactive(e)?null:e.touches[0].clientX},{passive:true});$('stage').addEventListener('touchend',e=>{if(startX===null)return;const d=e.changedTouches[0].clientX-startX;if(Math.abs(d)>65)d<0?next():prev();startX=null},{passive:true});
window.addEventListener('hashchange',()=>{index=clamp((Number(location.hash.slice(1))||1)-1);step=0;render()});document.addEventListener('pointermove',wake,{passive:true});new ResizeObserver(fit).observe($('stage'));
try{channel=new BroadcastChannel('content-cinema-c');channel.onmessage=({data})=>{
 if(!data||data.sender===clientId)return;
 if(data.type==='leave'){peers.delete(data.sender);updateAudio();return;}
 if(data.sender){peers.set(data.sender,!!data.presenter);updateAudio();}
 if(data.type==='request'){sync();return;}
 if(data.type==='motion'){setMotion(data.motion,false);return;}
 if(data.type==='media'){applyMedia(data.media);return;}
 if(data.type==='media-blocked'){if(data.slideId===deck[index].id)toast('投屏窗口尚未允许有声播放，请在该窗口点击一次播放');return;}
 if(data.type!=='state')return;
 const changed=index!==clamp(data.index);index=clamp(data.index);step=Math.max(0,Number(data.step)||0);elapsed=Math.max(0,Number(data.elapsed)||0);running=!!data.running;lastTick=Date.now();
 if(typeof data.motion==='boolean')setMotion(data.motion,false);
 if(Number.isInteger(data.coverSelection)&&data.coverSelection>=0&&data.coverSelection<3)coverSelection=data.coverSelection;
 if(changed)render(false);else{reveal(true);selectCover(coverSelection,false);}applyMedia(data.media);
};}catch{}
window.addEventListener('pagehide',()=>post({type:'leave'}));
window.addEventListener('pageshow',e=>{if(e.persisted)post({type:'request'})});
togglePresenter(presenter,false);setMotion(motion,false);render(false);post({type:'request'});
})();
