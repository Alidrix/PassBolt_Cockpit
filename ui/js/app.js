import { state, setTheme } from './state.js';
import { $, setToast } from './utils.js';
import { renderDashboardView, refreshDashboard } from './views/dashboard.js';
import { renderImporterView } from './views/importer.js';
import { renderDeletionsView, refreshDeleteConfig } from './views/deletions.js';
import { renderLogsView, refreshLogs } from './views/logs.js';
import { renderPassboltHealthView, refreshPassboltHealth } from './views/passbolt-health.js';
import { renderUpdatesView, refreshUpdatesView } from './views/updates.js';
import {
  renderJobsBatchView,
  refreshJobsBatchView,
  renderGroupsView,
  refreshGroupsView,
  renderAlertsView,
  refreshAlertsView,
  renderConfigOpsView,
  refreshConfigOpsView
} from './views/ops-pages.js';

const viewRegistry = {
  dashboardView: { render: renderDashboardView, refresh: refreshDashboard },
  importerView: { render: renderImporterView },
  groupsView: { render: renderGroupsView, refresh: refreshGroupsView },
  deletionsView: { render: renderDeletionsView, refresh: refreshDeleteConfig },
  jobsBatchView: { render: renderJobsBatchView, refresh: refreshJobsBatchView },
  alertsView: { render: renderAlertsView, refresh: refreshAlertsView },
  passboltHealthView: { render: renderPassboltHealthView, refresh: refreshPassboltHealth },
  updatesView: { render: renderUpdatesView, refresh: refreshUpdatesView },
  logsAuditView: { render: renderLogsView, refresh: refreshLogs },
  configOpsView: { render: renderConfigOpsView, refresh: refreshConfigOpsView }
};

function appendViewError(viewId, message) {
  const section = $(viewId);
  if (!section) return;
  section.innerHTML = `
    <section class="card">
      <div class="section-header"><h3>Erreur de vue</h3></div>
      <p class="muted">La vue <strong>${viewId}</strong> n'a pas pu être chargée.</p>
      <pre class="console">${String(message || 'Erreur inconnue')}</pre>
    </section>
  `;
}

function refreshActiveView() {
  const runner = viewRegistry[state.view]?.refresh;
  return runner ? runner() : Promise.resolve();
}

function switchView(viewId) {
  console.info(`view switch -> ${viewId}`);
  if (!viewRegistry[viewId]) {
    const message = `Navigation impossible: la vue '${viewId}' est absente du registre.`;
    console.error(message);
    setToast(message, 'error');
    return;
  }

  const section = $(viewId);
  if (!section) {
    const message = `Navigation impossible: section DOM #${viewId} introuvable.`;
    console.error(message);
    setToast(message, 'error');
    return;
  }

  state.view = viewId;
  document.querySelectorAll('.menu-item').forEach((a) => a.classList.toggle('active', a.dataset.view === viewId));
  document.querySelectorAll('.view-section').forEach((v) => v.classList.toggle('active-view', v.id === viewId));

  refreshByView[viewId]?.().catch((error) => {
    const message = `Refresh '${viewId}' en échec: ${error.message}`;
    console.error(message, error);
    appendViewError(viewId, message);
    setToast(message, 'error');
  });
}

function initThemeToggle() {
  const toggle = $('themeToggle');
  if (!toggle) return;
  const updateLabel = () => {
    toggle.textContent = state.theme === 'light' ? '🌙' : '☀️';
    toggle.title = state.theme === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair';
  };
  updateLabel();
  toggle.addEventListener('click', () => {
    const next = state.theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    updateLabel();
  });
}

const refreshByView = Object.fromEntries(
  Object.entries(viewRegistry)
    .filter(([, cfg]) => typeof cfg.refresh === 'function')
    .map(([viewId, cfg]) => [viewId, cfg.refresh])
);

function validateNavigationWiring() {
  const menuItems = [...document.querySelectorAll('.menu-item')];
  menuItems.forEach((item) => {
    const viewId = item.dataset.view;
    if (!viewId) {
      console.error('Menu item sans data-view détecté.', item);
      return;
    }
    if (!viewRegistry[viewId]) {
      console.error(`Menu item invalide: '${viewId}' absent du registre.`);
      return;
    }
    if (!$(viewId)) {
      console.error(`Menu item invalide: section DOM manquante pour '${viewId}'.`);
    }
  });

  Object.keys(viewRegistry).forEach((viewId) => {
    if (!$(viewId)) {
      console.error(`Vue enregistrée sans section DOM: '${viewId}'.`);
    }
  });
}

function renderLayout() {
  console.info('renderLayout started');
  Object.entries(viewRegistry).forEach(([viewId, cfg]) => {
    try {
      cfg.render();
    } catch (error) {
      const message = `Render '${viewId}' en échec: ${error.message}`;
      console.error(message, error);
      appendViewError(viewId, message);
      setToast(message, 'error');
    }
  });
  console.info('renderLayout done');
}

function init() {
  renderLayout();
  validateNavigationWiring();
  initThemeToggle();

  document.querySelectorAll('.menu-item').forEach((item) => item.addEventListener('click', (e) => {
    e.preventDefault();
    switchView(item.dataset.view);
  }));

  $('globalRefresh')?.addEventListener('click', () => {
    refreshActiveView().then(() => setToast('Vue actualisée.', 'info')).catch((e) => setToast(e.message, 'error'));
  });

  Promise.allSettled(Object.values(refreshByView).map((runner) => runner()))
    .then((results) => {
      results.forEach((result) => {
        if (result.status === 'rejected') {
          console.error('Erreur de refresh initial:', result.reason);
        }
      });
    });
}

init();
