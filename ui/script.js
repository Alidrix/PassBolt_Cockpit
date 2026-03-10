const fileInput = document.getElementById('file');
const previewBtn = document.getElementById('previewBtn');
const uploadBtn = document.getElementById('uploadBtn');
const rollbackInput = document.getElementById('rollbackOnError');
const resultsBody = document.getElementById('results');
const previewBody = document.getElementById('previewRows');
const summary = document.getElementById('summary');
const finalSummary = document.getElementById('finalSummary');
const bar = document.getElementById('bar');
const progressPercent = document.getElementById('progressPercent');
const progressStage = document.getElementById('progressStage');
const toast = document.getElementById('toast');
const logsBox = document.getElementById('logs');

let lastPreview = null;

function showToast(message) {
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 2500);
}

function appendLog(prefix, message) {
  logsBox.textContent += `[${new Date().toLocaleTimeString()}] ${prefix} ${message}\n`;
  logsBox.scrollTop = logsBox.scrollHeight;
}

function stageLabel(stage) {
  const map = {
    'preview': 'Prévalidation',
    'create-user': 'Création utilisateur',
    'create-group': 'Création groupe',
    'assign-group': 'Assignation groupe',
    'done': 'Terminé'
  };
  return map[stage] || stage;
}

function setProgress(percent, stage = 'preview') {
  bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressStage.textContent = stageLabel(stage);
}

function statusBadge(status) {
  if (status === 'success') return '<span class="badge badge-success">succès</span>';
  if (status === 'partial' || status === 'deferred') return '<span class="badge badge-warning">partiel/différé</span>';
  if (status === 'error' || status === 'failed') return '<span class="badge badge-error">erreur</span>';
  if (status === 'rolled_back' || status === 'rollback_required_manual') return '<span class="badge badge-info">rollback</span>';
  return `<span class="badge badge-info">${status || 'n/a'}</span>`;
}

function escapeHtml(text) {
  return (text || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function renderPreview(preview) {
  previewBody.innerHTML = '';
  preview.rows.forEach((row) => {
    previewBody.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${row.line}</td>
        <td>${escapeHtml(row.email)}</td>
        <td>${escapeHtml(row.firstname)}</td>
        <td>${escapeHtml(row.lastname)}</td>
        <td>${escapeHtml(row.role)}</td>
        <td>${escapeHtml((row.groups || []).join('; '))}</td>
        <td>${row.valid ? '<span class="badge badge-success">valide</span>' : '<span class="badge badge-error">invalide</span>'}</td>
        <td>${escapeHtml((row.errors || []).join(' | '))}</td>
      </tr>
    `);
  });
}

function renderImportResults(payload) {
  resultsBody.innerHTML = '';
  const rows = payload.results || [];
  rows.forEach((row) => {
    const detail = [
      row.errors && row.errors.length ? `Erreurs: ${row.errors.join(' | ')}` : '',
      row.groups_created?.length ? `Groupes créés: ${row.groups_created.join(', ')}` : '',
      row.groups_assigned?.length ? `Groupes assignés: ${row.groups_assigned.join(', ')}` : '',
      row.groups_deferred?.length ? `Groupes différés: ${row.groups_deferred.join(', ')}` : ''
    ].filter(Boolean).join('<br>') || '-';

    resultsBody.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${escapeHtml(row.email)}</td>
        <td>${statusBadge(row.user_create_status === 'success' && row.groups_deferred?.length ? 'deferred' : row.user_create_status)}</td>
        <td>${escapeHtml((row.groups_requested || []).join(', '))}</td>
        <td>${detail}</td>
      </tr>
    `);
  });

  const sum = payload.summary || {};
  finalSummary.innerHTML = `
    <li>Utilisateurs créés: <strong>${sum.users_created || 0}</strong></li>
    <li>Groupes créés: <strong>${sum.groups_created || 0}</strong></li>
    <li>Groupes assignés: <strong>${sum.groups_assigned || 0}</strong></li>
    <li>Assignations différées: <strong>${sum.groups_deferred || 0}</strong></li>
    <li>Erreurs: <strong>${sum.errors || 0}</strong></li>
  `;
  summary.textContent = `Import ${payload.status} — ${payload.success}/${payload.total}`;
}

previewBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return showToast('Sélectionne un CSV');

  const form = new FormData();
  form.append('file', file);
  previewBtn.disabled = true;

  try {
    const preview = await fetchJson('/preview', { method: 'POST', body: form });
    lastPreview = preview;
    renderPreview(preview);
    summary.textContent = `Preview: ${preview.valid_rows}/${preview.total_rows} lignes valides`;
    appendLog('INFO', `Preview OK: ${preview.valid_rows} valides, ${preview.invalid_rows} invalides`);
    if (preview.valid_rows === 0) {
      uploadBtn.disabled = true;
      showToast('Import bloqué: 100% des lignes sont invalides');
    } else {
      uploadBtn.disabled = false;
    }
  } catch (error) {
    appendLog('ERR', error.message || String(error));
    showToast('Erreur preview');
  } finally {
    previewBtn.disabled = false;
  }
});

uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return showToast('Sélectionne un CSV');
  if (lastPreview && lastPreview.valid_rows === 0) return showToast('Aucune ligne valide à importer');

  uploadBtn.disabled = true;
  resultsBody.innerHTML = '';
  logsBox.textContent = '';
  finalSummary.innerHTML = '';
  setProgress(5, 'preview');

  const form = new FormData();
  form.append('file', file);
  form.append('rollback_on_error', String(rollbackInput.checked));

  try {
    const response = await fetch('/import-stream', { method: 'POST', body: form });
    if (!response.ok || !response.body) throw new Error('Stream indisponible');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const event = JSON.parse(trimmed);
        if (event.type === 'log') appendLog('INFO', event.message);
        if (event.type === 'stderr') appendLog('ERR', event.message);
        if (event.type === 'stdout') appendLog('OUT', event.message);
        if (event.type === 'progress') {
          const payload = event.payload || {};
          setProgress(payload.percent || 0, payload.stage || 'preview');
        }
        if (event.type === 'final') {
          setProgress(100, 'done');
          renderImportResults(event.payload);
          showToast('Import terminé');
        }
      }
    }
  } catch (error) {
    appendLog('ERR', error.message || String(error));
    summary.textContent = 'Import interrompu';
    showToast('Erreur import');
  } finally {
    uploadBtn.disabled = false;
  }
});
