const BASE = '';

async function checkServerStatus() {
  const badge = document.getElementById('server-status-badge');
  try {
    const start = Date.now();
    const res = await fetch(BASE + '/health');
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

async function loadHealth() {
  const el = document.getElementById('health-content');
  el.innerHTML = 'Loading...';
  try {
    const res = await fetch(BASE + '/health');
    const data = await res.json();
    
    let html = `<div class="mb-4 text-gray-300">${data.summary}</div>`;
    
    if (data.accounts && data.accounts.length > 0) {
      html += `<div class="space-y-3">`;
      data.accounts.forEach(acc => {
        const isOk = acc.status === 'ok';
        const isLimited = acc.status === 'rate-limited';
        const isDisabled = acc.status === 'disabled';
        const isInvalid = acc.status === 'invalid';
        
        let statusColor = 'text-gray-400';
        if (isOk) statusColor = 'text-green-400';
        if (isLimited) statusColor = 'text-yellow-400';
        if (isDisabled) statusColor = 'text-gray-500';
        if (isInvalid || acc.status === 'error') statusColor = 'text-red-400';

        let modelsHtml = '';
        if (acc.models && Object.keys(acc.models).length > 0) {
          modelsHtml = `<div class="mt-2 grid grid-cols-2 gap-2 text-xs">`;
          for (const [model, info] of Object.entries(acc.models)) {
            const pct = info.remainingFraction !== null ? Math.round(info.remainingFraction * 100) : 0;
            const color = pct > 20 ? 'bg-green-500' : pct > 0 ? 'bg-yellow-500' : 'bg-red-500';
            modelsHtml += `
              <div class="bg-gray-800 p-2 rounded flex justify-between items-center">
                <span class="truncate pr-2" title="${model}">${model.replace('claude-3-5-', '').replace('gemini-1.5-', '')}</span>
                <div class="flex items-center gap-2">
                  <span>${info.remaining}</span>
                  <div class="w-12 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div class="${color} h-full" style="width: ${pct}%"></div>
                  </div>
                </div>
              </div>
            `;
          }
          modelsHtml += `</div>`;
        }

        const actionBtn = isDisabled 
          ? `<button onclick="toggleAccount('${acc.email}', false)" class="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded">Enable</button>`
          : `<button onclick="toggleAccount('${acc.email}', true)" class="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded">Disable</button>`;

        html += `
          <div class="p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
            <div class="flex justify-between items-start">
              <div>
                <div class="font-medium text-gray-200">${acc.email}</div>
                <div class="text-xs ${statusColor} mt-1">${acc.status.toUpperCase()} ${acc.error ? '— ' + acc.error : ''}</div>
              </div>
              ${actionBtn}
            </div>
            ${modelsHtml}
          </div>
        `;
      });
      html += `</div>`;
    }
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = `<p class="text-red-400">Error: ${e.message}</p>`;
  }
}

async function toggleAccount(email, disable) {
  try {
    const action = disable ? 'disable' : 'enable';
    const res = await fetch(BASE + `/accounts/${encodeURIComponent(email)}/${action}`, { method: 'POST' });
    if (res.ok) {
      loadHealth();
    } else {
      const data = await res.json();
      alert('Error: ' + data.error);
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function refreshTokens() {
  const btn = document.getElementById('refresh-btn');
  const resEl = document.getElementById('action-result');
  btn.disabled = true;
  btn.textContent = 'Refreshing...';
  resEl.textContent = '';
  try {
    const res = await fetch(BASE + '/refresh-token', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      resEl.innerHTML = `<span class="text-green-400">✅ ${data.message}</span>`;
      loadHealth();
    } else {
      resEl.innerHTML = `<span class="text-red-400">❌ Error: ${data.error}</span>`;
    }
  } catch (e) {
    resEl.innerHTML = `<span class="text-red-400">❌ Error: ${e.message}</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '⟳ Refresh All Tokens';
  }
}

checkServerStatus();
setInterval(checkServerStatus, 30000);
loadHealth();