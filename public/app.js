const els = {
  // Views
  loginView: document.getElementById('loginView'),
  appView: document.getElementById('appView'),

  // Auth
  loginTab: document.getElementById('tabLogin'),
  createTab: document.getElementById('tabCreate'),
  loginPane: document.getElementById('loginPane'),
  createPane: document.getElementById('createPane'),
  loginUsername: document.getElementById('loginUsername'),
  loginSubmit: document.getElementById('loginSubmit'),
  loginMessage: document.getElementById('loginMessage'),
  createUsername: document.getElementById('newUsername'),
  createWeight: document.getElementById('newWeightLbs'),
  createSubmit: document.getElementById('createAccount'),
  createMessage: document.getElementById('createMessage'),

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
  weightLbs: null,
  chart: null,
  activeAuthTab: 'login',
};

function setUser(u, weightLbs){
  const normalized = (u || '').trim().toLowerCase();
  const previousUser = state.user;
  const isSameUser = previousUser && normalized === previousUser;
  state.user = normalized;
  if (typeof weightLbs === 'number' && Number.isFinite(weightLbs) && weightLbs > 0) {
    state.weightLbs = Math.round(weightLbs);
    localStorage.setItem('pushups.weightLbs', String(state.weightLbs));
    if (state.user) {
      localStorage.setItem(`pushups.weightLbs.${state.user}`, String(state.weightLbs));
    }
  } else if (!isSameUser) {
    state.weightLbs = null;
  }
  if (state.user) {
    localStorage.setItem('pushups.username', state.user);
  } else {
    localStorage.removeItem('pushups.username');
  }
  els.appCurrentUser.textContent = state.user ? `Using: ${state.user}` : '';
  if (els.loginUsername) els.loginUsername.value = state.user || '';
  if (els.createUsername) els.createUsername.value = state.user || '';
  updateMyTotals();
  updateChartUser(state.user);
}

function showMessage(el, message, isError = false){
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', Boolean(isError && message));
}

function clearAuthMessages(){
  showMessage(els.loginMessage, '');
  showMessage(els.createMessage, '');
}

function showAuthTab(tab){
  state.activeAuthTab = tab === 'create' ? 'create' : 'login';
  const isLogin = state.activeAuthTab === 'login';
  if (els.loginPane) els.loginPane.classList.toggle('hidden', !isLogin);
  if (els.createPane) els.createPane.classList.toggle('hidden', isLogin);
  if (els.loginTab) els.loginTab.classList.toggle('active', isLogin);
  if (els.createTab) els.createTab.classList.toggle('active', !isLogin);
  const target = isLogin ? els.loginUsername : els.createUsername;
  if (target) target.focus();
}

async function attemptLogin(){
  if (!els.loginUsername) return;
  const usernameInput = els.loginUsername.value.trim();
  showMessage(els.loginMessage, '');
  showMessage(els.createMessage, '');
  if (!usernameInput) {
    showMessage(els.loginMessage, 'Enter a username to continue.', true);
    return;
  }
  try {
    const res = await fetch(`/api/users?username=${encodeURIComponent(usernameInput)}`);
    if (!res.ok) throw new Error(`Failed to look up user (${res.status})`);
    const data = await res.json();
    if (data.exists) {
      const weight = data.user && data.user.weightLbs != null ? Number(data.user.weightLbs) : undefined;
      await proceedToApp(usernameInput, weight);
      showMessage(els.loginMessage, '');
      showMessage(els.createMessage, '');
      return;
    }
    showMessage(els.loginMessage, 'No account found. Create one below.', true);
    showAuthTab('create');
    if (els.createUsername && !els.createUsername.value) {
      els.createUsername.value = usernameInput;
    }
    if (els.createWeight) {
      els.createWeight.focus();
    }
    showMessage(els.createMessage, 'Looks like that username is free. Add your weight to finish creating it.', false);
  } catch (err) {
    console.error(err);
    showMessage(els.loginMessage, 'Could not verify that username. Please try again.', true);
  }
}

async function attemptCreate(){
  if (!els.createUsername) return;
  const usernameRaw = els.createUsername.value.trim();
  const weightNumeric = Number(els.createWeight?.value || '');
  showMessage(els.createMessage, '');
  if (!usernameRaw) {
    showMessage(els.createMessage, 'Choose a username to continue.', true);
    return;
  }
  if (!Number.isFinite(weightNumeric) || weightNumeric <= 0) {
    showMessage(els.createMessage, 'Enter your weight (lbs) to personalize calorie estimates.', true);
    return;
  }
  const username = usernameRaw.toLowerCase();
  const weightToSave = Math.round(weightNumeric);
  try {
    const res = await fetch('/api/users', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username, weightLbs: weightToSave, createOnly: true })
    });
    if (res.status === 409) {
      showMessage(els.createMessage, 'That username is already taken. Try another.', true);
      return;
    }
    if (!res.ok) throw new Error(`Failed to create user (${res.status})`);
    const data = await res.json();
    const weight = data.weightLbs != null ? Number(data.weightLbs) : weightToSave;
    await proceedToApp(username, weight);
    showMessage(els.createMessage, '');
  } catch (err) {
    console.error(err);
    showMessage(els.createMessage, 'Could not create your account right now. Please try again.', true);
  }
}

async function ensureUser(){
  if (!state.user) return;
  let weightLbs = Number(state.weightLbs || 0);
  if (!weightLbs || !Number.isFinite(weightLbs)) {
    const keyed = state.user ? localStorage.getItem(`pushups.weightLbs.${state.user}`) : null;
    if (keyed != null) {
      const stored = Number(keyed);
      if (stored > 0) weightLbs = stored;
    }
  }
  const payload = { username: state.user };
  if (weightLbs && Number.isFinite(weightLbs) && weightLbs > 0) {
    payload.weightLbs = Math.round(weightLbs);
  }
  await fetch('/api/users', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)
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
  if (which === 'login') {
    els.loginView.classList.remove('hidden');
    els.appView.classList.add('hidden');
    clearAuthMessages();
    showAuthTab('login');
  }
  if (which === 'app') {
    els.appView.classList.remove('hidden');
    els.loginView.classList.add('hidden');
  }
}

async function proceedToApp(u, weight){
  setUser(u, weight);
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

  // Auth events
  if (els.loginSubmit) {
    els.loginSubmit.addEventListener('click', () => { attemptLogin(); });
  }
  if (els.loginUsername) {
    els.loginUsername.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter') {
        e.preventDefault();
        attemptLogin();
      }
    });
  }
  if (els.createSubmit) {
    els.createSubmit.addEventListener('click', () => { attemptCreate(); });
  }
  if (els.createUsername) {
    els.createUsername.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter') {
        e.preventDefault();
        attemptCreate();
      }
    });
  }
  if (els.createWeight) {
    els.createWeight.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter') {
        e.preventDefault();
        attemptCreate();
      }
    });
  }
  if (els.loginTab) {
    els.loginTab.addEventListener('click', ()=>{
      clearAuthMessages();
      showAuthTab('login');
    });
  }
  if (els.createTab) {
    els.createTab.addEventListener('click', ()=>{
      clearAuthMessages();
      showAuthTab('create');
    });
  }

  // Logout
  els.logoutBtn.addEventListener('click', ()=>{
    localStorage.removeItem('pushups.username');
    state.user = '';
    state.weightLbs = null;
    els.appCurrentUser.textContent = '';
    els.myToday.textContent = '0';
    els.myAllTime.textContent = '0';
    els.chartUser.textContent = '(choose a user)';
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    if (els.loginUsername) els.loginUsername.value = '';
    if (els.createUsername) els.createUsername.value = '';
    if (els.createWeight) els.createWeight.value = '';
    showView('login');
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
  if (saved) {
    if (els.loginUsername) els.loginUsername.value = saved;
    if (els.createUsername) els.createUsername.value = saved;
  }
  let savedW = '';
  if (saved) {
    savedW = localStorage.getItem(`pushups.weightLbs.${saved}`) || '';
  }
  if (!savedW) {
    savedW = localStorage.getItem('pushups.weightLbs') || '';
  }
  if (savedW) {
    const numeric = Number(savedW);
    state.weightLbs = Number.isFinite(numeric) && numeric > 0 ? numeric : null;
    if (els.createWeight) els.createWeight.value = savedW;
  }
  showView('login');
  // Poll leaderboard only when in app; keep it running after first enter
  setInterval(()=>{
    if (!els.appView.classList.contains('hidden')) refreshLeaderboard();
  }, 10000);
}

init();
