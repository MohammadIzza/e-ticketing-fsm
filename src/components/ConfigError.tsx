interface ConfigErrorProps {
  message: string;
}

function ConfigError({ message }: ConfigErrorProps) {
  return (
    <main className="auth-screen">
      <section className="card auth-card">
        <h2 className="section-title">Konfigurasi belum lengkap</h2>
        <p className="muted">{message}</p>
        <p className="muted small">
          Set <code>VITE_SUPABASE_URL</code> dan{" "}
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> di <code>.env.local</code>{" "}
          (lokal) atau di environment hosting (Vercel) lalu reload.
        </p>
      </section>
    </main>
  );
}

export default ConfigError;
