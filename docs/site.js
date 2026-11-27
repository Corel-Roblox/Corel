// Corel website: reveal-on-scroll, screenshot tabs, latest release info, swatch copy.
(() => {
  const reveal = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px' });
    reveal.forEach((el) => io.observe(el));
  } else reveal.forEach((el) => el.classList.add('in'));

  const tabs = document.querySelectorAll('.tab[data-shot]');
  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    document.querySelectorAll('.gallery img').forEach((img) => img.classList.toggle('on', img.dataset.shot === t.dataset.shot));
  }));

  document.querySelectorAll('.sw[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      const s = b.querySelector('span');
      const old = s.textContent;
      s.textContent = 'Copied';
      setTimeout(() => (s.textContent = old), 1200);
    } catch {}
  }));

  // Show the real latest version and file size.
  fetch('https://api.github.com/repos/Corel-Roblox/Corel/releases/latest')
    .then((r) => (r.ok ? r.json() : null))
    .then((rel) => {
      if (!rel) return;
      const v = String(rel.tag_name || '').replace(/^v/, '');
      const asset = (rel.assets || []).find((a) => /^corel\.exe$/i.test(a.name));
      if (v) document.querySelectorAll('.js-version').forEach((el) => (el.textContent = v));
      if (asset) {
        document.querySelectorAll('.js-size').forEach((el) => (el.textContent = `${Math.round(asset.size / 1048576)} MB`));
        document.querySelectorAll('.js-download').forEach((el) => (el.href = asset.browser_download_url));
      }
    })
    .catch(() => {});
})();
