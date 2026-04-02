import { apiGet } from '../api.js';
import { state } from '../state.js';
import { $, escapeHtml, formatDate } from '../utils.js';
import { emptyState } from '../components/empty-state.js';
import { kpiCard } from '../components/kpi-card.js';
import { statusBadge } from '../components/status-chip.js';

function boolTag(value) {
  return value ? '<span class="eligibility-tag good">Oui</span>' : '<span class="eligibility-tag neutral">Non</span>';
}

export function renderJobsBatchView() {
  $('jobsBatchView').innerHTML = `
    <section class="card">
      <div class="tabs">
        <button class="btn btn-secondary tab-btn active" data-jobs-tab="jobsOverviewTab">Jobs</button>
        <button class="btn btn-secondary tab-btn" data-jobs-tab="jobsHistoryTab">Historique</button>
      </div>
      <div id="jobsOverviewTab" class="tab-panel active">
        <div class="section-header"><h3>Jobs</h3></div>
        <div id="jobsBatchStats" class="grid-kpi"></div>
        <div class="table-wrap mt-3"><table><thead><tr><th>Import Job</th><th>Progression</th><th>Sous-batchs</th><th>Reprise</th><th>Statut</th></tr></thead><tbody id="jobsBatchRows"></tbody></table></div>
      </div>
      <div id="jobsHistoryTab" class="tab-panel">
        <div class="master-detail">
          <section class="card">
            <div class="form-grid">
              <div><label>Recherche</label><input id="historySearch" placeholder="UUID, fichier..." /></div>
              <div><label>Tri</label><select id="historySort"><option value="date_desc">Date ↓</option><option value="date_asc">Date ↑</option><option value="errors_desc">Erreurs ↓</option></select></div>
            </div>
            <div class="batch-list mt-3" id="batchList"></div>
          </section>
          <section class="card" id="historyDetail"></section>
        </div>
      </div>
    </section>
  `;

  document.querySelectorAll('[data-jobs-tab]').forEach((button) => button.addEventListener('click', () => {
    const tab = button.dataset.jobsTab;
    document.querySelectorAll('[data-jobs-tab]').forEach((x) => x.classList.toggle('active', x.dataset.jobsTab === tab));
    document.querySelectorAll('#jobsBatchView .tab-panel').forEach((x) => x.classList.toggle('active', x.id === tab));
  }));

  $('historySearch')?.addEventListener('input', () => {
    state.historySearch = $('historySearch').value.toLowerCase();
    renderHistoryList();
  });
  $('historySort')?.addEventListener('change', () => {
    state.historySort = $('historySort').value;
    renderHistoryList();
  });
}

function renderHistoryList() {
  const rows = [...(state.batches || [])]
    .filter((b) => `${b.import_job_id || b.batch_uuid || ''} ${b.filename || ''}`.toLowerCase().includes(state.historySearch || ''))
    .sort((a, b) => {
      if (state.historySort === 'date_asc') return new Date(a.created_at) - new Date(b.created_at);
      if (state.historySort === 'errors_desc') return (b.error_count || 0) - (a.error_count || 0);
      return new Date(b.created_at) - new Date(a.created_at);
    });

  $('batchList').innerHTML = rows.map((b) => `
    <button class="batch-item ${(b.import_job_id || b.batch_uuid) === state.activeBatch ? 'active' : ''}" data-batch="${escapeHtml(b.import_job_id || b.batch_uuid)}">
      <p class="text-ellipsis"><strong>${escapeHtml(b.filename || 'Sans nom')}</strong></p>
      <p class="muted text-ellipsis">${formatDate(b.created_at)}</p>
      <p class="muted text-break">${escapeHtml(b.import_job_id || b.batch_uuid || '-')}</p>
    </button>
  `).join('') || emptyState('Aucun batch.');

  document.querySelectorAll('#batchList .batch-item').forEach((item) => item.addEventListener('click', () => {
    state.activeBatch = item.dataset.batch;
    renderHistoryList();
  }));

  const selected = (state.batches || []).find((b) => (b.import_job_id || b.batch_uuid) === state.activeBatch);
  $('historyDetail').innerHTML = selected
    ? `
      <div class="section-header"><h3>Lot actif</h3>${statusBadge(selected.status)}</div>
      <div class="grid-kpi">
        ${kpiCard('Succès', selected.success_count || 0)}
        ${kpiCard('Erreurs', selected.error_count || 0)}
        ${kpiCard('Batchs terminés', `${selected.completed_batches || 0}/${selected.total_batches || 0}`)}
      </div>
      <p class="muted mt-3 text-break">Import Job: ${escapeHtml(selected.import_job_id || selected.batch_uuid || '-')}</p>
      <p class="muted text-break">Fichier: ${escapeHtml(selected.filename || '-')}</p>
    `
    : emptyState('Sélectionnez un batch à gauche.');
}

export async function refreshJobsBatchView() {
  const payload = await apiGet('/api/import-jobs').catch(() => ({ items: [] }));
  const batchesPayload = await apiGet('/api/batches').catch(() => ({ items: [] }));
  const items = payload.items || [];
  state.batches = batchesPayload.items || [];
  if (!state.activeBatch && state.batches.length) state.activeBatch = state.batches[0].import_job_id || state.batches[0].batch_uuid;

  $('jobsBatchStats').innerHTML = `
    ${kpiCard('Jobs', items.length)}
    ${kpiCard('Échecs batch', items.reduce((a, x) => a + (x.failed_batches || 0), 0))}
    ${kpiCard('Reprises à faire', items.filter((x) => x.resume_from_batch).length)}
  `;
  $('jobsBatchRows').innerHTML = items.map((item) => `<tr><td>${escapeHtml(item.import_job_id || '-')}</td><td>${item.progress_percent || 0}%</td><td>${item.completed_batches || 0}/${item.total_batches || 0}</td><td>${item.resume_from_batch ? `Batch ${item.resume_from_batch}` : '-'}</td><td>${escapeHtml(item.status || '-')}</td></tr>`).join('') || `<tr><td colspan="5">${emptyState('Aucun job import trouvé.')}</td></tr>`;
  renderHistoryList();
}

export function renderGroupsView() {
  $('groupsView').innerHTML = `
    <section class="card"><div class="section-header"><h3>Groupes</h3></div><div class="table-wrap"><table><thead><tr><th>Groupe</th><th>Origine</th><th>Manager temporaire</th><th>Manager final promu</th><th>Compte service retiré</th><th>Batch</th></tr></thead><tbody id="groupsRows"></tbody></table></div></section>
  `;
}

export async function refreshGroupsView() {
  const payload = await apiGet('/api/groups/overview').catch(() => ({ items: [] }));
  const items = payload.items || [];
  $('groupsRows').innerHTML = items.map((g) => `<tr><td>${escapeHtml(g.group_name || '-')}</td><td>${escapeHtml(g.origin || '-')}</td><td>${boolTag(Boolean(g.service_account_added_as_temporary_manager))}</td><td>${boolTag(Boolean(g.user_promoted_to_group_manager))}</td><td>${boolTag(Boolean(g.service_account_removed_from_group))}</td><td>${escapeHtml(g.batch_uuid || '-')}</td></tr>`).join('') || `<tr><td colspan="6">${emptyState('Aucun groupe tracé pour le moment.')}</td></tr>`;
}

export function renderAlertsView() {
  $('alertsView').innerHTML = `
    <section class="card">
      <div class="section-header"><h3>Alertes</h3></div>
      <div class="tabs mt-2">
        <button class="btn btn-secondary tab-btn active" data-alert-tab="alertPendingTab">En attente</button>
        <button class="btn btn-secondary tab-btn" data-alert-tab="alertBlockagesTab">Blocages</button>
        <button class="btn btn-secondary tab-btn" data-alert-tab="alertAnomaliesTab">Anomalies</button>
      </div>
      <div id="alertPendingTab" class="tab-panel active"><div class="table-wrap"><table><thead><tr><th>Email</th><th>Groupe</th><th>Raison</th><th>Statut</th><th>Batch</th><th>Maj</th></tr></thead><tbody id="alertsPendingRows"></tbody></table></div></div>
      <div id="alertBlockagesTab" class="tab-panel"><div id="alertsBlockagesRows"></div></div>
      <div id="alertAnomaliesTab" class="tab-panel"><div class="table-wrap"><table><thead><tr><th>Type</th><th>Job/Batch</th><th>Cible</th><th>Détail</th></tr></thead><tbody id="alertsAnomaliesRows"></tbody></table></div></div>
    </section>
  `;

  document.querySelectorAll('[data-alert-tab]').forEach((button) => button.addEventListener('click', () => {
    const tab = button.dataset.alertTab;
    document.querySelectorAll('[data-alert-tab]').forEach((x) => x.classList.toggle('active', x.dataset.alertTab === tab));
    document.querySelectorAll('#alertsView .tab-panel').forEach((x) => x.classList.toggle('active', x.id === tab));
  }));
}

export async function refreshAlertsView() {
  const [pendingPayload, anomaliesPayload, jobsPayload, logsPayload, groupsPayload] = await Promise.all([
    apiGet('/api/pending-group-assignments').catch(() => ({ items: [] })),
    apiGet('/api/anomalies/attention').catch(() => ({ items: [] })),
    apiGet('/api/import-jobs').catch(() => ({ items: [] })),
    apiGet('/api/logs?scope=system&level=error&limit=20').catch(() => ({ items: [] })),
    apiGet('/api/groups/overview').catch(() => ({ items: [] }))
  ]);

  const pending = pendingPayload.items || [];
  $('alertsPendingRows').innerHTML = pending.map((item) => `<tr><td>${escapeHtml(item.email || '-')}</td><td>${escapeHtml(item.group_name || '-')}</td><td>${escapeHtml(item.deferred_reason || '-')}</td><td>${escapeHtml(item.status || '-')}</td><td>${escapeHtml(item.batch_uuid || '-')}</td><td>${formatDate(item.updated_at)}</td></tr>`).join('') || `<tr><td colspan="6">${emptyState('Aucune affectation différée.')}</td></tr>`;

  const anomalies = anomaliesPayload.items || [];
  const partialImports = (jobsPayload.items || []).filter((x) => ['failed', 'partial'].includes(String(x.status || '').toLowerCase()));
  const failedBatches = (jobsPayload.items || []).filter((x) => Number(x.failed_batches || 0) > 0);
  const tempManagers = (groupsPayload.items || []).filter((g) => Boolean(g.service_account_added_as_temporary_manager) && !Boolean(g.service_account_removed_from_group));
  const criticalOpsErrors = (logsPayload.items || []).slice(0, 6);
  const blockages = [
    ...pending.map((item) => `Affectation différée · ${item.email || '-'} · ${item.group_name || '-'}`),
    ...tempManagers.map((g) => `Manager temporaire encore présent · ${g.group_name || '-'} · batch ${g.batch_uuid || '-'}`),
    ...partialImports.map((job) => `Import partiel/échoué · ${job.import_job_id || '-'} · statut ${job.status || '-'}`),
    ...failedBatches.map((job) => `Batchs en échec · ${job.import_job_id || '-'} · échecs ${job.failed_batches || 0}`),
    ...criticalOpsErrors.map((log) => `Erreur critique exploitation · ${log.message || '-'}`)
  ];

  $('alertsBlockagesRows').innerHTML = blockages.length
    ? blockages.map((line) => `<p class="dashboard-alert-line">${escapeHtml(line)}</p>`).join('')
    : emptyState('Aucun blocage détecté.');

  $('alertsAnomaliesRows').innerHTML = anomalies.map((item) => `<tr><td>${escapeHtml(item.type || '-')}</td><td>${escapeHtml(item.import_job_id || item.batch_uuid || '-')}</td><td>${escapeHtml(item.email || item.group_name || '-')}</td><td>${escapeHtml(item.reason || item.status || '-')}</td></tr>`).join('') || `<tr><td colspan="4">${emptyState('Aucune anomalie active.')}</td></tr>`;
}

export function renderConfigOpsView() {
  $('configOpsView').innerHTML = `<section class="card"><div class="section-header"><h3>Paramètres</h3></div><pre class="console" id="configOpsConsole"></pre></section>`;
}

export async function refreshConfigOpsView() {
  const payload = await apiGet('/api/config/exploitation').catch((e) => ({ error: e.message }));
  $('configOpsConsole').textContent = JSON.stringify(payload, null, 2);
}
