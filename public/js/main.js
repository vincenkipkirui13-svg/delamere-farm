(() => {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      nav.classList.toggle('open', !open);
      document.body.classList.toggle('menu-open', !open);
    });
    nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
      toggle.setAttribute('aria-expanded', 'false');
      nav.classList.remove('open');
      document.body.classList.remove('menu-open');
    }));
  }

  const header = document.getElementById('site-header');
  const updateHeader = () => {
    if (header) header.classList.toggle('scrolled', window.scrollY > 12);
  };
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 }) : null;
  document.querySelectorAll('.reveal').forEach(el => {
    if (observer) observer.observe(el); else el.classList.add('visible');
  });

  const lightbox = document.getElementById('lightbox');
  const lightboxImage = document.getElementById('lightbox-image');
  const close = () => {
    if (!lightbox) return;
    lightbox.classList.remove('open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    if (lightboxImage) lightboxImage.src = '';
  };
  if (lightbox) {
    document.querySelectorAll('[data-lightbox-src]').forEach(button => {
      button.addEventListener('click', () => {
        lightboxImage.src = button.dataset.lightboxSrc;
        lightboxImage.alt = button.dataset.lightboxAlt || '';
        lightbox.classList.add('open');
        lightbox.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
      });
    });
    lightbox.querySelector('.lightbox-close')?.addEventListener('click', close);
    lightbox.addEventListener('click', event => { if (event.target === lightbox) close(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  }
})();
