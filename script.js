/* ═══════════════════════════════════════════════════════
   STATE & STORAGE
═══════════════════════════════════════════════════════ */
const LS = {
  get(k,def){try{const v=localStorage.getItem(k);return v===null?def:JSON.parse(v);}catch{return def;}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}},
  clear(){try{localStorage.clear();}catch{}}
};

let settings = LS.get('catan_settings', {
  dark: false,
  sound: true,
  shortBeepStyle: 'double-high',
  longBeepStyle: 'double-low',
  warnSecs: 10,
  totalSecs: 60,
  playersEnabled: false,
  players: []
});
let sessionRolls   = [];   // array of totals this session
let turnCount      = LS.get('catan_turns', 0);
let currentPlayer  = LS.get('catan_curplayer', 0);

function saveSettings(){ LS.set('catan_settings', settings); }

/* ═══════════════════════════════════════════════════════
   PLAYER COLORS
═══════════════════════════════════════════════════════ */
const PLAYER_COLORS = ['#E74C3C','#3498DB','#2ECC71','#9B59B6','#E67E22','#1ABC9C','#E91E63','#607D8B'];

/* ═══════════════════════════════════════════════════════
   WAKE LOCK
═══════════════════════════════════════════════════════ */
let wakeLock = null;
async function requestWakeLock(){
  if('wakeLock' in navigator){
    try{ wakeLock = await navigator.wakeLock.request('screen'); }catch(e){}
  }
}
requestWakeLock();
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') requestWakeLock(); });

/* ═══════════════════════════════════════════════════════
   HAPTICS
═══════════════════════════════════════════════════════ */
function vibrate(pattern){ if(navigator.vibrate) navigator.vibrate(pattern); }

/* ═══════════════════════════════════════════════════════
   AUDIO
═══════════════════════════════════════════════════════ */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let actx;
function ensureAudio(){
  if(!actx) actx = new AudioCtx();
  if(actx.state==='suspended') actx.resume();
}
function tone(freq, start, dur, vol=0.5, type='sine'){
  const osc=actx.createOscillator(), gain=actx.createGain();
  osc.connect(gain); gain.connect(actx.destination);
  osc.type=type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(vol, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start+dur);
  osc.start(start); osc.stop(start+dur);
}
function playShortBeep(style){
  if(!settings.sound) return;
  ensureAudio();
  const t = actx.currentTime;
  switch(style||settings.shortBeepStyle){
    case 'double-high':  tone(880,t,.12,.6); tone(1100,t+.16,.1,.5); break;
    case 'single-ping':  tone(1200,t,.18,.7); break;
    case 'triple-blip':  tone(900,t,.07,.5); tone(900,t+.12,.07,.5); tone(900,t+.24,.07,.5); break;
    case 'descend':      tone(1000,t,.1,.5); tone(800,t+.14,.1,.5); tone(600,t+.28,.12,.5); break;
  }
}
function playLongBeep(style){
  if(!settings.sound) return;
  ensureAudio();
  const t = actx.currentTime;
  switch(style||settings.longBeepStyle){
    case 'double-low':   tone(440,t,.6,.7); tone(330,t+.25,.9,.6); break;
    case 'alarm':        for(let i=0;i<4;i++) tone(700,t+i*.22,.18,.65); break;
    case 'fanfare':      tone(523,t,.18,.6); tone(659,t+.2,.18,.6); tone(784,t+.4,.35,.7); break;
    case 'buzz':         tone(120,t,.8,.8,'sawtooth'); break;
  }
}

/* ═══════════════════════════════════════════════════════
   DICE
═══════════════════════════════════════════════════════ */
const PIP_LAYOUTS={
  1:[[30,30]],2:[[18,18],[42,42]],3:[[18,18],[30,30],[42,42]],
  4:[[18,18],[42,18],[18,42],[42,42]],5:[[18,18],[42,18],[30,30],[18,42],[42,42]],
  6:[[18,14],[42,14],[18,30],[42,30],[18,46],[42,46]]
};
function drawDie(svgEl, value, isRobber){
  svgEl.innerHTML='';
  (PIP_LAYOUTS[value]||[]).forEach(([cx,cy])=>{
    const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('cx',cx); c.setAttribute('cy',cy);
    c.setAttribute('r',6.5);
    c.setAttribute('class', isRobber ? 'pip-seven' : 'pip');
    svgEl.appendChild(c);
  });
}

const die1El=document.getElementById('die1'), die2El=document.getElementById('die2');
const svg1=document.getElementById('dieSvg1'), svg2=document.getElementById('dieSvg2');
const totalEl=document.getElementById('diceTotal'), histRow=document.getElementById('historyRow');
drawDie(svg1,1,false); drawDie(svg2,1,false);

function doRoll(){
  const d1=Math.ceil(Math.random()*6), d2=Math.ceil(Math.random()*6);
  const total=d1+d2, isS=(total===7);
  die1El.classList.remove('rolling','seven'); die2El.classList.remove('rolling','seven');
  void die1El.offsetWidth;
  die1El.classList.add('rolling'); die2El.classList.add('rolling');
  if(isS){die1El.classList.add('seven');die2El.classList.add('seven');}
  drawDie(svg1,d1,isS); drawDie(svg2,d2,isS);
  totalEl.textContent=total;
  totalEl.classList.toggle('seven',isS);
  sessionRolls.unshift(total);
  histRow.innerHTML=sessionRolls.slice(0,14).map(v=>
    `<span class="hist-chip${v===7?' seven-chip':''}">${v}</span>`).join('');
  vibrate(isS?[60,40,60]:30);
  if(isS) setTimeout(showRobber, 350);
  renderStats();
}

document.getElementById('rollBtn').addEventListener('click', doRoll);
document.addEventListener('keydown', e=>{
  if(!settingsOpen&&(e.code==='Space'||e.code==='KeyR')) doRoll();
});

/* ═══════════════════════════════════════════════════════
   ROBBER
═══════════════════════════════════════════════════════ */
function showRobber(){
  document.getElementById('robberOverlay').classList.add('show');
  vibrate([100,60,200]);
}
function closeRobber(){ document.getElementById('robberOverlay').classList.remove('show'); }

/* ═══════════════════════════════════════════════════════
   TIMER
═══════════════════════════════════════════════════════ */
let totalSeconds=settings.totalSecs||60, remaining=totalSeconds;
let timerInterval=null, running=false, timerEnded=false, warnFired=false;
const CIRC=2*Math.PI*68;

const timerDigits=document.getElementById('timerDigits');
const timerSub=document.getElementById('timerSub');
const startPauseBtn=document.getElementById('startPauseBtn');
const resetBtn=document.getElementById('resetBtn');
const ringProgress=document.getElementById('ringProgress');

function formatTime(s){ const m=Math.floor(s/60),sec=s%60; return `${m}:${sec.toString().padStart(2,'0')}`; }

function updateRing(){
  const frac=totalSeconds>0?remaining/totalSeconds:0;
  ringProgress.style.strokeDashoffset=CIRC*(1-frac);
  ringProgress.classList.remove('warning','danger','pulsing');
  timerDigits.classList.remove('warning','danger');
  const ws=settings.warnSecs||10;
  if(remaining<=ws&&remaining>0){
    ringProgress.classList.add('warning','pulsing');
    timerDigits.classList.add('warning');
  }
  if(remaining===0){ ringProgress.classList.add('danger'); timerDigits.classList.add('danger'); }
}

function setDisplay(){ timerDigits.textContent=formatTime(remaining); updateRing(); }

function advancePlayer(){
  if(!settings.playersEnabled||!settings.players.length) return;
  currentPlayer=(currentPlayer+1)%settings.players.length;
  LS.set('catan_curplayer', currentPlayer);
  renderPlayerBar();
}

function startTimer(){
  if(timerEnded){
    // New round: advance player, increment turn
    advancePlayer();
    turnCount++;
    LS.set('catan_turns', turnCount);
    renderTurnBadge();
    remaining=totalSeconds; warnFired=false; timerEnded=false;
    ringProgress.classList.remove('warning','danger','pulsing');
    timerDigits.classList.remove('warning','danger');
    setDisplay();
  }
  if(remaining<=0) return;
  running=true; timerEnded=false;
  startPauseBtn.textContent='⏸ Pause';
  timerSub.textContent='running';
  ensureAudio();
  timerInterval=setInterval(()=>{
    remaining--;
    setDisplay();
    const ws=settings.warnSecs||10;
    if(remaining===ws&&!warnFired){ warnFired=true; playShortBeep(); vibrate([50,30,50]); }
    if(remaining<=0){
      clearInterval(timerInterval); timerInterval=null;
      running=false; timerEnded=true;
      startPauseBtn.textContent='▶ Start';
      timerSub.textContent="time's up!";
      playLongBeep(); vibrate([100,60,200,60,200]);
      flashScreen();
    }
  },1000);
}

function pauseTimer(){
  clearInterval(timerInterval); timerInterval=null; running=false;
  startPauseBtn.textContent='▶ Resume'; timerSub.textContent='paused';
}

function resetTimer(){
  clearInterval(timerInterval); timerInterval=null;
  running=false; timerEnded=false; remaining=totalSeconds; warnFired=false;
  startPauseBtn.textContent='▶ Start'; timerSub.textContent='ready';
  ringProgress.classList.remove('warning','danger','pulsing');
  timerDigits.classList.remove('warning','danger');
  setDisplay();
}

function flashScreen(){
  const o=document.getElementById('flashOverlay');
  o.classList.remove('flash'); void o.offsetWidth; o.classList.add('flash');
}

startPauseBtn.addEventListener('click',()=>{ if(running) pauseTimer(); else startTimer(); });
resetBtn.addEventListener('click', resetTimer);

/* ═══════════════════════════════════════════════════════
   PLAYER BAR
═══════════════════════════════════════════════════════ */
function renderPlayerBar(){
  const bar=document.getElementById('playerBar');
  if(!settings.playersEnabled||!settings.players.length){ bar.classList.remove('visible'); return; }
  bar.classList.add('visible');
  bar.innerHTML=settings.players.map((p,i)=>{
    const col=PLAYER_COLORS[i%PLAYER_COLORS.length];
    const initials=p.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'?';
    return `<div class="player-token${i===currentPlayer?' active':''}">
      <div class="player-avatar" style="background:${col}">${initials}</div>
      <div class="player-name-lbl">${escHtml(p)}</div>
    </div>`;
  }).join('');
}

function renderTurnBadge(){
  const b=document.getElementById('turnBadge');
  if(turnCount>0){ b.style.display=''; b.textContent=`Turn ${turnCount}`; }
  else b.style.display='none';
}

/* ═══════════════════════════════════════════════════════
   ROLL STATS
═══════════════════════════════════════════════════════ */
function renderStats(){
  const el=document.getElementById('rollStats');
  if(!sessionRolls.length){ el.innerHTML='<span style="font-size:.78rem;color:var(--text3)">No rolls yet this session.</span>'; return; }
  const counts={}; for(let i=2;i<=12;i++) counts[i]=0;
  sessionRolls.forEach(r=>counts[r]=(counts[r]||0)+1);
  const max=Math.max(...Object.values(counts));
  el.innerHTML=Object.entries(counts).map(([n,c])=>{
    const pct=max>0?(c/max)*100:0;
    const is7=parseInt(n)===7;
    return `<div class="stat-bar-row">
      <div class="stat-num">${n}</div>
      <div class="stat-bar-wrap"><div class="stat-bar-fill${is7?' seven-bar':''}" style="width:${pct}%"></div></div>
      <div class="stat-count">${c}</div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════
   SETTINGS DRAWER
═══════════════════════════════════════════════════════ */
let settingsOpen=false;
const settingsOverlay=document.getElementById('settingsOverlay');
const settingsDrawer=document.getElementById('settingsDrawer');

function openSettings(){ settingsOpen=true; settingsOverlay.classList.add('open'); settingsDrawer.classList.add('open'); renderStats(); renderPlayerEditor(); }
function closeSettings(){ settingsOpen=false; settingsOverlay.classList.remove('open'); settingsDrawer.classList.remove('open'); }
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('drawerClose').addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', closeSettings);

/* ── THEME ── */
const darkPill=document.getElementById('darkPill');
function applyTheme(){
  document.documentElement.setAttribute('data-theme', settings.dark?'dark':'light');
  darkPill.classList.toggle('on', settings.dark);
}
darkPill.addEventListener('click',()=>{ settings.dark=!settings.dark; applyTheme(); saveSettings(); });
applyTheme();

/* ── SOUND ── */
const soundPill=document.getElementById('soundPill');
soundPill.classList.toggle('on', settings.sound);
soundPill.addEventListener('click',()=>{
  settings.sound=!settings.sound;
  soundPill.classList.toggle('on',settings.sound);
  document.getElementById('soundOptions').style.display=settings.sound?'':'none';
  saveSettings();
});
document.getElementById('soundOptions').style.display=settings.sound?'':'none';

/* ── BEEP STYLE PICKERS ── */
function initBeepPicker(containerId, settingKey, playFn){
  const c=document.getElementById(containerId);
  c.querySelectorAll('.beep-opt').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.style===settings[settingKey]);
    btn.addEventListener('click',()=>{
      settings[settingKey]=btn.dataset.style; saveSettings();
      c.querySelectorAll('.beep-opt').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      ensureAudio(); playFn(btn.dataset.style);
    });
  });
}
initBeepPicker('shortBeepOpts','shortBeepStyle', playShortBeep);
initBeepPicker('longBeepOpts','longBeepStyle', playLongBeep);

/* ── WARN SECS ── */
const warnInput=document.getElementById('warnSecsInput');
warnInput.value=settings.warnSecs;
warnInput.addEventListener('change',()=>{
  const v=parseInt(warnInput.value);
  if(v>=3&&v<=59){ settings.warnSecs=v; saveSettings(); warnFired=false; }
  else warnInput.value=settings.warnSecs;
});

/* ── DURATION ── */
const durationRow=document.getElementById('durationRow');
durationRow.querySelectorAll('.dur-preset').forEach(btn=>{
  btn.classList.toggle('active', parseInt(btn.dataset.s)===settings.totalSecs);
  btn.addEventListener('click',()=>{
    if(running) pauseTimer();
    durationRow.querySelectorAll('.dur-preset').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('customDurInput').value='';
    totalSeconds=settings.totalSecs=parseInt(btn.dataset.s);
    remaining=totalSeconds; warnFired=false; timerEnded=false;
    startPauseBtn.textContent='▶ Start'; timerSub.textContent='ready';
    setDisplay(); saveSettings();
  });
});

const customDurInput=document.getElementById('customDurInput');
const customDurSet=document.getElementById('customDurSet');
function applyCustomDur(){
  const v=parseInt(customDurInput.value);
  if(!v||v<5||v>3600){ customDurInput.style.borderColor='var(--danger)'; setTimeout(()=>customDurInput.style.borderColor='',1000); return; }
  if(running) pauseTimer();
  durationRow.querySelectorAll('.dur-preset').forEach(b=>b.classList.remove('active'));
  totalSeconds=settings.totalSecs=v; remaining=v; warnFired=false; timerEnded=false;
  startPauseBtn.textContent='▶ Start'; timerSub.textContent='ready';
  setDisplay(); saveSettings();
}
customDurSet.addEventListener('click', applyCustomDur);
customDurInput.addEventListener('keydown',e=>{ if(e.key==='Enter') applyCustomDur(); });

/* ── PLAYER TRACKER ── */
const playerPill=document.getElementById('playerPill');
playerPill.classList.toggle('on', settings.playersEnabled);
document.getElementById('playerSetup').style.display=settings.playersEnabled?'':'none';

playerPill.addEventListener('click',()=>{
  settings.playersEnabled=!settings.playersEnabled;
  playerPill.classList.toggle('on',settings.playersEnabled);
  document.getElementById('playerSetup').style.display=settings.playersEnabled?'':'none';
  renderPlayerBar(); saveSettings();
  if(settings.playersEnabled&&!settings.players.length){
    settings.players=['Player 1','Player 2']; saveSettings(); renderPlayerEditor();
  }
});

function escHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderPlayerEditor(){
  const list=document.getElementById('playerList');
  list.innerHTML=settings.players.map((p,i)=>{
    const col=PLAYER_COLORS[i%PLAYER_COLORS.length];
    const initials=p.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'?';
    return `<div class="player-item">
      <div class="player-swatch" style="background:${col}">${initials}</div>
      <input class="player-input" type="text" value="${escHtml(p)}" placeholder="Player name"
        data-idx="${i}" maxlength="20">
      <button class="player-del" data-idx="${i}" title="Remove">✕</button>
    </div>`;
  }).join('');

  list.querySelectorAll('.player-input').forEach(inp=>{
    inp.addEventListener('input',()=>{
      const idx=parseInt(inp.dataset.idx);
      settings.players[idx]=inp.value;
      saveSettings(); renderPlayerBar();
      // update swatch initials live
      const sw=inp.previousElementSibling;
      const init=inp.value.trim().split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'?';
      sw.textContent=init;
    });
  });
  list.querySelectorAll('.player-del').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const idx=parseInt(btn.dataset.idx);
      if(settings.players.length<=2){ btn.style.color='var(--danger)'; setTimeout(()=>btn.style.color='',900); return; }
      settings.players.splice(idx,1);
      if(currentPlayer>=settings.players.length) currentPlayer=0;
      LS.set('catan_curplayer',currentPlayer);
      saveSettings(); renderPlayerEditor(); renderPlayerBar();
    });
  });
}
renderPlayerEditor();

document.getElementById('addPlayerBtn').addEventListener('click',()=>{
  if(settings.players.length>=8) return;
  settings.players.push(`Player ${settings.players.length+1}`);
  saveSettings(); renderPlayerEditor(); renderPlayerBar();
});

/* ── CLEAR DATA ── */
document.getElementById('clearDataBtn').addEventListener('click',()=>{
  if(!confirm('Clear all saved data and reset the app?')) return;
  LS.clear();
  settings={ dark:false, sound:true, shortBeepStyle:'double-high', longBeepStyle:'double-low', warnSecs:10, totalSecs:60, playersEnabled:false, players:[] };
  turnCount=0; currentPlayer=0; sessionRolls=[];
  applyTheme(); soundPill.classList.add('on');
  document.getElementById('soundOptions').style.display='';
  warnInput.value=10;
  durationRow.querySelectorAll('.dur-preset').forEach(b=>b.classList.toggle('active',b.dataset.s==='60'));
  customDurInput.value='';
  playerPill.classList.remove('on');
  document.getElementById('playerSetup').style.display='none';
  totalSeconds=60; remaining=60;
  resetTimer(); renderPlayerBar(); renderTurnBadge(); renderStats(); renderPlayerEditor();
  saveSettings();
  closeSettings();
});

/* ═══════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════ */
setDisplay();
renderPlayerBar();
renderTurnBadge();
renderStats();