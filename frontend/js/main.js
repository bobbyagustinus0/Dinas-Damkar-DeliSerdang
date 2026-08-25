// ============ Utilities ============
function formatTanggal(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Gagal memuat ' + url);
  return res.json();
}

function beritaCardHTML(b, { withLink } = { withLink: false }) {
  return `
    <article class="berita-card">
      <div class="berita-meta">
        <span class="tag">${b.kategori}</span>
        <span>${formatTanggal(b.tanggal)}</span>
      </div>
      <h3>${b.judul}</h3>
      <p class="ringkasan">${b.ringkasan}</p>
      <p class="ringkasan" style="font-size:0.85rem;color:var(--muted)">📍 ${b.lokasi}</p>
      ${withLink ? `<p><a href="berita-detail.html?id=${b.id}" class="btn btn-outline" style="padding:8px 16px;font-size:0.78rem;">Baca Detail →</a></p>` : ''}
      <div class="berita-sumber">
        Sumber: ${b.sumber.map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${s.nama}</a>`).join(', ')}
      </div>
    </article>
  `;
}

// ============ Jam Papan Siaga (hanya ada di Beranda) ============
function updateJam() {
  const el = document.getElementById('jamSekarang');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB';
}
setInterval(updateJam, 1000);
updateJam();

// ============ Beranda: teaser 3 berita terbaru ============
async function renderBeritaTeaser() {
  const grid = document.getElementById('beritaTeaser');
  if (!grid) return;
  try {
    const berita = await getJSON('/api/berita');
    grid.innerHTML = berita.slice(0, 3).map((b) => beritaCardHTML(b, { withLink: true })).join('');
  } catch (e) {
    grid.innerHTML = '<p>Gagal memuat berita.</p>';
  }
}

// ============ Halaman Berita: semua berita ============
async function renderBerita() {
  const grid = document.getElementById('beritaGrid');
  if (!grid) return;
  try {
    const berita = await getJSON('/api/berita');
    if (!berita.length) {
      grid.innerHTML = '<p>Belum ada berita.</p>';
      return;
    }
    grid.innerHTML = berita.map((b) => beritaCardHTML(b, { withLink: true })).join('');
  } catch (e) {
    grid.innerHTML = '<p>Gagal memuat berita. Coba muat ulang halaman.</p>';
  }
}

// ============ Halaman Detail Berita ============
async function renderBeritaDetail() {
  const el = document.getElementById('beritaDetail');
  if (!el) return;
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) {
    el.innerHTML = '<p>Berita tidak ditemukan.</p>';
    return;
  }
  try {
    const b = await getJSON('/api/berita/' + encodeURIComponent(id));
    document.title = b.judul + ' | Damkar Deli Serdang';
    el.innerHTML = `
      <div class="berita-meta">
        <span class="tag">${b.kategori}</span>
        <span>${formatTanggal(b.tanggal)}</span>
      </div>
      <h1 style="font-size:1.7rem;text-transform:none;letter-spacing:0;margin:12px 0">${b.judul}</h1>
      <p style="color:var(--muted);font-size:0.9rem;margin-bottom:20px">📍 ${b.lokasi}</p>
      <p style="font-size:1.02rem;line-height:1.7;color:var(--ink-soft)">${b.isi}</p>
      <div class="berita-sumber" style="margin-top:24px">
        Sumber: ${b.sumber.map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${s.nama}</a>`).join(', ')}
      </div>
    `;
  } catch (e) {
    el.innerHTML = '<p>Berita tidak ditemukan atau gagal dimuat.</p>';
  }
}

// ============ Halaman Layanan ============
async function renderLayanan() {
  const kanalList = document.getElementById('kanalList');
  const layananGrid = document.getElementById('layananGrid');
  if (!kanalList && !layananGrid) return;
  try {
    const data = await getJSON('/api/layanan');

    if (kanalList) {
      kanalList.innerHTML = data.kanalDarurat
        .map(
          (k) => `
        <div class="kanal-item">
          <div class="label">${k.label}</div>
          <div class="nilai">${k.url ? `<a href="${k.url}" target="_blank" rel="noopener">${k.nilai}</a>` : k.nilai}</div>
          <div class="ket">${k.keterangan}</div>
        </div>
      `
        )
        .join('');
    }

    if (layananGrid) {
      layananGrid.innerHTML = data.layananUtama
        .map(
          (l) => `
        <div class="service-card">
          <h3>${l.judul}</h3>
          <p>${l.deskripsi}</p>
        </div>
      `
        )
        .join('');
    }
  } catch (e) {
    if (kanalList) kanalList.innerHTML = '<p>Gagal memuat data layanan.</p>';
  }
}

// ============ Halaman Profil ============
async function renderProfil() {
  const el = document.getElementById('profilGrid');
  if (!el) return;
  try {
    const p = await getJSON('/api/profil');
    el.innerHTML = `
      <div>
        <h3 style="text-transform:none;letter-spacing:0;font-size:1.3rem">${p.namaInstansi}</h3>
        <p>${p.tugasPokok}</p>
        <div class="stat-strip">
          <div class="stat"><span class="num">${p.kabupaten.luasWilayah}</span><span class="lbl">Luas Wilayah</span></div>
          <div class="stat"><span class="num">${p.kabupaten.jumlahPenduduk.split(' ').slice(0, 2).join(' ')}</span><span class="lbl">Jumlah Penduduk</span></div>
          <div class="stat"><span class="num">${p.kabupaten.ibuKota}</span><span class="lbl">Ibu Kota Kabupaten</span></div>
        </div>
        <p><strong>Kepala Dinas:</strong> ${p.kepalaDinas.nama}</p>
        <p><strong>Bupati:</strong> ${p.kabupaten.bupati} &nbsp;|&nbsp; <strong>Wakil Bupati:</strong> ${p.kabupaten.wakilBupati}</p>
      </div>
      <div>
        <h3 style="text-transform:none;letter-spacing:0;font-size:1.1rem">${p.gedungBaru.judul}</h3>
        <p style="font-size:0.85rem;color:var(--muted)">Diresmikan ${p.gedungBaru.tanggalDiresmikan} oleh ${p.gedungBaru.diresmikanOleh}</p>
        <p>${p.gedungBaru.deskripsi}</p>
        <div class="note-box">${p.catatanData}</div>
        <div class="source-list">
          Sumber: ${p.gedungBaru.sumber.map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${s.nama}</a>`).join(', ')}
        </div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = '<p>Gagal memuat profil.</p>';
  }
}

// ============ Halaman Program ============
async function renderProgram() {
  const el = document.getElementById('programGrid');
  if (!el) return;
  try {
    const program = await getJSON('/api/program');
    el.innerHTML = program
      .map(
        (p) => `
      <div class="service-card">
        <h3>${p.judul}</h3>
        <p>${p.deskripsi}</p>
        <p style="margin-top:8px"><span class="berita-meta"><span class="tag">${p.status}</span></span></p>
      </div>
    `
      )
      .join('');
  } catch (e) {
    el.innerHTML = '<p>Gagal memuat program.</p>';
  }
}

// ============ Halaman Pengaduan: form ============
function initFormPengaduan() {
  const formPengaduan = document.getElementById('formPengaduan');
  const formMsg = document.getElementById('formMsg');
  if (!formPengaduan) return;

  formPengaduan.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      nama: document.getElementById('nama').value.trim(),
      kontak: document.getElementById('kontak').value.trim(),
      kategori: document.getElementById('kategori').value,
      lokasi: document.getElementById('lokasi').value.trim(),
      isi: document.getElementById('isi').value.trim(),
    };

    formMsg.className = 'form-msg show';
    formMsg.textContent = 'Mengirim laporan…';

    try {
      const res = await fetch('/api/pengaduan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengirim laporan');

      formMsg.textContent = `Laporan berhasil dikirim. Nomor tiket: ${data.data.id}. Untuk kejadian darurat, tetap hubungi 112.`;
      formMsg.className = 'form-msg show ok';
      formPengaduan.reset();
    } catch (err) {
      formMsg.textContent = err.message || 'Terjadi kesalahan. Silakan coba lagi atau hubungi 112 langsung.';
      formMsg.className = 'form-msg show err';
    }
  });
}

// ============ Init semua fungsi (yang tidak relevan akan langsung berhenti karena elemennya tidak ada) ============
renderBeritaTeaser();
renderBerita();
renderBeritaDetail();
renderLayanan();
renderProfil();
renderProgram();
initFormPengaduan();
