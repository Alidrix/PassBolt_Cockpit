import { apiGet, apiPost } from '../api.js';
import { $, escapeHtml, formatDate, setToast } from '../utils.js';
import { emptyState } from '../components/empty-state.js';
import { statusChip } from '../components/status-chip.js';

const statusLabel = {
  up_to_date: ['success', 'À jour'],
  update_available: ['warning', 'Mise à jour disponible'],
  critical_update: ['error', 'Mise à jour critique']
};

function sourceLabel(source) {
  return {
    official_changelog: 'official changelog',
    rss: 'RSS',
    github_api: 'GitHub release',
    github_browser_extension: 'GitHub extension'
  }[source] || source || '-';
}

function releaseTypeLabel(type) {
  return ({ feature: 'feature', maintenance: 'maintenance', security: 'security' }[type] || 'feature');
}

function renderCurrentStatus(data = {}) {
  const status = statusLabel[data.status] || ['neutral', 'Inconnu'];
  $('updatesStatusCard').innerHTML = `
    <div class="section-header"><h3>Mises à jour Passbolt</h3>${statusChip(status[0], status[1])}</div>
    <div class="grid-kpi">
      <div class="kpi-card"><span class="label">Version installée</span><span class="value">${escapeHtml(data.local_version || '-')}</span></div>
      <div class="kpi-card"><span class="label">Dernière version</span><span class="value">${escapeHtml(data.remote_version || '-')}</span></div>
      <div class="kpi-card"><span class="label">Type</span><span class="value">${escapeHtml(releaseTypeLabel(data.release_type))}</span></div>
      <div class="kpi-card"><span class="label">Date publication</span><span class="value">${escapeHtml(formatDate(data.published_at) || '-')}</span></div>
    </div>
    <p class="muted mt-3">Source: ${escapeHtml(sourceLabel(data.source_checked))} · Dernière vérification: ${escapeHtml(formatDate(data.checked_at) || '-')}</p>
    ${data.raw_release_title ? `<p class="muted text-break">Release: ${escapeHtml(data.raw_release_title)}</p>` : ''}
  `;

  $('updatesSources').innerHTML = (data.sources || []).map((src) => `
    <tr>
      <td>${escapeHtml(sourceLabel(src.source))}</td>
      <td>${escapeHtml(src.remote_version || '-')}</td>
      <td>${escapeHtml(formatDate(src.published_at) || '-')}</td>
      <td>${escapeHtml(releaseTypeLabel(src.release_type))}</td>
      <td>${escapeHtml(src.ok ? 'OK' : 'Erreur')}</td>
    </tr>
  `).join('') || `<tr><td colspan="5">${emptyState('Aucune source détectée.')}</td></tr>`;
}

function renderHistory(items = []) {
  $('updatesHistoryRows').innerHTML = items.map((row) => {
    const s = statusLabel[row.status] || ['neutral', row.status || 'Inconnu'];
    return `<tr><td>${escapeHtml(formatDate(row.checked_at) || '-')}</td><td>${escapeHtml(row.local_version || '-')}</td><td>${escapeHtml(row.remote_version || '-')}</td><td>${escapeHtml(sourceLabel(row.source_checked))}</td><td>${statusChip(s[0], s[1])}</td></tr>`;
  }).join('') || `<tr><td colspan="5">${emptyState('Aucun historique de vérification.')}</td></tr>`;
}

export function renderUpdatesView() {
  $('updatesView').innerHTML = `
    <section class="card">
      <div class="action-bar mb-3"><button id="updatesCheckNow" class="btn btn-primary">Vérifier maintenant</button></div>
      <div id="updatesStatusCard"></div>
    </section>
    <section class="card mt-3">
      <div class="section-header"><h3>Sources surveillées</h3></div>
      <div class="table-wrap"><table><thead><tr><th>Source</th><th>Version</th><th>Publication</th><th>Type</th><th>Statut</th></tr></thead><tbody id="updatesSources"></tbody></table></div>
    </section>
    <section class="card mt-3">
      <div class="section-header"><h3>Historique des vérifications</h3></div>
      <div class="table-wrap"><table><thead><tr><th>Vérifié le</th><th>Locale</th><th>Remote</th><th>Source</th><th>Statut</th></tr></thead><tbody id="updatesHistoryRows"></tbody></table></div>
    </section>
  `;

  $('updatesCheckNow')?.addEventListener('click', async () => {
    try {
      await apiPost('/api/passbolt/updates/check', null);
      await refreshUpdatesView();
      setToast('Vérification des mises à jour terminée.', 'success');
    } catch (error) {
      setToast(`Échec vérification: ${error.message}`, 'error');
    }
  });
}

export async function refreshUpdatesView() {
  const [latest, history] = await Promise.all([
    apiGet('/api/passbolt/updates/check').catch(() => ({})),
    apiGet('/api/passbolt/updates/history?limit=12').catch(() => ({ items: [] }))
  ]);
  renderCurrentStatus(latest);
  renderHistory(history.items || []);
}
