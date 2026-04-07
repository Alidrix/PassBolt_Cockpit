import { apiGet, apiPost } from '../api.js';
import { $, escapeHtml, formatDate, setToast } from '../utils.js';
import { statusChip } from '../components/status-chip.js';
import { emptyState } from '../components/empty-state.js';

function gapChip(versionGap, updateAvailable) {
  if (!updateAvailable) return statusChip('operational', 'À jour');
  if (/majeure|major/i.test(versionGap || '')) return statusChip('warning', 'Mise à jour majeure');
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
  if (!items?.length) return '<li>Aucun élément notable publié.</li>';
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

function updatesShell(subtitle = 'Chargement des informations de version…') {
  return `
    <div class="updates-view-shell">
      <section class="card updates-hero">
        <p class="page-label">Mises à jour</p>
        <h2>Mises à jour Passbolt</h2>
        <p class="updates-subtitle">${escapeHtml(subtitle)}</p>
      </section>
      <div id="updatesViewBody"></div>
    </div>
  `;
}

async function runRefreshCheck() {
  const result = await apiPost('/api/updates/check', JSON.stringify({ force: true }), { headers: { 'Content-Type': 'application/json' } });
  if (!result?.success) throw new Error(result?.check_error || 'La vérification distante a échoué.');
  await refreshUpdates();
  setToast('Vérification terminée avec succès.', 'success');
}

function renderUpdatePayload(payload) {
  const timeline = payload?.intermediate_releases || [];
  const features = payload?.aggregated_features || {};
  const impact = payload?.operational_impact || {};
  const degraded = payload?.check_status && payload.check_status !== 'success';

  const body = $('updatesViewBody');
  if (!body) return;

  body.innerHTML = `
    <section class="updates-row updates-top-grid">
      <article class="card updates-kpi-card">
        <h3>Version installée</h3>
        <p class="updates-main-value">${escapeHtml(payload?.local_version || '-')}</p>
        <div class="updates-meta-list">
          <p><span>Édition</span><strong>${escapeHtml(payload?.local_edition || '-')}</strong></p>
          <p><span>Détectée le</span><strong>${formatDate(payload?.local_detected_at)}</strong></p>
          <p><span>Source locale</span><strong>${escapeHtml(payload?.local_source || '-')}</strong></p>
        </div>
      </article>
      <article class="card updates-kpi-card">
        <h3>Dernière version disponible</h3>
        <p class="updates-main-value">${escapeHtml(payload?.remote_version || '-')}</p>
        <div class="updates-meta-list">
          <p><span>Publiée le</span><strong>${formatDate(payload?.remote_published_at)}</strong></p>
          <p><span>Source retenue</span><strong>${escapeHtml(payload?.source_used || '-')}</strong></p>
        </div>
      </article>
      <article class="card updates-kpi-card">
        <h3>Statut global</h3>
        <div>${gapChip(payload?.version_gap, payload?.update_available)}</div>
        <p class="updates-status-text">${escapeHtml(payload?.version_gap || 'Statut indisponible')}</p>
        ${degraded ? `<p class="updates-warning-inline">Mode dégradé: la source distante est temporairement indisponible.</p>` : ''}
      </article>
    </section>

    <section class="card updates-row">
      <div class="section-header"><h3>Timeline des releases</h3></div>
      <div class="updates-timeline">
        <div class="updates-release-item">
          ${releaseBadge('installed')}
          <strong>${escapeHtml(payload?.local_version || '-')}</strong>
          <span class="muted">Version actuellement installée</span>
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

    <section class="card updates-row">
      <div class="section-header"><h3>Ce que vous gagnez</h3></div>
      <div class="updates-features-grid">
        <article class="updates-feature-card"><h4>Nouveautés utilisateur</h4><ul>${asList(features?.user)}</ul></article>
        <article class="updates-feature-card"><h4>Nouveautés admin</h4><ul>${asList(features?.admin)}</ul></article>
        <article class="updates-feature-card"><h4>Sécurité & performance</h4><ul>${asList(features?.security_performance)}</ul></article>
      </div>
    </section>

    <section class="card updates-row updates-impact-card">
      <div class="section-header"><h3>Impact avant mise à jour</h3></div>
      <div class="updates-impact-grid">
        <div><span>Sauvegarde</span><strong>${escapeHtml(impact?.backup_recommended ? 'Recommandée' : 'Optionnelle')}</strong></div>
        <div><span>Migration</span><strong>${escapeHtml(impact?.migration_potential || 'possible')}</strong></div>
        <div><span>Clear cache</span><strong>${escapeHtml(impact?.clear_cache_recommended ? 'Recommandé' : 'Non requis')}</strong></div>
        <div><span>Post-check</span><strong>${escapeHtml(impact?.healthcheck_post_update ? 'Recommandé' : 'Optionnel')}</strong></div>
        <div><span>Niveau de risque</span><strong>${escapeHtml(impact?.risk_level || 'modéré')}</strong></div>
      </div>
    </section>

    <section class="card updates-row updates-check-card">
      <div class="section-header">
        <h3>Dernière vérification</h3>
        <button id="updatesRefreshNow" class="btn btn-primary" type="button">Vérifier maintenant</button>
      </div>
      <div class="updates-check-grid">
        <div><span>Date</span><strong>${formatDate(payload?.checked_at)}</strong></div>
        <div><span>Source interrogée</span><strong>${escapeHtml(payload?.source_used || '-')}</strong></div>
        <div><span>Statut</span><strong>${escapeHtml(payload?.check_status || '-')}</strong></div>
      </div>
      ${payload?.check_error ? `<p class="updates-warning-inline">${escapeHtml(payload.check_error)}</p>` : ''}
    </section>
  `;

  $('updatesRefreshNow')?.addEventListener('click', async () => {
    try {
      await runRefreshCheck();
    } catch (error) {
      setToast(`Échec de vérification: ${error.message}`, 'error');
      await refreshUpdates();
    }
  });
}

export function renderUpdatesView() {
  const root = $('updatesView');
  if (!root) return;
  root.innerHTML = updatesShell('Visualisez votre version actuelle, la dernière release disponible et les bénéfices concrets d’une mise à jour.');
}

export async function refreshUpdates() {
  const root = $('updatesView');
  if (!root) return;
  if (!$('updatesViewBody')) root.innerHTML = updatesShell();

  try {
    const payload = await apiGet('/api/updates');
    if (!payload || Object.keys(payload).length === 0) throw new Error('Réponse vide de /api/updates');
    renderUpdatePayload(payload);
  } catch (error) {
    const target = $('updatesViewBody');
    if (target) {
      target.innerHTML = `
        <section class="card updates-row">
          ${emptyState('Les données distantes sont indisponibles. La version locale reste affichée dès que détectée.')}
          <p class="updates-warning-inline">Détail: ${escapeHtml(error.message)}</p>
          <button id="updatesRefreshNowFallback" class="btn btn-primary" type="button">Vérifier maintenant</button>
        </section>
      `;
      $('updatesRefreshNowFallback')?.addEventListener('click', async () => {
        try {
          await runRefreshCheck();
        } catch (refreshError) {
          setToast(`Échec de vérification: ${refreshError.message}`, 'error');
        }
      });
    }
    setToast(`Mises à jour indisponibles: ${error.message}`, 'error');
  }
}

export const refreshUpdatesView = refreshUpdates;
