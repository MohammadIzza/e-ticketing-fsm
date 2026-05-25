import { useEffect, useRef, useState } from "react";

interface CameraCaptureProps {
  onCapture: (blob: Blob) => void;
  /** Buka kamera otomatis saat mount. */
  autoStart?: boolean;
}

/**
 * Akses kamera lewat getUserMedia, preview di <video>, snapshot via <canvas>.
 * Memenuhi UX: tombol Buka Kamera, preview, tombol Ambil Foto.
 */
function CameraCapture({ onCapture, autoStart = false }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setActive(false);
  };

  const startCamera = async () => {
    setError(null);
    setStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Browser tidak mendukung getUserMedia.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Gagal mengakses kamera.";
      setError(
        message.includes("Permission") || message.includes("denied")
          ? "Akses kamera ditolak. Izinkan kamera di pengaturan browser."
          : message,
      );
      stopCamera();
    } finally {
      setStarting(false);
    }
  };

  const takePhoto = async () => {
    const video = videoRef.current;
    if (!video || !active) return;

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
    );
    if (!blob) {
      setError("Gagal mengambil foto.");
      return;
    }
    onCapture(blob);
    stopCamera();
  };

  // Auto-start (sekali, saat mount).
  useEffect(() => {
    if (autoStart) {
      void startCamera();
    }
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="camera">
      {!active && (
        <button
          type="button"
          className="btn btn--block"
          onClick={startCamera}
          disabled={starting}
        >
          {starting ? "Membuka kamera..." : "Buka Kamera"}
        </button>
      )}

      <div className={`camera__stage ${active ? "is-active" : ""}`}>
        <video
          ref={videoRef}
          className="camera__video"
          playsInline
          muted
          aria-label="Preview kamera"
        />
      </div>

      {active && (
        <div className="camera__actions">
          <button type="button" className="btn" onClick={takePhoto}>
            Ambil Foto
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={stopCamera}
          >
            Batal
          </button>
        </div>
      )}

      {error && <p className="notice notice--warn">{error}</p>}
    </div>
  );
}

export default CameraCapture;
