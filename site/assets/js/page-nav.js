// Long pages (setup guide, tune pages): a thin progress bar at the top and the current section marked in "On this page".
const bar = document.createElement('div');
bar.className = 'read-progress';
bar.setAttribute('aria-hidden', 'true');
bar.innerHTML = '<div class="read-progress-fill"></div>';
document.body.prepend(bar);
const fill = bar.firstChild;

let queued = false;
function update() {
  queued = false;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const pct = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
  fill.style.width = `${pct}%`;
  bar.classList.toggle('on', window.scrollY > 100);
}
const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
addEventListener('scroll', queue, { passive: true });
addEventListener('resize', queue);
update();

const links = [...document.querySelectorAll('.guide-toc a[href^="#"]')];
const sections = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
if (sections.length && 'IntersectionObserver' in window) {
  const seen = new Set();
  const mark = () => {
    const current = sections.find((s) => seen.has(s)) || null; // the first section on screen, in page order
    for (const a of links) {
      const on = current && a.getAttribute('href') === `#${current.id}`;
      a.classList.toggle('is-current', !!on);
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    }
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) { if (e.isIntersecting) seen.add(e.target); else seen.delete(e.target); }
    mark();
  }, { rootMargin: '-10% 0px -60% 0px' });
  sections.forEach((s) => io.observe(s));
}
