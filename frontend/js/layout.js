// Menyisipkan header & footer yang sama ke semua halaman,
// supaya menu navigasi konsisten dan berpindah HALAMAN (bukan cuma scroll).
async function loadPartial(url, targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  try {
    const res = await fetch(url);
    target.innerHTML = await res.text();
  } catch (e) {
    console.error('Gagal memuat', url, e);
  }
}

function setActiveNav() {
  const current = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('nav.main-nav a[data-page]').forEach((a) => {
    if (a.dataset.page === current) {
      a.setAttribute('aria-current', 'page');
      a.style.background = 'var(--ink)';
      a.style.color = 'var(--paper-text)';
    }
  });
}

function initMenuToggle() {
  const menuToggle = document.getElementById('menuToggle');
  const mainNav = document.getElementById('mainNav');
  if (!menuToggle || !mainNav) return;
  menuToggle.addEventListener('click', () => {
    const isOpen = mainNav.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
}

async function initLayout() {
  await loadPartial('partials/header.html', 'site-header-placeholder');
  await loadPartial('partials/footer.html', 'site-footer-placeholder');
  setActiveNav();
  initMenuToggle();
  registerServiceWorker();
  document.dispatchEvent(new Event('layout:ready'));
}

// Daftarkan service worker supaya situs bisa "Install" jadi app di HP.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch((err) => {
    console.warn('Service worker gagal didaftarkan:', err);
  });
}

initLayout();
