import { apiGet } from '../api.js';
import { $, escapeHtml, formatDate } from '../utils.js';
import { emptyState } from '../components/empty-state.js';

function boolTag(value) {
  return value ? '<span class="eligibility-tag good">Oui</span>' : '<span class="eligibility-tag neutral">Non</span>';
}

export function renderJobsBatchView() {
  $('jobsBatchView').innerHTML = `
    <section class="card"><div class="section-header"><h3>Jobs / Batchs globaux</h3></div><div id="jobsBatchStats" class="grid-kpi"></div></section>
    <section class="card"><div class="table-wrap"><table><thead><tr><th>Import Job</th><th>Progression</th><th>Sous-batchs</th><th>Reprise</th><th>Statut</th></tr></thead><tbody id="jobsBatchRows"></tbody></table></div></section>
  `;
}

export async function refreshJobsBatchView() {
  const payload = await apiGet('/api/import-jobs').catch(() => ({ items: [] }));
  const items = payload.items || [];
  $('jobsBatchStats').innerHTML = `
    <div class="kpi-card"><span class="label">Jobs</span><span class="value">${items.length}</span></div>
    <div class="kpi-card"><span class="label">Échecs batch</span><span class="value">${items.reduce((a, x) => a + (x.failed_batches || 0), 0)}</span></div>
    <div class="kpi-card"><span class="label">Reprises à faire</span><span class="value">${items.filter((x) => x.resume_from_batch).length}</span></div>
  `;
  $('jobsBatchRows').innerHTML = items.map((item) => `<tr><td>${escapeHtml(item.import_job_id || '-')}</td><td>${item.progress_percent || 0}%</td><td>${item.completed_batches || 0}/${item.total_batches || 0}</td><td>${item.resume_from_batch ? `Batch ${item.resume_from_batch}` : '-'}</td><td>${escapeHtml(item.status || '-')}</td></tr>`).join('') || `<tr><td colspan="5">${emptyState('Aucun job import trouvé.')}</td></tr>`;
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

export function renderPendingAssignmentsView() {
  $('pendingAssignmentsView').innerHTML = `
    <section class="card"><div class="section-header"><h3>Affectations en attente</h3></div><div class="table-wrap"><table><thead><tr><th>Email</th><th>Groupe</th><th>Raison</th><th>Statut</th><th>Batch</th><th>Maj</th></tr></thead><tbody id="pendingRows"></tbody></table></div></section>
  `;
}

export async function refreshPendingAssignmentsView() {
  const payload = await apiGet('/api/pending-group-assignments').catch(() => ({ items: [] }));
  const items = payload.items || [];
  $('pendingRows').innerHTML = items.map((item) => `<tr><td>${escapeHtml(item.email || '-')}</td><td>${escapeHtml(item.group_name || '-')}</td><td>${escapeHtml(item.deferred_reason || '-')}</td><td>${escapeHtml(item.status || '-')}</td><td>${escapeHtml(item.batch_uuid || '-')}</td><td>${formatDate(item.updated_at)}</td></tr>`).join('') || `<tr><td colspan="6">${emptyState('Aucune affectation différée.')}</td></tr>`;
}

export function renderBlockagesView() {
  $('blockagesView').innerHTML = `<section class="card"><div class="section-header"><h3>Blocages / Transferts</h3></div><div id="blockagesRows"></div></section>`;
}

export async function refreshBlockagesView() {
  const payload = await apiGet('/api/anomalies/attention').catch(() => ({ items: [] }));
  const blocked = (payload.items || []).filter((item) => ['assignment_deferred', 'imports_partial_or_failed'].includes(item.type));
  $('blockagesRows').innerHTML = blocked.map((item) => `<p class="dashboard-alert-line">${escapeHtml(item.type)} · ${escapeHtml(item.email || item.import_job_id || '-')} · ${escapeHtml(item.reason || item.status || '-')}</p>`).join('') || emptyState('Aucun blocage détecté.');
}

export function renderConfigOpsView() {
  $('configOpsView').innerHTML = `<section class="card"><div class="section-header"><h3>Configuration / Exploitation</h3></div><pre class="console" id="configOpsConsole"></pre></section>`;
}

export async function refreshConfigOpsView() {
  const payload = await apiGet('/api/config/exploitation').catch((e) => ({ error: e.message }));
  $('configOpsConsole').textContent = JSON.stringify(payload, null, 2);
}

export function renderAnomaliesView() {
  $('anomaliesView').innerHTML = `<section class="card"><div class="section-header"><h3>Anomalies / Attention Required</h3></div><div class="table-wrap"><table><thead><tr><th>Type</th><th>Job/Batch</th><th>Cible</th><th>Détail</th></tr></thead><tbody id="anomaliesRows"></tbody></table></div></section>`;
}

export async function refreshAnomaliesView() {
  const payload = await apiGet('/api/anomalies/attention').catch(() => ({ items: [] }));
  const items = payload.items || [];
  $('anomaliesRows').innerHTML = items.map((item) => `<tr><td>${escapeHtml(item.type || '-')}</td><td>${escapeHtml(item.import_job_id || item.batch_uuid || '-')}</td><td>${escapeHtml(item.email || item.group_name || '-')}</td><td>${escapeHtml(item.reason || item.status || '-')}</td></tr>`).join('') || `<tr><td colspan="4">${emptyState('Aucune anomalie active.')}</td></tr>`;
}
