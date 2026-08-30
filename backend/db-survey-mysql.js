// ============================================================
// KONEKSI MYSQL BERSAMA (database sama dengan E-Survey)
// ============================================================
// Dipakai khusus untuk data survei (dinas_survey_cache & dinas_survey_jawaban).
// Data lain milik Damkar sendiri (berita, layanan, dst) TETAP di file JSON
// seperti sebelumnya -- yang dipusatkan ke MySQL hanya bagian survei, sesuai
// permintaan: "1 database MySQL yang sama" untuk integrasi E-Survey.
//
// Koneksi antar sistem (E-Survey <-> Damkar) tetap lewat API/webhook seperti
// biasa; MySQL di sini hanya dipakai sebagai tempat Damkar menyimpan cache-nya
// sendiri (bukan diakses langsung oleh Laravel, dan Damkar juga tidak
// membaca/menulis tabel milik Laravel).

const mysql = require('mysql2/promise');

const SUMBER_DINAS = 'damkar';

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_DATABASE || 'db_survey_deliserdang22',
  user: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 5,
  namedPlaceholders: true,
});

// Membuat tabel dinas_survey_cache & dinas_survey_jawaban kalau belum ada
// (idempotent, aman dipanggil setiap kali server start). Definisi tabel
// yang sama juga ada di e-survey-deliserdang31/docs/sql/dinas_survey_shared_tables.sql
// (dokumentasi referensi) -- di-inline di sini supaya repo Damkar berdiri sendiri
// tanpa perlu file dari repo lain.
const DDL_CACHE = `
CREATE TABLE IF NOT EXISTS dinas_survey_cache (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sumber_dinas VARCHAR(30) NOT NULL COMMENT 'dinsos | damkar | disparbud',
  kode_survei VARCHAR(100) NOT NULL,
  judul_survei VARCHAR(255) NOT NULL,
  status VARCHAR(20) NULL,
  payload_json JSON NOT NULL,
  diterima_pada DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  diperbarui_pada DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dinas_kode (sumber_dinas, kode_survei)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const DDL_JAWABAN = `
CREATE TABLE IF NOT EXISTS dinas_survey_jawaban (
  id CHAR(36) NOT NULL PRIMARY KEY,
  sumber_dinas VARCHAR(30) NOT NULL COMMENT 'dinsos | damkar | disparbud',
  kode_survei VARCHAR(100) NOT NULL,
  judul_survei VARCHAR(255) NULL,
  nama_responden VARCHAR(150) NULL,
  email VARCHAR(150) NULL,
  no_hp VARCHAR(30) NULL,
  data_tambahan_json JSON NULL,
  jawaban_json JSON NOT NULL,
  waktu DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status_kirim_esurvey VARCHAR(20) NOT NULL DEFAULT 'belum_dikirim',
  esurvey_response_json JSON NULL,
  KEY idx_dinas_kode (sumber_dinas, kode_survei)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

async function ensureTables() {
  const conn = await pool.getConnection();
  try {
    await conn.query(DDL_CACHE);
    await conn.query(DDL_JAWABAN);
  } finally {
    conn.release();
  }
}

async function simpanSurvei(survey) {
  await pool.execute(
    `INSERT INTO dinas_survey_cache (sumber_dinas, kode_survei, judul_survei, status, payload_json)
     VALUES (:sumber_dinas, :kode_survei, :judul_survei, :status, :payload_json)
     ON DUPLICATE KEY UPDATE
       judul_survei = VALUES(judul_survei),
       status = VALUES(status),
       payload_json = VALUES(payload_json),
       diperbarui_pada = CURRENT_TIMESTAMP`,
    {
      sumber_dinas: SUMBER_DINAS,
      kode_survei: survey.kode_survei,
      judul_survei: survey.judul_survei,
      status: survey.status || null,
      payload_json: JSON.stringify(survey),
    }
  );
}

async function ambilSemuaSurvei() {
  const [rows] = await pool.execute(
    'SELECT payload_json, diterima_pada FROM dinas_survey_cache WHERE sumber_dinas = :sumber_dinas ORDER BY diperbarui_pada DESC',
    { sumber_dinas: SUMBER_DINAS }
  );
  return rows.map((r) => ({ ...JSON.parse(r.payload_json), diterima_damkar: r.diterima_pada }));
}

async function ambilSurveiByKode(kode) {
  const [rows] = await pool.execute(
    'SELECT payload_json, diterima_pada FROM dinas_survey_cache WHERE sumber_dinas = :sumber_dinas AND kode_survei = :kode_survei LIMIT 1',
    { sumber_dinas: SUMBER_DINAS, kode_survei: kode }
  );
  if (rows.length === 0) return null;
  return { ...JSON.parse(rows[0].payload_json), diterima_damkar: rows[0].diterima_pada };
}

async function simpanJawaban(id, kodeSurvei, judulSurvei, data) {
  await pool.execute(
    `INSERT INTO dinas_survey_jawaban
       (id, sumber_dinas, kode_survei, judul_survei, nama_responden, email, no_hp, data_tambahan_json, jawaban_json, status_kirim_esurvey)
     VALUES
       (:id, :sumber_dinas, :kode_survei, :judul_survei, :nama_responden, :email, :no_hp, :data_tambahan_json, :jawaban_json, 'belum_dikirim')`,
    {
      id,
      sumber_dinas: SUMBER_DINAS,
      kode_survei: kodeSurvei,
      judul_survei: judulSurvei || null,
      nama_responden: data.nama_responden || null,
      email: data.email || null,
      no_hp: data.no_hp || null,
      data_tambahan_json: JSON.stringify(data.data_tambahan || {}),
      jawaban_json: JSON.stringify(data.jawaban),
    }
  );
}

async function updateStatusKirim(id, status, esurveyResponse) {
  await pool.execute(
    `UPDATE dinas_survey_jawaban SET status_kirim_esurvey = :status, esurvey_response_json = :resp WHERE id = :id`,
    { id, status, resp: JSON.stringify(esurveyResponse ?? null) }
  );
}

async function ambilJawabanByKode(kode) {
  const [rows] = await pool.execute(
    'SELECT * FROM dinas_survey_jawaban WHERE sumber_dinas = :sumber_dinas AND kode_survei = :kode_survei ORDER BY waktu DESC',
    { sumber_dinas: SUMBER_DINAS, kode_survei: kode }
  );
  return rows.map((r) => ({
    id: r.id,
    kode_survei: r.kode_survei,
    judul_survei: r.judul_survei,
    nama_responden: r.nama_responden,
    email: r.email,
    no_hp: r.no_hp,
    data_tambahan: r.data_tambahan_json ? JSON.parse(r.data_tambahan_json) : {},
    jawaban: JSON.parse(r.jawaban_json),
    waktu: r.waktu,
    status_kirim_esurvey: r.status_kirim_esurvey,
    esurvey_response: r.esurvey_response_json ? JSON.parse(r.esurvey_response_json) : null,
  }));
}

module.exports = {
  pool,
  ensureTables,
  simpanSurvei,
  ambilSemuaSurvei,
  ambilSurveiByKode,
  simpanJawaban,
  updateStatusKirim,
  ambilJawabanByKode,
};
