/**
 * Tampilan blocking ketika navigator.onLine === false.
 * Dirender oleh App.tsx menggantikan seluruh routes — user tidak bisa
 * mengakses apapun sampai kembali online. Saat event 'online' meletup,
 * useOnline rerender dan layar normal kembali muncul.
 */
function OfflineScreen() {
  return (
    <main className="offline-screen">
      <section className="card offline-card">
        <div className="offline-icon" aria-hidden>
          ⚠
        </div>
        <h1 className="offline-title">Anda Sedang Offline!</h1>
        <p className="offline-desc">
          Aplikasi memerlukan koneksi internet. Periksa koneksi Anda; halaman
          ini akan kembali otomatis begitu Anda online.
        </p>
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => window.location.reload()}
        >
          Coba Lagi
        </button>
      </section>
    </main>
  );
}

export default OfflineScreen;
