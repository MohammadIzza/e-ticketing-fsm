import { useRef, useState } from "react";
import { useAuth } from "../lib/auth";

interface AvatarBlockProps {
  /** Optional initials fallback (e.g. user initials). */
  fallback?: string;
}

/**
 * Foto profil + tombol "Ganti Foto Profil" yang membuka file picker dan
 * langsung upload ke storage `profile-avatars` lalu update profile.avatar_url.
 */
function AvatarBlock({ fallback = "U" }: AvatarBlockProps) {
  const { profile, uploadAvatar, updateMyProfile } = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = () => inputRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = ""; // reset agar event terpicu lagi untuk file yg sama
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("File harus gambar.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Ukuran maksimal 5MB.");
      return;
    }

    setBusy(true);
    try {
      const { url, error: upErr } = await uploadAvatar(file);
      if (upErr || !url) {
        setError(upErr ?? "Gagal mengupload foto.");
        return;
      }
      const { error: updErr } = await updateMyProfile({ avatarUrl: url });
      if (updErr) {
        setError(updErr);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="avatar-block">
      <div className="avatar">
        {profile?.avatar_url ? (
          <img src={profile.avatar_url} alt="Foto profil" />
        ) : (
          <span className="avatar__fallback">
            {(fallback || "U").slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={onPick}
        disabled={busy}
      >
        {busy ? "Mengupload..." : "Ganti Foto Profil"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={onFile}
      />
      {error && <p className="notice notice--warn">{error}</p>}
    </div>
  );
}

export default AvatarBlock;
