export function appendConsoleLine(id, line) {
  const el = document.getElementById(id);
  if (!el) return;
  const timestamp = new Date().toLocaleTimeString('fr-FR');
  el.textContent += `[${timestamp}] ${line}\n`;
  el.scrollTop = el.scrollHeight;
}
