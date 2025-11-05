const els = {
  // Views
  loginView: document.getElementById('loginView'),
  appView: document.getElementById('appView'),

  // Login
  username: document.getElementById('username'),
  useUser: document.getElementById('useUser'),
  weightLbs: document.getElementById('weightLbs'),

  // App UI
  appCurrentUser: document.getElementById('appCurrentUser'),
  logoutBtn: document.getElementById('logoutBtn'),
  myToday: document.getElementById('myToday'),
  myAllTime: document.getElementById('myAllTime'),
  myCalsToday: document.getElementById('myCalsToday'),
  myCalsAll: document.getElementById('myCalsAll'),
  lbBody: document.querySelector('#leaderboard tbody'),
  quickBtns: document.getElementById('quickBtns'),
  custom: document.getElementById('customCount'),
  addCustom: document.getElementById('addCustom'),
  undoBtn: document.getElementById('undoBtn'),
  chartUser: document.getElementById('chartUser'),
  chartCanvas: document.getElementById('historyChart'),
  chartMode: document.getElementById('chartMode'),
};

let state = {
  user: '',
  chart: null,
};

function setUser(u){
  state.user = u.trim().toLowerCase();
  if (state.user) localStorage.setItem('pushups.username', state.user);
  els.appCurrentUser.textContent = state.user ? `Using: ${state.user}` : '';
  els.username.value = state.user || '';
  updateMyTotals();
  updateChartUser(state.user);
}

async function ensureUser(){
  if (!state.user) return;
  const weightLbs = Number(els.weightLbs?.value || localStorage.getItem('pushups.weightLbs') || '') || undefined;
  await fetch('/api/users', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ username: state.user, weightLbs })
  });
}

async function logPushups(count){
  if (!state.user) { alert('Set a username first.'); return; }
  await ensureUser();
  const res = await fetch('/api/log', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ username: state.user, count })
  });
  if (!res.ok) return;
  const data = await res.json();
  els.myToday.textContent = data.today ?? 0;
  els.myAllTime.textContent = data.allTime ?? 0;
  if ('todayCalories' in data) els.myCalsToday.textContent = data.todayCalories;
  if ('allTimeCalories' in data) els.myCalsAll.textContent = data.allTimeCalories;
  refreshLeaderboard();
  refreshHistory();
}

async function undoLast(){
  if (!state.user) { alert('Set a username first.'); return; }
  const res = await fetch('/api/undo', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ username: state.user })
  });
  if (!res.ok) {
    try { const e = await res.json(); if (e.error) alert(e.error); } catch {}
    return;
  }
  const data = await res.json();
  els.myToday.textContent = data.today ?? 0;
  els.myAllTime.textContent = data.allTime ?? 0;
  if ('todayCalories' in data) els.myCalsToday.textContent = data.todayCalories;
  if ('allTimeCalories' in data) els.myCalsAll.textContent = data.allTimeCalories;
  refreshLeaderboard();
  refreshHistory();
}

async function refreshLeaderboard(){
  const res = await fetch('/api/leaderboard');
  if (!res.ok) return;
  const data = await res.json();
  const rows = data.leaderboard || [];
  els.lbBody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    const userTd = document.createElement('td');
    userTd.textContent = r.user;
    userTd.className = 'usercell';
    userTd.style.cursor = 'pointer';
    userTd.addEventListener('click', () => updateChartUser(r.user));
    const tTd = document.createElement('td'); tTd.textContent = r.today;
    const aTd = document.createElement('td'); aTd.textContent = r.allTime;
    const ctTd = document.createElement('td'); ctTd.textContent = r.todayCalories ?? '';
    const caTd = document.createElement('td'); caTd.textContent = r.allTimeCalories ?? '';
    tr.append(userTd, tTd, aTd, ctTd, caTd);
    els.lbBody.appendChild(tr);
  }
}

async function updateMyTotals(){
  if (!state.user) { els.myToday.textContent = '0'; els.myAllTime.textContent = '0'; return; }
  const res = await fetch('/api/leaderboard');
  if (!res.ok) return;
  const data = await res.json();
  const me = (data.leaderboard||[]).find(r=>r.user===state.user);
  els.myToday.textContent = me ? me.today : '0';
  els.myAllTime.textContent = me ? me.allTime : '0';
  els.myCalsToday.textContent = me && me.todayCalories != null ? me.todayCalories : '0';
  els.myCalsAll.textContent = me && me.allTimeCalories != null ? me.allTimeCalories : '0';
}

function updateChartUser(user){
  els.chartUser.textContent = user || '(choose a user)';
  refreshHistory();
}

async function refreshHistory(){
  const user = els.chartUser.textContent;
  if (!user || user === '(choose a user)') return;
  const mode = els.chartMode.value;
  let query = `mode=${encodeURIComponent(mode)}`;
  if (mode === 'day') query += `&days=7`;
  if (mode === 'hour') query += `&hours=12`;
  if (mode === 'month') query += `&months=12`;
  const res = await fetch(`/api/history?username=${encodeURIComponent(user)}&${query}`);
  if (!res.ok) return;
  const j = await res.json();
  const labels = j.data.map(d => d.label ?? d.date);
  const values = j.data.map(d => d.total);

  if (!state.chart) {
    state.chart = new Chart(els.chartCanvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [{ label: 'Push-ups', data: values, tension: 0.25, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.2)', fill: true }] },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
  } else {
    state.chart.data.labels = labels;
    state.chart.data.datasets[0].data = values;
    state.chart.update();
  }
}

function showView(which){
  if (which === 'login') { els.loginView.classList.remove('hidden'); els.appView.classList.add('hidden'); }
  if (which === 'app') { els.appView.classList.remove('hidden'); els.loginView.classList.add('hidden'); }
}

async function proceedToApp(u){
  setUser(u);
  const w = Number(els.weightLbs.value||'');
  if (w > 0) {
    localStorage.setItem('pushups.weightLbs', String(Math.round(w)));
  }
  await ensureUser();
  await refreshLeaderboard();
  await updateMyTotals();
  showView('app');
}

function bind(){
  // Build quick-add buttons: 1, then 5..50 by 5s (skip 25, 35, 45)
  const counts = [1, ...Array.from({length: 10}, (_, i) => (i+1)*5)].filter(n => ![25,35,45].includes(n));
  els.quickBtns.innerHTML = '';
  counts.forEach(n => {
    const b = document.createElement('button');
    b.textContent = `+${n}`;
    b.setAttribute('data-add', String(n));
    b.className = 'quick-btn';
    els.quickBtns.appendChild(b);
  });

  // Login events
  els.useUser.addEventListener('click', async ()=>{
    const u = els.username.value.trim();
    if (!u) return;
    await proceedToApp(u);
  });
  els.username.addEventListener('keydown', async (e)=>{
    if (e.key === 'Enter') {
      const u = els.username.value.trim();
      if (!u) return;
      await proceedToApp(u);
    }
  });

  // Logout
  els.logoutBtn.addEventListener('click', ()=>{
    localStorage.removeItem('pushups.username');
    state.user = '';
    els.appCurrentUser.textContent = '';
    els.myToday.textContent = '0';
    els.myAllTime.textContent = '0';
    els.chartUser.textContent = '(choose a user)';
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    showView('login');
    els.username.focus();
  });

  // App events
  document.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => logPushups(Number(btn.getAttribute('data-add'))));
  });
  els.addCustom.addEventListener('click', () => {
    const n = Number(els.custom.value||0);
    if (n > 0) logPushups(n);
  });
  els.undoBtn.addEventListener('click', () => { undoLast(); });
  els.chartMode.addEventListener('change', () => { refreshHistory(); });
}

async function init(){
  bind();
  // Always start on login screen; prefill saved username if any
  const saved = localStorage.getItem('pushups.username') || '';
  if (saved) els.username.value = saved;
  const savedW = localStorage.getItem('pushups.weightLbs') || '';
  if (savedW) els.weightLbs.value = savedW;
  showView('login');
  // Poll leaderboard only when in app; keep it running after first enter
  setInterval(()=>{
    if (!els.appView.classList.contains('hidden')) refreshLeaderboard();
  }, 10000);
}

init();
