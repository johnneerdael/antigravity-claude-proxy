/* =====================================================
   Antigravity Gateway — Admin UI
   app.js: All API calls and UI rendering logic
   ===================================================== */

const BASE = '';  // Same origin — server serves this file
const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';

function formatVietnamDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('vi-VN', {
    timeZone: VN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// ── Tab Navigation ─────────────────────────────────────

function showTab(name) {
  document.querySelectorAll('[id^="tab-content-"]').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-content-${name}`).classList.remove('hidden');
  document.getElementById(`tab-${name}`).classList.add('active');

  if (name === 'dashboard') { loadDashboard(); loadLogs(); }
  if (name === 'models') {} // user triggers manually
  if (name === 'playground') loadPlaygroundModels();
  if (name === 'system') { loadHealth(); loadOptimizerConfig(); }
}

// ── Server Status Badge ────────────────────────────────

async function checkServerStatus() {
  const badge = document.getElementById('server-status-badge');
  try {
    const start = Date.now();
    const res = await fetch(`${BASE}/health`);
    const latency = Date.now() - start;
    if (res.ok) {
      badge.textContent = `online · ${latency}ms`;
      badge.className = 'text-xs px-2 py-0.5 rounded-full bg-green-900 text-green-300';
    } else {
      throw new Error('not ok');
    }
  } catch {
    badge.textContent = 'offline';
    badge.className = 'text-xs px-2 py-0.5 rounded-full bg-red-900 text-red-300';
  }
}

// ── Dashboard: Account Quota ───────────────────────────

function openModelsDialog() {
  document.getElementById('models-dialog').classList.remove('hidden');
  loadModelsDialog();
}

function closeModelsDialog() {
  document.getElementById('models-dialog').classList.add('hidden');
}

async function loadModelsDialog() {
  const el = document.getElementById('models-dialog-content');
  el.innerHTML = 'Loading...';
  try {
    const [mRes, rRes] = await Promise.all([
      fetch(`${BASE}/v1/models`).then(r => r.json()),
      fetch(`${BASE}/v1/real-models`).then(r => r.json())
    ]);
    
    const allModels = mRes.data.map(m => m.id);
    const working = rRes.workingModels;

    el.innerHTML = `
      <div class="space-y-4">
        <div>
          <h4 class="font-medium text-green-400 mb-2">Working Models (${working.length})</h4>
          <div class="flex flex-wrap gap-2">${working.map(m => `<span class="bg-green-900/30 px-2 py-1 rounded text-xs">${m}</span>`).join('')}</div>
        </div>
        <div>
          <h4 class="font-medium text-gray-400 mb-2">All Available (${allModels.length})</h4>
          <div class="flex flex-wrap gap-2">${allModels.map(m => `<span class="bg-gray-800 px-2 py-1 rounded text-xs">${m}</span>`).join('')}</div>
        </div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<p class="text-red-400">Error: ${e.message}</p>`;
  }
}

// ── API Docs ───────────────────────────────────────────

const API_DOCS = [
  {
    method: 'POST', path: '/v1/chat/completions',
    req: { model: 'gemini-3-flash', messages: [{ role: 'user', content: 'Hello' }] },
    res: { choices: [{ message: { content: 'Hi!' } }] }
  },
  {
    method: 'POST', path: '/v1/messages',
    req: { model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'Hello' }] },
    res: { content: [{ text: 'Hi!' }] }
  }
];

function renderApiDocs() {
  const el = document.getElementById('api-docs-content');
  if (!el) return;
  el.innerHTML = API_DOCS.map(doc => `
    <div class="card">
      <div class="flex items-center gap-3 mb-3">
        <span class="bg-indigo-900 text-indigo-200 px-2 py-0.5 rounded text-xs font-bold">${doc.method}</span>
        <code class="text-sm font-mono">${doc.path}</code>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p class="text-xs text-gray-500 mb-1">Request Sample</p>
          <pre class="bg-gray-900 p-3 rounded text-xs overflow-x-auto text-gray-300">${JSON.stringify(doc.req, null, 2)}</pre>
        </div>
        <div>
          <p class="text-xs text-gray-500 mb-1">Response Sample</p>
          <pre class="bg-gray-900 p-3 rounded text-xs overflow-x-auto text-gray-300">${JSON.stringify(doc.res, null, 2)}</pre>
        </div>
      </div>
    </div>
  `).join('');
}

async function loadDashboard() {
  const el = document.getElementById('dashboard-content');
  el.innerHTML = `<div class="skeleton h-48 rounded-xl"></div>`;
  // Also refresh optimizer button
  updateDashOptBtn();
  try {
    const res = await fetch(`${BASE}/account-limits?includeDisabledQuota=true`);
    const data = await res.json();
    renderDashboard(data);
  } catch (e) {
    el.innerHTML = `<p class="text-red-400 text-sm">Failed to load: ${e.message}</p>`;
  }
}

/** Update the dashboard optimizer toggle button state */
async function updateDashOptBtn() {
  const btn = document.getElementById('dash-opt-btn');
  if (!btn) return;
  try {
    const res = await fetch(`${BASE}/api/logs/optimizer`);
    const cfg = await res.json();
    btn.textContent = cfg.enabled ? '⚡ Opt: ON' : '⚡ Opt: OFF';
    btn.className = cfg.enabled
      ? 'btn-secondary text-sm border-emerald-600/40 text-emerald-400'
      : 'btn-secondary text-sm border-yellow-600/40 text-yellow-400';
  } catch (_) { btn.textContent = '⚡ Opt: ?'; }
}

/** Toggle optimizer from dashboard button */
async function optimizerToggleFromDash() {
  try {
    const res = await fetch(`${BASE}/api/logs/optimizer`);
    const cfg = await res.json();
    const enabled = !cfg.enabled;
    await fetch(`${BASE}/api/logs/optimizer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    updateDashOptBtn();
  } catch (e) {
    console.error('Failed to toggle optimizer:', e);
  }
}

async function setAccountEnabled(email, enabled) {
  const action = enabled ? 'enable' : 'disable';
  try {
    const res = await fetch(`${BASE}/accounts/${encodeURIComponent(email)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Manually disabled from dashboard' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || `Failed to ${action} account`);
    await loadDashboard();
  } catch (e) {
    alert(e.message);
  }
}

function toggleQuota(email) {
  const el = document.getElementById(`quota-${email}`);
  const btn = document.getElementById(`toggle-btn-${email}`);
  if (el.classList.contains('hidden')) {
    el.classList.remove('hidden');
    btn.textContent = '▼ Hide Quota';
  } else {
    el.classList.add('hidden');
    btn.textContent = '▶ Show Quota';
  }
}

function renderDashboard(data) {
  const el = document.getElementById('dashboard-content');
  if (!data.accounts || data.accounts.length === 0) {
    el.innerHTML = `<p class="text-gray-400 text-sm">No accounts configured. Add an account first.</p>`;
    return;
  }

  const models = data.models || [];

  // Summary bar
  const availableCount = data.accounts.filter(a => a.status === 'ok').length;
  const limitedCount = data.accounts.filter(a => a.status !== 'ok' && a.status !== 'invalid' && a.status !== 'disabled').length;
  const invalidCount = data.accounts.filter(a => a.status === 'invalid').length;
  const disabledCount = data.accounts.filter(a => a.status === 'disabled').length;

  let html = `
    <div class="flex gap-4 mb-5 text-sm">
      <span class="px-3 py-1 rounded-full bg-green-900/50 text-green-300">${availableCount} available</span>
      ${limitedCount ? `<span class="px-3 py-1 rounded-full bg-yellow-900/50 text-yellow-300">${limitedCount} rate-limited</span>` : ''}
      ${invalidCount ? `<span class="px-3 py-1 rounded-full bg-red-900/50 text-red-300">${invalidCount} invalid</span>` : ''}
      ${disabledCount ? `<span class="px-3 py-1 rounded-full bg-gray-800 text-gray-300">${disabledCount} disabled</span>` : ''}
      <span class="px-3 py-1 rounded-full bg-gray-700 text-gray-400">${data.totalAccounts} total</span>
    </div>
  `;

  // One card per account
  html += `<div class="grid grid-cols-1 gap-4">`;
  for (const acc of data.accounts) {
    const statusColor = acc.status === 'ok'
      ? 'text-green-400' : acc.status === 'invalid'
      ? 'text-red-400' : acc.status === 'disabled'
      ? 'text-gray-400' : 'text-yellow-400';
    const actionButton = acc.status === 'disabled'
      ? `<button onclick="setAccountEnabled('${acc.email}', true)" class="btn-secondary text-xs">Activate</button>`
      : `<button onclick="setAccountEnabled('${acc.email}', false)" class="btn-danger text-xs">Disable</button>`;

    html += `
      <div class="card">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-3">
            <span class="text-sm font-medium text-gray-200">${acc.email}</span>
            <button id="toggle-btn-${acc.email}" onclick="toggleQuota('${acc.email}')" class="text-xs text-gray-400 hover:text-gray-200 transition-colors">▼ Hide Quota</button>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold ${statusColor} uppercase">${acc.status}</span>
            ${actionButton}
          </div>
        </div>
    `;

    if (acc.error) {
      html += `<p class="text-xs text-red-400 mb-2">${acc.error}</p>`;
    }

    if (models.length > 0 && acc.limits) {
      html += `<div id="quota-${acc.email}" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">`;
      for (const modelId of models) {
        const q = acc.limits[modelId];
        const frac = q?.remainingFraction ?? null;
        const pct = frac !== null ? Math.round(frac * 100) : null;
        const barColor = pct === null ? 'bg-gray-600'
          : pct === 0 ? 'bg-red-600'
          : pct < 30 ? 'bg-yellow-500'
          : 'bg-green-500';
        const label = pct === null ? 'N/A' : `${pct}%`;
        const resetStr = q?.resetTime
          ? `Resets: ${formatVietnamDateTime(q.resetTime)} (GMT+7)`
          : '';

        html += `
          <div class="bg-gray-800 rounded-lg p-2 text-xs" title="${resetStr}">
            <div class="text-gray-400 truncate mb-1">${modelId}</div>
            <div class="flex items-center gap-2">
              <div class="flex-1 bg-gray-700 rounded-full h-1.5">
                <div class="${barColor} h-1.5 rounded-full transition-all" style="width: ${pct ?? 0}%"></div>
              </div>
              <span class="text-gray-300 shrink-0">${label}</span>
            </div>
            ${resetStr ? `<div class="text-gray-600 mt-1 truncate">${resetStr}</div>` : ''}
          </div>
        `;
      }
      html += `</div>`;
    }

    html += `</div>`;
  }
  html += `</div>`;
  html += `<p class="text-gray-600 text-xs mt-4">Last updated: ${formatVietnamDateTime(data.timestamp)} (GMT+7)</p>`;

  el.innerHTML = html;
}

// ── Models: Health Test ────────────────────────────────

async function testModels() {
  const btn = document.getElementById('test-models-btn');
  const el = document.getElementById('models-content');
  btn.disabled = true;
  btn.textContent = '⏳ Testing...';
  el.innerHTML = `
    <div class="flex items-center gap-3 text-gray-400 text-sm">
      <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
      </svg>
      Testing all models — this may take a minute...
    </div>
  `;

  try {
    const res = await fetch(`${BASE}/v1/real-models`);
    const data = await res.json();
    renderModelResults(data);
  } catch (e) {
    el.innerHTML = `<p class="text-red-400 text-sm">Failed: ${e.message}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Test All Models';
  }
}

function renderModelResults(data) {
  const el = document.getElementById('models-content');
  const working = data.results.filter(r => r.status === 'ok');
  const failed = data.results.filter(r => r.status !== 'ok');

  let html = `
    <div class="flex gap-3 mb-5 text-sm">
      <span class="px-3 py-1 rounded-full bg-green-900/50 text-green-300">${working.length} working</span>
      <span class="px-3 py-1 rounded-full bg-red-900/50 text-red-300">${failed.length} failed</span>
      <span class="px-3 py-1 rounded-full bg-gray-700 text-gray-400">${data.total} total</span>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
  `;

  for (const r of data.results) {
    const isOk = r.status === 'ok';
    const border = isOk ? 'border-green-800' : 'border-red-900';
    const icon = isOk ? '✅' : '❌';
    const detail = isOk
      ? `<span class="text-gray-400">"${r.detail}"</span>`
      : `<span class="text-red-400 text-xs">${r.detail}</span>`;

    html += `
      <div class="card ${border} border">
        <div class="flex items-start justify-between gap-2">
          <span class="text-sm font-mono text-gray-200">${r.model}</span>
          <span>${icon}</span>
        </div>
        <div class="text-xs mt-1">${detail}</div>
      </div>
    `;
  }

  html += `</div>`;
  el.innerHTML = html;
}

// ── Playground ─────────────────────────────────────────

let chatHistory = [];

async function loadPlaygroundModels() {
  const sel = document.getElementById('playground-model');
  try {
    const res = await fetch(`${BASE}/v1/models`);
    const data = await res.json();
    const models = data.data || [];
    sel.innerHTML = models.map(m =>
      `<option value="${m.id}">${m.id}</option>`
    ).join('');
  } catch {
    sel.innerHTML = `<option value="">Failed to load models</option>`;
  }
}

function handleChatKey(e) {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    sendChat();
  }
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const modelSel = document.getElementById('playground-model');
  const btn = document.getElementById('send-btn');
  const text = input.value.trim();
  if (!text) return;

  const model = modelSel.value;
  appendBubble('user', text);
  chatHistory.push({ role: 'user', content: text });
  input.value = '';
  btn.disabled = true;

  // Thinking bubble
  const thinkingId = appendBubble('assistant', '⏳ Thinking...');

  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ui' },
      body: JSON.stringify({
        model,
        messages: chatHistory,
        max_tokens: 2048,
        stream: false
      })
    });
    const data = await res.json();

    if (data.error) {
      updateBubble(thinkingId, null, data.error.message || JSON.stringify(data.error), 'error');
    } else {
      const reply = data.choices?.[0]?.message?.content || '(empty response)';
      chatHistory.push({ role: 'assistant', content: reply });
      updateBubble(thinkingId, 'assistant', reply);
    }
  } catch (e) {
    updateBubble(thinkingId, null, e.message, 'error');
  } finally {
    btn.disabled = false;
    input.focus();
  }
}

function appendBubble(role, text) {
  const container = document.getElementById('chat-messages');
  // Clear placeholder
  const placeholder = container.querySelector('p.text-center');
  if (placeholder) placeholder.remove();

  const id = `bubble-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const cls = role === 'user' ? 'bubble-user' : 'bubble-assistant';
  const div = document.createElement('div');
  div.id = id;
  div.className = cls;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}

function updateBubble(id, role, text, type = null) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = type === 'error' ? 'bubble-error' : (role === 'user' ? 'bubble-user' : 'bubble-assistant');
  el.textContent = text;
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function clearChat() {
  chatHistory = [];
  const container = document.getElementById('chat-messages');
  container.innerHTML = `<p class="text-gray-500 text-sm text-center mt-16">Start a conversation by typing below.</p>`;
}

// ── System ─────────────────────────────────────────────

async function loadHealth() {
  const el = document.getElementById('health-content');
  el.innerHTML = 'Loading...';
  try {
    const res = await fetch(`${BASE}/health`);
    const data = await res.json();
    const latency = data.latencyMs ?? '—';
    const summary = data.summary ?? '—';
    el.innerHTML = `
      <div class="flex flex-col gap-2">
        <div class="flex justify-between">
          <span class="text-gray-500">Status</span>
          <span class="text-green-400 font-medium">${data.status}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-500">Latency</span>
          <span class="text-gray-200">${latency}ms</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-500">Accounts</span>
          <span class="text-gray-200">${summary}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-gray-500">Checked at</span>
          <span class="text-gray-400">${new Date(data.timestamp).toLocaleTimeString()}</span>
        </div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<p class="text-red-400">Failed: ${e.message}</p>`;
  }
}

async function loadOptimizerConfig() {
  try {
    const res = await fetch(`${BASE}/api/logs/optimizer`);
    const data = await res.json();
    document.getElementById('opt-toggle').checked       = !!data.enabled;
    document.getElementById('opt-maxMessages').value    = data.maxMessages ?? 50;
    document.getElementById('opt-maxToolResults').value = data.maxToolResults ?? 20;
    document.getElementById('opt-keepTools').checked    = !!data.keepTools;
    document.getElementById('opt-maxSystemChars').value = data.maxSystemChars ?? 2000;
  } catch (e) {
    // ignore
  }
}

async function toggleOptimizer() {
  const enabled = document.getElementById('opt-toggle').checked;
  await fetch(`${BASE}/api/logs/optimizer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  updateDashOptBtn();
  showFeedback('opt-feedback', enabled ? '✅ Optimizer enabled' : '⛔ Optimizer disabled');
}

async function applyOptimizerSetting(key, value) {
  // First read current config
  const res = await fetch(`${BASE}/api/logs/optimizer`);
  const current = await res.json();
  // Merge & save
  await fetch(`${BASE}/api/logs/optimizer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...current, [key]: value }),
  });
  showFeedback('opt-feedback', `✅ ${key} updated to ${value}`);
}

function showFeedback(id, msg) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
  }
}

async function refreshTokens() {
  const btn = document.getElementById('refresh-btn');
  const result = document.getElementById('action-result');
  btn.disabled = true;
  btn.textContent = '⏳ Refreshing...';
  result.textContent = '';

  try {
    const res = await fetch(`${BASE}/refresh-token`, { method: 'POST' });
    const data = await res.json();
    if (data.status === 'ok') {
      result.className = 'mt-3 text-sm text-green-400';
      result.textContent = `✅ ${data.message}`;
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch (e) {
    result.className = 'mt-3 text-sm text-red-400';
    result.textContent = `❌ Failed: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '⟳ Refresh All Tokens';
  }
}

// ── Init ───────────────────────────────────────────────

// ── Logs Tab ───────────────────────────────────────────

let _logsPage = 1;
let _chartHourly = null;
let _chartDaily = null;

checkServerStatus();
setInterval(checkServerStatus, 30000);
loadDashboard();
loadLogs();

async function loadLogs() {
  _logsPage = 1;
  await Promise.all([loadLogsStats(), loadLogsCharts(), loadLogsFilters(), loadLogsTable()]);
}

async function loadLogsStats() {
  const period = document.getElementById('logs-period')?.value || '7d';
  const el = document.getElementById('logs-stats');
  try {
    const data = await fetch(`${BASE}/api/logs/stats?period=${period}`).then(r => r.json());
    const fmt = n => n == null ? '—' : n.toLocaleString();
    const fmtMs = ms => ms == null ? '—' : ms >= 1000 ? `${(ms/1000).toFixed(1)}s` : `${ms}ms`;
    const cacheHit = data.cacheReadTokens || 0;
    const cacheHitPct = data.totalTokens > 0 ? Math.round((cacheHit / (data.totalTokens + cacheHit)) * 100) : 0;
    el.innerHTML = `
      <div class="card text-center">
        <div class="text-2xl font-bold text-white">${fmt(data.totalCalls)}</div>
        <div class="text-xs text-gray-400 mt-1">Total Calls</div>
        <div class="text-xs text-green-400 mt-1">${fmt(data.successCalls)} success</div>
      </div>
      <div class="card text-center">
        <div class="text-2xl font-bold text-white">${fmt(data.totalTokens)}</div>
        <div class="text-xs text-gray-400 mt-1">Billed Tokens</div>
        <div class="text-xs text-gray-500 mt-1">${fmt(data.inputTokens)} in / ${fmt(data.outputTokens)} out</div>
      </div>
      <div class="card text-center">
        <div class="text-2xl font-bold text-cyan-400">${fmt(cacheHit)}</div>
        <div class="text-xs text-gray-400 mt-1">Cache-Read Tokens</div>
        <div class="text-xs text-cyan-600 mt-1">${cacheHitPct}% of total context${data.cacheCreationTokens > 0 ? ` · ${fmt(data.cacheCreationTokens)} written` : ''}</div>
      </div>
      <div class="card text-center">
        <div class="text-2xl font-bold ${data.successRate >= 90 ? 'text-green-400' : data.successRate >= 70 ? 'text-yellow-400' : 'text-red-400'}">${data.successRate != null ? data.successRate + '%' : '—'}</div>
        <div class="text-xs text-gray-400 mt-1">Success Rate</div>
        <div class="text-xs text-gray-500 mt-1">${fmtMs(data.avgDurationMs)} avg · ${fmt(data.rateLimitedCalls)} limited</div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<p class="text-red-400 text-sm col-span-4">Failed: ${e.message}</p>`;
  }
}

async function loadLogsCharts() {
  const period = document.getElementById('logs-period')?.value || '7d';
  // Use local date (not UTC) to match how call-logger.js stores date
  const _now = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;

  // Hourly chart (today)
  try {
    const hourly = await fetch(`${BASE}/api/logs/breakdown?type=hourly&date=${today}`).then(r => r.json());
    document.getElementById('logs-chart-date').textContent = `(${today})`;
    const labels = hourly.map(h => `${String(h.hour).padStart(2,'0')}:00`);
    const callsData = hourly.map(h => h.calls);
    const ctx = document.getElementById('chart-hourly').getContext('2d');
    if (_chartHourly) _chartHourly.destroy();
    _chartHourly = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Calls',
          data: callsData,
          backgroundColor: 'rgba(99,102,241,0.7)',
          borderRadius: 3,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: '#1f2937' } },
          y: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' }, beginAtZero: true }
        }
      }
    });
  } catch (e) { console.error('Hourly chart error:', e); }

  // Daily chart
  try {
    const daily = await fetch(`${BASE}/api/logs/breakdown?type=daily&days=7`).then(r => r.json());
    const ctx2 = document.getElementById('chart-daily').getContext('2d');
    if (_chartDaily) _chartDaily.destroy();
    _chartDaily = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: daily.map(d => d.date.slice(5)),  // "MM-DD"
        datasets: [
          { label: 'Success', data: daily.map(d => d.success), backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 3 },
          { label: 'Error',   data: daily.map(d => d.error),   backgroundColor: 'rgba(239,68,68,0.7)',  borderRadius: 3 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#9ca3af', boxWidth: 12 } } },
        scales: {
          x: { stacked: true, ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } },
          y: { stacked: true, ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' }, beginAtZero: true }
        }
      }
    });
  } catch (e) { console.error('Daily chart error:', e); }

  // Model breakdown
  try {
    const models = await fetch(`${BASE}/api/logs/breakdown?type=model&period=${period}`).then(r => r.json());
    const el = document.getElementById('logs-model-breakdown');
    if (!models.length) { el.innerHTML = '<p class="text-gray-500">No data yet.</p>'; return; }
    const maxTok = Math.max(...models.map(m => m.total_tokens || 0), 1);
    el.innerHTML = models.map(m => {
      const pct = Math.round(((m.total_tokens || 0) / maxTok) * 100);
      const avgMs = m.avg_duration_ms ? Math.round(m.avg_duration_ms) : null;
      const cacheRead = m.cache_read_tokens || 0;
      const cacheCreate = m.cache_creation_tokens || 0;
      const cacheStr = cacheRead > 0 ? ` · 💾 ${cacheRead.toLocaleString()} cached` : '';
      const cacheCreateStr = cacheCreate > 0 ? ` · ✍ ${cacheCreate.toLocaleString()} written` : '';
      return `
        <div class="mb-3">
          <div class="flex justify-between text-xs mb-1">
            <span class="font-mono text-gray-200">${m.model}</span>
            <span class="text-gray-400">${(m.total_tokens||0).toLocaleString()} billed &nbsp;·&nbsp; ${m.calls} calls${avgMs ? ` &nbsp;·&nbsp; avg ${avgMs}ms` : ''}${cacheStr}${cacheCreateStr}</span>
          </div>
          <div class="bg-gray-700 rounded-full h-2">
            <div class="bg-indigo-500 h-2 rounded-full" style="width:${pct}%"></div>
          </div>
        </div>`;
    }).join('');
  } catch (e) { console.error('Model breakdown error:', e); }
}

async function loadLogsFilters() {
  try {
    const data = await fetch(`${BASE}/api/logs/filters`).then(r => r.json());
    const sel = document.getElementById('logs-model');
    const current = sel.value;
    sel.innerHTML = '<option value="">All Models</option>' +
      data.models.map(m => `<option value="${m}"${m === current ? ' selected' : ''}>${m}</option>`).join('');
  } catch (e) { /* ignore */ }
}

async function loadLogsTable() {
  const period  = document.getElementById('logs-period')?.value || '7d';
  const model   = document.getElementById('logs-model')?.value  || '';
  const status  = document.getElementById('logs-status')?.value || '';
  const date    = document.getElementById('logs-date')?.value   || '';
  const tbody   = document.getElementById('logs-table-body');
  const pgEl    = document.getElementById('logs-pagination');
  tbody.innerHTML = `<tr><td colspan="11" class="py-4 text-gray-500">Loading...</td></tr>`;

  try {
    const params = new URLSearchParams({ page: _logsPage, limit: 50 });
    if (model)  params.set('model',  model);
    if (status) params.set('status', status);
    if (date)   params.set('date',   date);

    const data = await fetch(`${BASE}/api/logs/calls?${params}`).then(r => r.json());

    if (!data.rows.length) {
      tbody.innerHTML = `<tr><td colspan="11" class="py-4 text-gray-500">No calls recorded yet.</td></tr>`;
      pgEl.innerHTML = '';
      return;
    }

    const statusBadge = s => {
      if (s === 'success')      return '<span class="text-green-400">✓</span>';
      if (s === 'rate_limited') return '<span class="text-yellow-400">⏳</span>';
      return '<span class="text-red-400">✗</span>';
    };
    const shortEndpoint = e => e.replace('/v1/', '');
    const fmtTime = ts => {
      const d = new Date(ts);
      return `<span title="${ts}">${d.toLocaleDateString()} ${d.toLocaleTimeString()}</span>`;
    };
    // Opt badge
    const optBadge = opt => opt
      ? '<span class="text-yellow-400 text-xs font-bold" title="Request optimizer was enabled for this call">⚡</span>'
      : '<span class="text-gray-700">—</span>';

    tbody.innerHTML = data.rows.map(r => {
      const cacheRead = r.cache_read_tokens || 0;
      const cacheCreate = r.cache_creation_tokens || 0;
      const cacheCell = cacheRead > 0
        ? `<span class="text-cyan-400">${cacheRead.toLocaleString()}</span>${cacheCreate > 0 ? `<span class="text-gray-600"> +${cacheCreate.toLocaleString()}</span>` : ''}`
        : `<span class="text-gray-600">—</span>`;
      // Request info tooltip
      const reqSys  = r.request_system_len;
      const reqMsgs = r.request_messages;
      const reqTols = r.request_tools;
      const reqChar = r.request_chars;
      const reqTip  = (reqMsgs != null)
        ? `title="System: ${reqSys ?? '?'} · Messages: ${reqMsgs} · Tools: ${reqTols ?? 0} · ${(reqChar ?? 0).toLocaleString()} chars"`
        : '';
      const reqCell = (reqMsgs != null)
        ? `<span class="text-gray-500 cursor-help border-b border-dotted border-gray-700 text-xs" ${reqTip}>📋 ${reqMsgs}msgs</span>`
        : `<span class="text-gray-700">—</span>`;
      return `
      <tr class="border-t border-border hover:bg-gray-800/40 text-xs">
        <td class="py-2 pr-4 text-gray-400">${fmtTime(r.timestamp)}</td>
        <td class="py-2 pr-4 font-mono text-gray-300">${shortEndpoint(r.endpoint)}</td>
        <td class="py-2 pr-4 font-mono text-gray-200 max-w-[140px] truncate" title="${r.model}">${r.model}</td>
        <td class="py-2 pr-4">${statusBadge(r.status)} <span class="text-gray-500">${r.status}</span></td>
        <td class="py-2 pr-4 text-gray-300">${(r.input_tokens||0).toLocaleString()}</td>
        <td class="py-2 pr-4 text-gray-300">${(r.output_tokens||0).toLocaleString()}</td>
        <td class="py-2 pr-4">${cacheCell}</td>
        <td class="py-2 pr-4">${reqCell}</td>
        <td class="py-2 pr-4">${optBadge(r.optimized)}</td>
        <td class="py-2 pr-4 text-gray-400">${r.duration_ms != null ? r.duration_ms + 'ms' : '—'}</td>
        <td class="py-2 text-gray-500">${r.stream ? 'stream' : 'sync'}</td>
      </tr>`;
    }).join('');

    // Pagination
    pgEl.innerHTML = `
      <span>Page ${data.page} / ${data.totalPages} &nbsp;·&nbsp; ${data.total.toLocaleString()} total</span>
      <div class="flex gap-2">
        <button onclick="logsPageNav(-1)" class="btn-secondary text-xs px-3 py-1" ${data.page <= 1 ? 'disabled' : ''}>← Prev</button>
        <button onclick="logsPageNav(1)"  class="btn-secondary text-xs px-3 py-1" ${data.page >= data.totalPages ? 'disabled' : ''}>Next →</button>
      </div>
    `;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="11" class="py-4 text-red-400">Error: ${e.message}</td></tr>`;
  }
}

function logsPageNav(delta) {
  _logsPage = Math.max(1, _logsPage + delta);
  loadLogsTable();
}
