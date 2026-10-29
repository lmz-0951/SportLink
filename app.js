// SportLink 雲端預約版：保留原本的示範教練與代課資料
const coaches=[{id:1,name:'余賢',sport:'游泳',area:'大安區',price:900,years:6,icon:'🏊',desc:'兒童游泳、成人初學與水中安全教學',certificate:'游泳教練證照（示範）'},{id:2,name:'李岷澤',sport:'羽球',area:'中山區',price:1200,years:8,icon:'🏸',desc:'羽球初階至進階技術與步伐訓練',certificate:'羽球教練證照（示範）'},{id:3,name:'王宇昕',sport:'健身',area:'信義區',price:1500,years:5,icon:'🏋️',desc:'肌力訓練、核心與體能提升',certificate:'體適能教練證照（示範）'},{id:4,name:'張家豪',sport:'籃球',area:'士林區',price:800,years:4,icon:'🏀',desc:'青少年籃球基礎與團隊訓練',certificate:'籃球教練證照（示範）'}];
const initialJobs=[{id:1,sport:'游泳',area:'大安區',date:'2026-11-06',time:'14:00',hours:2,rate:800,detail:'兒童初級游泳課，需具備教學經驗',owner:'示範教練',status:'open'},{id:2,sport:'羽球',area:'中山區',date:'2026-11-08',time:'10:00',hours:2,rate:1100,detail:'成人雙打基礎課程',owner:'示範教練',status:'open'}];
const SUPABASE_URL='https://szlfgarfcgqtqalvljil.supabase.co';
const SUPABASE_KEY='sb_publishable_bLDjhYZQGgquuYL8MuYFug__NScOGUB';
const supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const load=(k,d)=>{try{return JSON.parse(localStorage.getItem('sl_'+k))??d}catch{return d}};
const save=(k,v)=>localStorage.setItem('sl_'+k,JSON.stringify(v));
let user=null,admin=false,coachProfile=null,liveCoaches=[],bookings=[],page='home',sportFilter='全部',areaFilter='全部';
let jobs=load('jobs',initialJobs),applications=load('applications',[]);
let availabilitySlots=[],availabilityError='';
const app=document.getElementById('app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(name,action,cls='btn')=>`<button type="button" class="${cls}" data-action="${action}">${name}</button>`;
const options=(arr,current)=>arr.map(v=>`<option ${v===current?'selected':''}>${esc(v)}</option>`).join('');
const errorText=e=>e?.message||'請稍後再試';
const dateToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const statusLabel={pending:'待教練確認',accepted:'已接受',rejected:'已拒絕',cancelled:'已取消'};
const coachCard=c=>`<div class="card"><div class="card-top"><div class="avatar">${esc(c.icon||'🏅')}</div><div><h3>${esc(c.display_name||c.name)}</h3><div class="muted">${esc(c.sport)} · 台北市${esc(c.area)}</div></div></div><p>${esc(c.description||c.desc||'')}</p><div class="row"><div><span class="price">NT$${Number(c.price).toLocaleString()}</span><span class="muted"> / 小時</span></div>${c.demo?'<span class="pill">示範資料・不可預約</span>':btn('查看 / 預約','coach:'+c.id)}</div></div>`;
const jobCard=j=>`<div class="card"><div class="row"><span class="pill">${esc(j.sport)}代課</span><b class="price">NT$${Number(j.rate).toLocaleString()} / 小時</b></div><h3>台北市${esc(j.area)} · ${esc(j.date)}</h3><p class="muted">${esc(j.time)} 開始 · ${esc(j.hours)} 小時</p><p>${esc(j.detail)}</p><div class="row"><span class="muted">${j.status==='open'?'招募中':'已媒合'}</span>${btn('查看 / 申請','job:'+j.id,'btn secondary')}</div></div>`;
const allCoaches=()=>[...liveCoaches,...coaches.map(c=>({...c,demo:true}))];
async function refreshData(){
  const {data:publicCoaches,error:ce}=await supabaseClient.from('coaches').select('id,user_id,display_name,sport,area,price,description,is_active').eq('is_active',true).order('created_at',{ascending:false});
  if(ce)throw ce;liveCoaches=publicCoaches||[];
  if(!user){admin=false;coachProfile=null;bookings=[];availabilitySlots=[];availabilityError='';return}
  const [a,c,b]=await Promise.all([
    supabaseClient.rpc('is_platform_admin'),
    supabaseClient.from('coaches').select('*').eq('user_id',user.id).maybeSingle(),
    supabaseClient.from('bookings').select('id,student_id,coach_id,lesson_date,lesson_time,note,status,created_at,coaches(display_name,sport)').order('created_at',{ascending:false})
  ]);
  if(a.error)throw a.error;if(c.error)throw c.error;if(b.error)throw b.error;
  admin=!!a.data;coachProfile=c.data;bookings=b.data||[];
  availabilitySlots=[];availabilityError='';
  if(coachProfile){
    const {data:slots,error:slotError}=await supabaseClient.from('coach_availability')
      .select('id,coach_id,lesson_date,lesson_time')
      .eq('coach_id',coachProfile.id)
      .order('lesson_date',{ascending:true})
      .order('lesson_time',{ascending:true});
    if(slotError)availabilityError=slotError.message;
    else availabilitySlots=slots||[];
  }
}
async function reload(){try{await refreshData();render()}catch(e){console.error(e);render();alert('雲端資料讀取失敗：'+errorText(e))}}
function bookingCard(b){
  const coachName=b.coaches?.display_name||'教練';
  const sport=b.coaches?.sport||'課程';
  const owned=coachProfile?.id===b.coach_id;
  const isStudent=b.student_id===user?.id;
  // lesson_date / lesson_time are Taiwan local calendar values in this project.
  const lessonStart=new Date(`${b.lesson_date}T${String(b.lesson_time).slice(0,8)}`);
  const canCancel=isStudent&&['pending','accepted'].includes(b.status)&&Number.isFinite(lessonStart.getTime())&&lessonStart.getTime()-Date.now()>=24*60*60*1000;
  const cancelInfo=isStudent&&['pending','accepted'].includes(b.status)&&!canCancel?'<p class="muted small">距離上課不足 24 小時，無法自行取消，請聯絡教練。</p>':'';
  return `<div class="item"><div class="row"><b>${esc(sport)} · ${esc(coachName)}</b><span class="pill">${statusLabel[b.status]||esc(b.status)}</span></div><p class="muted">${esc(b.lesson_date)} ${esc(b.lesson_time)} · 預約編號 ${esc(b.id.slice(0,8))}</p><p>${esc(b.note)}</p>${b.status==='pending'&&owned?btn('接受預約','booking-accept:'+b.id)+' '+btn('拒絕預約','booking-reject:'+b.id,'btn secondary'):''}${canCancel?btn('取消預約','booking-cancel:'+b.id,'btn secondary'):''}${cancelInfo}</div>`;
}
function coachEditPanel(){
  if(!coachProfile)return '';
  const sportChoices=[...new Set([coachProfile.sport,'游泳','羽球','健身','籃球'])];
  const areaChoices=[...new Set([coachProfile.area,'大安區','中山區','信義區','士林區'])];
  const choiceOptions=(values,selected)=>values.map(v=>`<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(v)}</option>`).join('');
  return `<div class="section"><h2>編輯教練資料</h2><p class="muted">修改後會同步更新公開的教練介紹，不會影響平台審核狀態。</p>
    <form class="form" id="coachEditForm">
      <label>公開顯示名稱<input name="display_name" maxlength="60" required value="${esc(coachProfile.display_name)}"></label>
      <label>運動項目<select name="sport" required>${choiceOptions(sportChoices,coachProfile.sport)}</select></label>
      <label>授課地區（台北市）<select name="area" required>${choiceOptions(areaChoices,coachProfile.area)}</select></label>
      <label>每小時價格（NT$）<input name="price" type="number" min="1" max="100000" step="1" required value="${esc(coachProfile.price)}"></label>
      <label>教學介紹<textarea name="description" maxlength="1000" required>${esc(coachProfile.description)}</textarea></label>
      <button class="btn" type="submit">儲存教練資料</button>
    </form></div>`;
}
function availabilityPanel(){
  if(!coachProfile)return '';
  if(!coachProfile.is_active)return '<p class="muted">教練通過審核後才能開放預約時段。</p>';
  const slots=availabilitySlots.map(s=>`<div class="item"><div class="row"><span>📅 ${esc(s.lesson_date)}　${esc(String(s.lesson_time).slice(0,5))}</span>${btn('移除時段','availability-remove:'+s.id,'btn secondary')}</div></div>`).join('');
  return `<div class="section"><h2>我的可預約時段</h2><p class="muted">先開放日期和時間，之後才會讓學生從這些時段選擇。</p>
    ${availabilityError?`<p class="notice">時段讀取失敗：${esc(availabilityError)}</p>`:''}
    <form class="form" id="availabilityForm">
      <label>開放日期<input name="date" type="date" min="${dateToday()}" required></label>
      <label>開始時間<input name="time" type="time" required></label>
      <button class="btn" type="submit">新增可預約時段</button>
    </form><div class="list">${slots||'<div class="item muted">目前沒有開放時段。</div>'}</div></div>`;
}
function render(){
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  if(page==='home')app.innerHTML=`<section class="hero"><div><span class="pill">📍 台北市試營運</span><h1>找到好教練，<br>也找到下一個機會。</h1><p>學生輕鬆預約專業運動教練；教練管理課程、尋找學生，也能快速發布與承接代課。</p><div class="hero-actions">${btn('探索運動教練','go:coaches')}${btn('尋找代課機會','go:substitutions','btn ghost')}</div></div><div class="art">🏊 🏸<br>🏀 🏋️</div></section><section class="section"><h2>你可以在 SportLink 做什麼？</h2><div class="grid"><div class="card"><h3>🎓 學生找教練</h3><p>尋找經平台核准的教練並提出預約。</p>${btn('找教練','go:coaches','btn secondary')}</div><div class="card"><h3>💪 教練管理課程</h3><p>申請上架，查看學生預約並回覆。</p>${btn('進入管理中心','go:dashboard','btn secondary')}</div><div class="card"><h3>🔄 教練代課媒合</h3><p>代課功能目前仍是本機示範。</p>${btn('找代課','go:substitutions','btn secondary')}</div></div></section><section class="section"><div class="row"><h2>精選教練</h2>${btn('查看全部','go:coaches','btn secondary')}</div><div class="grid">${allCoaches().slice(0,3).map(coachCard).join('')}</div></section>`;
  else if(page==='coaches')app.innerHTML=`<h1>尋找運動教練</h1><p class="muted">標示「示範資料」的教練尚未連結真實帳號，無法預約。</p><div class="filters"><select class="field" id="sportFilter">${options(['全部','游泳','羽球','健身','籃球'],sportFilter)}</select><select class="field" id="areaFilter">${options(['全部','大安區','中山區','信義區','士林區'],areaFilter)}</select></div><div class="grid">${allCoaches().filter(c=>(sportFilter==='全部'||c.sport===sportFilter)&&(areaFilter==='全部'||c.area===areaFilter)).map(coachCard).join('')||'<div class="empty">沒有符合條件的教練</div>'}</div>`;
  else if(page.startsWith('coach:')){
    const c=liveCoaches.find(x=>x.id===page.slice(6));if(!c){page='coaches';render();return}
    app.innerHTML=`<div class="panel card"><h1>${esc(c.display_name)}</h1><p class="muted">${esc(c.sport)} · 台北市${esc(c.area)}</p><p>${esc(c.description)}</p><p class="price">NT$${Number(c.price).toLocaleString()} / 小時</p><hr><h3>提出正式課程預約</h3><form class="form" id="bookingForm"><label>選擇教練開放的時段<select name="slot" id="bookingSlot" required disabled><option value="">正在載入可預約時段…</option></select></label><label>備註<textarea name="note" maxlength="500" placeholder="例如：第一次學游泳"></textarea></label><button class="btn" type="submit" disabled>送出預約申請</button></form><p class="muted small" id="bookingSlotMessage">正在讀取教練開放的時段…</p><p class="muted small">預約將儲存在 Supabase，並由教練確認。送出不代表已接受。</p></div>`;
    const form=app.querySelector('#bookingForm'),select=form.querySelector('#bookingSlot'),message=app.querySelector('#bookingSlotMessage'),submit=form.querySelector('button[type="submit"]');
    const requestedPage=page;
    (async()=>{
      try{
        const [{data:slots,error:slotError},{data:reserved,error:bookingError}]=await Promise.all([
          supabaseClient.from('coach_availability').select('id,lesson_date,lesson_time').eq('coach_id',c.id).order('lesson_date',{ascending:true}).order('lesson_time',{ascending:true}),
          // Only visible to relevant users under RLS; this is for UI hints, not security.
          supabaseClient.from('bookings').select('lesson_date,lesson_time').eq('coach_id',c.id).in('status',['pending','accepted'])
        ]);
        if(slotError)throw slotError;
        // Booking rows may be hidden by RLS, so server constraints remain authoritative.
        const reservedKeys=new Set((bookingError?[]:reserved||[]).map(b=>b.lesson_date+'|'+String(b.lesson_time).slice(0,5)));
        const now=new Date();
        const openSlots=(slots||[]).filter(s=>{
          const day=s.lesson_date,time=String(s.lesson_time).slice(0,5);
          const localStart=new Date(day+'T'+time+':00');
          return localStart>now&&!reservedKeys.has(day+'|'+time);
        });
        if(page!==requestedPage||!app.contains(form))return;
        select.innerHTML='<option value="">請選擇日期與時間</option>'+openSlots.map(s=>`<option value="${esc(s.id)}">${esc(s.lesson_date)}　${esc(String(s.lesson_time).slice(0,5))}</option>`).join('');
        select.disabled=openSlots.length===0;
        submit.disabled=openSlots.length===0;
        message.textContent=openSlots.length?'請選擇教練開放的時段。若時段已被其他學生預約，送出時會提示。':'教練目前尚未開放可預約時段。';
        form._openSlots=openSlots;
      }catch(err){if(page!==requestedPage||!app.contains(form))return;select.innerHTML='<option value="">時段讀取失敗</option>';message.textContent='讀取時段失敗：'+errorText(err);console.error(err)}
    })();
    form.onsubmit=async e=>{
      e.preventDefault();
      if(!user){alert('請先登入');page='account';render();return}
      if(user.id===c.user_id){alert('不能預約自己的課程');return}
      const f=new FormData(form),slot=(form._openSlots||[]).find(s=>s.id===f.get('slot'));
      if(!slot){alert('請先選擇有效的可預約時段');return}
      submit.disabled=true;
      try{
        const {error}=await supabaseClient.from('bookings').insert({student_id:user.id,coach_id:c.id,lesson_date:slot.lesson_date,lesson_time:slot.lesson_time,note:String(f.get('note')||'').trim(),status:'pending'});
        if(error)throw error;
        alert('預約已送出，等待教練確認');page='dashboard';await reload();
      }catch(err){
        console.error(err);
        alert(err?.code==='23505'?'這個時段剛剛已被其他學生預約，請重新進入教練頁面選擇其他時間。':'預約失敗：'+errorText(err));
      }finally{submit.disabled=false}
    };
  }
  else if(page==='account'){
    app.innerHTML=`<div class="panel card"><h1>SportLink 會員</h1><p class="muted">使用 Email 與密碼登入。註冊後請到信箱完成驗證。</p>${user?`<p class="notice">目前登入：${esc(user.name)}（${esc(user.role)}）${admin?' · 平台管理員':''}</p>${btn('登出','logout','btn secondary')}`:`<form class="form" id="accountForm"><label>電子郵件<input name="email" type="email" autocomplete="email" required></label><label>密碼（至少 6 碼）<input name="password" type="password" minlength="6" autocomplete="current-password" required></label><div id="signupFields" hidden><label>顯示名稱<input name="name" maxlength="30" placeholder="暱稱"></label><label>主要身分<select name="role"><option value="student">學生</option><option value="coach">教練</option></select></label></div><div class="row"><button class="btn" type="submit" id="authSubmit">登入</button>${btn('切換成註冊','toggle-signup','btn secondary')}</div><p id="authMessage" class="muted" role="status"></p></form>`}</div>`;
    const form=app.querySelector('#accountForm');if(form)form.onsubmit=async e=>{e.preventDefault();const submit=form.querySelector('#authSubmit'),message=form.querySelector('#authMessage'),signup=!form.querySelector('#signupFields').hidden,f=new FormData(form);submit.disabled=true;message.textContent='處理中…';try{let result;if(signup){const name=String(f.get('name')||'').trim();if(!name)throw Error('請填寫顯示名稱');result=await supabaseClient.auth.signUp({email:String(f.get('email')),password:String(f.get('password')),options:{emailRedirectTo:location.origin,data:{display_name:name,role:String(f.get('role'))}}})}else result=await supabaseClient.auth.signInWithPassword({email:String(f.get('email')),password:String(f.get('password'))});if(result.error)throw result.error;if(signup&&!result.data.session){message.textContent='註冊申請已送出。請先完成 Email 驗證，再登入。';return}await refreshAuthUser();page='dashboard';await reload()}catch(err){message.textContent='操作失敗：'+errorText(err)}finally{submit.disabled=false}};
  }
  else if(page==='dashboard'){
    if(!user){page='account';render();return}
    const mine=bookings.filter(b=>b.student_id===user.id),received=bookings.filter(b=>b.coach_id===coachProfile?.id);
    app.innerHTML=`<h1>你好，${esc(user.name)} 👋</h1><p class="muted">目前身分：${esc(user.role)}${admin?' · 平台管理員':''}</p><div class="tabs">${btn('重新整理預約','reload','btn secondary')}${admin?btn('平台管理後台','go:admin'):''}${!coachProfile?btn('申請成為教練','go:coach-apply','btn secondary'):''}${btn('代課示範區','go:substitutions','btn secondary')}</div><div class="section"><h2>我提出的預約</h2><div class="list">${mine.map(bookingCard).join('')||'<div class="item muted">目前沒有預約。</div>'}</div></div>${coachProfile?`<div class="section"><h2>我的教練資料</h2><p class="notice">${esc(coachProfile.display_name)} · ${coachProfile.is_active?'已核准上架':'等待管理員審核'}</p><h2>學生預約我的課程</h2><div class="list">${received.map(bookingCard).join('')||'<div class="item muted">目前沒有學生預約。</div>'}</div></div>${coachEditPanel()}${availabilityPanel()}`:''}<div class="section"><h2>代課功能</h2><p class="muted">代課媒合仍是本機示範，尚未雲端同步。</p></div>`;
    const coachEditForm=app.querySelector('#coachEditForm');
    if(coachEditForm)coachEditForm.onsubmit=async e=>{
      e.preventDefault();
      if(!user||!coachProfile)return;
      const submit=coachEditForm.querySelector('button[type="submit"]');
      const f=new FormData(coachEditForm);
      const displayName=String(f.get('display_name')||'').trim();
      const sport=String(f.get('sport')||'').trim();
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
    const availabilityForm=app.querySelector('#availabilityForm');
    if(availabilityForm)availabilityForm.onsubmit=async e=>{
      e.preventDefault();
      const submit=availabilityForm.querySelector('button');
      const f=new FormData(availabilityForm);
      submit.disabled=true;
      try{
        const {data,error}=await supabaseClient.rpc('sportlink_add_availability',{
          p_date:f.get('date'),p_time:f.get('time')
        });
        if(error)throw error;
        if(data===false)throw Error('沒有新增時段，可能是該時段已存在');
        await reload();
      }catch(err){alert('新增時段失敗：'+errorText(err));submit.disabled=false}
    };
  }
  else if(page==='coach-apply'){
    if(!user){page='account';render();return}if(coachProfile){page='dashboard';render();return}
    app.innerHTML=`<div class="panel card"><h1>申請教練上架</h1><p class="muted">送出後等待平台管理員核准。核准前不會開放學生預約。</p><form class="form" id="coachApply"><label>公開顯示名稱<input name="name" required maxlength="60" value="${esc(user.name)}"></label><label>運動項目<select name="sport">${options(['游泳','羽球','健身','籃球'],'游泳')}</select></label><label>台北市行政區<select name="area">${options(['大安區','中山區','信義區','士林區'],'大安區')}</select></label><label>每小時價格（NT$）<input name="price" type="number" min="1" max="100000" required></label><label>教學介紹<textarea name="description" maxlength="1000" required></textarea></label><button class="btn">送出教練申請</button></form></div>`;
    app.querySelector('#coachApply').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),submit=e.target.querySelector('button');submit.disabled=true;try{const {error}=await supabaseClient.from('coaches').insert({user_id:user.id,display_name:String(f.get('name')).trim(),sport:f.get('sport'),area:f.get('area'),price:Number(f.get('price')),description:String(f.get('description')).trim(),is_active:false});if(error)throw error;alert('教練申請已送出，等待管理員審核');page='dashboard';await reload()}catch(err){alert('送出失敗：'+errorText(err))}finally{submit.disabled=false}};
  }
  else if(page==='admin'){
    if(!user||!admin){page='dashboard';render();return}
    app.innerHTML=`<h1>SportLink 平台管理後台</h1><p class="muted">只有經資料庫授權的管理員可查看。</p>${btn('重新整理','admin-refresh','btn secondary')}<div class="section"><h2>全平台預約</h2><div class="list">${bookings.map(bookingCard).join('')||'<div class="item muted">尚無預約。</div>'}</div></div><div class="section"><h2>教練上架審核</h2><div class="list" id="adminCoaches"><div class="item muted">載入中…</div></div></div>`;
    supabaseClient.from('coaches').select('id,display_name,sport,area,price,is_active').order('created_at',{ascending:false}).then(({data,error})=>{if(page!=='admin')return;const target=app.querySelector('#adminCoaches');if(!target)return;target.innerHTML=error?`<div class="item">讀取失敗：${esc(error.message)}</div>`:(data||[]).map(c=>`<div class="item"><div class="row"><b>${esc(c.display_name)} · ${esc(c.sport)} · ${esc(c.area)}</b><span class="pill">${c.is_active?'已上架':'待審核／已下架'}</span></div><p class="muted">NT$${Number(c.price).toLocaleString()} / 小時</p>${btn(c.is_active?'下架教練':'核准上架','admin-coach:'+c.id+':'+(!c.is_active),'btn secondary')}</div>`).join('')||'<div class="item muted">尚無教練申請。</div>'});
  }
  else if(page==='substitutions')app.innerHTML=`<div class="row"><div><h1>代課媒合中心（示範）</h1><p class="muted">此區資料僅存在目前瀏覽器，尚未雲端同步。</p></div>${btn('＋ 發布代課需求','go:newjob')}</div><div class="grid">${jobs.filter(j=>j.status==='open').map(jobCard).join('')||'<p>目前沒有代課需求。</p>'}</div>`;
  else if(page.startsWith('job:')){const j=jobs.find(x=>x.id===+page.slice(4));if(!j){page='substitutions';render();return}app.innerHTML=`<div class="panel card"><span class="pill">${esc(j.sport)} · 本機示範</span><h1>${esc(j.sport)}教練代課</h1><p>📍 台北市${esc(j.area)}</p><p>📅 ${esc(j.date)} ${esc(j.time)}</p><p>${esc(j.detail)}</p>${btn('申請這個代課（示範）','apply:'+j.id)}</div>`}
  else if(page==='newjob'){if(!user){page='account';render();return}app.innerHTML=`<div class="panel card"><h1>發布代課需求（本機示範）</h1><form class="form" id="jobForm"><label>運動項目<select name="sport">${options(['游泳','羽球','健身','籃球'],'游泳')}</select></label><label>行政區<select name="area">${options(['大安區','中山區','信義區','士林區'],'大安區')}</select></label><label>日期<input name="date" type="date" min="${dateToday()}" required></label><label>時間<input name="time" type="time" required></label><label>時數<input name="hours" type="number" min="1" max="12" value="2" required></label><label>時薪<input name="rate" type="number" min="1" required></label><label>需求說明<textarea name="detail" required></textarea></label><button class="btn">發布（示範）</button></form></div>`;app.querySelector('#jobForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);jobs.unshift({id:Date.now(),sport:f.get('sport'),area:f.get('area'),date:f.get('date'),time:f.get('time'),hours:Number(f.get('hours')),rate:Number(f.get('rate')),detail:f.get('detail'),owner:user.name,status:'open'});save('jobs',jobs);page='substitutions';render()}}
}
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.page){page=b.dataset.page;render();window.scrollTo(0,0);return}
  const a=b.dataset.action;if(!a)return;const [cmd,id,extra]=a.split(':');
  if(cmd==='go'||cmd==='coach'||cmd==='job'){page=cmd==='go'?id:a;render();window.scrollTo(0,0);return}
  if(cmd==='reload'||cmd==='admin-refresh'){await reload();return}
  if(cmd==='availability-remove'){
    if(!coachProfile?.is_active)return;
    if(!confirm('確定移除這個開放時段？已有預約的時段可能無法移除。'))return;
    b.disabled=true;
    try{
      const {data,error}=await supabaseClient.rpc('sportlink_remove_availability',{p_slot_id:id});
      if(error)throw error;
      if(!data)throw Error('無法移除，可能已有預約或沒有權限');
      await reload();
    }catch(err){alert('移除時段失敗：'+errorText(err));b.disabled=false}
    return;
  }
  if(cmd==='booking-accept'||cmd==='booking-reject'||cmd==='booking-cancel'){
    if(!user)return;const action=cmd.slice(8);if(!confirm(action==='accept'?'確定接受這筆預約？':action==='reject'?'確定拒絕這筆預約？':'確定取消預約？'))return;
    b.disabled=true;try{const {data,error}=await supabaseClient.rpc('sportlink_change_booking_status',{p_booking_id:id,p_action:action});if(error)throw error;if(!data)throw Error(action==='cancel'?'無法取消：可能距離上課不足 24 小時，或預約狀態已變更。':'沒有權限或預約已經處理');await reload()}catch(err){alert('操作失敗：'+errorText(err));b.disabled=false}return;
  }
  if(cmd==='admin-coach'){
    if(!admin)return;if(!confirm(extra==='true'?'確定核准這位教練上架？':'確定下架這位教練？'))return;
    b.disabled=true;try{const {data,error}=await supabaseClient.rpc('sportlink_set_coach_active',{p_coach_id:id,p_active:extra==='true'});if(error)throw error;if(!data)throw Error('無法修改教練狀態');await reload()}catch(err){alert('操作失敗：'+errorText(err));b.disabled=false}return;
  }
  if(cmd==='toggle-signup'){const fields=app.querySelector('#signupFields');if(fields){fields.hidden=!fields.hidden;app.querySelector('#authSubmit').textContent=fields.hidden?'登入':'註冊';b.textContent=fields.hidden?'切換成註冊':'返回登入';app.querySelector('input[name=password]').autocomplete=fields.hidden?'current-password':'new-password'}return}
  if(cmd==='logout'){const {error}=await supabaseClient.auth.signOut();if(error){alert(error.message);return}user=null;admin=false;coachProfile=null;bookings=[];page='home';await reload();return}
  if(cmd==='apply'){if(!user){page='account';render();return}const j=jobs.find(x=>x.id===+id);if(!j)return;if(j.owner===user.name){alert('不能申請自己的代課需求');return}if(applications.some(x=>x.jobId===j.id&&x.applicant===user.name)){alert('已申請過');return}applications.push({id:Date.now(),jobId:j.id,applicant:user.name,sport:j.sport,date:j.date,status:'待確認'});save('applications',applications);alert('已建立本機示範申請，不會通知教練');page='dashboard';render()}
});
document.addEventListener('change',e=>{if(e.target.id==='sportFilter'){sportFilter=e.target.value;render()}if(e.target.id==='areaFilter'){areaFilter=e.target.value;render()}});
async function refreshAuthUser(){const {data:{user:authUser},error}=await supabaseClient.auth.getUser();if(error||!authUser){user=null;return}const meta=authUser.user_metadata||{};user={id:authUser.id,name:String(meta.display_name||authUser.email?.split('@')[0]||'會員'),role:meta.role==='coach'?'教練':'學生'}}
supabaseClient.auth.onAuthStateChange((_event,session)=>{if(!session){user=null;admin=false;coachProfile=null;bookings=[];render();return}const a=session.user,meta=a.user_metadata||{};user={id:a.id,name:String(meta.display_name||a.email?.split('@')[0]||'會員'),role:meta.role==='coach'?'教練':'學生'};setTimeout(()=>reload(),0)});
render();refreshAuthUser().then(reload).catch(e=>{console.error(e);alert('登入狀態讀取失敗：'+errorText(e))});