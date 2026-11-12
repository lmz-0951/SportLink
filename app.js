// SportLink 雲端預約版：只顯示已核准的真實教練
const REGIONS={
  '台北市':['中正區','大同區','中山區','松山區','大安區','萬華區','信義區','士林區','北投區','內湖區','南港區','文山區'],
  '新北市':['板橋區','三重區','中和區','永和區','新莊區','新店區','樹林區','鶯歌區','三峽區','淡水區','汐止區','瑞芳區','土城區','蘆洲區','五股區','泰山區','林口區','深坑區','石碇區','坪林區','三芝區','石門區','八里區','平溪區','雙溪區','貢寮區','金山區','萬里區','烏來區'],
  '桃園市':['桃園區','中壢區','平鎮區','八德區','楊梅區','蘆竹區','大溪區','龍潭區','龜山區','大園區','觀音區','新屋區','復興區']
};
const ALL_AREAS=Object.entries(REGIONS).flatMap(([city,districts])=>districts.map(d=>city+d));
// 舊資料只存行政區時，沿用原本的台北市設定；新資料儲存完整縣市與行政區。
const fullArea=area=>{const a=String(area||'').trim();return /^(台北市|臺北市|新北市|桃園市)/.test(a)?a:'台北市'+a};
const areaOptions=(selected,includeAll=false)=>{
  const current=selected?fullArea(selected):'';
  const values=[...(includeAll?['全部']:[]),...ALL_AREAS];
  if(current&&!values.includes(current))values.push(current);
  return values.map(v=>`<option value="${esc(v)}" ${v===(includeAll?(selected||'全部'):current)?'selected':''}>${esc(v)}</option>`).join('');
};
const initialJobs=[{id:2,sport:'羽球',area:'中山區',date:'2026-11-08',time:'10:00',hours:2,rate:1100,detail:'成人雙打基礎課程',owner:'示範教練',status:'open'}];
const SUPABASE_URL='https://szlfgarfcgqtqalvljil.supabase.co';
const SPORTLINK_VAPID_PUBLIC_KEY='BGc9IixtBx62bwA6tshRj9P07Mu7jlUtbSIIQqbCDCZdEjfNadzV1nMJrgPWk49lxZ3MzyE-ISvJL7JsoSLmLEI';
const SUPABASE_KEY='sb_publishable_bLDjhYZQGgquuYL8MuYFug__NScOGUB';
const supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const load=(k,d)=>{try{return JSON.parse(localStorage.getItem('sl_'+k))??d}catch{return d}};
const save=(k,v)=>localStorage.setItem('sl_'+k,JSON.stringify(v));
let user=null,admin=false,coachProfile=null,liveCoaches=[],bookings=[],page='home',areaFilter='全部';
let slOpenPlayGames=[],slOpenPlayLoading=false,slOpenPlayError='',slOpenPlayNotice='',slOpenPlayRequest=0;
let slOpenPlayMyGames=[],slOpenPlayMyGamesLoading=false,slOpenPlayMyGamesError='',slOpenPlayMyGamesRequest=0;
let slOpenPlayHostGames=[],slOpenPlayHostGamesLoading=false,slOpenPlayHostGamesError='',slOpenPlayHostGamesRequest=0;
let slOpenPlayFilters={city:'',district:'',level:''};
let slOpenPlayMode='list',slOpenPlayCreating=false,slOpenPlayReviewing=false,slOpenPlayPhotoSaving=false,slOpenPlaySelectedGameId='';
let jobs=load('jobs',initialJobs),applications=load('applications',[]);
const storedJobs=jobs;
const nonBadmintonJobIds=new Set(Array.isArray(storedJobs)?storedJobs.filter(j=>j?.sport&&j.sport!=='羽球').map(j=>String(j.id)):[]);
jobs=Array.isArray(storedJobs)?storedJobs.filter(j=>!j?.sport||j.sport==='羽球'):initialJobs;
if(!Array.isArray(storedJobs)||jobs.length!==storedJobs.length)save('jobs',jobs);
const storedApplications=applications;
applications=Array.isArray(storedApplications)?storedApplications.filter(a=>{
  if(nonBadmintonJobIds.has(String(a?.jobId)))return false;
  return !a?.sport||a.sport==='羽球';
}):[];
if(!Array.isArray(storedApplications)||applications.length!==storedApplications.length)save('applications',applications);
let slCommunityTab='discover';
let availabilitySlots=[],availabilityError='',coachReviews=[],myReviews=[];
let publicOpenBlocks=[],publicBusyBlocks=[],bookingUiVersion=0;
let favoriteCoachIds=new Set(),favoritesReady=false;
const app=document.getElementById('app');
document.querySelectorAll('[data-page="community"]').forEach(el=>{
  if(!el.querySelector('[data-sl-notice]'))el.insertAdjacentHTML('beforeend','<span class="sl-notice-slot" data-sl-notice="community" hidden></span>');
});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(name,action,cls='btn')=>`<button type="button" class="${cls}" data-action="${action}">${name}</button>`;
const options=(arr,current)=>arr.map(v=>`<option ${v===current?'selected':''}>${esc(v)}</option>`).join('');
const errorText=e=>{
  const message=String(e?.message||'');
  if(!navigator.onLine || /failed to fetch|load failed|networkerror|network request failed/i.test(message))
    return '網路連線不穩定，請檢查網路後再試一次。';
  if(/invalid login credentials/i.test(message))return '電子郵件或密碼不正確，請確認後重試；忘記密碼可使用下方重設功能。';
  if(/email not confirmed/i.test(message))return '電子郵件尚未驗證，請先到信箱完成驗證。';
  if(/too many requests|rate limit/i.test(message))return '操作過於頻繁，請稍後再試。';
  return message||'請稍後再試';
};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function retryRead(operation,attempts=2){
  for(let i=0;i<attempts;i++){
    try{
      const result=await operation();
      if(result?.error)throw result.error;
      return result;
    }catch(err){
      if(i===attempts-1 || !navigator.onLine || !/fetch|network|load failed|timeout/i.test(String(err?.message||'')))throw err;
      await wait(600*(i+1));
    }
  }
}
let loadingData=false;
let authVersion=0;
const dateToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const PHOTO_BUCKET='coach-photos';
const CERT_BUCKET='coach-certificates';
// photo_url stores a Storage object path (user-id/avatar-timestamp.ext), not an arbitrary URL.
const photoSrc=c=>{
  const path=String(c?.photo_url||'');
  if(!c?.user_id||!path.startsWith(c.user_id+'/')||!/^[-a-zA-Z0-9_/ .]+\.(jpg|jpeg|png|webp)$/i.test(path))return '';
  return supabaseClient.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
};
const photoAvatar=(c,large=false)=>{
  const url=photoSrc(c);
  const size=large?'width:116px;height:116px;font-size:46px;':'width:80px;height:80px;font-size:36px;';
  return `<div class="avatar" style="${size}flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;border-radius:50%">${url?`<img src="${esc(url)}" alt="${esc(c.display_name||'教練')}的照片" style="width:100%;height:100%;object-fit:cover" loading="lazy" referrerpolicy="no-referrer">`:'🏅'}</div>`;
};
const statusLabel={pending:'待教練確認',accepted:'已接受',rejected:'已拒絕',cancelled:'已取消',completed:'已完成'};
const reviewStars=n=>'★'.repeat(Math.max(0,Math.min(5,Number(n)||0)))+'☆'.repeat(5-Math.max(0,Math.min(5,Number(n)||0)));
const coachReviewSummary=id=>{const rs=coachReviews.filter(r=>r.coach_id===id);return rs.length?`<span class="muted">⭐ ${(rs.reduce((a,r)=>a+Number(r.rating),0)/rs.length).toFixed(1)}（${rs.length} 則評價）</span>`:'<span class="muted">尚無評價</span>'};
const coachReviewPanel=id=>{const rs=coachReviews.filter(r=>r.coach_id===id);return `<section class="section"><h2>學生評價</h2><p>${coachReviewSummary(id)}</p>${rs.length?`<div class="list">${rs.map(r=>`<div class="item"><b style="color:#d18a00">${reviewStars(r.rating)}</b><span class="muted"> · ${esc(String(r.created_at||'').slice(0,10))}</span>${r.comment?`<p style="white-space:pre-wrap">${esc(r.comment)}</p>`:''}</div>`).join('')}</div>`:'<p class="muted">目前還沒有學生評價。</p>'}</section>`};
const slFavoriteButton=id=>user?`<button type="button" class="sl-fav-toggle ${favoriteCoachIds.has(id)?'is-favorite':''}" data-action="favorite:${esc(id)}" aria-pressed="${favoriteCoachIds.has(id)}" aria-label="${favoriteCoachIds.has(id)?'取消收藏教練':'收藏教練'}">${favoriteCoachIds.has(id)?'♥ 已收藏':'♡ 收藏'}</button>`:'';
const coachCard=c=>`<div class="card coach-card"><div class="card-top">${photoAvatar(c)}<div><h3>${esc(c.display_name||c.name)}</h3><div class="muted">${esc(c.sport)} · ${esc(fullArea(c.area))}</div><div>${coachReviewSummary(c.id)}</div></div></div><p>${esc(c.description||c.desc||'')}</p><div class="row"><div><span class="price">NT$${Number(c.price).toLocaleString()}</span><span class="muted"> / 小時</span></div>${slFavoriteButton(c.id)}${btn('查看 / 預約','coach:'+c.id)}</div></div>`;
const slOpenPlayLevelOptions=selected=>Array.from({length:18},(_,i)=>i+1).map(level=>`<option value="${level}" ${Number(selected)===level?'selected':''}>${level} 級</option>`).join('');
const slOpenPlayFormatDate=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'時間待確認':date.toLocaleString('zh-TW',{year:'numeric',month:'numeric',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit'})};
const slOpenPlayGameCard=game=>{
  const spots=Math.max(0,Number(game.available_slots)||0);
  const status=game.registration_open?(spots>0?`尚有 ${spots} 個公開名額`:'目前額滿，可加入候補'):'已截止報名';
  const photoUrl=game.photo_path?supabaseClient.storage.from('sportlink-game-photos').getPublicUrl(game.photo_path).data.publicUrl:'';
  const cover=photoUrl?`<img class="sl-open-play-card-cover" src="${esc(photoUrl)}" alt="${esc(game.title)}的球局照片" loading="lazy" decoding="async">`:'<div class="sl-open-play-card-cover sl-open-play-card-cover-empty" aria-hidden="true"><span>SPORTLINK · BADMINTON OPEN PLAY</span><strong>🏸</strong></div>';
  return `<article class="card sl-open-play-card">${cover}<div class="sl-open-play-card-content"><div class="sl-open-play-card-main"><span class="pill">${esc(game.city)}${game.district?` · ${esc(game.district)}`:''}</span><h2>${esc(game.title)}</h2><p class="sl-open-play-card-meta"><span>${esc(slOpenPlayFormatDate(game.starts_at))}</span><span>${esc(game.venue_name)}</span></p></div><div class="sl-open-play-card-side"><span class="sl-open-play-availability ${spots>0&&game.registration_open?'is-open':''}">${status}</span><span class="muted small">NT$${Number(game.fee).toLocaleString()} / 人 · ${esc(game.level_min)}～${esc(game.level_max)} 級</span><button type="button" class="btn secondary" data-action="open-play-game:${esc(game.game_id)}">查看詳情／報名</button></div></div></article>`;
};
const slOpenPlayRegistrationForm=game=>!game.registration_open?'<p class="notice">此球局已截止報名。</p>':user?`<form class="form sl-open-play-register" data-game-registration="${esc(game.game_id)}"><h3>報名球局</h3><div class="sl-open-play-form-grid"><label>暱稱<input name="player_name" maxlength="60" required value="${esc(user.name)}"></label><label>羽球級數<select name="player_level" required><option value="">請選擇</option>${slOpenPlayLevelOptions('')}</select></label></div><label>備註（選填）<textarea name="note" maxlength="500" placeholder="可填寫想告訴團主的事項"></textarea></label><p class="muted small">若級數超出招收範圍，報名會送交團主審核；有候補時，新報名會依序排在候補隊伍後方。</p><button class="btn" type="submit">${Number(game.available_slots)>0?'送出報名':'加入候補'}</button><p class="sl-open-play-message" data-game-message role="status" aria-live="polite"></p></form>`:'<div class="sl-open-play-login"><p>登入後即可報名或加入候補。</p><button type="button" class="btn secondary" data-page="account">登入／註冊</button></div>';
function slOpenPlayGameDialog(game){
  if(!game)return '';
  const endDate=new Date(game.ends_at);
  const endLabel=Number.isNaN(endDate.getTime())?'':endDate.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'});
  return `<div class="sl-open-play-modal" role="presentation"><section class="sl-open-play-dialog" role="dialog" aria-modal="true" aria-labelledby="slOpenPlayDialogTitle" tabindex="-1"><header class="sl-open-play-dialog-head"><div><span class="pill">${esc(game.city)}${game.district?` · ${esc(game.district)}`:''}</span><h2 id="slOpenPlayDialogTitle">${esc(game.title)}</h2></div><button type="button" class="sl-open-play-dialog-close" data-action="open-play-close-game" aria-label="關閉球局資訊">×</button></header><dl class="sl-open-play-details"><div><dt>球館</dt><dd>${esc(game.venue_name)}${game.venue_address?` · ${esc(game.venue_address)}`:''}</dd></div><div><dt>時間</dt><dd>${esc(slOpenPlayFormatDate(game.starts_at))}${endLabel?`～${esc(endLabel)}`:''}</dd></div><div><dt>程度</dt><dd>${esc(game.level_min)}～${esc(game.level_max)} 級</dd></div><div><dt>費用</dt><dd>NT$${Number(game.fee).toLocaleString()} / 人</dd></div><div><dt>名額</dt><dd>${Number(game.confirmed_count)||0} / ${Number(game.capacity)||0} 人已確認；${Math.max(0,Number(game.available_slots)||0)} 個公開名額</dd></div><div><dt>報名截止</dt><dd>${game.registration_deadline?esc(slOpenPlayFormatDate(game.registration_deadline)):'團主未設定'}</dd></div></dl>${game.description?`<p class="sl-open-play-description">${esc(game.description)}</p>`:''}${slOpenPlayRegistrationForm(game)}</section></div>`;
}
function slOpenPlayCloseDialog(){
  const gameId=slOpenPlaySelectedGameId;
  if(!gameId)return;
  slOpenPlaySelectedGameId='';
  render();
  app.querySelectorAll('[data-action^="open-play-game:"]').forEach(button=>{if(button.dataset.action===`open-play-game:${gameId}`)button.focus()});
}
function slOpenPlayMyGamesView(){
  if(!user)return '<div class="empty">請先登入，再查看自己的報名球局。<p><button type="button" class="btn" data-page="account">登入／註冊</button></p></div>';
  if(slOpenPlayMyGamesError)return `<p class="notice" role="alert">${esc(slOpenPlayMyGamesError)}</p><button type="button" class="btn secondary" data-action="open-play-my-games-refresh">重新載入</button>`;
  if(slOpenPlayMyGamesLoading)return '<p class="empty" role="status">正在讀取已報名球局…</p>';
  if(!slOpenPlayMyGames.length)return '<div class="empty">目前沒有尚未開始的有效報名。報名成功後，球局時間會顯示在這裡。</div>';
  const labels={confirmed:'已確認',waitlisted:'候補中',pending_approval:'等待團主審核'};
  return `<div class="sl-open-play-my-list">${slOpenPlayMyGames.map(game=>`<article class="card sl-open-play-my-card"><div><span class="pill">${esc(game.city)}${game.district?` · ${esc(game.district)}`:''}</span><h2>${esc(game.title)}</h2><p>${esc(slOpenPlayFormatDate(game.starts_at))}${game.ends_at?`～${esc(new Date(game.ends_at).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'}))}`:''}</p><p class="muted">${esc(game.venue_name)} · NT$${Number(game.fee).toLocaleString()} / 人</p></div><div class="sl-open-play-my-status"><span class="sl-open-play-status sl-status-${esc(game.registration_status)}">${labels[game.registration_status]||'報名狀態更新中'}</span>${game.registration_status==='waitlisted'?`<span class="muted small">${game.waitlist_position?`候補第 ${Number(game.waitlist_position)} 位`:'候補順位依序安排'}</span>`:''}</div></article>`).join('')}</div>`;
}
function slOpenPlayHostGamesView(){
  if(!user)return '<div class="empty">請先登入，再查看自己開設的球局與報名名單。<p><button type="button" class="btn" data-page="account">登入／註冊</button></p></div>';
  if(slOpenPlayHostGamesError)return `<p class="notice" role="alert">${esc(slOpenPlayHostGamesError)}</p><button type="button" class="btn secondary" data-action="open-play-host-games-refresh">重新載入</button>`;
  if(slOpenPlayHostGamesLoading)return '<p class="empty" role="status">正在讀取你開設的球局與報名名單…</p>';
  if(!slOpenPlayHostGames.length)return '<div class="empty">目前沒有尚未開始的公開球局。建立球局後，可以在這裡查看報名者與資料。</div>';
  const statusLabels={confirmed:'已確認',waitlisted:'候補中',pending_approval:'等待審核',cancelled:'已取消',rejected:'未核准'};
  const groups=new Map();
  for(const row of slOpenPlayHostGames){
    if(!groups.has(row.game_id))groups.set(row.game_id,{game:row,registrations:[]});
    if(row.registration_id)groups.get(row.game_id).registrations.push(row);
  }
  return `<div class="sl-open-play-host-list">${[...groups.values()].map(({game,registrations})=>{
    const confirmed=registrations.filter(row=>row.registration_status==='confirmed').length;
    const waiting=registrations.filter(row=>row.registration_status==='waitlisted').length;
    const pending=registrations.filter(row=>row.registration_status==='pending_approval').length;
    const attendeeList=registrations.length?`<div class="sl-open-play-attendees">${registrations.map(row=>`<article class="sl-open-play-attendee"><div class="sl-open-play-attendee-head"><div><h3>${esc(row.player_name||'未提供暱稱')}</h3><span class="muted small">程度 ${Number(row.player_level)||'未提供'} 級 · 報名於 ${esc(slOpenPlayFormatDate(row.registered_at))}</span></div><span class="sl-open-play-status sl-status-${esc(row.registration_status)}">${statusLabels[row.registration_status]||'狀態更新中'}${row.registration_status==='waitlisted'&&row.waitlist_position?` · 第 ${Number(row.waitlist_position)} 位`:''}</span></div>${row.note?`<p class="sl-open-play-attendee-note"><b>備註：</b>${esc(row.note)}</p>`:'<p class="sl-open-play-attendee-note muted">沒有填寫備註</p>'}${row.registration_status==='pending_approval'?`<div class="sl-open-play-attendee-actions"><button type="button" class="btn" data-action="open-play-review:${esc(row.registration_id)}:approve" ${slOpenPlayReviewing?'disabled':''}>核准</button><button type="button" class="btn secondary" data-action="open-play-review:${esc(row.registration_id)}:reject" ${slOpenPlayReviewing?'disabled':''}>拒絕</button></div>`:''}</article>`).join('')}</div>`:'<p class="empty">目前還沒有球友報名。</p>';
    const photo=game.photo_path?`<img class="sl-open-play-host-photo" src="${esc(supabaseClient.storage.from('sportlink-game-photos').getPublicUrl(game.photo_path).data.publicUrl)}" alt="${esc(game.title)}的球局照片" loading="lazy">`:'';
    const photoForm=`<form class="sl-open-play-host-photo-form" data-host-game-photo="${esc(game.game_id)}" data-existing-photo="${esc(game.photo_path||'')}"><label>${game.photo_path?'更換球局照片':'新增球局照片'}<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required><span class="muted small">JPG、PNG 或 WebP，檔案上限 5 MB；照片會公開顯示。</span></label><button class="btn secondary" type="submit">上傳照片</button><p class="sl-open-play-message" data-photo-message role="status" aria-live="polite"></p></form>`;
    return `<article class="card sl-open-play-host-game"><header><div><span class="pill">${esc(game.city)}${game.district?` · ${esc(game.district)}`:''}</span><h2>${esc(game.title)}</h2><p>${esc(slOpenPlayFormatDate(game.starts_at))} · ${esc(game.venue_name)}</p></div><button type="button" class="btn secondary" data-action="open-play-host-games-refresh">重新整理</button></header>${photo}${photoForm}<p class="sl-open-play-host-summary">已確認 ${confirmed} 人 · 候補 ${waiting} 人 · 待審核 ${pending} 人</p><h3>報名名單（${registrations.length}）</h3>${attendeeList}</article>`;
  }).join('')}</div>`;
}
function slOpenPlayView(){
  const levelOptions=[`<option value="" ${slOpenPlayFilters.level?'':'selected'}>全部級數</option>`,slOpenPlayLevelOptions(slOpenPlayFilters.level)].join('');
  const content=slOpenPlayMode==='create'?slOpenPlayCreateForm():slOpenPlayMode==='registrations'?slOpenPlayMyGamesView():slOpenPlayMode==='host-games'?slOpenPlayHostGamesView():`<form id="slOpenPlayFilters" class="sl-open-play-filters" autocomplete="off"><label>縣市<input name="city" maxlength="40" placeholder="例如：新北市" value="${esc(slOpenPlayFilters.city)}"></label><label>行政區<input name="district" maxlength="40" placeholder="例如：板橋區" value="${esc(slOpenPlayFilters.district)}"></label><label>我的程度<select name="level" autocomplete="off">${levelOptions}</select></label><button class="btn" type="submit">搜尋球局</button><button class="btn secondary" type="button" data-action="open-play-refresh">清除篩選並重新整理</button></form>${slOpenPlayError?`<p class="notice" role="alert">${esc(slOpenPlayError)}</p>`:''}${slOpenPlayLoading?'<p class="empty" role="status">正在讀取公開球局…</p>':slOpenPlayGames.length?`<div class="sl-open-play-list">${slOpenPlayGames.map(slOpenPlayGameCard).join('')}</div>`:'<div class="empty">目前沒有符合條件的公開球局。你可以清除篩選後再查詢。</div>'}`;
  const title=slOpenPlayMode==='create'?'建立一場羽球零打':slOpenPlayMode==='registrations'?'我已報名的球局':slOpenPlayMode==='host-games'?'我開的球局':'找一場適合你的羽球零打';
  const description=slOpenPlayMode==='create'?'填寫球局資訊，發布後讓球友搜尋與報名。':slOpenPlayMode==='registrations'?'查看尚未開始、已確認或等待處理的報名場次。':slOpenPlayMode==='host-games'?'查看你開設的球局、報名者提供的資訊，並處理跨級審核。':'瀏覽公開球局，依地區與程度尋找場次。登入後即可報名；額滿時可以加入候補。';
  const selectedGame=slOpenPlayGames.find(game=>game.game_id===slOpenPlaySelectedGameId);
  return `<section class="sl-open-play-hero"><span class="eyebrow">SPORTLINK · BADMINTON OPEN PLAY</span><h1>${title}</h1><p>${description}</p><div class="sl-open-play-mode" role="group" aria-label="零打功能"><button type="button" class="${slOpenPlayMode==='list'?'is-active':''}" data-action="open-play-mode:list" aria-pressed="${slOpenPlayMode==='list'}">找球局</button><button type="button" class="${slOpenPlayMode==='create'?'is-active':''}" data-action="open-play-mode:create" aria-pressed="${slOpenPlayMode==='create'}">＋ 我要開團</button><button type="button" class="${slOpenPlayMode==='host-games'?'is-active':''}" data-action="open-play-mode:host-games" aria-pressed="${slOpenPlayMode==='host-games'}">我開的團</button><button type="button" class="${slOpenPlayMode==='registrations'?'is-active':''}" data-action="open-play-mode:registrations" aria-pressed="${slOpenPlayMode==='registrations'}">已報名</button></div></section>${slOpenPlayNotice?`<p class="notice sl-open-play-notice" role="status" aria-live="polite">${esc(slOpenPlayNotice)}</p>`:''}${content}${slOpenPlayMode==='list'?slOpenPlayGameDialog(selectedGame):''}`;
}
function slOpenPlayCreateForm(){
  if(!user)return `<div class="card sl-open-play-create"><p>登入 SportLink 後即可建立公開球局。</p><button type="button" class="btn" data-page="account">登入／註冊</button></div>`;
  return `<form id="slOpenPlayCreateForm" class="form sl-open-play-create"><div class="sl-open-play-create-grid"><label>球局名稱<input name="title" maxlength="120" placeholder="例如：週五晚上歡樂零打" required></label><label>球館名稱<input name="venue_name" maxlength="120" placeholder="例如：板橋運動中心" required></label><label>縣市<input name="city" maxlength="40" placeholder="例如：新北市" required></label><label>行政區<input name="district" maxlength="40" placeholder="例如：板橋區" required></label><label class="sl-open-play-address">球館地址（選填）<input name="venue_address" maxlength="300" placeholder="球館地址或交通資訊"></label><label>開始時間<input name="starts_at" type="datetime-local" required></label><label>結束時間<input name="ends_at" type="datetime-local" required></label><label>人數上限<input name="capacity" type="number" min="2" max="200" step="1" placeholder="例如：16" required></label><label>每人費用（NT$）<input name="fee" type="number" min="0" max="100000" step="1" placeholder="例如：200" required></label><label>最低程度<select name="level_min" required><option value="">選擇最低級數</option>${slOpenPlayLevelOptions('')}</select></label><label>最高程度<select name="level_max" required><option value="">選擇最高級數</option>${slOpenPlayLevelOptions('')}</select></label><label>報名截止時間（選填）<input name="registration_deadline" type="datetime-local"></label><label class="sl-open-play-description-field">球局說明（選填）<textarea name="description" maxlength="2000" placeholder="例如：自備球拍、球費分攤方式、注意事項"></textarea></label></div><label class="sl-open-play-photo-field">球局照片（選填，限 1 張）<input type="file" name="photo" accept="image/jpeg,image/png,image/webp"><span class="muted small">JPG、PNG 或 WebP，檔案上限 5 MB；照片會公開顯示。</span></label><p class="muted small">時間以台灣時間（UTC+8）解讀。發布後球局會公開顯示；固定球友保留名額目前尚未開放設定。</p><div class="row"><button class="btn" type="submit" ${slOpenPlayCreating?'disabled':''}>${slOpenPlayCreating?'發布中…':'發布球局'}</button><button class="btn secondary" type="button" data-action="open-play-mode:list">返回找球局</button></div><p id="slOpenPlayCreateMessage" class="sl-open-play-message" role="status" aria-live="polite"></p></form>`;
}
const slOpenPlayTimestamp=value=>value?`${value.length===16?value+':00':value}+08:00`:null;
async function slOpenPlayCreate(form){
  if(!user){page='account';render();return}
  const values=new FormData(form),startsAt=String(values.get('starts_at')||''),endsAt=String(values.get('ends_at')||''),deadline=String(values.get('registration_deadline')||'');
  const startDate=new Date(slOpenPlayTimestamp(startsAt)),endDate=new Date(slOpenPlayTimestamp(endsAt)),deadlineDate=deadline?new Date(slOpenPlayTimestamp(deadline)):null;
  const levelMin=Number(values.get('level_min')),levelMax=Number(values.get('level_max')),capacity=Number(values.get('capacity')),fee=Number(values.get('fee'));
  const photo=values.get('photo');
  const message=form.querySelector('#slOpenPlayCreateMessage'),submit=form.querySelector('button[type="submit"]');
  if(Number.isNaN(startDate.getTime())||Number.isNaN(endDate.getTime())||startDate<=new Date()||endDate<=startDate){message.textContent='請確認開始時間在未來，且結束時間晚於開始時間。';return}
  if(deadlineDate&&(!Number.isFinite(deadlineDate.getTime())||deadlineDate<=new Date()||deadlineDate>=startDate)){message.textContent='報名截止時間必須晚於現在，並早於球局開始時間。';return}
  if(!Number.isInteger(capacity)||capacity<2||capacity>200||!Number.isInteger(levelMin)||!Number.isInteger(levelMax)||levelMin<1||levelMax>18||levelMin>levelMax||!Number.isFinite(fee)||fee<0||fee>100000){message.textContent='請確認人數、費用及 1～18 級的程度範圍正確。';return}
  if(photo?.size&&(!['image/jpeg','image/png','image/webp'].includes(photo.type)||photo.size>5*1024*1024)){message.textContent='照片須為 JPG、PNG 或 WebP，且不可超過 5 MB。';return}
  slOpenPlayCreating=true;submit.disabled=true;submit.textContent='發布中…';message.textContent='正在建立球局…';
  try{
    const {data,error}=await supabaseClient.rpc('sportlink_create_game',{
      p_title:String(values.get('title')||'').trim(),
      p_venue_name:String(values.get('venue_name')||'').trim(),
      p_city:String(values.get('city')||'').trim(),
      p_district:String(values.get('district')||'').trim(),
      p_starts_at:slOpenPlayTimestamp(startsAt),
      p_ends_at:slOpenPlayTimestamp(endsAt),
      p_capacity:capacity,
      p_level_min:levelMin,
      p_level_max:levelMax,
      p_fee:fee,
      p_description:String(values.get('description')||'').trim()||null,
      p_venue_address:String(values.get('venue_address')||'').trim()||null,
      p_registration_deadline:slOpenPlayTimestamp(deadline)
    });
    if(error)throw error;
    if(typeof data!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data))throw Error('伺服器未回傳有效的球局編號，請重新整理確認球局是否已建立');
    let photoWarning='';
    if(photo?.size){
      const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[photo.type];
      const storagePath=`${user.id}/${data}/${crypto.randomUUID()}.${extension}`;
      try{
        const {error:uploadError}=await supabaseClient.storage.from('sportlink-game-photos').upload(storagePath,photo,{contentType:photo.type,cacheControl:'3600',upsert:false});
        if(uploadError)throw uploadError;
        const {data:photoSaved,error:photoError}=await supabaseClient.rpc('sportlink_set_game_photo',{p_game_id:data,p_storage_path:storagePath});
        if(photoError)throw photoError;
        if(photoSaved!==true)throw Error('伺服器未確認照片');
      }catch(photoError){photoWarning='球局已建立，但照片上傳失敗：'+errorText(photoError)+'。可先確認球局已發布，再重新處理照片。'}
    }
    slOpenPlayMode='list';slOpenPlaySelectedGameId='';slOpenPlayNotice=photoWarning||'球局已成功發布！現在可以在公開列表中查看。';slOpenPlayFilters={city:'',district:'',level:''};
    await slOpenPlayLoad(slOpenPlayFilters);
  }catch(error){message.textContent='建立球局失敗：'+errorText(error)}
  finally{slOpenPlayCreating=false;if(form.isConnected){submit.disabled=false;submit.textContent='發布球局'}}
}
async function slOpenPlayLoad(filters=slOpenPlayFilters){
  if(page!=='open-play')return;
  const request=++slOpenPlayRequest;
  slOpenPlayFilters={...filters};
  slOpenPlayLoading=true;slOpenPlayError='';render();
  try{
    const {data,error}=await supabaseClient.rpc('sportlink_list_games',{
      p_city:slOpenPlayFilters.city.trim()||null,
      p_district:slOpenPlayFilters.district.trim()||null,
      p_level:slOpenPlayFilters.level?Number(slOpenPlayFilters.level):null,
      p_limit:50,
      p_offset:0
    });
    if(error)throw error;
    if(request!==slOpenPlayRequest)return;
    slOpenPlayGames=Array.isArray(data)?data:[];
  }catch(error){
    if(request!==slOpenPlayRequest)return;
    slOpenPlayError='讀取球局失敗：'+errorText(error);
    slOpenPlayGames=[];
  }finally{
    if(request===slOpenPlayRequest){slOpenPlayLoading=false;if(page==='open-play')render()}
  }
}
async function slOpenPlayMyGamesLoad(){
  if(!user){slOpenPlayMyGames=[];slOpenPlayMyGamesError='';slOpenPlayMyGamesLoading=false;render();return}
  const request=++slOpenPlayMyGamesRequest;
  slOpenPlayMyGamesLoading=true;slOpenPlayMyGamesError='';render();
  try{
    const {data,error}=await supabaseClient.rpc('sportlink_my_game_registrations');
    if(error)throw error;
    if(request!==slOpenPlayMyGamesRequest)return;
    slOpenPlayMyGames=Array.isArray(data)?data:[];
  }catch(error){
    if(request!==slOpenPlayMyGamesRequest)return;
    slOpenPlayMyGamesError=error?.code==='PGRST202'||/could not find the function .* in the schema cache/i.test(String(error?.message||''))?'資料庫尚未找到已報名清單功能。請在 Supabase SQL Editor 執行 20261105220000_open_play_registrations_and_photos.sql，成功後再重新載入。':'讀取已報名球局失敗：'+errorText(error);
    slOpenPlayMyGames=[];
  }finally{
    if(request===slOpenPlayMyGamesRequest){slOpenPlayMyGamesLoading=false;if(page==='open-play'&&slOpenPlayMode==='registrations')render()}
  }
}
async function slOpenPlayHostGamesLoad(){
  if(!user){slOpenPlayHostGames=[];slOpenPlayHostGamesError='';slOpenPlayHostGamesLoading=false;render();return}
  const request=++slOpenPlayHostGamesRequest;
  slOpenPlayHostGamesLoading=true;slOpenPlayHostGamesError='';render();
  try{
    const {data,error}=await supabaseClient.rpc('sportlink_hosted_games');
    if(error)throw error;
    if(request!==slOpenPlayHostGamesRequest)return;
    slOpenPlayHostGames=Array.isArray(data)?data:[];
  }catch(error){
    if(request!==slOpenPlayHostGamesRequest)return;
    slOpenPlayHostGamesError=error?.code==='PGRST202'||/could not find the function .* in the schema cache/i.test(String(error?.message||''))?'資料庫尚未找到團主名單功能。請在 Supabase SQL Editor 執行最新的團主功能 migration，成功後再重新載入。':'讀取我開的球局與報名名單失敗：'+errorText(error);
    slOpenPlayHostGames=[];
  }finally{
    if(request===slOpenPlayHostGamesRequest){slOpenPlayHostGamesLoading=false;if(page==='open-play'&&slOpenPlayMode==='host-games')render()}
  }
}
const jobCard=j=>`<div class="card"><div class="row"><span class="pill">${esc(j.sport)}代課</span><b class="price">NT$${Number(j.rate).toLocaleString()} / 小時</b></div><h3>${esc(fullArea(j.area))} · ${esc(j.date)}</h3><p class="muted">${esc(j.time)} 開始 · ${esc(j.hours)} 小時</p><p>${esc(j.detail)}</p><div class="row"><span class="muted">${j.status==='open'?'招募中':'已媒合'}</span>${btn('查看 / 申請','job:'+j.id,'btn secondary')}</div></div>`;
const allCoaches=()=>liveCoaches;
async function refreshData(){
  const {data:publicCoaches,error:ce}=await retryRead(()=>supabaseClient.from('coaches').select('id,user_id,display_name,sport,area,price,description,is_active,photo_url,teaching_years,teaching_experience,certificate_name').eq('is_active',true).eq('sport','羽球').order('created_at',{ascending:false}));
  if(ce)throw ce;liveCoaches=publicCoaches||[];
  const {data:reviews,error:re}=await retryRead(()=>supabaseClient.from('coach_reviews').select('booking_id,coach_id,rating,comment,created_at').order('created_at',{ascending:false}));
  if(re)throw re;coachReviews=reviews||[];
  if(!user){admin=false;coachProfile=null;bookings=[];myReviews=[];favoriteCoachIds=new Set();favoritesReady=false;availabilitySlots=[];availabilityError='';return}
  const [a,c,b]=await Promise.all([
    supabaseClient.rpc('is_platform_admin'),
    supabaseClient.from('coaches').select('*').eq('user_id',user.id).maybeSingle(),
    supabaseClient.from('bookings').select('id,student_id,coach_id,lesson_date,lesson_time,duration_minutes,note,status,created_at,coaches(display_name,sport)').order('created_at',{ascending:false})
  ]);
  if(a.error)throw a.error;if(c.error)throw c.error;if(b.error)throw b.error;
  admin=!!a.data;coachProfile=c.data;bookings=b.data||[];
  const favoriteResult=await supabaseClient.from('sportlink_favorite_coaches').select('coach_id').eq('student_id',user.id);
  favoritesReady=!favoriteResult.error;
  favoriteCoachIds=new Set((favoriteResult.data||[]).map(row=>row.coach_id));
  const {data:ownReviews,error:ownReviewError}=await supabaseClient.from('coach_reviews').select('booking_id').eq('student_id',user.id);
  if(ownReviewError)throw ownReviewError;myReviews=ownReviews||[];
  availabilitySlots=[];availabilityError='';
  if(coachProfile){
    const {data:slots,error:slotError}=await supabaseClient.from('sportlink_open_blocks')
      .select('id,coach_id,lesson_date,start_time,end_time,allowed_minutes')
      .eq('coach_id',coachProfile.id).order('lesson_date',{ascending:true}).order('start_time',{ascending:true});
    if(slotError)availabilityError=slotError.message;
    else availabilitySlots=slots||[];
  }
}
async function reload(){
  if(loadingData)return;
  loadingData=true;
  try{await refreshData();render()}
  catch(e){console.error('SportLink data refresh:',e);render();showConnectionNotice('雲端資料暫時無法更新：'+errorText(e))}
  finally{loadingData=false}
}
function showConnectionNotice(message){
  let notice=document.getElementById('sl-connection-notice');
  if(!notice){notice=document.createElement('div');notice.id='sl-connection-notice';notice.setAttribute('role','status');notice.style.cssText='position:fixed;bottom:16px;left:16px;right:16px;max-width:540px;margin:auto;z-index:10000;padding:12px 16px;background:#fff3df;color:#643e00;border:1px solid #d6b57e;border-radius:12px;box-shadow:0 6px 20px #0002';document.body.append(notice)}
  notice.textContent=message;
  clearTimeout(showConnectionNotice.timer);
  showConnectionNotice.timer=setTimeout(()=>notice.remove(),8000);
}
const slClock=d=>Number.isFinite(d.getTime())?`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`:'--:--';
const slMins=t=>{const [h,m]=String(t).slice(0,5).split(':').map(Number);return h*60+m};
const slTime=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const slDurationLabel=n=>`${n/60} 小時`;
const slIsBusy=(start,end,busy)=>busy.some(b=>{const bs=slMins(b.lesson_time),be=bs+(Number(b.duration_minutes)||60);return start<be&&end>bs});
const slDayBlocks=(blocks,date)=>blocks.filter(b=>b.lesson_date===date).sort((a,b)=>slMins(a.start_time)-slMins(b.start_time));
function slScheduleHtml(blocks,busy,date,selection=null){
 const daily=slDayBlocks(blocks,date);
 if(!daily.length)return '<div class="sl-schedule-empty">這天沒有開放時段，請選擇其他日期。</div>';
 const cells=[];
 for(const block of daily){
   for(let t=slMins(block.start_time);t+30<=slMins(block.end_time);t+=30){
     const blocked=slIsBusy(t,t+30,busy);
     const picked=!blocked&&selection&&selection.start>=0&&t>=selection.start&&t<selection.start+(selection.duration||30);
     const enabled=!blocked&&new Date(date+'T'+slTime(t)+':00')>new Date()&&(block.allowed_minutes||[]).some(n=>t+n<=slMins(block.end_time)&&!slIsBusy(t,t+n,busy));
     cells.push(`<button type="button" class="sl-time-cell ${picked?'is-selected':blocked?'is-booked':'is-free'}" data-sl-time="${t}" ${enabled?'':'disabled'} title="${slTime(t)}～${slTime(t+30)}"><span>${slTime(t)}</span><small>${picked?'已選取':blocked?'已預約':'可預約'}</small></button>`);
   }
 }
 return `<div class="sl-time-grid">${cells.join('')}</div><div class="sl-schedule-legend"><span>● 可預約</span><span>● 已選取</span><span>● 已預約</span></div>`;
}
function bookingCard(b){
  const coachName=b.coaches?.display_name||'教練';
  const sport=b.coaches?.sport||'課程';
  const owned=coachProfile?.id===b.coach_id;
  const isStudent=b.student_id===user?.id;
  // lesson_date / lesson_time are Taiwan local calendar values in this project.
  const lessonStart=new Date(`${b.lesson_date}T${String(b.lesson_time).slice(0,8)}`);
  const lessonEnd=new Date(lessonStart.getTime()+(Number(b.duration_minutes)||60)*60000);
  const canCancel=(isStudent&&b.status==='pending')||(owned&&b.status==='accepted');
  const canComplete=owned&&b.status==='accepted'&&Number.isFinite(lessonEnd.getTime())&&lessonEnd.getTime()<=Date.now();
  const canReview=isStudent&&!coachProfile&&user?.role!=='coach'&&b.status==='completed'&&!myReviews.some(r=>r.booking_id===b.id);
  const reviewed=isStudent&&b.status==='completed'&&myReviews.some(r=>r.booking_id===b.id);
  const cancelInfo=isStudent&&b.status==='accepted'&&!owned?'<p class="muted small">教練已接受預約，如需取消請聯絡教練。</p>':'';
  const heading=owned&&b.student_name?`${b.student_name} · ${sport}`:`${sport} · ${coachName}`;
  return `<div class="item"><div class="row"><b>${esc(heading)}</b><span class="pill">${statusLabel[b.status]||esc(b.status)}</span></div><p class="muted">${esc(b.lesson_date)} ${esc(String(b.lesson_time).slice(0,5))}～${esc(slClock(lessonEnd))} · ${esc((Number(b.duration_minutes)||60)/60)} 小時 · 預約編號 ${esc(b.id.slice(0,8))}</p><p>${esc(b.note)}</p>${b.status==='pending'&&owned?btn('接受預約','booking-accept:'+b.id)+' '+btn('拒絕預約','booking-reject:'+b.id,'btn secondary'):''}${canCancel?btn('取消預約','booking-cancel:'+b.id,'btn secondary'):''}${canComplete?btn('標記課程完成','booking-complete:'+b.id,'btn secondary'):''}${canReview?btn('評價教練（自願）','review:'+b.id,'btn secondary'):''}${reviewed?'<p class="muted small">已提交評價，無法修改或刪除。</p>':''}${cancelInfo}</div>`;
}
// Archive completed/cancelled/rejected bookings without deleting any records.
const slArchivedStatuses=new Set(['completed','cancelled','rejected']);
function slBookingSection(title,items,emptyText,archiveId,mode='student'){
  const current=items.filter(b=>!slArchivedStatuses.has(b.status));
  const history=items.filter(b=>slArchivedStatuses.has(b.status));
  const coachMode=mode==='coach';
  const pending=current.filter(b=>b.status==='pending').length;
  const accepted=current.filter(b=>b.status==='accepted').length;
  const summary=coachMode?`<div class="sl-board-stats"><div><small>進行中預約</small><strong>${current.length}</strong></div><div><small>待確認</small><strong>${pending}</strong></div><div><small>已接受</small><strong>${accepted}</strong></div></div><div class="sl-board-filters" role="group" aria-label="篩選學生預約"><button type="button" class="sl-board-filter is-active" data-board-filter="all" aria-pressed="true">全部</button><button type="button" class="sl-board-filter" data-board-filter="pending" aria-pressed="false">待確認</button><button type="button" class="sl-board-filter" data-board-filter="accepted" aria-pressed="false">已接受</button></div>`:'';
  const cards=current.map(b=>{
    const duration=Number(b.duration_minutes)||60;
    const start=slMins(b.lesson_time);
    const end=slTime(start+duration);
    const day=String(b.lesson_date||'');
    const dateText=day.slice(5).replace('-','/');
    return `<div class="sl-board-entry" data-board-status="${esc(b.status)}"><div class="sl-board-date"><strong>${esc(dateText)}</strong><small>${esc(day.slice(0,4))}</small></div><div class="sl-board-card">${bookingCard(b).replace('class="item"','class="item sl-board-booking"')}<div class="sl-board-meta">${esc(String(b.lesson_time).slice(0,5))}–${esc(end)} · ${esc(slDurationLabel(duration))}</div></div></div>`;
  }).join('');
  return `<section class="section sl-booking-section ${coachMode?'sl-coach-board':'sl-student-board'}" id="${archiveId}-section"><div class="sl-board-heading"><span class="eyebrow">${coachMode?'COACH BOOKING BOARD':'MY LESSONS'}</span><h2>${title}</h2><p class="muted">${coachMode?'快速查看學生預約，優先處理待確認課程。':'查看自己的課程時間、預約狀態與歷史紀錄。'}</p></div>${summary}<div class="sl-board-list">${cards||`<div class="item muted">${emptyText}</div>`}</div><div class="sl-board-no-results hidden">這個分類目前沒有預約。</div><details class="sl-history" id="${archiveId}"><summary>歷史預約紀錄 <span class="sl-history-count">${history.length} 筆</span></summary><div class="sl-history-inner"><label class="sl-history-label" for="${archiveId}-date">依上課日期查詢</label><div class="sl-history-controls"><input id="${archiveId}-date" type="date" class="field sl-history-date" data-history-date="${archiveId}"><button type="button" class="btn secondary" data-history-clear="${archiveId}">清除日期</button></div><p class="muted small">依課程日期篩選；點開紀錄可查看預約詳情。</p><div class="sl-history-results" id="${archiveId}-results">${slHistoryCards(history,'')}</div></div></details></section>`;
}
// Student dashboard: distinct course overview, using only live booking records.
function slStudentDashboard(items){
  const active=items.filter(b=>!slArchivedStatuses.has(b.status));
  const accepted=active.filter(b=>b.status==='accepted');
  const pending=active.filter(b=>b.status==='pending');
  const archived=items.filter(b=>slArchivedStatuses.has(b.status));
  const completed=archived.filter(b=>b.status==='completed');
  const now=Date.now();
  const upcoming=accepted.filter(b=>new Date(`${b.lesson_date}T${String(b.lesson_time).slice(0,8)}`).getTime()>=now).sort((a,b)=>String(a.lesson_date+a.lesson_time).localeCompare(String(b.lesson_date+b.lesson_time)));
  const otherAccepted=accepted.filter(b=>!upcoming.includes(b));
  const groups=[['upcoming','即將上課',upcoming,'目前沒有即將開始的課程。'],['pending','待確認',pending,'目前沒有待教練確認的預約。'],['other','已接受',otherAccepted,'沒有其他已接受的課程。']];
  const entry=b=>{
    const date=String(b.lesson_date||'');
    const duration=Number(b.duration_minutes)||60;
    const start=slMins(b.lesson_time);
    const month=Number(date.slice(5,7));
    const day=Number(date.slice(8,10));
    return `<article class="sl-student-lesson"><div class="sl-student-date"><small>${month}月</small><strong>${day}</strong><span>${esc(String(b.lesson_time).slice(0,5))}</span></div><div class="sl-student-lesson-main"><div class="sl-student-lesson-top"><strong>${esc(b.coaches?.sport||'運動')}私人課程</strong><span class="sl-student-status sl-status-${esc(b.status)}">${statusLabel[b.status]||esc(b.status)}</span></div><p class="sl-student-coach">${esc(b.coaches?.display_name||'教練')} · ${esc(String(b.lesson_time).slice(0,5))}–${esc(slTime(start+duration))}</p><div class="sl-student-lesson-bottom"><span>◷ ${esc(slDurationLabel(duration))}</span><details class="sl-student-detail"><summary>課程詳情</summary>${bookingCard(b)}</details></div></div></article>`;
  };
  const next=upcoming[0];
  const nextCoach=next?liveCoaches.find(c=>c.id===next.coach_id):null;
  const nextHtml=`<section class="sl-next-class"><div class="sl-next-top"><span>✦ NEXT SESSION · 下一堂課</span><span class="sl-next-mark">↗</span></div>${next?`<h2>${Number(next.lesson_date.slice(5,7))}月${Number(next.lesson_date.slice(8,10))}日 · ${esc(next.coaches?.sport||'運動')}課程</h2><p>${esc(next.coaches?.display_name||'教練')} · ${esc(String(next.lesson_time).slice(0,5))}–${esc(slTime(slMins(next.lesson_time)+(Number(next.duration_minutes)||60)))}</p><div class="sl-next-footer"><span>✓ 已接受 · ${esc(slDurationLabel(Number(next.duration_minutes)||60))}</span>${nextCoach?btn('查看教練 ↗','coach:'+nextCoach.id,'btn secondary'):''}</div>`:`<h2>下一堂精彩課程，等你安排</h2><p>目前沒有即將開始的已接受課程，探索適合你的運動教練。</p><div class="sl-next-footer">${btn('探索教練 ↗','go:coaches','btn secondary')}</div>`}</section>`;
  const today=new Date();const monthBase=new Date(today.getFullYear(),today.getMonth(),1);
  const calendarHtml=`<section class="sl-calendar-card"><div class="sl-widget-title"><div><span class="eyebrow">MY CALENDAR</span><h3>我的運動行事曆</h3></div><div class="sl-calendar-nav"><button type="button" data-calendar-step="-1" aria-label="上個月">‹</button><strong id="sl-calendar-month"></strong><button type="button" data-calendar-step="1" aria-label="下個月">›</button></div></div><div id="sl-calendar-grid" class="sl-calendar-grid" role="group" aria-label="課程月曆"></div><div id="sl-calendar-detail" class="sl-calendar-detail" aria-live="polite"></div></section>`;
  const favoriteCoaches=liveCoaches.filter(c=>favoriteCoachIds.has(c.id));
  const favoriteHtml=`<section class="sl-favorites-card"><div class="sl-widget-title"><div><span class="eyebrow">MY FAVORITES</span><h3>♡ 我的收藏教練</h3></div><span class="sl-fav-count">${favoriteCoaches.length} 位</span></div>${favoritesReady?(favoriteCoaches.length?`<div class="sl-fav-list">${favoriteCoaches.map(c=>`<div class="sl-fav-row">${photoAvatar(c)}<div class="sl-fav-info"><strong>${esc(c.display_name)}</strong><small>${esc(c.sport)} · ${esc(fullArea(c.area))}</small></div><div class="sl-fav-actions">${btn('查看／預約 ↗','coach:'+c.id,'btn secondary')}${slFavoriteButton(c.id)}</div></div>`).join('')}</div>`:`<div class="sl-fav-empty">還沒有收藏教練。到探索教練頁面點選 ♡，就能在這裡快速找到他們。</div>`):`<div class="sl-fav-empty">收藏功能尚未啟用，請先執行隨附的 Supabase SQL 設定。</div>`}<div class="sl-fav-bottom">${btn('探索更多教練 ↗','go:coaches','btn secondary')}</div></section>`;
  const widgets=`${nextHtml}<div class="sl-student-widgets">${calendarHtml}${favoriteHtml}</div>`;
  return `<section class="section sl-student-dashboard" id="sl-my-history-section">${widgets}<div class="sl-student-head"><div><span class="eyebrow">MY SPORT DASHBOARD</span><h2>我的運動課程</h2><p>上課安排、待確認預約與課程紀錄，一眼就能掌握。</p></div><div class="sl-student-head-icon" aria-hidden="true">▦</div></div><div class="sl-student-stats"><div><small>即將上課</small><strong>${upcoming.length}</strong><span>堂課</span></div><div><small>待確認</small><strong>${pending.length}</strong><span>筆預約</span></div><div><small>已完成</small><strong>${completed.length}</strong><span>堂課</span></div></div><div class="sl-student-tabs" role="group" aria-label="篩選我的課程"><button type="button" class="sl-student-tab is-active" data-student-tab="upcoming" aria-pressed="true">即將上課</button><button type="button" class="sl-student-tab" data-student-tab="pending" aria-pressed="false">待確認</button><button type="button" class="sl-student-tab" data-student-tab="history" aria-pressed="false">歷史紀錄</button></div><div class="sl-student-panels">${groups.map(([key,title,list,empty])=>`<div class="sl-student-panel ${key==='upcoming'?'':'hidden'}" data-student-panel="${key}"><h3>${title}</h3>${list.length?list.map(entry).join(''):`<div class="sl-student-empty">${empty}</div>`}</div>`).join('')}<div class="sl-student-panel hidden" data-student-panel="history"><h3>歷史課程</h3><p class="muted small">已完成、取消或拒絕的預約都保留在這裡。</p><label class="sl-history-label" for="sl-my-history-date">依上課日期查詢</label><div class="sl-history-controls"><input id="sl-my-history-date" type="date" class="field sl-history-date" data-history-date="sl-my-history"><button type="button" class="btn secondary" data-history-clear="sl-my-history">清除日期</button></div><div class="sl-history-results" id="sl-my-history-results">${slHistoryCards(archived,'')}</div></div></div>${otherAccepted.length?`<details class="sl-student-other"><summary>其他已接受課程（${otherAccepted.length}）</summary>${otherAccepted.map(entry).join('')}</details>`:''}</section>`;
}
function slSetupStudentCalendar(items){
 const grid=app.querySelector('#sl-calendar-grid'),label=app.querySelector('#sl-calendar-month'),detail=app.querySelector('#sl-calendar-detail');if(!grid)return;
 const today=new Date();let year=today.getFullYear(),month=today.getMonth();let selected='';
 const lessonItems=items.filter(b=>['pending','accepted','completed'].includes(b.status));
 function paint(){const first=new Date(year,month,1).getDay(),days=new Date(year,month+1,0).getDate();label.textContent=`${year} 年 ${month+1} 月`;
 const head=['日','一','二','三','四','五','六'].map(d=>`<span class="sl-calendar-weekday">${d}</span>`).join('');
 let cells='';for(let i=0;i<first;i++)cells+='<span class="sl-calendar-blank"></span>';
 for(let day=1;day<=days;day++){const date=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`,has=lessonItems.some(b=>b.lesson_date===date);cells+=`<button type="button" class="sl-calendar-day ${has?'has-lesson':''} ${date===selected?'selected':''}" data-calendar-date="${date}" aria-label="${date}${has?' 有課程':''}" aria-pressed="${date===selected}"><span>${day}</span>${has?'<i aria-hidden="true"></i>':''}</button>`}
 grid.innerHTML=head+cells;const matches=lessonItems.filter(b=>b.lesson_date===selected);detail.innerHTML=selected?`<strong>${esc(selected)} · ${matches.length} 堂課</strong>${matches.length?matches.map(b=>`<div class="sl-calendar-class"><span>${esc(String(b.lesson_time).slice(0,5))} · ${esc(b.coaches?.sport||'課程')} · ${esc(b.coaches?.display_name||'教練')}</span><span>${esc(statusLabel[b.status]||b.status)}</span></div>`).join(''):'<p>這一天沒有課程。</p>'}`:'<p>點選有標記的日期，查看當天的課程安排。</p>';
 }
 grid.addEventListener('click',e=>{const b=e.target.closest('[data-calendar-date]');if(!b)return;selected=b.dataset.calendarDate;paint()});
 app.querySelectorAll('[data-calendar-step]').forEach(b=>b.addEventListener('click',()=>{const d=new Date(year,month+Number(b.dataset.calendarStep),1);year=d.getFullYear();month=d.getMonth();selected='';paint()}));
 const upcoming=lessonItems.filter(b=>b.lesson_date>=`${year}-${String(month+1).padStart(2,'0')}-01`).sort((a,b)=>a.lesson_date.localeCompare(b.lesson_date));
 if(upcoming.length){const d=upcoming[0].lesson_date.split('-');year=Number(d[0]);month=Number(d[1])-1;selected=upcoming[0].lesson_date;}
 paint();
}
function slHistoryCards(history,date){
  const found=history.filter(b=>!date||b.lesson_date===date);
  return found.length?found.map(b=>`<details class="sl-history-record"><summary><span><strong>${esc(b.lesson_date)} ${esc(String(b.lesson_time).slice(0,5))}</strong>　${esc(b.coaches?.sport||'課程')} · ${esc(b.coaches?.display_name||'教練')}</span><span class="pill">${statusLabel[b.status]||esc(b.status)}</span></summary><div class="sl-history-record-body">${bookingCard(b)}</div></details>`).join(''):'<div class="item muted">這個日期沒有歷史預約紀錄。</div>';
}
function coachEditPanel(){
  if(!coachProfile)return '';
  return `<section class="section sl-coach-profile"><div class="sl-board-heading"><span class="eyebrow">COACH PROFILE</span><h2>教練資料管理</h2><p class="muted">需要修改時再展開對應項目，讓管理頁面更簡潔。</p></div><details class="sl-profile-fold"><summary><span>📷　教練大頭照</span><small>查看或更換公開照片</small></summary><div class="sl-profile-body"><h2>教練大頭照</h2>
    <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin:12px 0">${photoAvatar(coachProfile,true)}
      <form id="coachPhotoForm" class="form" style="flex:1;min-width:220px">
        <label>選擇照片（JPG、PNG、WebP，最多 5 MB）<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required></label>
        <button class="btn" type="submit">上傳 / 更換大頭照</button>
        <p class="muted small" id="coachPhotoMessage" role="status">照片公開顯示，請勿上傳證件或私人資訊。</p>
      </form></div></div></details>
    <details class="sl-profile-fold"><summary><span>👤　基本教練資料</span><small>名稱、運動、地區、價格與介紹</small></summary><div class="sl-profile-body"><h2>編輯教練資料</h2><p class="muted">修改後會同步更新公開的教練介紹，不會影響平台審核狀態。</p>
    <form class="form" id="coachEditForm">
      <label>公開顯示名稱<input name="display_name" maxlength="60" required value="${esc(coachProfile.display_name)}"></label>
      <label>運動項目<input value="羽球" readonly></label>
      <label>授課地區（雙北及桃園）<select name="area" required>${areaOptions(coachProfile.area)}</select></label>
      <label>每小時價格（NT$）<input name="price" type="number" min="1" max="100000" step="1" required value="${esc(coachProfile.price)}"></label>
      <label>教學介紹<textarea name="description" maxlength="1000" required>${esc(coachProfile.description)}</textarea></label>
      <button class="btn" type="submit">儲存教練資料</button>
    </form></div></details>
    <details class="sl-profile-fold"><summary><span>🎓　教學資歷與專業證照</span><small>年資、經歷、證照及私人照片</small></summary><div class="sl-profile-body"><h2>教學資歷與專業證照</h2>
      <p class="muted">年資、經歷及證照名稱會公開顯示；證照照片保存在私人空間。</p>
      <form class="form" id="coachCredentialsForm">
        <label>教學年資（年）<input name="teaching_years" type="number" min="0" max="80" step="1" required value="${esc(coachProfile.teaching_years??0)}"></label>
        <label>教學經歷<textarea name="teaching_experience" maxlength="2000">${esc(coachProfile.teaching_experience||'')}</textarea></label>
        <label>專業證照名稱<input name="certificate_name" maxlength="200" value="${esc(coachProfile.certificate_name||'')}"></label>
        <button class="btn" type="submit">儲存教學資歷</button><p class="muted small" id="credentialsMessage" role="status"></p>
      </form>
      <form class="form" id="coachCertificateForm">
        <label>證照照片（JPG、PNG、WebP，最多 5 MB）<input type="file" name="certificate" accept="image/jpeg,image/png,image/webp" required></label>
        <button class="btn secondary" type="submit">上傳 / 更換證照照片</button>
        <p class="muted small" id="certificateMessage" role="status">${coachProfile.certificate_path?'已儲存證照照片（不公開）':'尚未上傳證照照片。'}</p>
      </form>
    </div></details></section>`;
}
function availabilityPanel(){
 if(!coachProfile)return '';
 if(!coachProfile.is_active)return '<p class="muted">教練通過審核後才能開放預約時段。</p>';
 const slots=availabilitySlots.map(b=>`<div class="sl-block-row"><div><b>${esc(b.lesson_date)}</b><p>${esc(String(b.start_time).slice(0,5))}～${esc(String(b.end_time).slice(0,5))} · 可預約 ${esc((b.allowed_minutes||[]).map(slDurationLabel).join('、'))}</p></div>${btn('移除時段','block-remove:'+b.id,'btn secondary')}</div>`).join('');
 return `<section class="section sl-block-manager"><div class="sl-section-title"><span class="eyebrow">COACH SCHEDULE</span><h2>我的開放時段</h2><p class="muted">設定一整段教學時間，學生可預約其中一部分。已預約的時間不會重複開放。</p></div>
 ${availabilityError?`<p class="notice">時段讀取失敗：${esc(availabilityError)}</p>`:''}
 <form class="sl-block-form" id="availabilityForm">
  <label>上課日期<input name="date" type="date" min="${dateToday()}" required></label>
  <label>開始時間<input name="start" type="time" step="1800" value="13:00" required></label>
  <label>結束時間<input name="end" type="time" step="1800" value="18:00" required></label>
  <fieldset class="sl-duration-options"><legend>學生可以預約的時長（可複選）</legend><label><input type="checkbox" name="duration" value="60" checked> 1 小時</label><label><input type="checkbox" name="duration" value="90"> 1.5 小時</label><label><input type="checkbox" name="duration" value="120" checked> 2 小時</label><label><input type="checkbox" name="duration" value="180"> 3 小時</label></fieldset>
  <button class="btn" type="submit">＋ 新增開放時段</button><p class="muted small">時間以台灣時間計算，單次最多開放 12 小時。已存在預約的時段無法直接刪除。</p>
 </form><div class="sl-block-list">${slots||'<p class="muted">目前沒有開放時段。</p>'}</div></section>`;
}

function slCoachCalendarPanel(){
  return `<section class="section sl-coach-calendar-card" aria-label="教練課程行事曆">
    <div class="sl-coach-calendar-heading">
      <div><span class="eyebrow">COACH CALENDAR</span><h2>教練行事曆</h2><p class="muted">查看每月課程日期，點選有標記的日期查看學生與上課時間。</p></div>
      <div class="sl-calendar-nav"><button type="button" data-coach-calendar-step="-1" aria-label="上個月">‹</button><strong id="sl-coach-calendar-month"></strong><button type="button" data-coach-calendar-step="1" aria-label="下個月">›</button></div>
    </div>
    <div id="sl-coach-calendar-grid" class="sl-calendar-grid sl-coach-calendar-grid" role="group" aria-label="教練課程月曆"></div>
    <div id="sl-coach-calendar-detail" class="sl-calendar-detail sl-coach-calendar-detail" aria-live="polite"><p>正在讀取本月課程…</p></div>
    <div id="sl-coach-calendar-modal"></div>
  </section>`;
}
function slSetupCoachCalendar(received){
  const grid=app.querySelector('#sl-coach-calendar-grid');
  const label=app.querySelector('#sl-coach-calendar-month');
  const detail=app.querySelector('#sl-coach-calendar-detail');
  if(!grid||!label||!detail)return;
  const today=dateToday();
  const current=new Date();
  let year=current.getFullYear(),month=current.getMonth(),selected='';
  let lessons=[],loading=false,error='',request=0,dialogOpen=false;
  const monthStart=()=>`${year}-${String(month+1).padStart(2,'0')}-01`;
  function paint(){
    const first=new Date(year,month,1).getDay(),days=new Date(year,month+1,0).getDate();
    label.textContent=`${year} 年 ${month+1} 月`;
    const weekdays=['日','一','二','三','四','五','六'].map(day=>`<span class="sl-calendar-weekday">${day}</span>`).join('');
    let cells='';
    for(let i=0;i<first;i++)cells+='<span class="sl-calendar-blank"></span>';
    for(let day=1;day<=days;day++){
      const date=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const hasLesson=lessons.some(lesson=>lesson.lesson_date===date);
      const count=lessons.filter(lesson=>lesson.lesson_date===date).length;
      cells+=`<button type="button" class="sl-calendar-day ${hasLesson?'has-lesson':''} ${date===selected?'selected':''}" data-coach-calendar-date="${date}" aria-label="${date}${hasLesson?` 有 ${count} 堂課`:''}" aria-pressed="${date===selected}"><span>${day}</span>${hasLesson?`<i aria-hidden="true"></i>`:''}</button>`;
    }
    grid.innerHTML=weekdays+cells;
    const modal=app.querySelector('#sl-coach-calendar-modal');
    if(loading){modal.innerHTML='';detail.innerHTML='<p>正在讀取本月課程…</p>';return}
    if(error){modal.innerHTML='';detail.innerHTML=`<p class="notice">行事曆讀取失敗：${esc(error)}</p>`;return}
    detail.innerHTML='<p>點選有標記的日期，在彈出視窗查看當天完整課程列表。</p>';
    if(!dialogOpen||!selected){modal.innerHTML='';return}
    const matches=lessons.filter(lesson=>lesson.lesson_date===selected)
      .sort((a,b)=>String(a.lesson_time).localeCompare(String(b.lesson_time)));
    const [,selectedMonth,selectedDay]=selected.split('-');
    const weekday=new Date(year,month,Number(selectedDay)).toLocaleDateString('zh-TW',{weekday:'long'});
    modal.dataset.date=selected;
    modal.innerHTML=`<div class="sl-coach-calendar-modal" role="presentation"><section class="sl-coach-calendar-dialog" role="dialog" aria-modal="true" aria-labelledby="slCoachCalendarDialogTitle" tabindex="-1"><header class="sl-coach-calendar-dialog-head"><div class="sl-coach-calendar-date-mark" aria-hidden="true"><span>${Number(selectedMonth)}月</span><strong>${Number(selectedDay)}</strong><small>${weekday}</small></div><div class="sl-coach-calendar-dialog-title"><span class="eyebrow">COACH CALENDAR · COURSE DETAILS</span><h2 id="slCoachCalendarDialogTitle">${selected.slice(0,4)} / ${selectedMonth} / ${selectedDay}</h2><span class="sl-coach-calendar-count">${matches.length} 堂課程</span></div><button type="button" class="sl-coach-calendar-dialog-close" data-action="coach-calendar-close" aria-label="關閉課程明細">×</button></header>${matches.length?`<div class="sl-coach-calendar-lesson-list">${matches.map(lesson=>{
      const booking=received.find(item=>item.id===lesson.booking_id);
      return `<article class="sl-coach-calendar-lesson">${bookingCard({
        ...booking,
        id:lesson.booking_id,
        coach_id:coachProfile.id,
        lesson_date:lesson.lesson_date,
        lesson_time:lesson.lesson_time,
        duration_minutes:lesson.duration_minutes,
        status:lesson.status,
        student_name:lesson.student_name,
        note:booking?.note||''
      })}</article>`;
    }).join('')}</div>`:'<p class="sl-coach-calendar-empty">這一天沒有課程。</p>'}</section></div>`;
  }
  async function loadMonth(initial=false){
    const currentRequest=++request;
    loading=true;error='';lessons=[];selected='';paint();
    try{
      const {data,error:rpcError}=await supabaseClient.rpc('sportlink_coach_calendar',{p_month_start:monthStart()});
      if(rpcError)throw rpcError;
      if(currentRequest!==request)return;
      lessons=Array.isArray(data)?data:[];
      if(initial){
        const firstLesson=lessons.find(lesson=>lesson.lesson_date>=today)||lessons[0];
        selected=firstLesson?.lesson_date||'';
      }
    }catch(cause){
      if(currentRequest!==request)return;
      console.error('SportLink coach calendar:',cause);
      error=errorText(cause);
    }finally{
      if(currentRequest===request){loading=false;paint()}
    }
  }
  grid.addEventListener('click',event=>{
    const button=event.target.closest('[data-coach-calendar-date]');
    if(!button||!button.classList.contains('has-lesson')||loading||error)return;
    selected=button.dataset.coachCalendarDate;
    dialogOpen=true;
    paint();
    app.querySelector('.sl-coach-calendar-dialog')?.focus();
  });
  app.querySelectorAll('[data-coach-calendar-step]').forEach(button=>button.addEventListener('click',()=>{
    const next=new Date(year,month+Number(button.dataset.coachCalendarStep),1);
    year=next.getFullYear();month=next.getMonth();
    dialogOpen=false;
    loadMonth();
  }));
  paint();
  loadMonth(true);
}
function slCoachCalendarCloseDialog(){
  const modal=app.querySelector('#sl-coach-calendar-modal');
  if(!modal)return;
  const date=modal.dataset.date;
  modal.innerHTML='';
  app.querySelector(`[data-coach-calendar-date="${date}"]`)?.focus();
}

function slSyncMemberNav(){
  const nav=document.querySelector('.nav');
  const login=nav?.querySelector('.login');
  const account=nav?.querySelector('.sl-member-account');
  if(!nav||!login)return;
  const loggedIn=!!user;
  login.hidden=loggedIn;
  login.setAttribute('aria-hidden',String(loggedIn));
  const pushToggle=account?.querySelector('[data-action="push-disable"]');
  if(pushToggle)pushToggle.hidden=!loggedIn||!slPushStateReady||!slPushEnabled;
  if(account){
    account.hidden=!loggedIn;
    const names=account.querySelectorAll('.sl-member-name');
    const initial=account.querySelector('.sl-member-initial');
    names.forEach(name=>name.textContent=user?.name||'會員');
    if(initial)initial.textContent=String(user?.name||'會').trim().slice(0,1)||'會';
    const role=account.querySelector('.sl-member-role');
    if(role)role.textContent=coachProfile?'教練':user?.role||'學生';
    if(!loggedIn){account.open=false;}
  }
}
function slWelcomeCard(){
  const coach=!!coachProfile;
  const role=coach?'教練會員':admin?'平台管理員':'學生會員';
  return `<section class="sl-welcome-card" aria-label="會員歡迎資訊"><div class="sl-welcome-content"><div class="sl-welcome-avatar" aria-hidden="true">${esc(String(user.name||'會').slice(0,1))}</div><div class="sl-welcome-copy"><span class="sl-welcome-eyebrow">WELCOME BACK · 歡迎回來</span><h1>你好，${esc(user.name)} <span aria-hidden="true">👋</span></h1><p>${esc(role)} <span class="sl-welcome-dot">·</span> SportLink</p></div></div><div class="sl-welcome-footer"><span>${coach?'管理教學時段，陪伴更多學生前進。':'你的運動旅程，從這裡開始。'}</span><span class="sl-welcome-spark" aria-hidden="true">✦</span></div></section>`;
}

// 社群第一階段：純介面預覽，不讀取或寫入好友資料，避免誤認已完成雲端功能。
let slSocialRows=[],slSocialSearchRows=[],slSocialQuery='',slSocialLoading=false,slSocialError='',slSocialProfile=null;
let slReportTargetPrefill='',slReportCategoryPrefill='bug';
const slSocialCard=(m)=>`<div class="sl-social-member"><div><strong>${esc(m.display_name)}</strong><p class="muted small">${esc(m.role)} · ${m.relation==='accepted'?'已是好友':m.relation==='sent'?'已送出邀請':m.relation==='received'?'邀請你成為好友':'運動會員'}</p></div><div class="sl-social-member-actions">${btn('查看個人頁','social-profile:'+m.id,'btn secondary')}${m.relation==='none'?btn('加好友','social-action:send:'+m.id):m.relation==='received'?btn('接受邀請','social-action:accept:'+m.id):''}</div></div>`;
const slSocialList=(items,empty)=>items.length?`<div class="sl-social-members">${items.map(slSocialCard).join('')}</div>`:`<p class="sl-social-hint">${empty}</p>`;
async function slSocialLoad(){
  if(!user)return;
  slSocialLoading=true;slSocialError='';
  try{const {data,error}=await supabaseClient.rpc('sportlink_social_connections');if(error)throw error;slSocialRows=data||[]}
  catch(e){slSocialError='好友資料尚未啟用或讀取失敗：'+errorText(e)}
  finally{slSocialLoading=false;slNoticeRefresh();if(page==='community'){if(slChatPeer&&!slChatFriends().some(x=>x.id===slChatPeer)){slChatPeer=null;slChatStop();slChatMessages=[]}render()}}
}
async function slSocialSearch(){
  const q=slSocialQuery.trim();if(!user||q.length<2){slSocialSearchRows=[];render();return}
  slSocialLoading=true;slSocialError='';
  try{const {data,error}=await supabaseClient.rpc('sportlink_social_directory',{p_search:q});if(error)throw error;slSocialSearchRows=data||[]}
  catch(e){slSocialError='搜尋失敗：'+errorText(e)}
  finally{slSocialLoading=false;if(page==='community')render()}
}

// 私訊：只有雙方已互加好友才允許讀取或傳送，資料庫 RLS 會再驗證一次。

// 社群提醒：收到的待處理好友邀請與尚未閱讀的私人訊息。
let slNoticeRequests=0,slNoticeMessages=0,slNoticeByPeer={},slNoticeUserId=null;
let slNoticeTimer=null,slNoticeChannel=null,slNoticeSeq=0;
const slNoticeCount=n=>n>99?'99+':String(n);
const slNoticeBadge=(n,extra='')=>n>0?`<span class="sl-notice-badge ${extra}" aria-label="${n} 則未處理提醒">${slNoticeCount(n)}</span>`:'';
function slNoticePaint(){
  const counts={requests:slNoticeRequests,messages:slNoticeMessages,community:slNoticeRequests+slNoticeMessages};
  document.querySelectorAll('[data-sl-notice]').forEach(el=>{
    const kind=el.dataset.slNotice;
    const count=kind==='peer'?Number(slNoticeByPeer[el.dataset.peer]||0):Number(counts[kind]||0);
    el.innerHTML=slNoticeBadge(count);
    el.hidden=count===0;
  });
}
function slNoticeReset(){
  slNoticeSeq++;
  if(slNoticeTimer){clearInterval(slNoticeTimer);slNoticeTimer=null}
  if(slNoticeChannel){supabaseClient.removeChannel(slNoticeChannel);slNoticeChannel=null}
  slNoticeUserId=null;slNoticeRequests=0;slNoticeMessages=0;slNoticeByPeer={};
  slNoticePaint();
}
async function slNoticeRefresh(){
  if(!user||!slNoticeUserId||user.id!==slNoticeUserId)return;
  const current=user.id,seq=++slNoticeSeq;
  try{
    const [requests,messages]=await Promise.all([
      supabaseClient.rpc('sportlink_social_connections'),
      supabaseClient.from('sportlink_chat_messages').select('sender_id')
        .eq('recipient_id',current).is('read_at',null)
    ]);
    if(requests.error)throw requests.error;
    if(messages.error)throw messages.error;
    if(seq!==slNoticeSeq||!user||user.id!==current)return;
    slNoticeRequests=(requests.data||[]).filter(x=>x.relation==='received').length;
    const byPeer={};
    for(const m of messages.data||[])byPeer[m.sender_id]=(byPeer[m.sender_id]||0)+1;
    slNoticeByPeer=byPeer;
    slNoticeMessages=(messages.data||[]).length;
    slNoticePaint();
  }catch(e){console.warn('SportLink notifications:',e?.message||e)}
}
function slNoticeStart(){
  if(!user)return;
  if(slNoticeUserId===user.id)return;
  slNoticeReset();
  slNoticeUserId=user.id;
  slNoticeRefresh();
  slNoticeTimer=setInterval(()=>{if(!document.hidden)slNoticeRefresh()},8000);
  slNoticeChannel=supabaseClient.channel('sportlink-notices-'+user.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'sportlink_chat_messages'},()=>slNoticeRefresh())
    .subscribe();
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)slNoticeRefresh()});

// Web push requires a secure origin and explicit user permission.
let slPushStatus='',slPushStateUserId=null,slPushEnabled=false,slPushChecking=false,slPushStateReady=false,slPushStateError='',slPushStateRequest=0;
const slPushSupported=()=>window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
function slPushKeyBytes(key){const raw=atob((key+'='.repeat((4-key.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0))}
function slPushWithTimeout(promise,message){
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),12000)})]).finally(()=>clearTimeout(timer));
}
async function slPushRegistration(create=false){
 const scope=new URL('./',document.baseURI);
 let registration=await navigator.serviceWorker.getRegistration(scope.href);
 if(!registration&&create)registration=await navigator.serviceWorker.register(new URL('./sw.js',document.baseURI),{scope:scope.pathname});
 if(!registration)return null;
 if(registration.active)return registration;
 return slPushWithTimeout(navigator.serviceWorker.ready,'Service Worker 啟動逾時，請重新整理頁面後再試。');
}
function slPushResetState(){
 slPushStateRequest++;slPushStateUserId=null;slPushEnabled=false;slPushChecking=false;slPushStateReady=false;slPushStateError='';slPushStatus='';
}
function slPushLoadState(force=false){
 if(!user)return;
 const userId=user.id;
 if(!force&&slPushStateUserId===userId&&(slPushChecking||slPushStateReady))return;
 if(force)slPushStatus='';
 if(slPushStateUserId!==userId){slPushEnabled=false;slPushStatus=''}
 slPushStateUserId=userId;slPushChecking=true;slPushStateReady=false;slPushStateError='';
 const request=++slPushStateRequest;
 if(!slPushSupported()){
   slPushEnabled=false;slPushChecking=false;slPushStateReady=true;
   return;
 }
 (async()=>{
   const registration=await navigator.serviceWorker.getRegistration(new URL('./',document.baseURI).href);
   if(!registration?.active){slPushEnabled=false;return}
   const subscription=await registration.pushManager.getSubscription();
   if(!subscription){slPushEnabled=false;return}
   const {data,error}=await supabaseClient.from('sportlink_push_subscriptions')
     .select('enabled').eq('user_id',userId).eq('endpoint',subscription.endpoint).maybeSingle();
   if(error)throw error;
   slPushEnabled=data?.enabled===true;
 })().catch(error=>{
   if(request!==slPushStateRequest)return;
   console.error('SportLink push settings:',error);
   slPushStateError='通知狀態讀取失敗：'+errorText(error);
 }).finally(()=>{
   if(request!==slPushStateRequest)return;
   slPushChecking=false;slPushStateReady=true;
   if(user?.id===userId)render();
 });
}
function slPushPanel(){
 if(user&&slPushStateUserId!==user.id)slPushLoadState();
 if(slPushEnabled)return '';
 const supported=slPushSupported();
 const controls=slPushChecking
   ?'<button type="button" class="btn secondary sl-push-toggle" disabled>正在確認…</button>'
   :slPushStateError
     ?'<button type="button" class="btn secondary sl-push-toggle" data-action="push-refresh">重新確認</button>'
     :slPushEnabled
       ?''
       :`<button type="button" class="btn secondary sl-push-toggle" data-action="push-enable" ${supported?'':'disabled'}>啟用推播</button>`;
 const supportMessage=!window.isSecureContext?'推播需要 HTTPS 安全連線（localhost 除外）。':!supported?'此瀏覽器不支援推播通知。':'點擊啟用後，允許裝置通知。';
 const status=slPushStatus||slPushStateError||(slPushChecking?'正在確認此裝置的通知設定…':slPushEnabled?'此裝置已啟用推播通知。':supportMessage);
 return `<section class="sl-push-settings"><div class="sl-push-heading"><strong>🔔 SportLink 推播通知</strong><div class="sl-push-actions">${controls}</div></div><p>啟用後可收到好友訊息、預約異動，以及上課前 24 小時提醒。iPhone 請先在 Safari 加入主畫面，再從主畫面開啟 SportLink。</p><p role="status" aria-live="polite">${esc(status)}</p></section>`;
}
async function slPushEnable(){
 if(!user||!slPushSupported())throw Error('請先登入並確認裝置支援推播');
 const userId=user.id;
 if(await Notification.requestPermission()!=='granted')throw Error('通知權限未允許');
 const reg=await slPushWithTimeout(slPushRegistration(true),'Service Worker 啟動逾時，請重新整理頁面後再試。');
 if(!reg)throw Error('無法註冊 Service Worker，請確認網站使用 HTTPS 或 localhost。');
 let sub=await reg.pushManager.getSubscription();
 if(sub){const k=sub.options?.applicationServerKey;if(k){const a=new Uint8Array(k),b=slPushKeyBytes(SPORTLINK_VAPID_PUBLIC_KEY);if(a.length!==b.length||a.some((v,i)=>v!==b[i])){await sub.unsubscribe();sub=null}}}
 if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:slPushKeyBytes(SPORTLINK_VAPID_PUBLIC_KEY)});
 for(let attempt=0;attempt<2;attempt++){
   if(user?.id!==userId)throw Error('登入帳號已變更，請重新啟用推播');
   const data=sub.toJSON();if(!data.endpoint||!data.keys?.p256dh||!data.keys?.auth)throw Error('推播訂閱資料不完整');
   const row={user_id:userId,endpoint:data.endpoint,p256dh:data.keys.p256dh,auth:data.keys.auth,enabled:true};
   const findOwn=()=>supabaseClient.from('sportlink_push_subscriptions').select('id').eq('user_id',userId).eq('endpoint',data.endpoint).maybeSingle();
   const updateOwn=id=>supabaseClient.from('sportlink_push_subscriptions').update(row).eq('id',id).eq('user_id',userId);
   const found=await findOwn();if(found.error)throw found.error;
   let result=found.data?await updateOwn(found.data.id):await supabaseClient.from('sportlink_push_subscriptions').insert(row);
   if(result.error?.code==='23505'&&String(result.error.message).includes('sportlink_push_subscriptions_endpoint_key')){
     // Another tab may have saved this account's subscription after our lookup.
     const existing=await findOwn();if(existing.error)throw existing.error;
     if(existing.data)result=await updateOwn(existing.data.id);
     else if(attempt===0){
       // RLS hides other accounts' subscriptions. Rotate this browser's subscription
       // instead of updating or taking ownership of another account's database row.
       if(user?.id!==userId)throw Error('登入帳號已變更，請重新啟用推播');
       if(!await sub.unsubscribe())throw Error('無法重設此裝置的舊訂閱，請重新整理後再試');
       sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:slPushKeyBytes(SPORTLINK_VAPID_PUBLIC_KEY)});
       continue;
     }else throw Error('此裝置的舊推播訂閱仍有衝突，請重新整理後再啟用');
   }
   if(result.error)throw result.error;
   break;
 }
 if(user?.id!==userId)throw Error('登入帳號已變更，請重新啟用推播');
 slPushStateRequest++;
 slPushStateUserId=userId;slPushEnabled=true;slPushChecking=false;slPushStateReady=true;slPushStateError='';
 slPushStatus='已啟用推播，可接收訊息與課程提醒。';
}
async function slPushDisable(){
 if(!user||!slPushSupported())throw Error('請先登入並確認裝置支援推播');const reg=await slPushRegistration();const sub=await reg?.pushManager.getSubscription();
 if(sub){const result=await supabaseClient.from('sportlink_push_subscriptions').delete().eq('user_id',user.id).eq('endpoint',sub.endpoint);if(result.error)throw result.error;await sub.unsubscribe()}
 slPushStateUserId=user.id;slPushEnabled=false;slPushChecking=false;slPushStateReady=true;slPushStateError='';
 slPushStatus='此裝置已關閉所有 SportLink 推播通知。';
}
let slAdminReports=[],slAdminReportsLoading=false,slAdminReportsError='';
const slReportStatuses={pending:'待處理',in_progress:'處理中',resolved:'已解決',closed:'已結案'};
async function slSubmitReport(form){
  if(!user)throw Error('請先登入後再提交回報');
  const message=form.querySelector('#slReportMessage');
  const submit=form.querySelector('button[type=submit]');
  const category=String(new FormData(form).get('category')||'');
  const description=String(new FormData(form).get('description')||'').trim();
  const target=String(new FormData(form).get('target')||'').trim();
  const file=form.querySelector('input[type=file]').files?.[0];
  if(!['bug','abuse'].includes(category)||description.length<10||description.length>2000||target.length>500){
    message.textContent='請確認分類與內容；描述需為 10 至 2000 字。';return;
  }
  const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file?.type];
  if(file&&(!ext||file.size>5*1024*1024)){
    message.textContent='截圖僅支援 JPG、PNG、WebP，且不可超過 5 MB。';return;
  }
  const reportId=crypto.randomUUID();
  const path=file?`${user.id}/${reportId}.${ext}`:null;
  submit.disabled=true;message.textContent=file?'正在上傳截圖並提交…':'正在提交回報…';
  let reportCreated=false;
  try{
    const {error}=await supabaseClient.rpc('sportlink_submit_report',{
      p_report_id:reportId,p_category:category,p_description:description,
      p_target:target||null,p_attachment_path:path
    });
    if(error)throw error;
    reportCreated=true;
    if(file){
      message.textContent='回報已建立，正在安全上傳截圖…';
      const {error:uploadError}=await supabaseClient.storage.from('sportlink-report-attachments')
        .upload(path,file,{contentType:file.type,upsert:false,cacheControl:'3600'});
      if(uploadError)throw uploadError;
    }
    form.reset();slReportTargetPrefill='';slReportCategoryPrefill='bug';message.textContent='回報已送出，感謝你協助改善 SportLink。';
  }catch(error){
    if(reportCreated&&path){
      const {error:removeError}=await supabaseClient.storage.from('sportlink-report-attachments').remove([path]);
      if(removeError)console.warn('Report attachment cleanup failed:',removeError.message);
      const {error:clearError}=await supabaseClient.rpc('sportlink_clear_report_attachment',{
        p_report_id:reportId,p_attachment_path:path
      });
      if(clearError)console.warn('Report attachment reference cleanup failed:',clearError.message);
    }
    if(reportCreated){form.reset();slReportTargetPrefill='';slReportCategoryPrefill='bug'}
    console.error('SportLink report submission failed:',error);
    message.textContent=reportCreated
      ?(path?`回報內容已送出，但截圖處理失敗：${errorText(error)}`:'回報已送出。')
      :`送出失敗：${errorText(error)}`;
  }finally{submit.disabled=false}
}
function slAdminReportsPaint(){
  const target=app.querySelector('#adminReports');
  if(!target)return;
  if(slAdminReportsLoading){target.innerHTML='<p class="muted">正在讀取回報…</p>';return}
  if(slAdminReportsError){target.innerHTML=`<p class="notice" role="alert">${esc(slAdminReportsError)}</p>`;return}
  if(!slAdminReports.length){target.innerHTML='<p class="muted">目前沒有使用者回報。</p>';return}
  target.innerHTML=slAdminReports.map(report=>`<article class="sl-admin-report"><header><div><span class="pill">${report.category==='bug'?'網站問題':'使用者／內容檢舉'}</span><span class="muted small"> · ${esc(new Date(report.created_at).toLocaleString('zh-TW'))}</span></div><strong>${esc(report.reporter_name)}</strong></header><p>${esc(report.description)}</p>${report.target?`<p class="muted">相關對象／頁面：${esc(report.target)}</p>`:''}${report.attachmentUrl?`<a class="sl-report-image-link" href="${esc(report.attachmentUrl)}" target="_blank" rel="noopener noreferrer">查看回報截圖 ↗</a>`:report.attachment_path?`<p class="notice">截圖讀取失敗：${esc(report.attachmentError||'無法建立安全連結')}</p>`:''}<form class="sl-admin-report-controls" data-report-id="${esc(report.id)}"><label>處理狀態<select name="status">${Object.entries(slReportStatuses).map(([value,label])=>`<option value="${value}" ${report.status===value?'selected':''}>${label}</option>`).join('')}</select></label><label>管理備註<textarea name="admin_note" maxlength="1000" placeholder="處理結果或內部備註">${esc(report.admin_note||'')}</textarea></label><button type="button" class="btn secondary" data-action="admin-report-save:${esc(report.id)}">儲存處理結果</button></form></article>`).join('');
}
async function slAdminReportsLoad(){
  if(!admin||page!=='admin')return;
  slAdminReportsLoading=true;slAdminReportsError='';slAdminReportsPaint();
  try{
    const {data,error}=await supabaseClient.rpc('sportlink_admin_list_reports');
    if(error)throw error;
    slAdminReports=await Promise.all((data||[]).map(async report=>{
      if(!report.attachment_path)return report;
      const {data:signed,error:signError}=await supabaseClient.storage
        .from('sportlink-report-attachments').createSignedUrl(report.attachment_path,300);
      return {...report,attachmentUrl:signed?.signedUrl||'',attachmentError:signError?.message||''};
    }));
  }catch(error){
    console.error('SportLink admin reports:',error);
    slAdminReportsError='讀取回報失敗：'+errorText(error);
  }finally{slAdminReportsLoading=false;slAdminReportsPaint()}
}
// Open a specific friend conversation from a trusted, same-origin push link.
function slPushDeepLinkPeer(){
  const params=new URLSearchParams(location.search);
  const peer=params.get('sl_peer');
  return params.get('sl_tab')==='messages' && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(peer||'') ? peer : null;
}
async function slHandlePushDeepLink(){
  const params=new URLSearchParams(location.search);
  const tab=params.get('sl_tab');
  if(tab==='bookings'){
    if(!user)return;
    page='dashboard';render();
    history.replaceState(null,'',location.pathname+location.hash);
    return;
  }
  if(tab!=='messages')return;
  if(!user)return; // Keep the link until the member logs in.
  const peer=slPushDeepLinkPeer();
  page='community';slCommunityTab='messages';slSocialProfile=null;
  await slSocialLoad();
  if(peer && slChatFriends().some(friend=>friend.id===peer)){
    if(slChatPeer!==peer){slChatPeer=peer;slChatMessages=[];slChatError='';slChatStart()}
    await slChatLoad();
  }
  render();
  history.replaceState(null,'',location.pathname+location.hash);
}
window.addEventListener('popstate',()=>{slHandlePushDeepLink().catch(console.error)});
window.addEventListener('pageshow',()=>{slHandlePushDeepLink().catch(console.error)});
let slChatPeer=null,slChatMessages=[],slChatError='',slChatLoading=false,slChatBusy=false;
let slChatChannel=null,slChatTimer=null,slChatRequest=0;
function slChatStop(){
  if(slChatTimer){clearInterval(slChatTimer);slChatTimer=null}
  if(slChatChannel){supabaseClient.removeChannel(slChatChannel);slChatChannel=null}
}
function slChatFriends(){return slSocialRows.filter(x=>x.relation==='accepted')}
function slChatPanel(){
  if(!user)return '<p>請先登入，才能使用好友私訊。</p>';
  const friends=slChatFriends(),peer=friends.find(x=>x.id===slChatPeer);
  const list=friends.map(x=>`<button type="button" class="sl-chat-person ${x.id===slChatPeer?'active':''}" data-action="chat-open:${esc(x.id)}"><span class="sl-chat-avatar">${esc(x.display_name.slice(0,1))}</span><span class="sl-chat-person-name">${esc(x.display_name)}</span><span class="sl-notice-slot" data-sl-notice="peer" data-peer="${esc(x.id)}" ${slNoticeByPeer[x.id]?'':'hidden'}>${slNoticeBadge(slNoticeByPeer[x.id]||0)}</span></button>`).join('');
  return `<span class="eyebrow">DIRECT MESSAGES</span><h2>好友私人訊息</h2><p class="sl-chat-help">只有互為好友的會員能傳訊息。離開頁面後，聊天紀錄仍會保存。</p>${slPushPanel()}
    <div class="sl-chat-layout"><aside class="sl-chat-contacts"><strong>我的好友</strong>${list||'<p class="muted">還沒有好友，先到「尋找好友」認識夥伴吧。</p>'}</aside>
    <div class="sl-chat-main">${peer?`<div class="sl-chat-heading"><strong>${esc(peer.display_name)}</strong><span>私人對話</span></div>
    <div class="sl-chat-history" id="slChatHistory" role="log" aria-live="polite">${slChatLoading?'<p class="muted">載入訊息中…</p>':slChatMessages.length?slChatMessages.map(m=>`<div class="sl-chat-bubble ${m.sender_id===user.id?'mine':'theirs'}"><div>${esc(m.body)}</div><time>${esc(new Date(m.created_at).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</time></div>`).join(''):'<p class="sl-chat-empty">還沒有訊息，傳送第一句問候吧！</p>'}</div>
    <form id="slChatForm" class="sl-chat-compose"><input name="body" maxlength="2000" placeholder="輸入訊息…" autocomplete="off" aria-label="訊息內容" required><button class="btn" type="submit" ${slChatBusy?'disabled':''}>傳送</button></form>`:'<div class="sl-chat-placeholder">選擇左邊的好友，開始聊天。</div>'}
    ${slChatError?`<p class="notice" role="alert">${esc(slChatError)}</p>`:''}</div></div>`;
}
async function slChatLoad(silent=false){
  if(!user||!slChatPeer||page!=='community'||slCommunityTab!=='messages')return;
  const peer=slChatPeer,request=++slChatRequest;
  if(!silent){slChatLoading=true;slChatError='';render()}
  try{
    const {data,error}=await supabaseClient.from('sportlink_chat_messages')
      .select('id,sender_id,recipient_id,body,created_at,read_at')
      .or(`and(sender_id.eq.${user.id},recipient_id.eq.${peer}),and(sender_id.eq.${peer},recipient_id.eq.${user.id})`)
      .order('created_at',{ascending:false}).limit(100);
    if(error)throw error;
    if(request!==slChatRequest||peer!==slChatPeer)return;
    const next=(data||[]).reverse();
    const changed=JSON.stringify(next)!==JSON.stringify(slChatMessages);
    slChatMessages=next;slChatLoading=false;
    if(changed||!silent){
      const old=document.getElementById('slChatHistory');
      const atBottom=!old||old.scrollHeight-old.scrollTop-old.clientHeight<100;
      render();
      const area=document.getElementById('slChatHistory');
      if(area&&atBottom)area.scrollTop=area.scrollHeight;
    }
    if(next.some(m=>m.recipient_id===user.id&&!m.read_at)){
      supabaseClient.rpc('sportlink_chat_mark_read',{p_peer:peer}).then(({error})=>{if(error)console.warn('read receipt:',error.message);else slNoticeRefresh()});
    }
  }catch(e){if(request===slChatRequest){slChatLoading=false;slChatError='訊息讀取失敗：'+errorText(e);render()}}
}
function slChatStart(){
  slChatStop();
  if(!slChatPeer||!user)return;
  // Supabase Realtime 有啟用時立即更新；輪詢則作為斷線備援。
  slChatChannel=supabaseClient.channel('sportlink-chat-'+user.id+'-'+slChatPeer)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'sportlink_chat_messages'},()=>slChatLoad(true))
    .subscribe();
  slChatTimer=setInterval(()=>{if(!document.hidden)slChatLoad(true)},6000);
}

function slCommunityView(){
  const sections=[['discover','尋找好友'],['friends','我的好友'],['requests','好友邀請'],['messages','私人訊息'],['forum','運動討論區']];
  const nav=sections.map(([key,label])=>`<button type="button" class="sl-social-tab ${slCommunityTab===key?'is-active':''}" data-action="social-tab:${key}" aria-pressed="${slCommunityTab===key}"><span>${label}</span>${key==='requests'||key==='messages'?`<span class="sl-notice-slot" data-sl-notice="${key}" ${((key==='requests'?slNoticeRequests:slNoticeMessages)>0)?'':'hidden'}>${slNoticeBadge(key==='requests'?slNoticeRequests:slNoticeMessages)}</span>`:''}</button>`).join('');
  let content='';
  if(slCommunityTab==='discover')content=`<span class="eyebrow">FIND YOUR PEOPLE</span><h2>尋找運動夥伴</h2><p>輸入至少兩個字搜尋會員公開暱稱，學生與教練都可以互加好友。</p>${user?`<form id="slSocialSearchForm" class="sl-social-search-form"><input class="sl-social-search" name="q" maxlength="60" placeholder="輸入會員暱稱（至少兩字）" value="${esc(slSocialQuery)}" required minlength="2"><button class="btn" type="submit">搜尋</button></form>${slSocialList(slSocialSearchRows,slSocialQuery?'沒有找到符合條件的會員。':'搜尋結果會顯示在這裡。')}`:'<p>登入後即可搜尋會員。</p>'}`;
  if(slCommunityTab==='friends')content=`<span class="eyebrow">MY CONNECTIONS</span><h2>我的運動好友</h2>${slSocialList(slSocialRows.filter(x=>x.relation==='accepted'),'目前還沒有好友，先去尋找運動夥伴吧！')}`;
  if(slCommunityTab==='requests')content=`<span class="eyebrow">FRIEND REQUESTS</span><h2>好友邀請</h2><h3>收到的邀請</h3>${slSocialList(slSocialRows.filter(x=>x.relation==='received'),'目前沒有收到邀請。')}<h3>送出的邀請</h3>${slSocialList(slSocialRows.filter(x=>x.relation==='sent'),'目前沒有待回覆的邀請。')}`;
  if(slCommunityTab==='messages')content=slChatPanel();
  if(slCommunityTab==='forum')content=`<span class="eyebrow">BADMINTON DISCUSSION</span><h2>羽球討論區</h2><p class="sl-social-lead">未來公開文章不需登入即可閱讀；登入後可以發文、留言、按讚及收藏。</p><div class="sl-social-categories">${['單打','雙打','球拍與裝備','技術訓練','賽事交流'].map(x=>`<span>${x}</span>`).join('')}</div><div class="sl-social-empty"><span aria-hidden="true">▤</span><h3>討論區正在規劃中</h3><p>目前沒有公開文章資料。正式上線前會完成內容檢舉與管理機制。</p></div>`;
  return `<div class="sl-social-page"><section class="sl-social-hero"><div><span class="sl-social-kicker">SPORTLINK · COMMUNITY</span><h1>運動不只是一堂課，<br><em>也是一群志同道合的人。</em></h1><p>認識運動夥伴、建立好友關係，未來一起分享運動心得與活動。</p><div class="sl-social-hero-meta"><span>運動好友</span><span>一對一私訊</span><span>公開討論區</span></div></div><div class="sl-social-hero-symbol" aria-hidden="true">✳</div></section><div class="sl-social-preview-notice" role="status"><strong>好友功能已開放</strong><span>現在可以搜尋會員、發送好友邀請及管理好友；好友私人訊息已開放；運動討論區將陸續推出。</span></div><div class="sl-social-layout"><nav class="sl-social-tabs" aria-label="社群功能分頁">${nav}</nav><section class="sl-social-panel" aria-live="polite">${slSocialError?`<p class="notice" role="alert">${esc(slSocialError)}</p>`:''}${slSocialLoading?'<p class="muted">正在讀取…</p>':''}${slSocialProfile?`<div class="sl-social-profile"><h3>${esc(slSocialProfile.display_name)}</h3><p>${esc(slSocialProfile.role)} · SportLink 會員</p><p class="muted">只顯示公開暱稱與會員角色，不公開聯絡資訊。</p>${slSocialProfile.relation==='accepted'?btn('解除好友','social-action:remove:'+slSocialProfile.id,'btn secondary'):slSocialProfile.relation==='sent'?btn('取消邀請','social-action:cancel:'+slSocialProfile.id,'btn secondary'):slSocialProfile.relation==='received'?`${btn('接受','social-action:accept:'+slSocialProfile.id)} ${btn('拒絕','social-action:reject:'+slSocialProfile.id,'btn secondary')}`:btn('送出好友邀請','social-action:send:'+slSocialProfile.id)} ${btn('封鎖會員','social-block:'+slSocialProfile.id,'btn secondary')} ${btn('檢舉此會員','social-report:'+slSocialProfile.id,'btn secondary')} ${btn('關閉','social-close','btn secondary')}</div>`:''}${content}${!user?'<div class="sl-social-login-tip">想參與社群？先登入 SportLink。<button type="button" data-page="account">登入／註冊 ↗</button></div>':''}</section></div></div>`;
}

function render(){
  slSyncMemberNav();
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
   if(page==='community'){app.innerHTML=slCommunityView();slNoticePaint()}
   else if(page==='home')app.innerHTML=`
<section class="hero sl-home-hero"><div class="hero-copy"><span class="hero-eyebrow"><span class="live-dot"></span> SPORTLINK · MOVE TOGETHER</span><h1>找到你的節奏，<br><em>一起上場。</em></h1><p>探索專業教練、認識運動夥伴，找到適合你的方式，讓每一次練習都更有方向。</p><div class="hero-actions">${btn('探索專業教練 ↗','go:coaches')}${btn('成為 SportLink 教練 ↗',user?'go:coach-apply':'go:account','btn ghost')}</div><div class="hero-trust"><span>✦ 依地區尋找</span><span>✦ 彈性選擇時段</span><span>✦ 查看教練介紹與評價</span></div></div><div class="hero-visual sl-home-hero-visual" role="region" aria-label="快速開始：找教練、找學生或找球友"><div class="sl-home-actions-panel" aria-label="選擇你想使用的 SportLink 功能"><div class="sl-home-actions-heading"><span>YOUR NEXT MOVE · 03</span><h2>今天，想找誰一起打球？</h2><p>選一個方向，馬上開始認識你的羽球夥伴。</p></div><div class="sl-home-action-grid"><button type="button" class="sl-home-action-card is-coach-search" data-action="go:coaches"><span class="sl-home-action-number">01 / LEARN</span><span class="sl-home-action-icon" aria-hidden="true">⌕</span><strong>找教練</strong><span class="sl-home-action-description">探索專長、地區與可預約時段</span><span class="sl-home-action-link">我是學生 <b aria-hidden="true">↗</b></span></button><button type="button" class="sl-home-action-card is-coach-join" data-action="go:coach-apply"><span class="sl-home-action-number">02 / TEACH</span><span class="sl-home-action-icon" aria-hidden="true">＋</span><strong>找學生</strong><span class="sl-home-action-description">分享你的專業，遇見合適學生</span><span class="sl-home-action-link">我是教練 <b aria-hidden="true">↗</b></span></button><button type="button" class="sl-home-action-card is-player-match" data-action="go:open-play"><span class="sl-home-action-number">03 / PLAY</span><span class="sl-home-action-icon" aria-hidden="true">↗</span><strong>找球友</strong><span class="sl-home-action-description">看看揪團球局，一起上場交流</span><span class="sl-home-action-link">我要約球 <b aria-hidden="true">↗</b></span></button></div><div class="sl-home-actions-footer"><span><i></i> 從線上認識，到球場相遇</span><span>SPORTLINK COMMUNITY</span></div></div></div></section>
<section class="section sl-home-search" aria-labelledby="slHomeSearchTitle"><div class="sl-home-search-copy"><span class="eyebrow">FIND YOUR COACH</span><h2 id="slHomeSearchTitle">尋找你的羽球教練。</h2><p class="muted">選擇授課地區，快速探索適合你的羽球教練。</p></div><form id="slHomeSearchForm" class="sl-home-search-form"><label>授課地區<select id="slHomeArea" name="area">${areaOptions(areaFilter,true)}</select></label><button type="submit" class="btn sl-home-search-button">搜尋教練 ↗</button></form></section>
<section class="section featured-section sl-home-featured"><div class="section-heading"><div><span class="eyebrow">EXPLORE COACHES</span><h2>認識 SportLink 教練</h2><p class="muted">看看教練的專長、地區、價格及課程資訊。</p></div>${btn('查看全部教練 ↗','go:coaches','btn secondary')}</div><div class="grid">${allCoaches().slice(0,3).map(coachCard).join('')||'<div class="empty">目前尚無上架教練，歡迎稍後再來探索。</div>'}</div></section>
<section class="closing-banner sl-home-join"><div><span class="eyebrow">JOIN SPORTLINK</span><h2>讓運動熱情，遇見專業陪伴。</h2><p>想開始運動？探索教練。想分享專業？加入 SportLink 教練行列。</p></div><div class="sl-home-join-actions">${btn('尋找教練 ↗','go:coaches','btn ghost')}${btn('申請成為教練 ↗',user?'go:coach-apply':'go:account','btn secondary')}</div></section>`;
  else if(page==='open-play')app.innerHTML=slOpenPlayView();
  else if(page==='coaches')app.innerHTML=`<h1>尋找羽球教練</h1><p class="muted">僅顯示已通過審核的羽球教練。</p><div class="filters"><select class="field" id="areaFilter">${areaOptions(areaFilter,true)}</select></div><div class="grid">${allCoaches().filter(c=>areaFilter==='全部'||fullArea(c.area)===areaFilter).map(coachCard).join('')||'<div class="empty">沒有符合條件的羽球教練</div>'}</div>`;
  else if(page.startsWith('coach:')){
    const c=liveCoaches.find(x=>x.id===page.slice(6));if(!c){page='coaches';render();return}
    app.innerHTML=`<div class="panel card coach-detail"><div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">${photoAvatar(c,true)}<h1>${esc(c.display_name)}</h1></div><p class="muted">${esc(c.sport)} · ${esc(fullArea(c.area))}</p><p>${esc(c.description)}</p>${c.teaching_years!=null?`<p><b>教學年資：</b>${esc(c.teaching_years)} 年</p>`:''}${c.teaching_experience?`<p><b>教學經歷：</b>${esc(c.teaching_experience)}</p>`:''}${c.certificate_name?`<p><b>專業證照：</b>${esc(c.certificate_name)}</p>`:''}${coachReviewPanel(c.id)}<div class="sl-coach-detail-fav">${slFavoriteButton(c.id)}</div><p class="price">NT$${Number(c.price).toLocaleString()} / 小時</p><hr><section class="sl-booking-widget"><span class="eyebrow">BOOK A SESSION</span><h2>選擇預約時間</h2><p class="muted">綠色代表可預約，橘色代表已有預約。直接點選上方開始時段，下方會顯示可預約的課程時長。</p><form class="form" id="bookingForm"><label>上課日期<input name="date" type="date" id="slBookingDate" min="${dateToday()}" required></label><div id="slBookingSchedule" aria-live="polite">正在讀取時段…</div><label>課程時長<select name="duration" id="slBookingDuration" required disabled><option value="">請先選擇日期</option></select></label><label>開始時間<select name="start" id="slBookingStart" required disabled><option value="">請先選擇時長</option></select></label><div class="sl-booking-summary" id="slBookingSummary">選擇日期、時長與開始時間後，這裡會顯示預約資訊。</div><label>備註<textarea name="note" maxlength="500" placeholder="例如：第一次學羽球"></textarea></label><button class="btn" type="submit" disabled>送出預約申請</button><p id="bookingSlotMessage" class="muted small" role="status"></p></form></section><p class="muted small">預約將儲存在 Supabase，需由教練確認；課程結束 24 小時後自動完成。</p></div>`;
    const form=app.querySelector('#bookingForm'),dateInput=form.elements.date,durationInput=form.elements.duration,startInput=form.elements.start,submit=form.querySelector('button[type=submit]'),schedule=app.querySelector('#slBookingSchedule'),summary=app.querySelector('#slBookingSummary'),message=app.querySelector('#bookingSlotMessage');
    const requestedPage=page,requestVersion=++bookingUiVersion;
    let blocks=[],busy=[],chosen=null,selectedStart=null;
    function choices(){
      const date=dateInput.value,dayBlocks=slDayBlocks(blocks,date);
      const durations=[...new Set(dayBlocks.flatMap(b=>(b.allowed_minutes||[]).filter(n=>selectedStart===null||(selectedStart>=slMins(b.start_time)&&selectedStart+n<=slMins(b.end_time)&&!slIsBusy(selectedStart,selectedStart+n,busy.filter(x=>x.lesson_date===date))&&new Date(date+'T'+slTime(selectedStart)+':00')>new Date()))))].sort((a,b)=>a-b);
      const previousDuration=Number(durationInput.value);
      durationInput.innerHTML='<option value="">選擇課程時長</option>'+durations.map(n=>`<option value="${n}">${slDurationLabel(n)}</option>`).join('');
      if(durations.includes(previousDuration))durationInput.value=String(previousDuration);
      durationInput.disabled=!durations.length;
      const duration=Number(durationInput.value),starts=[];
      if(duration){
        for(const block of dayBlocks){
          for(let t=slMins(block.start_time);t+duration<=slMins(block.end_time);t+=30){
            if((block.allowed_minutes||[]).includes(duration)&&!slIsBusy(t,t+duration,busy.filter(b=>b.lesson_date===date))&&new Date(date+'T'+slTime(t)+':00')>new Date())starts.push(t);
          }
        }
      }
      const unique=[...new Set(starts)].sort((a,b)=>a-b);
      const previousStart=selectedStart??(startInput.value===''?null:Number(startInput.value));
      startInput.innerHTML='<option value="">選擇開始時間</option>'+unique.map(t=>`<option value="${t}">${slTime(t)}～${slTime(t+duration)}</option>`).join('');
      if(previousStart!==null&&unique.includes(previousStart))startInput.value=String(previousStart);
      startInput.disabled=!unique.length;
      chosen=duration&&startInput.value!==''?{start:Number(startInput.value),duration}:null;
      schedule.innerHTML=slScheduleHtml(blocks,busy.filter(b=>b.lesson_date===date),date,{start:chosen?.start??selectedStart??-1,duration});
      summary.textContent=chosen?`${date} ${slTime(chosen.start)}～${slTime(chosen.start+chosen.duration)} · ${slDurationLabel(chosen.duration)} · 預估 NT$${Math.round(Number(c.price)*chosen.duration/60).toLocaleString()}（實際費用請與教練確認）`:'請選擇可預約的課程時長與開始時間。';
      submit.disabled=!chosen;
      message.textContent=dayBlocks.length?'每個區塊代表 30 分鐘；只有連續且未被預約的時間才能選取。':'這個日期沒有開放時段。';
    }
    (async()=>{
      try{
        const [a,b]=await Promise.all([
          supabaseClient.from('sportlink_open_blocks').select('id,lesson_date,start_time,end_time,allowed_minutes').eq('coach_id',c.id).gte('lesson_date',dateToday()).order('lesson_date'),
          supabaseClient.rpc('sportlink_busy_intervals',{p_coach_id:c.id})
        ]);
        if(a.error)throw a.error;if(b.error)throw b.error;
        if(page!==requestedPage||requestVersion!==bookingUiVersion||!app.contains(form))return;
        blocks=a.data||[];busy=b.data||[];
        const future=blocks.map(x=>x.lesson_date).find(d=>d>=dateToday());dateInput.value=future||dateToday();choices();
      }catch(err){if(page!==requestedPage||!app.contains(form))return;schedule.innerHTML='<p class="notice">無法讀取開放時段：'+esc(errorText(err))+'</p>';message.textContent='請確認 Supabase 資料庫已完成新版 SQL 設定。'}
    })();
    schedule.addEventListener('click',e=>{
      const button=e.target.closest('button[data-sl-time]');if(!button||button.disabled)return;
      selectedStart=Number(button.dataset.slTime);choices();
      durationInput.focus();
      if(!durationInput.value){
        summary.textContent=`已選擇 ${dateInput.value} ${slTime(selectedStart)}，請選擇下方課程時長。`;
        try{durationInput.showPicker?.()}catch{}
      }
    });
    dateInput.addEventListener('change',()=>{selectedStart=null;startInput.value='';choices()});
    durationInput.addEventListener('change',choices);
    startInput.addEventListener('change',()=>{
      selectedStart=startInput.value===''?null:Number(startInput.value);
      const duration=Number(durationInput.value);chosen=startInput.value!==''&&duration?{start:Number(startInput.value),duration}:null;
      schedule.innerHTML=slScheduleHtml(blocks,busy.filter(b=>b.lesson_date===dateInput.value),dateInput.value,{start:chosen?.start??-1,duration});
      summary.textContent=chosen?`${dateInput.value} ${slTime(chosen.start)}～${slTime(chosen.start+chosen.duration)} · ${slDurationLabel(chosen.duration)} · 預估 NT$${Math.round(Number(c.price)*chosen.duration/60).toLocaleString()}（實際費用請與教練確認）`:'請選擇開始時間';submit.disabled=!chosen;
    });
    form.onsubmit=async e=>{
      e.preventDefault();if(!user){alert('請先登入');page='account';render();return}
      if(user.id===c.user_id){alert('不能預約自己的課程');return}
      if(!chosen){alert('請先選擇時段');return}
      submit.disabled=true;
      try{
        const {error}=await supabaseClient.rpc('sportlink_create_booking',{p_coach_id:c.id,p_date:dateInput.value,p_start:slTime(chosen.start),p_duration:chosen.duration,p_note:String(new FormData(form).get('note')||'').trim()});
        if(error)throw error;
        alert('預約已送出，等待教練確認');page='dashboard';await reload();
      }catch(err){message.textContent='預約失敗：'+errorText(err);submit.disabled=false}
    };
  }
   else if(page.startsWith('review:')){
     if(!user){page='account';render();return}
     const booking=bookings.find(b=>b.id===page.slice(7));
     if(!booking||booking.student_id!==user.id||booking.status!=='completed'||coachProfile||user.role==='coach'||myReviews.some(r=>r.booking_id===booking.id)){
       alert('這筆課程目前無法評價，可能尚未完成、已評價或帳號具有教練身分。');page='dashboard';render();return;
     }
     app.innerHTML=`<div class="panel card"><h1>評價這堂課程</h1><p class="muted">${esc(booking.coaches?.sport||'課程')} · ${esc(booking.coaches?.display_name||'教練')} · ${esc(booking.lesson_date)}</p><p>不想評價可以直接離開，不影響預約紀錄。</p><form class="form" id="reviewForm"><label>星級（送出時必填）<select name="rating" required><option value="">請選擇星級</option><option value="5">★★★★★ 5 顆星</option><option value="4">★★★★☆ 4 顆星</option><option value="3">★★★☆☆ 3 顆星</option><option value="2">★★☆☆☆ 2 顆星</option><option value="1">★☆☆☆☆ 1 顆星</option></select></label><label>文字評論（選填）<textarea name="comment" maxlength="1000" placeholder="可以只給星星，不用寫評論"></textarea></label><p class="muted">⚠️ 評價一旦提交，就無法修改或刪除，請確認星級與內容後再送出。</p><div class="row"><button class="btn" type="submit">提交評價</button>${btn('先不評價，返回管理中心','go:dashboard','btn secondary')}</div><p id="reviewMessage" role="status" class="muted"></p></form></div>`;
     const reviewForm=app.querySelector('#reviewForm');
     reviewForm.onsubmit=async e=>{
       e.preventDefault();const f=new FormData(reviewForm),rating=Number(f.get('rating')),comment=String(f.get('comment')||'').trim(),submit=reviewForm.querySelector('button[type=submit]'),message=reviewForm.querySelector('#reviewMessage');
       if(!Number.isInteger(rating)||rating<1||rating>5){message.textContent='請先選擇 1～5 顆星。';return}
       if(!confirm('確定提交評價？送出後無法修改或刪除。'))return;
       submit.disabled=true;message.textContent='提交中…';
       try{const {data,error}=await supabaseClient.rpc('sportlink_submit_review',{p_booking_id:booking.id,p_rating:rating,p_comment:comment||null});if(error)throw error;if(data!==true)throw Error('無法提交，請確認課程已完成、尚未評價且帳號不是教練');page='dashboard';await reload();alert('評價已成功送出，謝謝你的回饋！')}
       catch(err){console.error(err);message.textContent='提交失敗：'+errorText(err);submit.disabled=false}
     };
   }
   else if(page==='account'){
     app.innerHTML=`<section class="sl-auth-wrap"><div class="sl-auth-card"><div class="sl-auth-intro"><span class="sl-auth-eyebrow">WELCOME BACK</span><h1>歡迎回到 SportLink</h1><p>登入帳號，繼續你的運動旅程。</p></div>${user?`<p class="notice">目前登入：${esc(user.name)}（${esc(user.role)}）${admin?' · 平台管理員':''}</p>${btn('登出','logout','btn secondary')}`:`<form class="form sl-auth-form" id="accountForm"><label>電子郵件<input name="email" type="email" autocomplete="username" inputmode="email" placeholder="example@email.com" required></label><label>密碼（至少 6 碼）<span class="sl-password-field"><input name="password" id="accountPassword" type="password" minlength="6" autocomplete="current-password" placeholder="請輸入密碼" required><button type="button" class="sl-password-toggle" data-action="toggle-password" aria-label="顯示密碼" aria-controls="accountPassword" aria-pressed="false">顯示</button></span></label><div id="signupFields" hidden><label>顯示名稱<input name="name" maxlength="30" autocomplete="nickname" placeholder="你的暱稱"></label><label>主要身分<select name="role"><option value="student">學生</option><option value="coach">教練</option></select></label></div><button type="button" class="sl-text-button" data-action="forgot-password" id="forgotPasswordButton">忘記密碼？</button><button class="btn sl-auth-submit" type="submit" id="authSubmit">登入 SportLink</button><div class="sl-auth-switch"><span id="authSwitchPrompt">還沒有帳號嗎？</span><button type="button" data-action="toggle-signup" class="sl-auth-switch-btn">立即註冊</button></div><p class="sl-auth-hint">可使用瀏覽器或 iPhone 密碼管理員儲存密碼；登入狀態會持續保留，直到登出或工作階段失效。</p><p id="authMessage" class="sl-auth-message" role="status" aria-live="polite"></p></form>`}</div></section>`;
    const form=app.querySelector('#accountForm');if(form)form.onsubmit=async e=>{e.preventDefault();const submit=form.querySelector('#authSubmit'),message=form.querySelector('#authMessage'),signup=!form.querySelector('#signupFields').hidden,f=new FormData(form);submit.disabled=true;message.textContent='處理中…';try{let result;if(signup){const name=String(f.get('name')||'').trim();if(!name)throw Error('請填寫顯示名稱');result=await supabaseClient.auth.signUp({email:String(f.get('email')),password:String(f.get('password')),options:{emailRedirectTo:location.origin,data:{display_name:name,role:String(f.get('role'))}}})}else result=await supabaseClient.auth.signInWithPassword({email:String(f.get('email')),password:String(f.get('password'))});if(result.error)throw result.error;if(signup&&!result.data.session){message.textContent='註冊申請已送出。請先完成 Email 驗證，再登入。';return}await refreshAuthUser();page='dashboard';await reload();await slHandlePushDeepLink()}catch(err){message.textContent='操作失敗：'+errorText(err)}finally{submit.disabled=false}};
  }
  else if(page==='report'){
    if(!user){page='account';render();return}
    app.innerHTML=`<section class="panel card sl-report-form-card"><span class="eyebrow">HELP & SAFETY</span><h1>回報問題／檢舉</h1><p class="muted">請提供具體資訊，協助我們處理網站問題或不當內容。管理員會查看回報；請勿填入密碼或不必要的敏感個資。</p><form class="form" id="slReportForm"><label>回報類型<select name="category" required><option value="bug" ${slReportCategoryPrefill==='bug'?'selected':''}>網站問題回報</option><option value="abuse" ${slReportCategoryPrefill==='abuse'?'selected':''}>不當使用者／內容檢舉</option></select></label><label>問題描述<textarea name="description" minlength="10" maxlength="2000" rows="6" placeholder="請描述遇到的問題或檢舉原因（至少 10 字）" required></textarea></label><label>相關頁面或對象（選填）<input name="target" maxlength="500" placeholder="網址、使用者暱稱或相關內容" value="${esc(slReportTargetPrefill)}"></label><label>附上截圖（選填，JPG／PNG／WebP，最多 5 MB）<input name="attachment" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="btn" type="submit">送出回報</button><p id="slReportMessage" class="sl-report-message" role="status" aria-live="polite"></p></form></section>`;
    app.querySelector('#slReportForm').addEventListener('submit',async event=>{event.preventDefault();await slSubmitReport(event.currentTarget)});
  }
  else if(page==='dashboard'){
    if(!user){page='account';render();return}
    const mine=bookings.filter(b=>b.student_id===user.id),received=bookings.filter(b=>b.coach_id===coachProfile?.id);
    app.innerHTML=`${slWelcomeCard()}<div class="sl-dashboard-tools"><span class="sl-tools-label">會員快捷操作</span><div class="sl-tools-actions">${btn('↻ 更新課程','reload','btn secondary')}${admin?btn('平台管理後台','go:admin','btn secondary'):''}${!coachProfile?btn('申請成為教練','go:coach-apply','btn secondary'):''}${btn('回報問題／檢舉','go:report','btn secondary')}</div></div>${slPushPanel()}${coachProfile?`${slCoachCalendarPanel()}${availabilityPanel()}${slBookingSection('學生預約我的課程',received,'目前沒有進行中的學生預約。','sl-coach-history','coach')}${coachEditPanel()}${slStudentDashboard(mine)}`:slStudentDashboard(mine)}<details class="sl-demo-details"><summary>代課媒合（示範功能）</summary><p>代課媒合仍是本機示範，尚未雲端同步。</p>${btn('查看代課示範','go:substitutions','btn secondary')}</details>`;
    if(coachProfile)slSetupCoachCalendar(received);
    slSetupStudentCalendar(mine);
    app.querySelectorAll('.sl-board-filters').forEach(group=>group.addEventListener('click',e=>{
      const button=e.target.closest('[data-board-filter]');if(!button)return;
      const filter=button.dataset.boardFilter;
      const section=group.closest('.sl-booking-section');
      group.querySelectorAll('[data-board-filter]').forEach(b=>{const selected=b===button;b.classList.toggle('is-active',selected);b.setAttribute('aria-pressed',String(selected));});
      let shown=0;
      section.querySelectorAll('.sl-board-entry').forEach(entry=>{const visible=filter==='all'||entry.dataset.boardStatus===filter;entry.classList.toggle('hidden',!visible);if(visible)shown++;});
      section.querySelector('.sl-board-no-results')?.classList.toggle('hidden',shown!==0);
    }));
    app.querySelectorAll('.sl-student-tabs').forEach(group=>group.addEventListener('click',e=>{
      const button=e.target.closest('[data-student-tab]');if(!button)return;
      const tab=button.dataset.studentTab;
      const section=group.closest('.sl-student-dashboard');
      group.querySelectorAll('[data-student-tab]').forEach(b=>{const selected=b===button;b.classList.toggle('is-active',selected);b.setAttribute('aria-pressed',String(selected));});
      section.querySelectorAll('[data-student-panel]').forEach(panel=>panel.classList.toggle('hidden',panel.dataset.studentPanel!==tab));
    }));
    const coachPhotoForm=app.querySelector('#coachPhotoForm');
    if(coachPhotoForm)coachPhotoForm.onsubmit=async e=>{
      e.preventDefault();
      if(!user||!coachProfile||coachProfile.user_id!==user.id)return;
      const file=coachPhotoForm.querySelector('input[type=file]').files?.[0];
      const message=coachPhotoForm.querySelector('#coachPhotoMessage');
      const submit=coachPhotoForm.querySelector('button[type=submit]');
      const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file?.type];
      if(!file||!ext){message.textContent='請選擇 JPG、PNG 或 WebP 照片。';return}
      if(file.size>5*1024*1024){message.textContent='照片不可超過 5 MB。';return}
      submit.disabled=true;message.textContent='照片上傳中…';
      try{
        const path=`${user.id}/avatar-${Date.now()}.${ext}`;
        const {error:uploadError}=await supabaseClient.storage.from(PHOTO_BUCKET).upload(path,file,{contentType:file.type,upsert:false,cacheControl:'3600'});
        if(uploadError)throw uploadError;
        const {data,error}=await supabaseClient.rpc('sportlink_set_coach_photo',{p_photo_path:path});
        if(error)throw error;
        if(data!==true)throw Error('照片已上傳，但更新教練資料失敗');
        await refreshData();render();alert('教練大頭照更新成功！');
      }catch(err){console.error(err);message.textContent='照片處理失敗：'+errorText(err);submit.disabled=false}
    };
    const coachEditForm=app.querySelector('#coachEditForm');
    if(coachEditForm)coachEditForm.onsubmit=async e=>{
      e.preventDefault();
      if(!user||!coachProfile)return;
      const submit=coachEditForm.querySelector('button[type="submit"]');
      const f=new FormData(coachEditForm);
      const displayName=String(f.get('display_name')||'').trim();
      const sport='羽球';
      const area=String(f.get('area')||'').trim();
      const price=Number(f.get('price'));
      const description=String(f.get('description')||'').trim();
      if(!displayName||!sport||!area||!description||!Number.isFinite(price)||price<=0||price>100000){alert('請確認教練資料及價格填寫正確');return}
      submit.disabled=true;
      try{
        const {data,error}=await supabaseClient.rpc('sportlink_update_coach_profile',{
          p_display_name:displayName,p_sport:sport,p_area:area,p_price:price,p_description:description
        });
        if(error)throw error;
        if(data!==true)throw Error('儲存未成功，請確認資料及帳號權限');
        await refreshData();
        render();
        alert('教練資料已儲存成功！');
      }catch(err){alert('儲存失敗：'+errorText(err));submit.disabled=false}
    };
     const credentialsForm=app.querySelector('#coachCredentialsForm');
     if(credentialsForm)credentialsForm.onsubmit=async e=>{
       e.preventDefault();
       if(!user||!coachProfile||coachProfile.user_id!==user.id)return;
       const f=new FormData(credentialsForm),submit=credentialsForm.querySelector('button[type=submit]'),message=credentialsForm.querySelector('#credentialsMessage');
       const years=Number(f.get('teaching_years'));
       if(!Number.isInteger(years)||years<0||years>80){message.textContent='教學年資請填寫 0 到 80 的整數。';return}
       submit.disabled=true;message.textContent='儲存中…';
       try{
         const {data,error}=await supabaseClient.rpc('sportlink_update_coach_credentials',{
           p_teaching_years:years,
           p_teaching_experience:String(f.get('teaching_experience')||'').trim(),
           p_certificate_name:String(f.get('certificate_name')||'').trim()
         });
         if(error)throw error;
         if(data!==true)throw Error('儲存未成功，請確認教練帳號權限');
         await refreshData();render();alert('教學資歷已儲存成功！');
       }catch(err){console.error(err);message.textContent='儲存失敗：'+errorText(err);submit.disabled=false}
     };
     const certificateForm=app.querySelector('#coachCertificateForm');
     if(certificateForm)certificateForm.onsubmit=async e=>{
       e.preventDefault();
       if(!user||!coachProfile||coachProfile.user_id!==user.id)return;
       const file=certificateForm.querySelector('input[type=file]').files?.[0];
       const message=certificateForm.querySelector('#certificateMessage');
       const submit=certificateForm.querySelector('button[type=submit]');
       const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file?.type];
       if(!file||!ext){message.textContent='請選擇 JPG、PNG 或 WebP 照片。';return}
       if(file.size>5*1024*1024){message.textContent='證照照片不可超過 5 MB。';return}
       submit.disabled=true;message.textContent='證照照片上傳中…';
       try{
         const path=`${user.id}/certificate-${Date.now()}.${ext}`;
         const {error:uploadError}=await supabaseClient.storage.from(CERT_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
         if(uploadError)throw uploadError;
         const {data,error}=await supabaseClient.rpc('sportlink_set_coach_certificate',{p_certificate_path:path});
         if(error)throw error;
         if(data!==true)throw Error('證照已上傳，但無法更新教練資料');
         await refreshData();render();alert('證照照片已安全儲存！');
       }catch(err){console.error(err);message.textContent='上傳失敗：'+errorText(err);submit.disabled=false}
     };
    const availabilityForm=app.querySelector('#availabilityForm');
    if(availabilityForm)availabilityForm.onsubmit=async e=>{
      e.preventDefault();const submit=availabilityForm.querySelector('button[type=submit]'),f=new FormData(availabilityForm);
      const durations=f.getAll('duration').map(Number),start=String(f.get('start')),end=String(f.get('end'));
      if(!durations.length){alert('請至少選擇一種可預約時長');return}
      if(slMins(end)<=slMins(start)||slMins(end)-slMins(start)>720){alert('結束時間必須晚於開始時間，最多 12 小時');return}
      submit.disabled=true;
      try{
        const {error}=await supabaseClient.rpc('sportlink_add_open_block',{p_date:f.get('date'),p_start:start,p_end:end,p_durations:durations});
        if(error)throw error;await reload();
      }catch(err){alert('新增開放時段失敗：'+errorText(err));submit.disabled=false}
    };
  }
  else if(page==='coach-apply'){
    if(!user){page='account';render();return}if(coachProfile){page='dashboard';render();return}
    app.innerHTML=`<div class="panel card"><h1>申請羽球教練上架</h1><p class="muted">送出後等待平台管理員核准。核准前不會開放學生預約。</p><form class="form" id="coachApply"><label>公開顯示名稱<input name="name" required maxlength="60" value="${esc(user.name)}"></label><label>運動項目<input value="羽球" readonly></label><label>授課地區（雙北及桃園）<select name="area">${areaOptions('台北市大安區')}</select></label><label>每小時價格（NT$）<input name="price" type="number" min="1" max="100000" required></label><label>教學介紹<textarea name="description" maxlength="1000" required></textarea></label><button class="btn">送出教練申請</button></form></div>`;
    app.querySelector('#coachApply').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),submit=e.target.querySelector('button');submit.disabled=true;try{const {error}=await supabaseClient.from('coaches').insert({user_id:user.id,display_name:String(f.get('name')).trim(),sport:'羽球',area:f.get('area'),price:Number(f.get('price')),description:String(f.get('description')).trim(),is_active:false});if(error)throw error;alert('羽球教練申請已送出，等待管理員審核');page='dashboard';await reload()}catch(err){alert('送出失敗：'+errorText(err))}finally{submit.disabled=false}};
  }
  else if(page==='admin'){
    if(!user||!admin){page='dashboard';render();return}
    app.innerHTML=`<h1>SportLink 平台管理後台</h1><p class="muted">只有經資料庫授權的管理員可查看。</p>${btn('重新整理','admin-refresh','btn secondary')}<div class="section"><h2>使用者回報與檢舉</h2><p class="muted">回報內容與附圖只有平台管理員能查看。</p>${btn('重新讀取回報','admin-reports-refresh','btn secondary')}<div id="adminReports" class="sl-admin-reports"><p class="muted">正在讀取回報…</p></div></div><div class="section"><h2>全平台預約</h2><div class="list">${bookings.map(bookingCard).join('')||'<div class="item muted">尚無預約。</div>'}</div></div><div class="section"><h2>教練上架審核</h2><div class="list" id="adminCoaches"><div class="item muted">載入中…</div></div></div>`;
    supabaseClient.from('coaches').select('id,display_name,sport,area,price,is_active').eq('sport','羽球').order('created_at',{ascending:false}).then(({data,error})=>{if(page!=='admin')return;const target=app.querySelector('#adminCoaches');if(!target)return;target.innerHTML=error?`<div class="item">讀取失敗：${esc(error.message)}</div>`:(data||[]).map(c=>`<div class="item"><div class="row"><b>${esc(c.display_name)} · ${esc(c.sport)} · ${esc(c.area)}</b><span class="pill">${c.is_active?'已上架':'待審核／已下架'}</span></div><p class="muted">NT$${Number(c.price).toLocaleString()} / 小時</p>${btn(c.is_active?'下架教練':'核准上架','admin-coach:'+c.id+':'+(!c.is_active),'btn secondary')}</div>`).join('')||'<div class="item muted">尚無教練申請。</div>'});
    slAdminReportsLoad();
  }
  else if(page==='substitutions')app.innerHTML=`<div class="row"><div><h1>代課媒合中心（示範）</h1><p class="muted">此區資料僅存在目前瀏覽器，尚未雲端同步。</p></div>${btn('＋ 發布代課需求','go:newjob')}</div><div class="grid">${jobs.filter(j=>j.status==='open').map(jobCard).join('')||'<p>目前沒有代課需求。</p>'}</div>`;
  else if(page.startsWith('job:')){const j=jobs.find(x=>x.id===+page.slice(4));if(!j){page='substitutions';render();return}app.innerHTML=`<div class="panel card"><span class="pill">${esc(j.sport)} · 本機示範</span><h1>${esc(j.sport)}教練代課</h1><p>📍 ${esc(fullArea(j.area))}</p><p>📅 ${esc(j.date)} ${esc(j.time)}</p><p>${esc(j.detail)}</p>${btn('申請這個代課（示範）','apply:'+j.id)}</div>`}
  else if(page==='newjob'){if(!user){page='account';render();return}app.innerHTML=`<div class="panel card"><h1>發布羽球代課需求（本機示範）</h1><form class="form" id="jobForm"><label>運動項目<input value="羽球" readonly></label><label>行政區<select name="area">${areaOptions('台北市大安區')}</select></label><label>日期<input name="date" type="date" min="${dateToday()}" required></label><label>時間<input name="time" type="time" required></label><label>時數<input name="hours" type="number" min="1" max="12" value="2" required></label><label>時薪<input name="rate" type="number" min="1" required></label><label>需求說明<textarea name="detail" required></textarea></label><button class="btn">發布（示範）</button></form></div>`;app.querySelector('#jobForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);jobs.unshift({id:Date.now(),sport:'羽球',area:f.get('area'),date:f.get('date'),time:f.get('time'),hours:Number(f.get('hours')),rate:Number(f.get('rate')),detail:f.get('detail'),owner:user.name,status:'open'});save('jobs',jobs);page='substitutions';render()}}
}
// Mobile navigation: keep the existing page-routing behavior intact.
const slMenuToggle=document.getElementById('slMobileMenuToggle');
const slMenu=document.getElementById('slMobileMenu');
function closeSlMobileMenu(){
  if(!slMenuToggle||!slMenu)return;
  slMenuToggle.setAttribute('aria-expanded','false');
  slMenuToggle.setAttribute('aria-label','開啟導覽選單');
  slMenuToggle.querySelector('span[aria-hidden]').textContent='☰';
  slMenu.classList.remove('sl-menu-open');
}
if(slMenuToggle&&slMenu){
  slMenuToggle.addEventListener('click',()=>{
    const open=slMenuToggle.getAttribute('aria-expanded')!=='true';
    slMenuToggle.setAttribute('aria-expanded',String(open));
    slMenuToggle.setAttribute('aria-label',open?'關閉導覽選單':'開啟導覽選單');
    slMenuToggle.querySelector('span[aria-hidden]').textContent=open?'✕':'☰';
    slMenu.classList.toggle('sl-menu-open',open);
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSlMobileMenu()});
  document.addEventListener('click',e=>{
    if(!slMenu.contains(e.target)&&!slMenuToggle.contains(e.target))closeSlMobileMenu();
  });
  window.addEventListener('resize',()=>{if(window.innerWidth>700)closeSlMobileMenu()});
}
document.addEventListener('click',async e=>{
  const accountMenu=document.querySelector('.sl-member-account');
  if(accountMenu?.open&&!accountMenu.contains(e.target))accountMenu.open=false;
  if(e.target.classList?.contains('sl-coach-calendar-modal')){slCoachCalendarCloseDialog();return}
  if(e.target.classList?.contains('sl-open-play-modal')){slOpenPlayCloseDialog();return}
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.page){slChatStop();document.querySelector('.sl-member-account')?.removeAttribute('open');closeSlMobileMenu();page=b.dataset.page==='account'&&user?'dashboard':b.dataset.page;if(page!=='open-play')slOpenPlaySelectedGameId='';render();if(page==='community'&&user)slSocialLoad();if(page==='open-play')slOpenPlayLoad();window.scrollTo(0,0);return}
  const a=b.dataset.action;if(!a)return;const [cmd,id,extra]=a.split(':');
  if(cmd==='coach-calendar-close'){slCoachCalendarCloseDialog();return}
  if(cmd==='push-refresh'){slPushLoadState(true);render();return}
  if(cmd==='push-enable'||cmd==='push-disable'){b.disabled=true;try{if(cmd==='push-enable')await slPushEnable();else await slPushDisable()}catch(err){slPushStatus='設定失敗：'+errorText(err)}render();return}
  if(cmd==='social-tab'){if(!['discover','friends','requests','messages','forum'].includes(id))return;slChatStop();slCommunityTab=id;slSocialProfile=null;render();if(user&&['discover','friends','requests','messages'].includes(id))slSocialLoad();return}
  if(cmd==='chat-open'){if(!user||!slChatFriends().some(x=>x.id===id))return;slChatPeer=id;slChatMessages=[];slChatError='';slChatStart();slChatLoad();return}
  if(cmd==='social-close'){slSocialProfile=null;render();return}
  if(cmd==='social-profile'){slSocialProfile=[...slSocialRows,...slSocialSearchRows].find(x=>x.id===id)||null;render();return}
  if(cmd==='social-report'){
    const member=[...slSocialRows,...slSocialSearchRows].find(x=>x.id===id);
    if(!member||!user)return;
    slReportCategoryPrefill='abuse';slReportTargetPrefill=`${member.display_name} (${member.id})`;
    page='report';render();window.scrollTo(0,0);return;
  }
  if(cmd==='social-block'){if(!confirm('封鎖後將解除好友並禁止互相發送邀請。確定封鎖？'))return;}
  if(cmd==='social-action'||cmd==='social-block'){
    if(!user){page='account';render();return}
    const action=cmd==='social-block'?'block':id,target=cmd==='social-block'?id:extra;
    if(!['send','accept','reject','cancel','remove','block'].includes(action)||!target)return;
    b.disabled=true;
    try{const {data,error}=await supabaseClient.rpc('sportlink_social_action',{p_target:target,p_action:action});if(error)throw error;if(!data)throw Error('邀請狀態已改變，請重新整理');slSocialProfile=null;await slSocialLoad();slNoticeRefresh();if(slSocialQuery.trim().length>=2)await slSocialSearch();}
    catch(err){alert('操作失敗：'+errorText(err));b.disabled=false}return;
  }
  if(cmd==='favorite'){
    if(!user){alert('請先登入才能收藏教練');page='account';render();return}
    if(!favoritesReady){alert('收藏功能尚未啟用，請先執行隨附的 Supabase SQL');return}
    if(!liveCoaches.some(c=>c.id===id))return;
    b.disabled=true;
    try{const wasFavorite=favoriteCoachIds.has(id);const query=supabaseClient.from('sportlink_favorite_coaches');
      const result=wasFavorite?await query.delete().eq('student_id',user.id).eq('coach_id',id):await query.insert({student_id:user.id,coach_id:id});
      if(result.error)throw result.error;
      if(wasFavorite)favoriteCoachIds.delete(id);else favoriteCoachIds.add(id);
      render();
    }catch(err){alert('收藏操作失敗：'+errorText(err));b.disabled=false}return;
  }
  if(cmd==='go'||cmd==='coach'||cmd==='job'){
    if(cmd==='go'&&id==='report'){slReportTargetPrefill='';slReportCategoryPrefill='bug'}
    page=cmd==='go'?id:a;render();window.scrollTo(0,0);return
  }
  if(cmd==='open-play-refresh'){slOpenPlayFilters={city:'',district:'',level:''};slOpenPlayNotice='';slOpenPlayLoad();return}
  if(cmd==='open-play-mode'){slOpenPlayMode=['list','create','registrations','host-games'].includes(id)?id:'list';slOpenPlaySelectedGameId='';slOpenPlayError='';slOpenPlayNotice='';render();if(slOpenPlayMode==='list')slOpenPlayLoad();else if(slOpenPlayMode==='registrations')slOpenPlayMyGamesLoad();else if(slOpenPlayMode==='host-games')slOpenPlayHostGamesLoad();return}
  if(cmd==='open-play-game'){slOpenPlaySelectedGameId=id;render();app.querySelector('.sl-open-play-dialog-close')?.focus();return}
  if(cmd==='open-play-close-game'){slOpenPlayCloseDialog();return}
  if(cmd==='open-play-my-games-refresh'){slOpenPlayMyGamesLoad();return}
  if(cmd==='open-play-host-games-refresh'){slOpenPlayHostGamesLoad();return}
  if(cmd==='open-play-review'){
    if(!user||!['approve','reject'].includes(extra)||!confirm(extra==='approve'?'確定核准這筆跨級報名？':'確定拒絕這筆跨級報名？'))return;
    slOpenPlayReviewing=true;b.disabled=true;
    try{
      const {data,error}=await supabaseClient.rpc('sportlink_review_game_registration',{p_registration_id:id,p_approve:extra==='approve'});
      if(error)throw error;
      const result=Array.isArray(data)?data[0]:data;
      if(!result?.status)throw Error('伺服器未回傳審核結果，請重新載入確認狀態');
      slOpenPlayNotice=result.status==='rejected'?'已拒絕這筆報名。':result.status==='confirmed'?'已核准報名，球友已取得名額。':'已核准報名，但名額已滿，球友已排入候補。';
      slOpenPlayReviewing=false;
      await slOpenPlayHostGamesLoad();
    }catch(error){slOpenPlayReviewing=false;slOpenPlayNotice='審核失敗：'+errorText(error);render()}
    return;
  }
   if(cmd==='admin-reports-refresh'){if(!admin)return;await slAdminReportsLoad();return}
   if(cmd==='admin-report-save'){
     if(!admin)return;
     const form=b.closest('[data-report-id]');
     if(!form)return;
     const values=new FormData(form),status=String(values.get('status')||''),note=String(values.get('admin_note')||'').trim();
     b.disabled=true;
     try{
       const {data,error}=await supabaseClient.rpc('sportlink_admin_update_report',{
         p_report_id:form.dataset.reportId,p_status:status,p_admin_note:note||null
       });
       if(error)throw error;
       if(data!==true)throw Error('回報已不存在，請重新讀取');
       const report=slAdminReports.find(item=>item.id===form.dataset.reportId);
       if(report){report.status=status;report.admin_note=note}
       slAdminReportsPaint();
     }catch(error){alert('儲存回報處理結果失敗：'+errorText(error));b.disabled=false}
     return;
   }
   if(cmd==='reload'||cmd==='admin-refresh'){await reload();return}
   if(cmd==='review'){page='review:'+id;render();window.scrollTo(0,0);return}
   if(cmd==='booking-complete'){
     if(!coachProfile||!confirm('確定這堂課程已經完成？完成後學生即可選擇是否評價。'))return;
     b.disabled=true;
     try{const {data,error}=await supabaseClient.rpc('sportlink_change_booking_status',{p_booking_id:id,p_action:'complete'});if(error)throw error;if(!data)throw Error('課程尚未開始、狀態不符或沒有權限');await reload()}
     catch(err){alert('標記完成失敗：'+errorText(err));b.disabled=false}
     return;
   }
     if(cmd==='block-remove'){
     if(!coachProfile?.is_active)return;
     if(!confirm('確定移除這個開放時段？若已有預約，系統會拒絕移除。'))return;
     b.disabled=true;
     try{const {error}=await supabaseClient.rpc('sportlink_remove_open_block',{p_block_id:id});if(error)throw error;await reload()}
     catch(err){alert('移除時段失敗：'+errorText(err));b.disabled=false}
     return;
   }if(cmd==='booking-accept'||cmd==='booking-reject'||cmd==='booking-cancel'){
    if(!user)return;const action=cmd.slice(8);if(!confirm(action==='accept'?'確定接受這筆預約？':action==='reject'?'確定拒絕這筆預約？':'確定取消預約？'))return;
    b.disabled=true;try{const {data,error}=await supabaseClient.rpc('sportlink_change_booking_status',{p_booking_id:id,p_action:action});if(error)throw error;if(!data)throw Error(action==='cancel'?'無法取消：預約狀態已變更或沒有取消權限。':'沒有權限或預約已經處理');await reload()}catch(err){alert('操作失敗：'+errorText(err));b.disabled=false}return;
  }
  if(cmd==='admin-coach'){
    if(!admin)return;if(!confirm(extra==='true'?'確定核准這位教練上架？':'確定下架這位教練？'))return;
    b.disabled=true;try{const {data,error}=await supabaseClient.rpc('sportlink_set_coach_active',{p_coach_id:id,p_active:extra==='true'});if(error)throw error;if(!data)throw Error('無法修改教練狀態');await reload()}catch(err){alert('操作失敗：'+errorText(err));b.disabled=false}return;
  }
  if(cmd==='toggle-password'){const input=app.querySelector('#accountPassword');if(input){const showing=input.type==='password';input.type=showing?'text':'password';b.textContent=showing?'隱藏':'顯示';b.setAttribute('aria-label',showing?'隱藏密碼':'顯示密碼');b.setAttribute('aria-pressed',String(showing))}return}
  if(cmd==='forgot-password'){const email=String(app.querySelector('#accountForm input[name=email]')?.value||'').trim();const message=app.querySelector('#authMessage');if(!message)return;if(!email||!app.querySelector('#accountForm input[name=email]').checkValidity()){message.textContent='請先輸入有效的電子郵件，再點選忘記密碼。';return}b.disabled=true;message.textContent='正在寄送重設密碼信…';try{const {error}=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:location.origin+'/?auth=recovery'});if(error)throw error;message.textContent='如果此信箱有註冊帳號，請查看信箱中的密碼重設連結（也請檢查垃圾郵件）。'}catch(err){message.textContent='寄送失敗：'+errorText(err)}finally{b.disabled=false}return}
  if(cmd==='toggle-signup'){const fields=app.querySelector('#signupFields');if(fields){fields.hidden=!fields.hidden;app.querySelector('#authSubmit').textContent=fields.hidden?'登入 SportLink':'建立帳號';b.textContent=fields.hidden?'立即註冊':'返回登入';app.querySelector('#authSwitchPrompt').textContent=fields.hidden?'還沒有帳號嗎？':'已經有帳號了？';app.querySelector('input[name=password]').autocomplete=fields.hidden?'current-password':'new-password';app.querySelector('#forgotPasswordButton').hidden=!fields.hidden}return}
  if(cmd==='logout'){slChatStop();slNoticeReset();document.querySelector('.sl-member-account')?.removeAttribute('open');const {error}=await supabaseClient.auth.signOut();if(error){alert(error.message);return}user=null;slOpenPlayMyGames=[];slOpenPlayHostGames=[];admin=false;coachProfile=null;bookings=[];page='home';await reload();return}
  if(cmd==='apply'){if(!user){page='account';render();return}const j=jobs.find(x=>x.id===+id);if(!j)return;if(j.owner===user.name){alert('不能申請自己的代課需求');return}if(applications.some(x=>x.jobId===j.id&&x.applicant===user.name)){alert('已申請過');return}applications.push({id:Date.now(),jobId:j.id,applicant:user.name,sport:j.sport,date:j.date,status:'待確認'});save('applications',applications);alert('已建立本機示範申請，不會通知教練');page='dashboard';render()}
});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  if(app.querySelector('#sl-coach-calendar-modal .sl-coach-calendar-modal')){slCoachCalendarCloseDialog();return}
  if(slOpenPlaySelectedGameId)slOpenPlayCloseDialog();
});
document.addEventListener('change',e=>{
  const id=e.target?.dataset?.historyDate;
  if(!id||page!=='dashboard')return;
  const source=id==='sl-coach-history'?bookings.filter(b=>b.coach_id===coachProfile?.id):bookings.filter(b=>b.student_id===user?.id);
  const target=document.getElementById(id+'-results');
  if(target)target.innerHTML=slHistoryCards(source.filter(b=>slArchivedStatuses.has(b.status)),e.target.value);
});
document.addEventListener('click',e=>{
  const button=e.target.closest('button[data-history-clear]');
  if(!button||page!=='dashboard')return;
  const id=button.dataset.historyClear,field=document.getElementById(id+'-date');
  if(field){field.value='';field.dispatchEvent(new Event('change',{bubbles:true}))}
});
document.addEventListener('submit',e=>{if(e.target.id!=='slHomeSearchForm')return;e.preventDefault();areaFilter=e.target.elements.area.value;page='coaches';render();window.scrollTo(0,0)});
document.addEventListener('submit',e=>{if(e.target.id!=='slOpenPlayFilters')return;e.preventDefault();const form=e.target;slOpenPlayNotice='';slOpenPlayLoad({city:String(form.elements.city.value||'').trim(),district:String(form.elements.district.value||'').trim(),level:String(form.elements.level.value||'')})});
document.addEventListener('submit',e=>{if(e.target.id!=='slOpenPlayCreateForm')return;e.preventDefault();slOpenPlayCreate(e.target)});
document.addEventListener('submit',async e=>{
  const form=e.target.closest('form[data-host-game-photo]');
  if(!form)return;
  e.preventDefault();
  if(!user){page='account';render();return}
  if(slOpenPlayPhotoSaving)return;
  const gameId=form.dataset.hostGamePhoto;
  const game=slOpenPlayHostGames.find(item=>item.game_id===gameId);
  const photo=new FormData(form).get('photo');
  const message=form.querySelector('[data-photo-message]');
  const button=form.querySelector('button[type="submit"]');
  if(!game||!photo?.size){message.textContent='請選擇一張照片後再上傳。';return}
  if(!['image/jpeg','image/png','image/webp'].includes(photo.type)||photo.size>5*1024*1024){message.textContent='照片須為 JPG、PNG 或 WebP，且不可超過 5 MB。';return}
  const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[photo.type];
  const storagePath=`${user.id}/${gameId}/${crypto.randomUUID()}.${extension}`;
  const storage=supabaseClient.storage.from('sportlink-game-photos');
  slOpenPlayPhotoSaving=true;button.disabled=true;message.textContent='正在上傳照片…';
  let uploaded=false,savedToGame=false;
  try{
    const {error:uploadError}=await storage.upload(storagePath,photo,{contentType:photo.type,cacheControl:'3600',upsert:false});
    if(uploadError)throw uploadError;
    uploaded=true;
    const {data:saved,error:saveError}=await supabaseClient.rpc('sportlink_set_game_photo',{p_game_id:gameId,p_storage_path:storagePath});
    if(saveError)throw saveError;
    if(saved!==true)throw Error('伺服器未確認照片');
    savedToGame=true;
    let cleanupWarning='';
    const oldPath=form.dataset.existingPhoto;
    if(oldPath){
      const {error:removeError}=await storage.remove([oldPath]);
      if(removeError)cleanupWarning='照片已更新，但舊照片清理失敗：'+errorText(removeError);
    }
    slOpenPlayNotice=cleanupWarning||'球局照片已更新，球友可在球局詳情中查看。';
    await slOpenPlayHostGamesLoad();
  }catch(error){
    let detail=errorText(error);
    if(savedToGame){
      slOpenPlayNotice='照片已更新，但舊照片清理失敗：'+detail;
      await slOpenPlayHostGamesLoad();
    }else if(uploaded){
      const {error:cleanupError}=await storage.remove([storagePath]);
      if(cleanupError)detail+='；新上傳的照片清理失敗：'+errorText(cleanupError);
      message.textContent='照片上傳失敗：'+detail;
      button.disabled=false;
    }else{
      message.textContent='照片上傳失敗：'+detail;
      button.disabled=false;
    }
  }finally{slOpenPlayPhotoSaving=false}
});
document.addEventListener('submit',async e=>{
  const form=e.target.closest('form[data-game-registration]');
  if(!form)return;
  e.preventDefault();
  if(!user){page='account';render();return}
  const game=slOpenPlayGames.find(item=>item.game_id===form.dataset.gameRegistration);
  if(!game)return;
  const values=new FormData(form),name=String(values.get('player_name')||'').trim(),level=Number(values.get('player_level')),note=String(values.get('note')||'').trim();
  const message=form.querySelector('[data-game-message]'),button=form.querySelector('button[type="submit"]');
  if(!name||name.length>60||!Number.isInteger(level)||level<1||level>18||note.length>500){message.textContent='請檢查暱稱、級數與備註格式。';return}
  button.disabled=true;message.textContent='正在送出報名…';
  try{
    const {data,error}=await supabaseClient.rpc('sportlink_register_for_game',{p_game_id:game.game_id,p_player_name:name,p_player_level:level,p_note:note||null});
    if(error)throw error;
    const result=Array.isArray(data)?data[0]:data;
    if(!result?.status)throw Error('伺服器未回傳報名狀態，請重新整理確認結果');
    const statusMessages={confirmed:'報名成功，名額已確認。',waitlisted:result.waitlist_position?`已加入候補，目前順位第 ${result.waitlist_position} 位。`:'已加入候補，順位將依候補順序安排。',pending_approval:'跨級申請已送出，等待團主審核。'};
    slOpenPlayNotice=statusMessages[result.status]||`報名狀態：${result.status}`;
    slOpenPlaySelectedGameId='';
    await slOpenPlayLoad();
  }catch(error){message.textContent='報名失敗：'+errorText(error);button.disabled=false}
});
document.addEventListener('change',e=>{if(e.target.id==='areaFilter'){areaFilter=e.target.value;render()}});
async function refreshAuthUser(){
  const {data:{session},error}=await supabaseClient.auth.getSession();
  if(error)throw error;
  if(!session?.user){user=null;return}
  const authUser=session.user,meta=authUser.user_metadata||{};
  user={id:authUser.id,name:String(meta.display_name||authUser.email?.split('@')[0]||'會員'),role:meta.role==='coach'?'教練':'學生'};
}
async function handlePasswordRecovery(){
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(!session){alert('重設連結已失效，請回登入頁重新寄送。');page='account';render();return}
  page='account';
  app.innerHTML=`<div class="panel card"><h1>設定新密碼</h1><p class="muted">請輸入新密碼，至少 6 碼。</p><form id="recoveryForm" class="form"><label>新密碼<input type="password" name="newPassword" autocomplete="new-password" minlength="6" required></label><label>確認新密碼<input type="password" name="confirmPassword" autocomplete="new-password" minlength="6" required></label><button class="btn" type="submit">更新密碼</button><p id="recoveryMessage" role="status" aria-live="polite"></p></form></div>`;
  const form=app.querySelector('#recoveryForm');
  form.onsubmit=async e=>{e.preventDefault();const message=form.querySelector('#recoveryMessage'),button=form.querySelector('button[type=submit]'),p=form.elements.newPassword.value;if(p!==form.elements.confirmPassword.value){message.textContent='兩次密碼不一致。';return}button.disabled=true;message.textContent='更新中…';try{const {error}=await supabaseClient.auth.updateUser({password:p});if(error)throw error;history.replaceState(null,'',location.pathname);page='dashboard';await reload();alert('密碼已更新。')}catch(err){message.textContent='重設失敗：'+errorText(err)}finally{button.disabled=false}};
}
// Avoid async Supabase calls inside auth callbacks: they can deadlock on the auth lock.
// INITIAL_SESSION is handled by startup below; TOKEN_REFRESHED must not refetch every page.
supabaseClient.auth.onAuthStateChange((event,session)=>{
  if(event==='PASSWORD_RECOVERY'){
    setTimeout(()=>handlePasswordRecovery().catch(e=>showConnectionNotice(errorText(e))),0);
    return;
  }
  if(event==='INITIAL_SESSION'||event==='TOKEN_REFRESHED')return;
  if(event==='SIGNED_OUT'){
    slChatStop();slNoticeReset();slChatPeer=null;slChatMessages=[];
    slPushResetState();
    authVersion++;
    user=null;slOpenPlayMyGames=[];slOpenPlayHostGames=[];admin=false;coachProfile=null;bookings=[];render();
    return;
  }
  if(event==='SIGNED_IN'||event==='USER_UPDATED'){
    const next=session?.user;
    if(!next)return;
    const previousId=user?.id;
    const meta=next.user_metadata||{};
    user={id:next.id,name:String(meta.display_name||next.email?.split('@')[0]||'會員'),role:meta.role==='coach'?'教練':'學生'};
    slSyncMemberNav();slNoticeStart();
    if(previousId!==next.id){
      const version=++authVersion;
      setTimeout(()=>{if(version===authVersion)reload()},0);
    }
  }
});
window.addEventListener('online',()=>{showConnectionNotice('網路已恢復，正在更新資料…');reload()});
window.addEventListener('offline',()=>showConnectionNotice('目前沒有網路連線；登入及預約需要連線。'));
render();
refreshAuthUser().then(async()=>{
  await reload();slNoticeStart();
  if(new URLSearchParams(location.search).get('auth')==='recovery')await handlePasswordRecovery();
  else await slHandlePushDeepLink();
}).catch(e=>{console.error('SportLink auth startup:',e);showConnectionNotice('登入狀態讀取失敗：'+errorText(e))});

// 社群搜尋使用表單送出，避免每次輸入都查詢資料庫。
document.addEventListener('submit',e=>{if(e.target.id!=='slSocialSearchForm')return;e.preventDefault();slSocialQuery=String(new FormData(e.target).get('q')||'').trim();slSocialSearch()});

document.addEventListener('submit',async e=>{
  if(e.target.id!=='slChatForm')return;
  e.preventDefault();
  if(slChatBusy||!user||!slChatPeer)return;
  const form=e.target,peer=slChatPeer,body=String(new FormData(form).get('body')||'').trim();
  if(!body||body.length>2000)return;
  slChatBusy=true;slChatError='';
  const button=form.querySelector('button[type=submit]');if(button)button.disabled=true;
  try{
    const {error}=await supabaseClient.rpc('sportlink_chat_send',{p_recipient:peer,p_body:body});
    if(error)throw error;
    form.reset();await slChatLoad(true);slNoticeRefresh();
  }catch(err){slChatError='傳送失敗：'+errorText(err);render()}
  finally{slChatBusy=false;const current=document.querySelector('#slChatForm button[type=submit]');if(current)current.disabled=false}
});
