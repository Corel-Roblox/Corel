// Roicon site: scroll reveals, nav state, the countdown showcase and card spotlights.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Reveal elements as they scroll into view.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal, .shot').forEach((el) => io.observe(el));

  // Nav gets a border once the page scrolls.
  const nav = document.querySelector('nav.top');
  const onScroll = () => nav && nav.classList.toggle('scrolled', scrollY > 10);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Card spotlight follows the pointer.
  document.querySelectorAll('.card').forEach((c) => {
    c.addEventListener('pointermove', (ev) => {
      const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', `${ev.clientX - r.left}px`);
      c.style.setProperty('--my', `${ev.clientY - r.top}px`);
    });
  });

  // Countdown showcase: 12h -> 6h -> 3h -> 1h -> live, looping.
  const stack = document.getElementById('stack');
  if (stack) {
    const imgs = [...stack.querySelectorAll('img')];
    const badge = document.getElementById('badge');
    const items = [...document.querySelectorAll('#line li')];
    const fill = document.getElementById('fill');
    const labels = ['12 hours', '6 hours', '3 hours', '1 hour', 'Live now'];
    let i = 0;
    let timer = null;
    const show = (n) => {
      i = n;
      imgs.forEach((im, k) => im.classList.toggle('on', k === n));
      badge.textContent = labels[n];
      badge.classList.toggle('live', n === imgs.length - 1);
      items.forEach((li, k) => {
        li.classList.toggle('done', k < n);
        li.classList.toggle('cur', k === n);
      });
      const cur = items[n];
      if (cur && fill) {
        const top = items[0].offsetTop + items[0].offsetHeight / 2;
        fill.style.top = `${top}px`;
        fill.style.height = `${cur.offsetTop + cur.offsetHeight / 2 - top}px`;
      }
    };
    const loop = () => {
      clearInterval(timer);
      if (!reduce) timer = setInterval(() => show((i + 1) % imgs.length), i === imgs.length - 1 ? 2600 : 1900);
    };
    items.forEach((li, k) => li.addEventListener('click', () => { show(k); loop(); }));
    show(0);
    loop();
    addEventListener('resize', () => show(i));
  }

  // Show the latest version number in the hero pill.
  fetch('https://api.github.com/repos/jakedev2/Roicon/releases/latest')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const v = j && j.tag_name;
      const el = document.getElementById('ver');
      if (v && el) el.textContent = v;
    })
    .catch(() => {});
})();
