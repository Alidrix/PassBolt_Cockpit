import { escapeHtml } from '../utils.js';

export const dangerZone = (title, description, actionHtml) => `
  <section class="card danger-zone">
    <div class="section-header">
      <h3>${escapeHtml(title)}</h3>
      <span class="status-chip status-danger"><span class="dot"></span><span>Sensible</span></span>
    </div>
    <p class="muted line-clamp-3 text-break">${escapeHtml(description)}</p>
    <div class="mt-3">${actionHtml}</div>
  </section>
`;
