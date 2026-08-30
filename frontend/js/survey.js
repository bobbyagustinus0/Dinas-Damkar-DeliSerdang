// ============================================================
// POP UP SURVEI (Integrasi E-Survey Deli Serdang)
// ============================================================
// Alur:
// 1. E-Survey mem-push survei ke POST /api/survey (backend), tersimpan di survey.json.
//    Payload survei berisi juga objek "popup" (tampil_setelah_detik, frekuensi,
//    jam_mulai, jam_selesai) yang mengatur KAPAN pop up ini boleh muncul.
// 2. Saat pengunjung membuka halaman, kita ambil GET /api/survey, cari survei aktif
//    yang jadwalnya (tanggal, jam, frekuensi per-pengunjung) sedang berlaku.
// 3. Saat pengunjung submit, jawaban dikirim ke POST /api/survey/:kode/jawaban,
//    lalu diteruskan backend sebagai webhook ke E-Survey.

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function surveyStorageKey(kode, kind) {
  return `survey:${kind}:${kode}`;
}

function isSurveyActive(survey) {
  if (survey.status && survey.status !== 'aktif') return false;
  const now = new Date();
  if (survey.tanggal_mulai && now < new Date(survey.tanggal_mulai)) return false;
  if (survey.tanggal_selesai) {
    const end = new Date(survey.tanggal_selesai);
    end.setHours(23, 59, 59, 999);
    if (now > end) return false;
  }
  return true;
}

function isWithinPopupJamTayang(popup) {
  if (!popup) return true;
  const { jam_mulai, jam_selesai } = popup;
  if (!jam_mulai && !jam_selesai) return true;

  const now = new Date();
  const menitSekarang = now.getHours() * 60 + now.getMinutes();
  const keMenit = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + (m || 0);
  };

  const mulai = jam_mulai ? keMenit(jam_mulai) : 0;
  const selesai = jam_selesai ? keMenit(jam_selesai) : 24 * 60 - 1;
  return menitSekarang >= mulai && menitSekarang <= selesai;
}

function isPopupDiizinkanTampil(survey) {
  const kode = survey.kode_survei;
  const frekuensi = survey.popup?.frekuensi || 'sekali_per_sesi';

  if (localStorage.getItem(surveyStorageKey(kode, 'done'))) return false;

  if (frekuensi === 'setiap_kunjungan') return true;
  if (frekuensi === 'sekali_per_sesi') return !sessionStorage.getItem(surveyStorageKey(kode, 'dismissed'));
  if (frekuensi === 'sekali_per_hari') {
    const terakhir = localStorage.getItem(surveyStorageKey(kode, 'dismissed_at'));
    if (!terakhir) return true;
    return Date.now() - Number(terakhir) >= 24 * 60 * 60 * 1000;
  }
  if (frekuensi === 'sekali_selamanya') return !localStorage.getItem(surveyStorageKey(kode, 'dismissed_forever'));
  return true;
}

function tandaiPopupDitutup(survey) {
  const kode = survey.kode_survei;
  const frekuensi = survey.popup?.frekuensi || 'sekali_per_sesi';

  if (frekuensi === 'sekali_per_sesi') sessionStorage.setItem(surveyStorageKey(kode, 'dismissed'), '1');
  else if (frekuensi === 'sekali_per_hari') localStorage.setItem(surveyStorageKey(kode, 'dismissed_at'), String(Date.now()));
  else if (frekuensi === 'sekali_selamanya') localStorage.setItem(surveyStorageKey(kode, 'dismissed_forever'), '1');
}

function surveyModal() { return document.getElementById('surveyModal'); }

function openSurveyModal() {
  const modal = surveyModal();
  if (!modal) return;
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeSurveyModal() {
  const modal = surveyModal();
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function renderSurveyQuestion(q) {
  const nama = `q_${q.id}`;
  const tipe = q.tipe_jawaban;

  if (tipe === 'skala_ikm') {
    return `
      <div class="survey-question">
        <span>${escapeHtml(q.pertanyaan)}</span>
        <div class="survey-scale">
          ${[1, 2, 3, 4].map((o) => `
            <label><input type="radio" name="${nama}" value="${o}" ${q.wajib_diisi ? 'required' : ''} />${o}</label>`).join('')}
        </div>
      </div>`;
  }

  if (tipe === 'rating_bintang') {
    return `
      <div class="survey-question">
        <span>${escapeHtml(q.pertanyaan)}</span>
        <div class="survey-scale">
          ${[1, 2, 3, 4, 5].map((o) => `
            <label><input type="radio" name="${nama}" value="${o}" ${q.wajib_diisi ? 'required' : ''} />${'★'.repeat(o)}</label>`).join('')}
        </div>
      </div>`;
  }

  if (tipe === 'pilihan_ganda') {
    const opsi = q.opsi_jawaban || [];
    return `
      <div class="survey-question">
        <span>${escapeHtml(q.pertanyaan)}</span>
        <div class="survey-choice">
          ${opsi.map((o) => `
            <label><input type="radio" name="${nama}" value="${escapeHtml(String(o))}" ${q.wajib_diisi ? 'required' : ''} />${escapeHtml(String(o))}</label>`).join('')}
        </div>
      </div>`;
  }

  return `
    <div class="survey-question">
      <span>${escapeHtml(q.pertanyaan)}</span>
      <textarea name="${nama}" rows="3" placeholder="Tulis jawaban Anda…" ${q.wajib_diisi ? 'required' : ''}></textarea>
    </div>`;
}

function renderSurveyForm(survey) {
  const pertanyaan = survey.pertanyaan || [];
  return `
    <span class="survey-modal-eyebrow">Survei Kepuasan Layanan</span>
    <h2 id="surveyModalTitle">${escapeHtml(survey.judul_survei)}</h2>
    ${survey.deskripsi ? `<p class="survey-modal-desc">${escapeHtml(survey.deskripsi)}</p>` : ''}
    <form id="surveyForm" novalidate>
      <label class="survey-field">
        <span>Nama (opsional)</span>
        <input type="text" name="nama_responden" maxlength="100" placeholder="Nama Anda" />
      </label>
      ${pertanyaan.map(renderSurveyQuestion).join('')}
      <div class="survey-modal-footer">
        <button type="button" class="btn btn-outline" data-survey-close>Nanti Saja</button>
        <button type="submit" class="btn btn-primary">Kirim Jawaban</button>
      </div>
      <div class="survey-form-result" id="surveyFormResult" aria-live="polite"></div>
    </form>`;
}

function bindSurveyForm(survey) {
  const form = document.getElementById('surveyForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const jawaban = {};
    (survey.pertanyaan || []).forEach((q) => {
      const v = fd.get(`q_${q.id}`);
      if (v !== null && v !== '') jawaban[q.id] = v;
    });

    if (Object.keys(jawaban).length === 0) {
      document.getElementById('surveyFormResult').innerHTML =
        '<div class="survey-form-result is-error">Mohon isi minimal satu pertanyaan.</div>';
      return;
    }

    try {
      const res = await fetch(`/api/survey/${encodeURIComponent(survey.kode_survei)}/jawaban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nama_responden: fd.get('nama_responden') || null, jawaban }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.message || 'Gagal mengirim jawaban.');

      localStorage.setItem(surveyStorageKey(survey.kode_survei, 'done'), '1');
      document.getElementById('surveyModalBody').innerHTML = `
        <span class="survey-modal-eyebrow">Terima kasih 🙏</span>
        <h2>Jawaban Anda sudah terkirim</h2>
        <p class="survey-modal-desc">Masukan Anda sangat berarti bagi peningkatan layanan Damkar Deli Serdang.</p>
        <div class="survey-modal-footer">
          <button type="button" class="btn btn-primary" data-survey-close>Tutup</button>
        </div>`;
    } catch (err) {
      document.getElementById('surveyFormResult').innerHTML =
        `<div class="survey-form-result is-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

async function initSurveyPopup() {
  const modal = surveyModal();
  if (!modal) return;

  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-survey-close]')) closeSurveyModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeSurveyModal();
  });

  try {
    const res = await fetch('/api/survey');
    const { data } = await res.json();
    const survey = (data || []).find(
      (s) => isSurveyActive(s) && isWithinPopupJamTayang(s.popup) && isPopupDiizinkanTampil(s)
    );
    if (!survey) return;

    document.getElementById('surveyModalBody').innerHTML = renderSurveyForm(survey);
    bindSurveyForm(survey);

    modal.querySelectorAll('[data-survey-close]').forEach((btn) => {
      btn.addEventListener('click', () => tandaiPopupDitutup(survey), { once: true });
    });

    const jedaDetik = Number.isFinite(survey.popup?.tampil_setelah_detik) ? survey.popup.tampil_setelah_detik : 3;
    setTimeout(openSurveyModal, Math.max(0, jedaDetik) * 1000);
  } catch {
    // Belum ada survei aktif / gagal memuat — diam saja, tidak ganggu pengunjung.
  }
}

// Modal disisipkan lewat partials/footer.html (loadPartial di layout.js), jadi
// tunggu event "layout:ready" dulu sebelum mencari elemennya di DOM.
document.addEventListener('layout:ready', initSurveyPopup);
