/* =====================================================
   Antigravity Gateway — Admin UI
   app.js: All API calls and UI rendering logic
   ===================================================== */

const BASE = '';  // Same origin — server serves this file

// ── Tab Navigation ─────────────────────────────────────

function showTab(name) {
  document.querySelectorAll('[id^="tab-content-"]').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-content-${name}`).classList.remove('hidden');
  document.getElementById(`tab-${name}`).classList.add('active');

  if (name === 'dashboard') { loadDashboard(); renderApiDocs(); }
  if (name === 'models') {} // user triggers manually
  if (name === 'playground') loadPlaygroundModels();
  if (name === 'system') { loadHealth(); }
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
  try {
    const res = await fetch(`${BASE}/account-limits`);
    const data = await res.json();
    renderDashboard(data);
  } catch (e) {
    el.innerHTML = `<p class="text-red-400 text-sm">Failed to load: ${e.message}</p>`;
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
          <span class="text-sm font-medium text-gray-200">${acc.email}</span>
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
      html += `<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">`;
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
          ? `Resets: ${new Date(q.resetTime).toLocaleTimeString()}`
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
  html += `<p class="text-gray-600 text-xs mt-4">Last updated: ${new Date(data.timestamp).toLocaleString()}</p>`;

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

checkServerStatus();
setInterval(checkServerStatus, 30000);
loadDashboard();
renderApiDocs();
