import { escapeHtml } from '../utils.js';

export function renderStepper(containerId, stages, active) {
  const current = stages.indexOf(active);
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = stages.map((stage, index) => {
    const cls = index < current ? 'done' : index === current ? 'active' : '';
    return `<div class="step ${cls}">${escapeHtml(stage)}</div>`;
  }).join('');
}
