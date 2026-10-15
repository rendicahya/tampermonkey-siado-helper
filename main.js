// ==UserScript==
// @name         SIADO - Auto Presensi Helper
// @namespace    siado-presensi-helper
// @version      1.36
// @description  Semi-otomatisasi alur input Sub Capaian Pembelajaran & Presensi Mahasiswa di SIADO UB: deteksi kelas Tatap Muka yang sedang berlangsung, buka form presensi, lalu isi otomatis "Batas Presensi Mahasiswa" (jam mulai + 30 menit) dan "Keterangan" (Luring). Dosen tinggal mengisi Sub Capaian Pembelajaran lalu klik Simpan.
// @match        https://siado.ub.ac.id/dosen/akademik/jadwal*
// @match        https://siado.ub.ac.id//dosen/akademik/jadwal*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  // ====================== KONFIGURASI ======================
  // Ubah angka-angka ini sesuai kebiasaan Anda.
  const BATAS_PRESENSI_MENIT = 30;    // Batas presensi = jam mulai kuliah + sekian menit
  const TOLERANSI_SEBELUM_MENIT = 15; // Tombol "Ajar Sekarang" akan mengenali kelas mulai sekian menit SEBELUM jam mulai
  const KETERANGAN_DEFAULT = 'Luring';
  const TIPE_PERTEMUAN_DIIZINKAN = ['Tatap Muka']; // hanya kelas dengan Tipe Pertemuan ini yang akan dipertimbangkan oleh "Ajar Sekarang"

  // Kolom pada tabel jadwal (#tabelku) yang ingin disembunyikan.
  // Cocokkan berdasarkan teks header (tanpa spasi, tanpa memandang huruf besar/kecil).
  // Catatan: kolom yang disembunyikan tetap ada di halaman (hanya tidak tampak), jadi
  // "Program Studi" tetap dibaca untuk kode prodi di kolom KELAS, dan "Tipe Pertemuan"
  // tetap dibaca untuk awalan "(P)" & pewarnaan baris.
  const KOLOM_DISEMBUNYIKAN = ['Kode MK', 'Tahun', 'Tim Pengajar', 'Gedung Kuliah', 'SKS Kelas', 'Fakultas', 'Jurusan', 'Seleksi', 'Jadwal', 'Ketua', 'Program Studi', 'Tipe Pertemuan'];

  // Kolom yang ingin dipindah posisinya. Setiap entri: pindahkan "kolom" ke tepat
  // setelah kolom "keSetelah" (dicocokkan berdasarkan teks header, tanpa spasi/besar-kecil).
  // Catatan: gunakan judul ASLI dari SIADO (mis. 'KLS'), bukan judul hasil rename.
  const KOLOM_DIPINDAH = [
    { kolom: 'Program Studi', keSetelah: 'Nama' },
    { kolom: 'KLS', keSetelah: 'Program Studi' },
  ];

  // Ganti judul kolom: { 'judul asli dari SIADO': 'judul baru' }.
  // Isi sel kolom "KLS" juga diberi awalan kode program studi, mis. "E" -> "TIF (E)".
  const KOLOM_RENAME = {
    'KLS': 'KELAS',
    'Jumlah Peserta': 'JUMLAH MAHASISWA',
  };

  // Sembunyikan tombol-tombol yang berada di bawah tabel jadwal (dalam panel yang sama).
  // Tombol hanya disembunyikan (display:none), tidak dihapus, sehingga fungsi "Ajar Sekarang"
  // yang memanggilnya di balik layar tetap berjalan. Ubah ke false untuk menampilkannya lagi.
  const SEMBUNYIKAN_TOMBOL_BAWAH_TABEL = true;

  // Toolbar paling atas (yang ada logo SIADO) tidak lagi menempel (sticky/fixed) saat halaman
  // digulir, tetapi ikut tergulung ke atas. Ubah ke false untuk mengembalikan perilaku aslinya.
  const TOOLBAR_TIDAK_STICKY = true;

  // Sembunyikan bar di bawah tabel yang berisi "Showing 1 to xx of xx entries"
  // (beserta navigasi halaman di bar yang sama, yang tidak terpakai bila "Show entries" = All).
  const SEMBUNYIKAN_INFO_ENTRIES = true;

  // Sembunyikan bar di atas tabel yang berisi kotak "Search" (beserta "Show xx entries" di
  // bar yang sama). Pilihan "Show entries" tetap ada di halaman (hanya tidak tampak), jadi
  // AUTO_SHOW_ALL_ENTRIES tetap bisa mengubahnya ke "All".
  const SEMBUNYIKAN_BAR_SEARCH = true;

  // Sembunyikan footer halaman (<div id="footer">).
  const SEMBUNYIKAN_FOOTER = true;

  // Sembunyikan <div class="search"> yang berada DI BAWAH tabel jadwal. Div "search" di atas
  // tabel (mis. form filter berisi tombol "Tampilkan") tidak disentuh.
  const SEMBUNYIKAN_DIV_SEARCH_BAWAH = true;
  // Kode singkatan program studi. Dicocokkan dengan teks pada kolom "Program Studi"
  // (tanpa memandang huruf besar/kecil; nama yang lebih panjang dicek lebih dulu supaya
  // "Pendidikan Teknologi Informasi" tidak tertangkap sebagai "Teknologi Informasi").
  // Kalau prodi tidak ada di daftar ini, sel kelas dibiarkan apa adanya.
  const KODE_PRODI = {
    'Teknik Informatika': 'TIF',
    'Teknologi Informasi': 'TI',
    'Pendidikan Teknologi Informasi': 'PTI',
  };

  // Penanda kelas Praktikum: awalan yang ditambahkan di depan nama mata kuliah.
  const AWALAN_PRAKTIKUM = '(P) ';

  // Otomatisasi saat halaman jadwal pertama kali dibuka.
  const AUTO_KLIK_TAMPILKAN = true;       // otomatis klik tombol "Tampilkan" saat halaman dimuat
  const AUTO_SHOW_ALL_ENTRIES = true;     // otomatis ubah "Show entries" menjadi "All"
  const AUTO_PILIH_KELAS_BERLANGSUNG = true; // otomatis klik radio kelas yang sedang berlangsung sekarang (tanpa membuka form presensi)
  const AUTO_PILIH_TIPE_PERTEMUAN = ['Tatap Muka', 'Praktikum']; // tipe pertemuan yang dipertimbangkan untuk auto-pilih ini
  const AUTO_PILIH_TOLERANSI_SEBELUM_MENIT = 0; // 0 = hanya kelas yang benar-benar sedang berlangsung, bukan yang akan segera dimulai

  // Dropdown filter (Fakultas, Tahun Akademik, dll.) di atas tombol "Tampilkan" kadang
  // baru terisi nilai defaultnya belakangan (via AJAX), setelah tombolnya sendiri sudah
  // tampak & bisa diklik. Supaya AUTO_KLIK_TAMPILKAN tidak mengklik lebih cepat dari itu,
  // skrip menunggu semua dropdown ini terisi DAN nilainya tidak berubah-ubah lagi
  // (stabil) sebelum benar-benar mengklik "Tampilkan". Tambahkan/kurangi id di sini kalau
  // suatu saat ada dropdown lain yang perlu ikut ditunggu.
  const DROPDOWN_ID_SEBELUM_TAMPILKAN = ['k_fakultas', 'k_tahun', 'k_jenjang', 'k_semester', 'k_reguler', 'k_jurusan', 'k_cabang', 'k_prodi'];
  const TUNGGU_DROPDOWN_STABIL_MS = 300;  // jeda antar pengecekan saat menunggu nilai dropdown berhenti berubah
  const TUNGGU_DROPDOWN_STABIL_ULANGAN = 6; // maksimum berapa kali pengecekan (300ms x 6 = ~1.8 detik)

  // Tampilan tabel jadwal supaya tidak terlalu lebar ke samping.
  const TAMPILAN_KOMPAK = true;      // perkecil font & padding tabel
  const TAMPILAN_FONT_SIZE = '12px';
  const TAMPILAN_PADDING = '3px 5px';
  const TAMPILAN_LEBAR_MAKS_NAMA = '90px';     // lebar maksimum kolom "Nama" (mata kuliah) sebelum teks membungkus ke baris baru
  const TAMPILAN_LEBAR_MAKS_PRODI = '100px';   // lebar maksimum kolom "Program Studi"
  const TAMPILAN_LEBAR_MAKS_RUANG = '50px';    // lebar maksimum kolom "Ruang Kuliah"
  const TAMPILAN_LEBAR_MAKS_SKS = '26px';      // lebar maksimum kolom "SKS"
  const TAMPILAN_LEBAR_MAKS_HARI = '38px';     // lebar maksimum kolom "Hari"
  const TAMPILAN_LEBAR_MAKS_JAM_MULAI = '42px';   // lebar maksimum kolom "Jam Mulai"
  const TAMPILAN_LEBAR_MAKS_JAM_SELESAI = '42px'; // lebar maksimum kolom "Jam Selesai"
  const TAMPILAN_LEBAR_MAKS_KEHADIRAN = '55px';   // lebar maksimum kolom "Kehadiran Dosen"
  // Kolom-kolom lain yang ikut diberi lebar tetap supaya TIDAK ada satupun kolom yang
  // dibiarkan "bebas" (auto) -- kalau ada yang dibiarkan bebas, sisa lebar tabel akan
  // ditumpuk semua ke kolom itu saja sehingga tampilan jadi tidak proporsional/berantakan.
  const TAMPILAN_LEBAR_MAKS_NO = '28px';          // lebar kolom "No"
  const TAMPILAN_LEBAR_MAKS_PILIH = '36px';       // lebar kolom "Pilih" (radio button)
  const TAMPILAN_LEBAR_MAKS_KLS = '54px';         // lebar kolom "KELAS" (dulu "KLS"; diperlebar agar "PTI (E)" muat satu baris)
  const TAMPILAN_LEBAR_MAKS_JUMLAH_PESERTA = '50px'; // lebar kolom "Jumlah Peserta"
  const TAMPILAN_LEBAR_MAKS_TIPE = '85px';        // lebar kolom "Tipe Pertemuan"
  const TAMPILAN_LEBAR_DEFAULT = '70px';          // jaring pengaman untuk kolom lain yang mungkin belum terdaftar di atas
  // ===========================================================
  function pad(n) { return String(n).padStart(2, '0'); }
  function toast(msg, isError) {
    let el = document.getElementById('siado-helper-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'siado-helper-toast';
      el.style.cssText = 'position:fixed;bottom:80px;right:20px;max-width:340px;z-index:99999;' +
        'padding:12px 16px;border-radius:8px;font:14px/1.4 sans-serif;' +
        'box-shadow:0 4px 14px rgba(0,0,0,.3);color:#fff;white-space:pre-line;';
      document.body.appendChild(el);
    }
    el.style.background = isError ? '#c0392b' : '#2d6a4f';
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 7000);
  }
  // ---- decode metadata dari atribut onclick="SetData('<base64 JSON>')" pada radio jadwal ----
  function decodeRadioMeta(radio) {
    const onclick = radio.getAttribute('onclick') || '';
    const m = onclick.match(/SetData\('([^']+)'\)/);
    if (!m) return null;
    try {
      return JSON.parse(atob(m[1]));
    } catch (e) {
      return null;
    }
  }
  function parseHM(hms) {
    const [h, mi, s] = hms.split(':').map(Number);
    return { h, mi, s: s || 0 };
  }
  function getAllRadios() {
    const table = document.getElementById('tabelku');
    if (!table) return [];
    return Array.from(table.querySelectorAll('tbody input[type="radio"]'));
  }
  // Setelah "Show entries" diubah ke "All", DataTables perlu merender ulang SELURUH baris
  // (termasuk baris yang sebelumnya cuma ada di halaman ke-2, dst.). Kita tunggu sampai
  // JUMLAH baris di tbody benar-benar berhenti berubah (stabil beberapa kali pengecekan
  // berturut-turut) sebelum resolve -- mirip pola tungguDropdownSiap() di bawah.
  const TUNGGU_SHOW_ALL_STABIL_MS = 200;     // jeda antar pengecekan jumlah baris
  const TUNGGU_SHOW_ALL_STABIL_ULANGAN = 3;  // berapa kali berturut-turut jumlah baris harus sama sebelum dianggap stabil
  const TUNGGU_SHOW_ALL_TIMEOUT_MS = 6000;   // batas maksimum menunggu (jaga-jaga kalau tidak pernah stabil)
  function setShowAllEntries() {
    return new Promise((resolve) => {
      const sel = document.querySelector('select[name="tabelku_length"]');
      if (!sel) return resolve(false);
      if (sel.value === '-1') return resolve(true);
      sel.value = '-1';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const table = document.getElementById('tabelku');
      const start = Date.now();
      let lastCount = -1;
      let stableStreak = 0;
      const timer = setInterval(() => {
        const count = (table && table.tBodies[0]) ? table.tBodies[0].rows.length : 0;
        if (count > 0 && count === lastCount) {
          stableStreak++;
        } else {
          stableStreak = 0;
          lastCount = count;
        }
        const stabil = stableStreak >= TUNGGU_SHOW_ALL_STABIL_ULANGAN;
        const timeout = Date.now() - start > TUNGGU_SHOW_ALL_TIMEOUT_MS;
        if (stabil || timeout) {
          clearInterval(timer);
          resolve(true);
        }
      }, TUNGGU_SHOW_ALL_STABIL_MS);
    });
  }
  function waitFor(checkFn, timeoutMs = 8000, intervalMs = 200) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        let result;
        try { result = checkFn(); } catch (e) { result = false; }
        if (result) {
          clearInterval(timer);
          resolve(result);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          reject(new Error('timeout menunggu elemen halaman'));
        }
      }, intervalMs);
    });
  }
  function isVisible(el) {
    return !!(el && el.offsetParent !== null);
  }
  // ---- pastikan dropdown filter (Fakultas/Tahun/dst.) sudah terisi & nilainya stabil ----
  // sebelum tombol "Tampilkan" diklik otomatis (lihat DROPDOWN_ID_SEBELUM_TAMPILKAN).
  function ambilSnapshotDropdown() {
    const snap = {};
    DROPDOWN_ID_SEBELUM_TAMPILKAN.forEach(id => {
      const el = document.getElementById(id);
      // Sertakan jumlah opsi juga, bukan cuma value, supaya dropdown yang opsinya
      // baru selesai di-load lewat AJAX tetap dianggap "belum stabil".
      snap[id] = el ? `${el.options.length}|${el.value}` : null;
    });
    return snap;
  }
  function semuaDropdownTerisi() {
    return DROPDOWN_ID_SEBELUM_TAMPILKAN.every(id => {
      const el = document.getElementById(id);
      if (!el) return true; // dropdown ini tidak ada di halaman -- jangan sampai memblokir
      return el.options.length > 0 && el.value !== '' && el.value !== null;
    });
  }
  function snapshotSama(a, b) {
    return DROPDOWN_ID_SEBELUM_TAMPILKAN.every(id => a[id] === b[id]);
  }
  async function tungguDropdownSiap() {
    await waitFor(semuaDropdownTerisi, 10000).catch(() => {});
    let snapshotSebelumnya = ambilSnapshotDropdown();
    for (let i = 0; i < TUNGGU_DROPDOWN_STABIL_ULANGAN; i++) {
      await new Promise(resolve => setTimeout(resolve, TUNGGU_DROPDOWN_STABIL_MS));
      const snapshotSekarang = ambilSnapshotDropdown();
      if (snapshotSama(snapshotSebelumnya, snapshotSekarang)) break;
      snapshotSebelumnya = snapshotSekarang;
    }
  }
  // ---- cari kelas (dari daftar tipe pertemuan tertentu) hari ini yang sedang berlangsung / akan segera dimulai ----
  function findClassAtTime(radios, allowedTipeList, toleransiSebelumMenit) {
    const now = new Date();
    // JS: Minggu=0..Sabtu=6, cocok langsung dengan hari_ke di SIADO (1=Senin ... 5=Jumat)
    const todayHariKe = now.getDay();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const candidates = [];
    for (const radio of radios) {
      const meta = decodeRadioMeta(radio);
      if (!meta) continue;
      if (!allowedTipeList.includes(meta.tipe_pertemuan)) continue;
      if (Number(meta.hari_ke) !== todayHariKe) continue;
      const mulai = parseHM(meta.jam_mulai);
      const selesai = parseHM(meta.jam_selesai);
      const mulaiMin = mulai.h * 60 + mulai.mi;
      const selesaiMin = selesai.h * 60 + selesai.mi;
      if (nowMinutes >= mulaiMin - toleransiSebelumMenit && nowMinutes <= selesaiMin) {
        candidates.push({ radio, meta, mulaiMin, selesaiMin, sedangBerlangsung: nowMinutes >= mulaiMin });
      }
    }
    if (candidates.length === 0) return { candidates: [] };
    candidates.sort((a, b) => {
      if (a.sedangBerlangsung !== b.sedangBerlangsung) return a.sedangBerlangsung ? -1 : 1;
      return Math.abs(nowMinutes - a.mulaiMin) - Math.abs(nowMinutes - b.mulaiMin);
    });
    return { candidates, best: candidates[0] };
  }
  // dipakai oleh tombol "Ajar Sekarang": hanya Tipe Pertemuan yang ada di TIPE_PERTEMUAN_DIIZINKAN,
  // dengan toleransi beberapa menit sebelum jam mulai (lihat TOLERANSI_SEBELUM_MENIT).
  function findCurrentClassRadio(radios) {
    return findClassAtTime(radios, TIPE_PERTEMUAN_DIIZINKAN, TOLERANSI_SEBELUM_MENIT);
  }
  // ---- isi otomatis form "Tambah Presensi oleh Mahasiswa" ----
  function autofillPresensiForm() {
    try {
      const materi = document.getElementById('materiPresensi');
      const keterangan = document.getElementById('tx-keteranganPresensi');
      const tglAjarEl = document.getElementById('tgl_ajarPresensi');
      const jamMulaiEl = document.getElementById('jam_mulaiPresensi');
      const batasEl = document.getElementById('tgl_batas');
      if (!materi || !keterangan || !tglAjarEl || !jamMulaiEl || !batasEl) return;
      // Kalau materi sudah terisi, ini kemungkinan form "Ubah" (edit) -> jangan timpa datanya.
      if (materi.value.trim() !== '') return;
      // Hindari autofill ganda (dari hook + fallback setTimeout) dalam waktu berdekatan.
      if (Date.now() - (autofillPresensiForm._last || 0) < 1500) return;
      autofillPresensiForm._last = Date.now();
      const tglAjar = tglAjarEl.value;   // format "YYYY-M-D"
      const jamMulai = jamMulaiEl.value; // format "HH:MM:SS"
      if (!tglAjar || !jamMulai) return;
      const [y, mo, d] = tglAjar.split('-').map(Number);
      const { h, mi, s } = parseHM(jamMulai);
      const dt = new Date(y, mo - 1, d, h, mi, s);
      dt.setMinutes(dt.getMinutes() + BATAS_PRESENSI_MENIT);
      const batasValue = `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
      batasEl.value = batasValue;
      batasEl.dispatchEvent(new Event('change', { bubbles: true }));
      batasEl.dispatchEvent(new Event('input', { bubbles: true }));
      if (keterangan.value.trim() === '') {
        keterangan.value = KETERANGAN_DEFAULT;
        keterangan.dispatchEvent(new Event('input', { bubbles: true }));
      }
      materi.focus();
      toast(
        `Diisi otomatis:\nBatas presensi -> ${pad(dt.getHours())}:${pad(dt.getMinutes())} (jam mulai +${BATAS_PRESENSI_MENIT} menit)\nKeterangan -> "${KETERANGAN_DEFAULT}"\n\nSilakan isi Sub Capaian Pembelajaran, lalu cek & klik Simpan.`
      );
    } catch (e) {
      console.error('[SIADO Helper] gagal autofill:', e);
    }
  }
  // ---- pasang hook ke fungsi asli agar form otomatis terisi kapan pun dibuka ----
  // (berlaku baik dibuka lewat tombol "Ajar Sekarang" di bawah, maupun diklik manual oleh dosen)
  function hookOriginalFunctions() {
    if (typeof window.call_new_materi_mahasiswa === 'function' && !window.call_new_materi_mahasiswa.__hooked) {
      const original = window.call_new_materi_mahasiswa;
      const wrapped = function (...args) {
        const ret = original.apply(this, args);
        setTimeout(autofillPresensiForm, 300);
        return ret;
      };
      wrapped.__hooked = true;
      window.call_new_materi_mahasiswa = wrapped;
    }
  }
  hookOriginalFunctions();
  const hookInterval = setInterval(() => {
    hookOriginalFunctions();
    if (window.call_new_materi_mahasiswa && window.call_new_materi_mahasiswa.__hooked) {
      clearInterval(hookInterval);
    }
  }, 500);
  setTimeout(() => clearInterval(hookInterval), 15000);

  // Jaga nilai "Tipe Pertemuan" & "SKS Pertemuan" pada form presensi: kalau setelah terisi
  // nilainya sempat dikosongkan oleh halaman, kembalikan ke nilai terakhir. Tidak pernah
  // mengubah nilai yang sudah ada dan tidak memicu event apa pun.
  function jagaTipeDanSks(durasiMs = 10000) {
    const tipe = document.getElementById('inp-tipe_pertemuanPresensi');
    const sks = document.getElementById('inp-sksPresensi');
    if (!tipe || !sks) return;
    let lastTipe = tipe.value, lastSks = sks.value;
    const start = Date.now();
    const timer = setInterval(() => {
      if (tipe.value) lastTipe = tipe.value; else if (lastTipe) tipe.value = lastTipe;
      if (sks.value) lastSks = sks.value; else if (lastSks) sks.value = lastSks;
      if (Date.now() - start > durasiMs) clearInterval(timer);
    }, 50);
  }

  // ---- alur "Ajar Sekarang": pilih kelas Tatap Muka hari ini yang sedang berlangsung & buka form presensi ----
  async function ajarSekarang() {
    try {
      toast('Mencari kelas Tatap Muka yang sedang berlangsung...');
      let radios = getAllRadios();
      if (radios.length === 0) {
        const tampilkanBtn = Array.from(document.querySelectorAll('button'))
          .find(b => b.textContent.trim() === 'Tampilkan');
        if (tampilkanBtn) {
          await tungguDropdownSiap();
          tampilkanBtn.click();
          await waitFor(() => getAllRadios().length > 0, 8000).catch(() => {});
        }
      }
      await setShowAllEntries();
      reapplyTableStyling(); // pastikan baris dari halaman 2+ ikut terformat setelah "All" stabil
      radios = getAllRadios();
      if (radios.length === 0) {
        toast('Jadwal tidak ditemukan. Silakan klik "Tampilkan" secara manual dahulu.', true);
        return;
      }
      const { candidates, best } = findCurrentClassRadio(radios);
      if (!best) {
        toast(`Tidak ada kelas Tatap Muka yang sedang berlangsung sekarang (atau dalam ${TOLERANSI_SEBELUM_MENIT} menit ke depan). Silakan pilih kelas secara manual.`, true);
        return;
      }
      let chosen = best;
      if (candidates.length > 1) {
        const list = candidates.map((c, i) =>
          `${i + 1}. ${c.meta.nama} (Kelas ${c.meta.kelas}) ${c.meta.jam_mulai.slice(0, 5)}-${c.meta.jam_selesai.slice(0, 5)}`
        ).join('\n');
        const pick = prompt(`Ditemukan lebih dari satu kelas Tatap Muka yang cocok:\n${list}\n\nMasukkan nomor kelas yang ingin dipilih:`, '1');
        const idx = parseInt(pick, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= candidates.length) {
          toast('Dibatalkan.', true);
          return;
        }
        chosen = candidates[idx];
      }
      jagaTipeDanSks();
      // Jangan klik ulang kalau radio sudah terpilih (mis. oleh auto-pilih saat halaman dibuka),
      // supaya data kelas tidak di-set ulang oleh halaman.
      if (!chosen.radio.checked) chosen.radio.click();
      if (typeof window.call_detail_selected === 'function') {
        window.call_detail_selected();
      } else {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => b.textContent.includes('Sub Capaian Pembelajaran dan Presensi'));
        if (btn) btn.click();
      }
      await waitFor(() => {
        const dlg = document.getElementById('table-materi');
        return dlg && isVisible(dlg);
      }, 8000);
      if (typeof window.call_new_materi_mahasiswa === 'function') {
        window.call_new_materi_mahasiswa();
      } else {
        const dlg = document.getElementById('table-materi');
        const btn = dlg && Array.from(dlg.parentElement.querySelectorAll('button'))
          .find(b => b.textContent.includes('Tambah Presensi oleh Mahasiswa'));
        if (btn) btn.click();
      }
      await waitFor(() => {
        const el = document.getElementById('jam_mulaiPresensi');
        return el && el.value;
      }, 8000);
      // Jaga-jaga bila hook belum sempat terpasang saat form pertama kali dibuka.
      setTimeout(autofillPresensiForm, 300);
    } catch (e) {
      console.error('[SIADO Helper]', e);
      toast('Terjadi kesalahan: ' + e.message, true);
    }
  }
  function addFloatingButton() {
    if (document.getElementById('siado-helper-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'siado-helper-btn';
    btn.textContent = '⚡ Ajar Sekarang';
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;background:#1d3557;' +
      'color:#fff;border:none;padding:12px 18px;border-radius:24px;font:600 14px sans-serif;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer;';
    btn.addEventListener('click', ajarSekarang);
    document.body.appendChild(btn);
  }
  addFloatingButton();

  // ---- otomatisasi saat halaman jadwal pertama kali dibuka: klik "Tampilkan",
  // ---- ubah ke "Show All entries", lalu pilih otomatis kelas yang sedang berlangsung ----
  async function autoInitJadwal() {
    try {
      if (!AUTO_KLIK_TAMPILKAN) return;
      const tampilkanBtn = await waitFor(() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => b.textContent.trim() === 'Tampilkan');
        return (btn && isVisible(btn)) ? btn : null;
      }, 10000).catch(() => null);
      if (!tampilkanBtn) return;
      await tungguDropdownSiap();
      tampilkanBtn.click();
      await waitFor(() => getAllRadios().length > 0, 10000).catch(() => {});

      if (AUTO_SHOW_ALL_ENTRIES) {
        await setShowAllEntries();
        reapplyTableStyling(); // pastikan baris dari halaman 2+ ikut terformat setelah "All" stabil
        await waitFor(() => getAllRadios().length > 0, 8000).catch(() => {});
      }

      if (AUTO_PILIH_KELAS_BERLANGSUNG) {
        const radios = getAllRadios();
        if (radios.length > 0) {
          const { best } = findClassAtTime(radios, AUTO_PILIH_TIPE_PERTEMUAN, AUTO_PILIH_TOLERANSI_SEBELUM_MENIT);
          if (best) {
            best.radio.click();
            best.radio.scrollIntoView({ behavior: 'smooth', block: 'center' });
            toast(`Kelas "${best.meta.nama}" (Kelas ${best.meta.kelas}) otomatis dipilih karena sedang berlangsung.`);
          }
        }
      }
    } catch (e) {
      console.error('[SIADO Helper] auto-init gagal:', e);
    }
  }
  autoInitJadwal();

  // =====================================================================
  // ====== TAMPILAN TABEL JADWAL: warna baris, awalan "(P)" untuk    ======
  // ====== praktikum, bold untuk kelas yang sedang berlangsung, dan  ======
  // ====== sembunyikan kolom yang tidak diperlukan.                  ======
  // =====================================================================
  const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  // Footer disembunyikan lewat CSS (bukan JS per elemen) supaya langsung berlaku sejak
  // halaman dimuat, termasuk bila footer baru dibuat belakangan.
  if (SEMBUNYIKAN_FOOTER && !document.getElementById('siado-helper-footer-style')) {
    const footerStyle = document.createElement('style');
    footerStyle.id = 'siado-helper-footer-style';
    footerStyle.textContent = '#footer { display: none !important; }';
    document.head.appendChild(footerStyle);
  }

  function normalizeHeaderText(s) {
    return (s || '').replace(/\s+/g, '').toUpperCase();
  }
  // Kolom yang di-align center (kunci index pada objek info di setupTableOnceAndGetInfo):
  // No, Pilih, KLS, SKS, Ruang Kuliah, Hari, Jam Mulai, Jam Selesai, Tipe Pertemuan.
  const KOLOM_CENTER_KEYS = ['noIdx', 'pilihIdx', 'klsIdx', 'sksIdx', 'ruangIdx', 'hariIdx', 'jamMulaiIdx', 'jamSelesaiIdx', 'tipeIdx'];
  const HIDE_TARGETS = KOLOM_DISEMBUNYIKAN.map(normalizeHeaderText);

  // Daftar [nama prodi (huruf kecil), kode] diurutkan dari nama terpanjang, supaya
  // "pendidikan teknologi informasi" dicek sebelum "teknologi informasi".
  const DAFTAR_KODE_PRODI = Object.entries(KODE_PRODI)
    .map(([nama, kode]) => [nama.toLowerCase().replace(/\s+/g, ' ').trim(), kode])
    .sort((a, b) => b[0].length - a[0].length);

  function cariKodeProdi(teksProdi) {
    const t = (teksProdi || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!t) return null;
    for (const [nama, kode] of DAFTAR_KODE_PRODI) {
      if (t.includes(nama)) return kode;
    }
    return null;
  }

  // Ubah isi sel kelas menjadi "KODEPRODI (kelas)", mis. "E" -> "TIF (E)".
  // Idempotent: nilai kelas asli disimpan di data-kelas-asli, jadi aman dipanggil berulang
  // (MutationObserver, interval) tanpa jadi "TIF (TIF (E))".
  function setLabelKelas(kelasCell, prodiCell) {
    if (!kelasCell) return;
    if (kelasCell.dataset.kelasAsli === undefined) {
      kelasCell.dataset.kelasAsli = kelasCell.textContent.trim();
    }
    const asli = kelasCell.dataset.kelasAsli;
    if (!asli) return;
    const kode = prodiCell ? cariKodeProdi(prodiCell.textContent) : null;
    const label = kode ? `${kode} (${asli})` : asli;
    if (kelasCell.textContent !== label) kelasCell.textContent = label;
  }

  // Membangun peta grid header (menangani rowspan/colspan) agar tahu index kolom "leaf"
  // mana yang berasal dari header mana, walau ada header berkelompok (mis. "MATA KULIAH").
  function buildHeaderGrid(thead) {
    const rows = Array.from(thead.rows);
    const numRows = rows.length;
    const grid = rows.map(() => []);
    const tracker = {};
    const cellStart = new Map();
    rows.forEach((row, r) => {
      let col = 0;
      const cells = Array.from(row.cells);
      let ci = 0;
      while (ci < cells.length) {
        while (tracker[col]) {
          grid[r][col] = tracker[col].cell;
          tracker[col].remaining--;
          if (tracker[col].remaining <= 0) delete tracker[col];
          col++;
        }
        const cell = cells[ci++];
        const colSpan = cell.colSpan || 1;
        const rowSpan = cell.rowSpan || 1;
        cellStart.set(cell, { row: r, col, colSpan, rowSpan });
        for (let k = 0; k < colSpan; k++) {
          grid[r][col + k] = cell;
          if (rowSpan > 1) tracker[col + k] = { cell, remaining: rowSpan - 1 };
        }
        col += colSpan;
      }
      while (tracker[col]) {
        grid[r][col] = tracker[col].cell;
        tracker[col].remaining--;
        if (tracker[col].remaining <= 0) delete tracker[col];
        col++;
      }
    });
    const totalCols = Math.max(...grid.map(r => r.length));
    return { grid, totalCols, numRows, cellStart };
  }

  // Index kolom "logis" (yang juga jadi index <td> pada tbody) dicari secara dinamis
  // lewat teks header, bukan angka tetap, supaya tetap benar walau susunan kolom
  // berubah (disembunyikan atau dipindah).
  function findLeafIndexByText(table, text) {
    const { grid, totalCols, numRows } = buildHeaderGrid(table.tHead);
    const leafRow = numRows - 1;
    const target = normalizeHeaderText(text);
    for (let c = 0; c < totalCols; c++) {
      const cell = grid[leafRow][c];
      if (cell && normalizeHeaderText(cell.textContent) === target) return c;
    }
    return -1;
  }

  // Pindahkan kolom sesuai KOLOM_DIPINDAH (mis. "Program Studi" ke sebelah "Nama").
  // Di sini HANYA header yang dipindah (dijalankan sekali per elemen tabel). Urutan
  // pemindahan dicatat di table.dataset.colMoves, lalu diterapkan ke setiap baris tbody
  // oleh applyColumnMovesToRow() di reapplyTableStyling(). Ini penting: DataTables hanya
  // menaruh baris halaman aktif di DOM, jadi baris dari halaman 2+ baru muncul belakangan
  // dengan urutan kolom asli dan harus dipindah juga saat itu.
  function moveColumnsIfNeeded(table) {
    if (table.dataset.colsMoved === '1') return;
    const moves = [];
    KOLOM_DIPINDAH.forEach(({ kolom, keSetelah }) => {
      const { grid, totalCols, numRows } = buildHeaderGrid(table.tHead);
      const leafRow = numRows - 1;
      const kolomNorm = normalizeHeaderText(kolom);
      const keSetelahNorm = normalizeHeaderText(keSetelah);
      let moveIdx = -1, afterIdx = -1;
      for (let c = 0; c < totalCols; c++) {
        const cell = grid[leafRow][c];
        if (!cell) continue;
        const t = normalizeHeaderText(cell.textContent);
        if (t === kolomNorm) moveIdx = c;
        if (t === keSetelahNorm) afterIdx = c;
      }
      if (moveIdx === -1 || afterIdx === -1 || moveIdx === afterIdx) return;

      const moveTh = grid[leafRow][moveIdx];
      const afterTh = grid[leafRow][afterIdx];
      afterTh.parentNode.insertBefore(moveTh, afterTh.nextSibling);

      const moveGroupCell = grid[0][moveIdx];
      const afterGroupCell = grid[0][afterIdx];
      if (moveGroupCell && moveGroupCell !== afterGroupCell) {
        const newSpan = (moveGroupCell.colSpan || 1) - 1;
        if (newSpan <= 0) moveGroupCell.style.display = 'none';
        else moveGroupCell.colSpan = newSpan;
        if (afterGroupCell) afterGroupCell.colSpan = (afterGroupCell.colSpan || 1) + 1;
      }

      moves.push({ moveIdx, afterIdx });
    });
    table.dataset.colMoves = JSON.stringify(moves);
    table.dataset.colsMoved = '1';
  }

  // Terapkan urutan pemindahan kolom ke satu baris tbody (sekali per baris).
  function applyColumnMovesToRow(row, moves) {
    if (row.dataset.colsMoved === '1') return;
    if (!moves.length) { row.dataset.colsMoved = '1'; return; }
    const maxIdx = Math.max(...moves.flatMap(m => [m.moveIdx, m.afterIdx]));
    if (row.cells.length <= maxIdx) return; // baris placeholder / belum lengkap
    moves.forEach(({ moveIdx, afterIdx }) => {
      const moveTd = row.cells[moveIdx], afterTd = row.cells[afterIdx];
      if (moveTd && afterTd) afterTd.parentNode.insertBefore(moveTd, afterTd.nextSibling);
    });
    row.dataset.colsMoved = '1';
  }

  function ensureTableStyle() {
    if (document.getElementById('siado-helper-table-style')) return;
    const style = document.createElement('style');
    style.id = 'siado-helper-table-style';
    style.textContent = `
      #tabelku th.siado-center, #tabelku td.siado-center { text-align: center !important; }
      /* Tatap Muka & Praktikum memakai warna yang sama (abu-abu).
         Pembedanya adalah awalan "(P)" pada nama mata kuliah praktikum. */
      #tabelku tbody tr.tipe-tatap-muka td,
      #tabelku tbody tr.tipe-praktikum td { background-color: #e0e0e0 !important; }
      /* Baris yang jadwalnya hari ini: kuning (semua tipe). Harus berada DI BAWAH aturan
         abu-abu di atas karena tingkat spesifisitasnya sama (yang di bawah yang menang). */
      #tabelku tbody tr.hari-today td { background-color: #fff9c4 !important; }
      #tabelku tbody tr.sedang-berlangsung td { font-weight: bold !important; background-color: #fff176 !important; }
      #tabelku tbody tr:not(.hari-today):not(.sedang-berlangsung) td { background-color: #ffffff !important; }
      #tabelku tbody tr:not(.hari-today):not(.sedang-berlangsung):hover td { background-color: #bbdefb !important; }
      #tabelku tbody tr:hover td { background-color: #bbdefb !important; }
      ${TAMPILAN_KOMPAK ? `
      /* DataTables mengunci lebar <table> lewat inline style; width:100% !important
         mengalahkan itu supaya lebar tabel mengikuti wadahnya yang sebenarnya. */
      #tabelku {
        table-layout: fixed !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }
      #tabelku, #tabelku th, #tabelku td {
        font-size: ${TAMPILAN_FONT_SIZE} !important;
      }
      #tabelku th, #tabelku td {
        padding: ${TAMPILAN_PADDING} !important;
        white-space: normal !important;
        word-break: break-word !important;
        box-sizing: border-box !important;
      }
      #tabelku td.siado-col-nama, #tabelku th.siado-col-nama {
        width: ${TAMPILAN_LEBAR_MAKS_NAMA};
        max-width: ${TAMPILAN_LEBAR_MAKS_NAMA};
      }
      #tabelku td.siado-col-prodi, #tabelku th.siado-col-prodi {
        width: ${TAMPILAN_LEBAR_MAKS_PRODI};
        max-width: ${TAMPILAN_LEBAR_MAKS_PRODI};
      }
      #tabelku td.siado-col-ruang, #tabelku th.siado-col-ruang {
        width: ${TAMPILAN_LEBAR_MAKS_RUANG};
        max-width: ${TAMPILAN_LEBAR_MAKS_RUANG};
      }
      #tabelku td.siado-col-sks, #tabelku th.siado-col-sks {
        width: ${TAMPILAN_LEBAR_MAKS_SKS};
        max-width: ${TAMPILAN_LEBAR_MAKS_SKS};
      }
      #tabelku td.siado-col-hari, #tabelku th.siado-col-hari {
        width: ${TAMPILAN_LEBAR_MAKS_HARI};
        max-width: ${TAMPILAN_LEBAR_MAKS_HARI};
      }
      #tabelku td.siado-col-jam-mulai, #tabelku th.siado-col-jam-mulai {
        width: ${TAMPILAN_LEBAR_MAKS_JAM_MULAI};
        max-width: ${TAMPILAN_LEBAR_MAKS_JAM_MULAI};
      }
      #tabelku td.siado-col-jam-selesai, #tabelku th.siado-col-jam-selesai {
        width: ${TAMPILAN_LEBAR_MAKS_JAM_SELESAI};
        max-width: ${TAMPILAN_LEBAR_MAKS_JAM_SELESAI};
      }
      #tabelku td.siado-col-kehadiran, #tabelku th.siado-col-kehadiran {
        width: ${TAMPILAN_LEBAR_MAKS_KEHADIRAN};
        max-width: ${TAMPILAN_LEBAR_MAKS_KEHADIRAN};
      }
      ` : ''}
    `;
    document.head.appendChild(style);
  }

  // ---- Event delegation global: Klik baris untuk memilih radio button ----
  document.body.addEventListener('click', (e) => {
    // Pastikan elemen yang diklik berada di dalam baris <tr> pada tbody tabelku
    const row = e.target.closest('#tabelku tbody tr');
    if (!row) return;

    // Jika yang diklik adalah radio button itu sendiri, checkbox, link, atau tombol,
    // biarkan aksi bawaannya berjalan alami
    if (e.target.closest('input, button, a, select, textarea, label')) return;

    // Cari radio button di baris tersebut
    const radio = row.querySelector('input[type="radio"]');
    if (radio && !radio.disabled) {
      // Pemicu manual: beri centang lalu trigger event 'change' & 'click'
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      radio.click();
    }
  });

  // Sembunyikan kolom pada header hanya sekali per elemen tabel (tabel dibuat ulang dari
  // nol setiap kali tombol "Tampilkan" diklik, sehingga flag ini otomatis ter-reset saat itu).
  function hideHeaderColumnsIfNeeded(table) {
    if (table.dataset.colsHidden === '1') {
      return JSON.parse(table.dataset.hiddenCols);
    }
    const { grid, totalCols, numRows, cellStart } = buildHeaderGrid(table.tHead);
    const leafRow = numRows - 1;
    const hiddenColsSet = new Set();
    for (let c = 0; c < totalCols; c++) {
      const cell = grid[leafRow][c];
      if (cell && HIDE_TARGETS.includes(normalizeHeaderText(cell.textContent))) {
        hiddenColsSet.add(c);
      }
    }
    cellStart.forEach(({ col, colSpan }, cell) => {
      let hiddenCount = 0;
      for (let k = 0; k < colSpan; k++) if (hiddenColsSet.has(col + k)) hiddenCount++;
      if (hiddenCount === 0) return;
      if (hiddenCount === colSpan) {
        cell.style.display = 'none';
      } else {
        cell.colSpan = colSpan - hiddenCount;
      }
    });
    table.dataset.colsHidden = '1';
    const arr = Array.from(hiddenColsSet);
    table.dataset.hiddenCols = JSON.stringify(arr);
    return arr;
  }

  // Memaksa lebar kolom lewat <colgroup><col> + table-layout:fixed. SEMUA kolom yang
  // tampak harus diberi lebar eksplisit; kalau ada yang dibiarkan auto, sisa lebar tabel
  // akan ditumpuk ke kolom itu saja.
  function ensureColumnWidths(table, info) {
    const { totalCols } = buildHeaderGrid(table.tHead);
    const hiddenSet = new Set(info.hiddenCols);
    const widthByIdx = {};
    if (info.noIdx !== -1) widthByIdx[info.noIdx] = TAMPILAN_LEBAR_MAKS_NO;
    if (info.pilihIdx !== -1) widthByIdx[info.pilihIdx] = TAMPILAN_LEBAR_MAKS_PILIH;
    if (info.namaIdx !== -1) widthByIdx[info.namaIdx] = TAMPILAN_LEBAR_MAKS_NAMA;
    if (info.prodiIdx !== -1) widthByIdx[info.prodiIdx] = TAMPILAN_LEBAR_MAKS_PRODI;
    if (info.klsIdx !== -1) widthByIdx[info.klsIdx] = TAMPILAN_LEBAR_MAKS_KLS;
    if (info.ruangIdx !== -1) widthByIdx[info.ruangIdx] = TAMPILAN_LEBAR_MAKS_RUANG;
    if (info.sksIdx !== -1) widthByIdx[info.sksIdx] = TAMPILAN_LEBAR_MAKS_SKS;
    if (info.hariIdx !== -1) widthByIdx[info.hariIdx] = TAMPILAN_LEBAR_MAKS_HARI;
    if (info.jamMulaiIdx !== -1) widthByIdx[info.jamMulaiIdx] = TAMPILAN_LEBAR_MAKS_JAM_MULAI;
    if (info.jamSelesaiIdx !== -1) widthByIdx[info.jamSelesaiIdx] = TAMPILAN_LEBAR_MAKS_JAM_SELESAI;
    if (info.jumlahPesertaIdx !== -1) widthByIdx[info.jumlahPesertaIdx] = TAMPILAN_LEBAR_MAKS_JUMLAH_PESERTA;
    if (info.kehadiranIdx !== -1) widthByIdx[info.kehadiranIdx] = TAMPILAN_LEBAR_MAKS_KEHADIRAN;
    if (info.tipeIdx !== -1) widthByIdx[info.tipeIdx] = TAMPILAN_LEBAR_MAKS_TIPE;

    const colgroup = document.createElement('colgroup');
    for (let i = 0; i < totalCols; i++) {
      const col = document.createElement('col');
      if (hiddenSet.has(i)) {
        col.style.display = 'none';
      } else {
        col.style.width = widthByIdx[i] || TAMPILAN_LEBAR_DEFAULT;
      }
      colgroup.appendChild(col);
    }
    table.insertBefore(colgroup, table.firstChild);
  }

  // Menyiapkan tabel sekali saja per elemen: pindahkan kolom (header), catat index kolom
  // (WAJIB tepat SETELAH dipindah tapi SEBELUM disembunyikan), baru sembunyikan kolom yang
  // tidak perlu. Hasilnya di-cache di elemen tabel supaya panggilan berikutnya tidak
  // menghitung ulang dari header yang sudah berubah bentuk.
  function setupTableOnceAndGetInfo(table) {
    if (table.dataset.tableSetupInfo) {
      return JSON.parse(table.dataset.tableSetupInfo);
    }
    moveColumnsIfNeeded(table);
    const info = {
      hariIdx: findLeafIndexByText(table, 'Hari'),
      jamMulaiIdx: findLeafIndexByText(table, 'Jam Mulai'),
      jamSelesaiIdx: findLeafIndexByText(table, 'Jam Selesai'),
      tipeIdx: findLeafIndexByText(table, 'Tipe Pertemuan'),
      namaIdx: findLeafIndexByText(table, 'Nama'),
      prodiIdx: findLeafIndexByText(table, 'Program Studi'),
      ruangIdx: findLeafIndexByText(table, 'Ruang Kuliah'),
      kehadiranIdx: findLeafIndexByText(table, 'Kehadiran Dosen'),
      sksIdx: findLeafIndexByText(table, 'SKS'),
      noIdx: findLeafIndexByText(table, 'No'),
      pilihIdx: findLeafIndexByText(table, 'Pilih'),
      klsIdx: findLeafIndexByText(table, 'KLS'),
      jumlahPesertaIdx: findLeafIndexByText(table, 'Jumlah Peserta'),
    };
    // Ganti judul kolom sesuai KOLOM_RENAME. Dilakukan SETELAH semua index dicatat
    // (supaya pencarian judul asli di atas & di KOLOM_DIPINDAH tetap cocok).
    Object.entries(KOLOM_RENAME).forEach(([judulAsli, judulBaru]) => {
      const idx = findLeafIndexByText(table, judulAsli);
      if (idx === -1) return;
      const { grid, numRows } = buildHeaderGrid(table.tHead);
      const th = grid[numRows - 1][idx];
      if (th) th.textContent = judulBaru;
    });
    if (TAMPILAN_KOMPAK) {
      const { grid, numRows } = buildHeaderGrid(table.tHead);
      const leafRow = numRows - 1;
      if (info.namaIdx !== -1 && grid[leafRow][info.namaIdx]) grid[leafRow][info.namaIdx].classList.add('siado-col-nama');
      if (info.prodiIdx !== -1 && grid[leafRow][info.prodiIdx]) grid[leafRow][info.prodiIdx].classList.add('siado-col-prodi');
      if (info.ruangIdx !== -1 && grid[leafRow][info.ruangIdx]) grid[leafRow][info.ruangIdx].classList.add('siado-col-ruang');
      if (info.sksIdx !== -1 && grid[leafRow][info.sksIdx]) grid[leafRow][info.sksIdx].classList.add('siado-col-sks');
      if (info.hariIdx !== -1 && grid[leafRow][info.hariIdx]) grid[leafRow][info.hariIdx].classList.add('siado-col-hari');
      if (info.jamMulaiIdx !== -1 && grid[leafRow][info.jamMulaiIdx]) grid[leafRow][info.jamMulaiIdx].classList.add('siado-col-jam-mulai');
      if (info.jamSelesaiIdx !== -1 && grid[leafRow][info.jamSelesaiIdx]) grid[leafRow][info.jamSelesaiIdx].classList.add('siado-col-jam-selesai');
      if (info.kehadiranIdx !== -1 && grid[leafRow][info.kehadiranIdx]) grid[leafRow][info.kehadiranIdx].classList.add('siado-col-kehadiran');
    }
    {
      const { grid, numRows } = buildHeaderGrid(table.tHead);
      const leafRow = numRows - 1;
      KOLOM_CENTER_KEYS.forEach(k => {
        const idx = info[k];
        if (idx !== -1 && grid[leafRow][idx]) grid[leafRow][idx].classList.add('siado-center');
      });
    }
    info.hiddenCols = hideHeaderColumnsIfNeeded(table);
    if (TAMPILAN_KOMPAK) {
      ensureColumnWidths(table, info);
    }
    table.dataset.tableSetupInfo = JSON.stringify(info);
    return info;
  }

  function jakartaNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  }

  // Koreksi lebar #content (div pembungkus konten utama SIADO) yang sedikit lebih lebar
  // dari jendela. Pakai document.documentElement.clientWidth, BUKAN 100vw, karena clientWidth
  // sudah dikurangi lebar scrollbar vertikal.
  function fixKontenOverflow() {
    try {
      const content = document.getElementById('content');
      if (!content) return;
      const marginLeft = parseFloat(getComputedStyle(content).marginLeft) || 0;
      const availableWidth = document.documentElement.clientWidth - marginLeft;
      const targetWidth = `${availableWidth}px`;
      content.style.setProperty('box-sizing', 'border-box', 'important');
      content.style.setProperty('width', targetWidth, 'important');
      content.style.setProperty('max-width', targetWidth, 'important');
    } catch (e) {
      console.error('[SIADO Helper] gagal koreksi lebar #content:', e);
    }
  }

  // Sembunyikan tombol yang letaknya SETELAH tabel jadwal (urutan dokumen) di dalam panel
  // pembungkus tabel yang sama. Tombol di dalam modal/dialog, kontrol DataTables (pagination),
  // dan tombol milik skrip ini tidak ikut disembunyikan.
  function sembunyikanTombolBawahTabel() {
    if (!SEMBUNYIKAN_TOMBOL_BAWAH_TABEL) return;
    const table = document.getElementById('tabelku');
    if (!table) return;
    const wrapper = document.getElementById('tabelku_wrapper') || table;
    const panel = wrapper.closest('.panel, .card, .box, .x_panel, .widget-box') ||
      (wrapper.parentElement && wrapper.parentElement.parentElement) || document.body;
    panel.querySelectorAll('button, a.btn, input[type="button"], input[type="submit"]').forEach(btn => {
      if (btn.style.display === 'none') return;
      if (wrapper.contains(btn)) return;
      if (btn.closest('.modal, [role="dialog"]')) return;
      if (btn.id && btn.id.startsWith('siado-helper')) return;
      if (!(wrapper.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
      btn.style.display = 'none';
      btn.dataset.siadoDisembunyikan = '1';
    });
  }

  // Cari toolbar atas yang "menempel" (position fixed/sticky, berada di paling atas, selebar
  // minimal separuh layar) lalu lepaskan. Toolbar fixed diubah ke absolute supaya tetap
  // menempati posisi yang sama di puncak halaman (jarak/padding konten tidak berubah) tetapi
  // ikut tergulung; toolbar sticky diubah ke static. Hanya dicari saat halaman masih di
  // posisi paling atas, supaya tidak salah tangkap elemen lain.
  function lepasToolbarSticky() {
    if (!TOOLBAR_TIDAK_STICKY) return;
    if (window.scrollY > 5) return;
    const kandidat = document.querySelectorAll(
      'header, nav, .navbar, .navbar-fixed-top, .header, .main-header, .app-header, .topbar, #header, body > div'
    );
    kandidat.forEach(el => {
      if (el.dataset.siadoToolbarDilepas === '1') return;
      if (el.id && el.id.startsWith('siado-helper')) return;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') return;
      const r = el.getBoundingClientRect();
      if (r.top > 5 || r.height === 0 || r.height > 200) return;
      if (r.width < window.innerWidth * 0.5) return;
      el.style.setProperty('position', cs.position === 'fixed' ? 'absolute' : 'static', 'important');
      el.dataset.siadoToolbarDilepas = '1';
    });
  }
  lepasToolbarSticky();

  // Sembunyikan seluruh bar info DataTables (#tabelku_info), bukan cuma teksnya.
  // Dari elemen teks itu, naik terus ke elemen pembungkusnya selama pembungkus tersebut
  // TIDAK memuat tabel jadwal. Pembungkus tertinggi yang didapat itulah "bar"-nya
  // (apa pun struktur HTML-nya: .row, .bottom, .dt-layout-row, dsb.), lalu disembunyikan.
  function sembunyikanInfoEntries() {
    if (SEMBUNYIKAN_INFO_ENTRIES) sembunyikanBarDataTables('tabelku_info');
    if (SEMBUNYIKAN_BAR_SEARCH) sembunyikanBarDataTables('tabelku_filter');
    if (SEMBUNYIKAN_DIV_SEARCH_BAWAH) sembunyikanDivSearchBawah();
  }
  function sembunyikanDivSearchBawah() {
    const table = document.getElementById('tabelku');
    if (!table) return;
    document.querySelectorAll('div.search').forEach(div => {
      if (div.style.display === 'none') return;
      if (div.contains(table)) return;
      if (!(table.compareDocumentPosition(div) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
      div.style.setProperty('display', 'none', 'important');
    });
  }
  function sembunyikanBarDataTables(elementId) {
    const info = document.getElementById(elementId);
    const table = document.getElementById('tabelku');
    if (!info || !table) return;
    let bar = info;
    while (
      bar.parentElement &&
      bar.parentElement !== document.body &&
      !bar.parentElement.contains(table)
    ) {
      bar = bar.parentElement;
    }
    if (bar.style.display !== 'none') bar.style.setProperty('display', 'none', 'important');
  }

  // Pasang / copot awalan "(P) " pada sel nama mata kuliah. Idempotent: awalan dibungkus
  // <span class="siado-p-prefix"> sehingga tidak pernah dobel walau fungsi ini dipanggil
  // berulang kali (MutationObserver, interval, dsb.).
  function setAwalanPraktikum(namaCell, adalahPraktikum) {
    if (!namaCell) return;
    const existing = namaCell.querySelector(':scope > .siado-p-prefix');
    if (adalahPraktikum) {
      if (existing) return;
      const span = document.createElement('span');
      span.className = 'siado-p-prefix';
      span.textContent = AWALAN_PRAKTIKUM;
      namaCell.insertBefore(span, namaCell.firstChild);
    } else if (existing) {
      existing.remove();
    }
  }

  // Dipanggil berulang kali (lewat MutationObserver) agar tetap konsisten setelah
  // klik "Tampilkan", ganti "Show X entries", cari, sort, atau pindah halaman.
  function reapplyTableStyling() {
    const table = document.getElementById('tabelku');
    lepasToolbarSticky();
    if (!table || !table.tBodies[0]) return;
    ensureTableStyle();
    if (TAMPILAN_KOMPAK) {
      fixKontenOverflow();
    }
    const info = setupTableOnceAndGetInfo(table);
    sembunyikanTombolBawahTabel();
    sembunyikanInfoEntries();
    const { hariIdx, jamMulaiIdx, jamSelesaiIdx, tipeIdx, namaIdx, prodiIdx, ruangIdx, kehadiranIdx, sksIdx, klsIdx, hiddenCols: hiddenColsArr } = info;
    const hiddenCols = new Set(hiddenColsArr);
    const moves = JSON.parse(table.dataset.colMoves || '[]');
    const now = jakartaNow();
    const today = DAY_NAMES[now.getDay()];
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    Array.from(table.tBodies[0].rows).forEach(row => {
      // Pindahkan kolom pada baris ini kalau belum (termasuk baris dari halaman 2+).
      applyColumnMovesToRow(row, moves);
      // sembunyikan sel body sesuai kolom yang disembunyikan di header
      let col = 0;
      Array.from(row.cells).forEach(td => {
        const span = td.colSpan || 1;
        let anyHidden = false;
        for (let k = 0; k < span; k++) if (hiddenCols.has(col + k)) anyHidden = true;
        if (anyHidden) td.style.display = 'none';
        col += span;
      });
      if (TAMPILAN_KOMPAK) {
        const cellsArr = row.cells;
        if (namaIdx !== -1 && cellsArr[namaIdx]) cellsArr[namaIdx].classList.add('siado-col-nama');
        if (prodiIdx !== -1 && cellsArr[prodiIdx]) cellsArr[prodiIdx].classList.add('siado-col-prodi');
        if (ruangIdx !== -1 && cellsArr[ruangIdx]) cellsArr[ruangIdx].classList.add('siado-col-ruang');
        if (sksIdx !== -1 && cellsArr[sksIdx]) cellsArr[sksIdx].classList.add('siado-col-sks');
        if (hariIdx !== -1 && cellsArr[hariIdx]) cellsArr[hariIdx].classList.add('siado-col-hari');
        if (jamMulaiIdx !== -1 && cellsArr[jamMulaiIdx]) cellsArr[jamMulaiIdx].classList.add('siado-col-jam-mulai');
        if (jamSelesaiIdx !== -1 && cellsArr[jamSelesaiIdx]) cellsArr[jamSelesaiIdx].classList.add('siado-col-jam-selesai');
        if (kehadiranIdx !== -1 && cellsArr[kehadiranIdx]) cellsArr[kehadiranIdx].classList.add('siado-col-kehadiran');
      }
      KOLOM_CENTER_KEYS.forEach(k => {
        const idx = info[k];
        if (idx !== -1 && row.cells[idx]) row.cells[idx].classList.add('siado-center');
      });
      // Isi sel KELAS dengan "KODEPRODI (kelas)", mis. "TIF (E)".
      // Hanya untuk baris data lengkap (bukan baris placeholder "No data").
      if (klsIdx !== -1 && row.cells.length > klsIdx) {
        const prodiCell = (prodiIdx !== -1) ? row.cells[prodiIdx] : null;
        setLabelKelas(row.cells[klsIdx], prodiCell);
      }
      // warnai berdasarkan Tipe Pertemuan, beri awalan "(P)" pada nama praktikum, tandai baris
      // hari ini, dan tandai (bold + highlight kuning) baris yang sedang berlangsung tepat saat ini.
      const cells = row.cells;
      if (tipeIdx === -1 || hariIdx === -1 || cells.length <= tipeIdx) return;
      const tipe = normalizeHeaderText(cells[tipeIdx].textContent);
      const hari = cells[hariIdx].textContent.trim();
      row.classList.remove('tipe-tatap-muka', 'tipe-praktikum', 'hari-today', 'sedang-berlangsung');
      const adalahPraktikum = tipe === normalizeHeaderText('Praktikum');
      if (tipe === normalizeHeaderText('Tatap Muka')) row.classList.add('tipe-tatap-muka');
      else if (adalahPraktikum) row.classList.add('tipe-praktikum');
      if (namaIdx !== -1) setAwalanPraktikum(cells[namaIdx], adalahPraktikum);
      if (hari === today) row.classList.add('hari-today');

      const jamMulaiText = (jamMulaiIdx !== -1 && cells[jamMulaiIdx]) ? cells[jamMulaiIdx].textContent.trim() : '';
      const jamSelesaiText = (jamSelesaiIdx !== -1 && cells[jamSelesaiIdx]) ? cells[jamSelesaiIdx].textContent.trim() : '';
      if (hari === today && jamMulaiText && jamSelesaiText) {
        const mulai = parseHM(jamMulaiText);
        const selesai = parseHM(jamSelesaiText);
        const mulaiMin = mulai.h * 60 + mulai.mi;
        const selesaiMin = selesai.h * 60 + selesai.mi;
        if (nowMinutes >= mulaiMin && nowMinutes <= selesaiMin) {
          row.classList.add('sedang-berlangsung');
        }
      }
    });
  }

  reapplyTableStyling();

  let tableStylingDebounce = null;
  const tableStylingObserver = new MutationObserver(() => {
    clearTimeout(tableStylingDebounce);
    tableStylingDebounce = setTimeout(reapplyTableStyling, 150);
  });
  tableStylingObserver.observe(document.body, { childList: true, subtree: true });
  // Refresh berkala agar highlight "sedang berlangsung" & "hari ini" tetap akurat
  // seiring berjalannya waktu, walau tidak ada perubahan DOM (mis. tab dibiarkan terbuka).
  setInterval(reapplyTableStyling, 60000);
  // Saat jendela di-resize, ukur ulang & benahi lebar #content.
  let resizeDebounce = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(reapplyTableStyling, 150);
  });
})();
