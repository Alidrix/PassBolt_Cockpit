import { apiGet, apiPost } from '../api.js';
import { $, escapeHtml, formatDate, setToast } from '../utils.js';
import { statusChip } from '../components/status-chip.js';
import { emptyState } from '../components/empty-state.js';

function gapChip(versionGap, updateAvailable) {
  if (!updateAvailable) return statusChip('operational', 'À jour');
  if (/major/i.test(versionGap || '')) return statusChip('warning', 'Mise à jour majeure');
  if (/1 version/i.test(versionGap || '')) return statusChip('info', '1 version de retard');
  return statusChip('degraded', 'Plusieurs versions de retard');
}

function releaseBadge(kind) {
  const label = {
    installed: 'installée',
    intermediate: 'intermédiaire',
    target: 'cible',
    critical: 'critique'
  }[kind] || 'intermédiaire';
  return `<span class="updates-release-badge ${kind}">${label}</span>`;
}

function asList(items) {
  if (!items?.length) return '<li>Aucun élément publié.</li>';
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

function fallbackBody(message) {
  return `
    <section class="card updates-hero">
      <p class="page-label">Mises à jour</p>
      <h2>Mises à jour Passbolt</h2>
      <p class="muted">${escapeHtml(message)}</p>
    </section>
    <section class="card">
      ${emptyState('Impossible de récupérer les informations de mise à jour pour le moment. Réessayez dans quelques minutes.')}
    </section>
  `;
}

async function runRefreshCheck() {
  await apiPost('/api/updates/check', JSON.stringify({ force: true }), { headers: { 'Content-Type': 'application/json' } });
  await refreshUpdates();
  setToast('Vérification des mises à jour terminée.', 'success');
}

function renderUpdatePayload(payload) {
  const timeline = payload?.intermediate_releases || [];
  const features = payload?.aggregated_features || {};
  const impact = payload?.operational_impact || {};

  const viewBody = $('updatesViewBody');
  if (!viewBody) return;

  viewBody.innerHTML = `
    <section class="card updates-hero">
      <p class="page-label">Mises à jour</p>
      <h2>Mises à jour Passbolt</h2>
      <p class="muted">Visualisez votre version actuelle, la prochaine version disponible et les bénéfices concrets d’une mise à jour.</p>
    </section>

    <section class="updates-top-grid">
      <article class="card updates-kpi-card">
        <h3>Version installée</h3>
        <p class="updates-main-value">${escapeHtml(payload?.local_version || '-')}</p>
        <p class="muted">Édition: ${escapeHtml(payload?.local_edition || '-')}</p>
        <p class="muted">Détectée le: ${formatDate(payload?.local_detected_at)}</p>
        <p class="muted">Source locale: ${escapeHtml(payload?.local_source || '-')}</p>
      </article>
      <article class="card updates-kpi-card">
        <h3>Dernière version disponible</h3>
        <p class="updates-main-value">${escapeHtml(payload?.remote_version || '-')}</p>
        <p class="muted">Publiée le: ${formatDate(payload?.remote_published_at)}</p>
        <p class="muted">Source retenue: ${escapeHtml(payload?.source_used || '-')}</p>
      </article>
      <article class="card updates-kpi-card">
        <h3>Statut</h3>
        <div>${gapChip(payload?.version_gap, payload?.update_available)}</div>
        <p class="muted">${escapeHtml(payload?.version_gap || 'Statut indisponible')}</p>
      </article>
    </section>

    <section class="card">
      <div class="section-header"><h3>Ce que vous gagnez</h3></div>
      <div class="updates-features-grid">
        <article><h4>Nouveautés utilisateur</h4><ul>${asList(features?.user)}</ul></article>
        <article><h4>Nouveautés admin</h4><ul>${asList(features?.admin)}</ul></article>
        <article><h4>Sécurité & performance</h4><ul>${asList(features?.security_performance)}</ul></article>
      </div>
    </section>

    <section class="card">
      <div class="section-header"><h3>Timeline des releases</h3></div>
      <div class="updates-timeline">
        <div class="updates-release-item">
          ${releaseBadge('installed')}
          <strong>${escapeHtml(payload?.local_version || '-')}</strong>
        </div>
        ${timeline.map((item) => `
          <div class="updates-release-item">
            ${releaseBadge(item?.critical ? 'critical' : 'intermediate')}
            <strong>${escapeHtml(item?.version || '-')}</strong>
            <span class="muted">${formatDate(item?.published_at)}</span>
          </div>
        `).join('')}
        <div class="updates-release-item">
          ${releaseBadge('target')}
          <strong>${escapeHtml(payload?.remote_version || '-')}</strong>
          <span class="muted">${formatDate(payload?.remote_published_at)}</span>
        </div>
      </div>
    </section>

    <section class="card updates-impact-card">
      <div class="section-header"><h3>Impact avant mise à jour</h3></div>
      <div class="updates-impact-grid">
        <div><span class="muted">Sauvegarde</span><strong>${escapeHtml(impact?.backup_recommended ? 'Recommandée' : 'Optionnelle')}</strong></div>
        <div><span class="muted">Migration</span><strong>${escapeHtml(impact?.migration_potential ? 'Potentielle' : 'Faible')}</strong></div>
        <div><span class="muted">Clear cache</span><strong>${escapeHtml(impact?.clear_cache_recommended ? 'Recommandé' : 'Non requis')}</strong></div>
        <div><span class="muted">Post-check</span><strong>${escapeHtml(impact?.healthcheck_post_update ? 'Recommandé' : 'Optionnel')}</strong></div>
        <div><span class="muted">Niveau de risque</span><strong>${escapeHtml(impact?.risk_level || 'modéré')}</strong></div>
      </div>
    </section>

    <section class="card updates-check-card">
      <div class="section-header">
        <h3>Dernière vérification</h3>
        <button id="updatesRefreshNow" class="btn btn-primary" type="button">Vérifier maintenant</button>
      </div>
      <div class="updates-check-grid">
        <div><span class="muted">checked_at</span><strong>${formatDate(payload?.checked_at)}</strong></div>
        <div><span class="muted">source interrogée</span><strong>${escapeHtml(payload?.source_used || '-')}</strong></div>
        <div><span class="muted">statut</span><strong>${escapeHtml(payload?.check_status || '-')}</strong></div>
      </div>
      ${payload?.check_error ? `<details class="technical-logs"><summary>Détails techniques</summary><p class="json-block">${escapeHtml(payload.check_error)}</p></details>` : ''}
    </section>
  `;

  $('updatesRefreshNow')?.addEventListener('click', async () => {
    try {
      await runRefreshCheck();
    } catch (error) {
      console.error('[UI] updatesView remote source error', error);
      setToast(`Échec de vérification: ${error.message}`, 'error');
    }
  });
}

export function renderUpdatesView() {
  console.info('renderUpdatesView started');
  const root = $('updatesView');
  if (!root) return;

  root.innerHTML = `
    <div class="updates-view-shell">
      <section class="card updates-hero">
        <p class="page-label">Mises à jour</p>
        <h2>Mises à jour Passbolt</h2>
        <p class="muted">Chargement des informations de version…</p>
      </section>
      <section class="updates-top-grid">
        <article class="card updates-kpi-card"><h3>Version installée</h3><p class="updates-main-value">-</p></article>
        <article class="card updates-kpi-card"><h3>Dernière version disponible</h3><p class="updates-main-value">-</p></article>
        <article class="card updates-kpi-card"><h3>Statut</h3><p class="updates-main-value">-</p></article>
      </section>
      <section class="card updates-check-card">
        <div class="section-header">
          <h3>Actions</h3>
          <button id="updatesRefreshNowInitial" class="btn btn-primary" type="button">Vérifier maintenant</button>
        </div>
      </section>
      <div id="updatesViewBody"></div>
    </div>
  `;

  $('updatesRefreshNowInitial')?.addEventListener('click', async () => {
    try {
      await runRefreshCheck();
    } catch (error) {
      console.error('[UI] updatesView refresh button failed', error);
      setToast(`Échec de vérification: ${error.message}`, 'error');
    }
  });
}

export async function refreshUpdates() {
  console.info('refreshUpdates started');
  const viewBody = $('updatesViewBody');
  if (!viewBody) {
    console.warn('[UI] updatesViewBody not found, rendering fallback shell');
    renderUpdatesView();
  }

  try {
    const payload = await apiGet('/api/updates');
    if (!payload || Object.keys(payload).length === 0) throw new Error('Réponse vide de /api/updates');
    renderUpdatePayload(payload);
    console.info('refreshUpdates success');
  } catch (error) {
    console.error('refreshUpdates failed', error);
    const target = $('updatesViewBody');
    if (target) {
      target.innerHTML = fallbackBody(`Impossible de charger les mises à jour: ${error.message}`);
    }
    setToast(`Mises à jour indisponibles: ${error.message}`, 'error');
  }
}

export const refreshUpdatesView = refreshUpdates;
