import { escapeHtml } from '../utils.js';

export const kpiCard = (label, value, trend = '') => `
  <article class="kpi-card">
    <p class="label text-ellipsis">${escapeHtml(label)}</p>
    <div class="value text-break">${escapeHtml(value)}</div>
    ${trend ? `<p class="trend text-ellipsis">${escapeHtml(trend)}</p>` : ''}
  </article>
`;
