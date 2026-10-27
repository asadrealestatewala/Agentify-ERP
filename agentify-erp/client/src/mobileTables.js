// Phones show wide tables as stacked cards (see mobile.css). The card layout needs each cell to know its column title,
// so this copies the header text onto every cell as `data-label`, for every table that renders now or later.
function label(table) {
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  if (!heads.length) return;
  table.classList.add('t-stack');
  table.querySelectorAll('tbody tr, tfoot tr').forEach((tr) => {
    let col = 0;
    [...tr.children].forEach((td) => {
      if (td.tagName !== 'TD') return;
      if (td.colSpan > 1) { td.setAttribute('data-wide', ''); col += td.colSpan; return; }
      const h = heads[col] || '';
      if (td.getAttribute('data-label') !== h) td.setAttribute('data-label', h);
      col += 1;
    });
  });
}

let timer = null;
function scan() { timer = null; document.querySelectorAll('table.t').forEach(label); }

export function watchTables() {
  if (typeof window === 'undefined' || !window.matchMedia || window.__tablesWatched) return;
  window.__tablesWatched = true;
  const mq = window.matchMedia('(max-width: 700px)');
  const observer = new MutationObserver(() => { if (mq.matches && !timer) timer = setTimeout(scan, 60); });
  observer.observe(document.body, { childList: true, subtree: true });
  mq.addEventListener?.('change', () => { if (mq.matches) scan(); });
  if (mq.matches) scan();
}
