import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import {
  evaluateFormula,
  FormulaError,
} from "../../lib/kinerjaFormula";
import {
  KINERJA_SUBMISSION_STATUS_LABEL,
  type KinerjaApproval,
  type KinerjaAssignment,
  type KinerjaAssignmentType,
  type KinerjaEvidence,
  type KinerjaFormField,
  type KinerjaFormSchema,
  type KinerjaIndicator,
  type KinerjaReviewAction,
  type KinerjaSubmission,
} from "../../lib/kinerjaTypes";

/**
 * Halaman tunggal untuk:
 *   - Buat submission baru     (`/kinerja/submission/new`)
 *   - Buat dari assignment     (`/kinerja/submission/new?assignment=<id>`)
 *   - Edit / view submission   (`/kinerja/submission/:id`)
 *
 * Self-contained: load assignment_type → form schema → indicators →
 * existing submission (jika ada). Render form sesuai schema + input
 * indikator + evidence uploader. Tombol kontrol mengikuti status &
 * role (owner vs reviewer).
 */
function KinerjaSubmissionEditor() {
  const { id: routeId } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const presetAssignmentId = params.get("assignment");

  const navigate = useNavigate();
  const { session, loading: authLoading, user, isSuperadmin, roles } =
    useAuth();
  const isReviewer =
    isSuperadmin || (roles?.includes("pimpinan") ?? false);

  const isNew = !routeId;

  // ---- Form state
  const [submission, setSubmission] = useState<KinerjaSubmission | null>(null);
  const [assignment, setAssignment] = useState<KinerjaAssignment | null>(null);
  const [type, setType] = useState<KinerjaAssignmentType | null>(null);
  const [types, setTypes] = useState<KinerjaAssignmentType[]>([]);
  const [schema, setSchema] = useState<KinerjaFormSchema | null>(null);
  const [indicators, setIndicators] = useState<KinerjaIndicator[]>([]);
  const [evidences, setEvidences] = useState<KinerjaEvidence[]>([]);
  const [approvals, setApprovals] = useState<KinerjaApproval[]>([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [typeId, setTypeId] = useState("");
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [indValues, setIndValues] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  /* --------------------------- Initial load -------------------------- */

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tRes = await supabase
        .from("kinerja_assignment_types")
        .select("*")
        .order("name", { ascending: true });
      if (tRes.error) throw tRes.error;
      const allTypes = (tRes.data ?? []) as KinerjaAssignmentType[];
      setTypes(allTypes);

      let activeTypeId = "";
      let assignmentRow: KinerjaAssignment | null = null;
      let submissionRow: KinerjaSubmission | null = null;

      if (routeId) {
        const sRes = await supabase
          .from("kinerja_submissions")
          .select("*")
          .eq("id", routeId)
          .maybeSingle();
        if (sRes.error) throw sRes.error;
        submissionRow = (sRes.data ?? null) as KinerjaSubmission | null;
        if (!submissionRow) throw new Error("Submission tidak ditemukan.");
        activeTypeId = submissionRow.assignment_type_id;
        if (submissionRow.assignment_id) {
          const aRes = await supabase
            .from("kinerja_assignments")
            .select("*")
            .eq("id", submissionRow.assignment_id)
            .maybeSingle();
          assignmentRow = (aRes.data ?? null) as KinerjaAssignment | null;
        }
        // Load evidences + approvals
        const [eRes, apprRes] = await Promise.all([
          supabase
            .from("kinerja_evidences")
            .select("*")
            .eq("submission_id", routeId)
            .order("uploaded_at", { ascending: true }),
          supabase
            .from("kinerja_approvals")
            .select("*")
            .eq("submission_id", routeId)
            .order("created_at", { ascending: true }),
        ]);
        setEvidences((eRes.data ?? []) as KinerjaEvidence[]);
        setApprovals((apprRes.data ?? []) as KinerjaApproval[]);
      } else if (presetAssignmentId) {
        const aRes = await supabase
          .from("kinerja_assignments")
          .select("*")
          .eq("id", presetAssignmentId)
          .maybeSingle();
        if (aRes.error) throw aRes.error;
        assignmentRow = (aRes.data ?? null) as KinerjaAssignment | null;
        if (!assignmentRow)
          throw new Error("Penugasan tidak ditemukan / akses ditolak.");
        activeTypeId = assignmentRow.assignment_type_id;
      } else {
        // Pure self-claim (alur B). Type dipilih nanti via dropdown.
        const firstActive = allTypes.find((t) => t.is_active);
        if (firstActive) activeTypeId = firstActive.id;
      }

      const activeType = allTypes.find((t) => t.id === activeTypeId) ?? null;
      setAssignment(assignmentRow);
      setSubmission(submissionRow);
      setType(activeType);
      setTypeId(activeTypeId);

      if (activeTypeId) {
        const [schRes, indRes] = await Promise.all([
          supabase
            .from("kinerja_form_schemas")
            .select("*")
            .eq("assignment_type_id", activeTypeId)
            .maybeSingle(),
          supabase
            .from("kinerja_indicators")
            .select("*")
            .eq("assignment_type_id", activeTypeId)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true }),
        ]);
        setSchema((schRes.data ?? null) as KinerjaFormSchema | null);
        const inds = (indRes.data ?? []) as KinerjaIndicator[];
        setIndicators(inds);

        // Init values dari submission (kalau edit) atau default.
        if (submissionRow) {
          setTitle(submissionRow.title);
          setDescription(submissionRow.description ?? "");
          setFormData(submissionRow.form_data ?? {});
          const seed: Record<string, string> = {};
          for (const i of inds) {
            const v = submissionRow.indicator_values?.[i.code];
            seed[i.code] = String(v ?? i.default_value);
          }
          setIndValues(seed);
        } else {
          setTitle(assignmentRow?.title ?? "");
          setDescription("");
          setFormData({});
          const seed: Record<string, string> = {};
          for (const i of inds) seed[i.code] = String(i.default_value);
          setIndValues(seed);
        }
      } else {
        setSchema(null);
        setIndicators([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat.");
    } finally {
      setLoading(false);
    }
  }, [routeId, presetAssignmentId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /* --------------------------- Computed SKS -------------------------- */

  const computedSks = useMemo(() => {
    if (!type?.formula) return null;
    const vars: Record<string, number> = {};
    for (const [k, v] of Object.entries(indValues)) {
      const n = v === "" ? 0 : Number(v);
      if (!Number.isFinite(n)) return { error: `${k} bukan angka` };
      vars[k] = n;
    }
    try {
      return { value: evaluateFormula(type.formula, vars) };
    } catch (e) {
      return {
        error: e instanceof FormulaError ? e.message : "Error formula",
      };
    }
  }, [type?.formula, indValues]);

  /* --------------------------- Permissions --------------------------- */

  if (authLoading || loading) {
    return <div className="auth-screen muted">Memuat...</div>;
  }
  if (!session || !user) return <Navigate to="/login" replace />;

  const isOwner = !!submission && submission.user_id === user.id;
  const editable =
    isNew ||
    (isOwner &&
      (submission?.status === "draft" ||
        submission?.status === "needs_revision"));

  const canReviewerActOn = (sub: KinerjaSubmission | null): boolean =>
    !!sub && isReviewer;

  /* --------------------------- Handlers ------------------------------ */

  const buildIndicatorValues = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const i of indicators) {
      const raw = indValues[i.code];
      const n = raw === "" || raw === undefined ? i.default_value : Number(raw);
      out[i.code] = Number.isFinite(n) ? n : 0;
    }
    return out;
  };

  const computeSksOrNull = (): number | null => {
    if (!type?.formula) return null;
    const r = computedSks;
    if (r && "value" in r && typeof r.value === "number") return r.value;
    return null;
  };

  const validateForm = (): string | null => {
    if (!title.trim()) return "Judul wajib diisi.";
    if (!typeId) return "Pilih jenis penugasan.";
    if (schema?.fields) {
      for (const f of schema.fields) {
        if (f.required) {
          const v = formData[f.name];
          if (
            v === undefined ||
            v === null ||
            (typeof v === "string" && v.trim() === "") ||
            (Array.isArray(v) && v.length === 0)
          ) {
            return `Field "${f.label}" wajib diisi.`;
          }
        }
      }
    }
    return null;
  };

  const saveDraft = async () => {
    setError(null);
    setInfo(null);
    const v = validateForm();
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    const payload = {
      assignment_id: assignment?.id ?? null,
      assignment_type_id: typeId,
      title: title.trim(),
      description: description.trim() || null,
      form_data: formData,
      indicator_values: buildIndicatorValues(),
      computed_sks: computeSksOrNull(),
    };
    if (submission) {
      const { error: err } = await supabase
        .from("kinerja_submissions")
        .update(payload)
        .eq("id", submission.id);
      setBusy(false);
      if (err) {
        setError(err.message);
        return;
      }
      setInfo("Draft tersimpan.");
      void loadAll();
    } else {
      const { data, error: err } = await supabase
        .from("kinerja_submissions")
        .insert({ ...payload, user_id: user.id, status: "draft" })
        .select("*")
        .single();
      setBusy(false);
      if (err) {
        setError(err.message);
        return;
      }
      setInfo("Draft tersimpan.");
      navigate(`/kinerja/submission/${(data as KinerjaSubmission).id}`, {
        replace: true,
      });
    }
  };

  const submitForReview = async () => {
    if (!submission) {
      setError("Simpan draft dulu sebelum submit.");
      return;
    }
    if (!confirm("Submit submission ini untuk direview pimpinan?")) return;
    setBusy(true);
    // Save current edits first to make sure latest values masuk.
    await saveDraft();
    const { error: err } = await supabase.rpc("kinerja_submit_submission", {
      p_submission_id: submission.id,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setInfo("Submission terkirim untuk review.");
    void loadAll();
  };

  const review = async (action: KinerjaReviewAction, note: string | null) => {
    if (!submission) return;
    setBusy(true);
    const { error: err } = await supabase.rpc("kinerja_review_submission", {
      p_submission_id: submission.id,
      p_action: action,
      p_note: note,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    void loadAll();
  };

  const uploadEvidence = async (file: File, label: string) => {
    if (!submission) {
      setError("Simpan draft dulu sebelum upload bukti.");
      return;
    }
    setBusy(true);
    setError(null);
    const ts = Date.now();
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${user.id}/${submission.id}/${ts}_${safe}`;
    const { error: upErr } = await supabase.storage
      .from("kinerja-evidence")
      .upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (upErr) {
      setBusy(false);
      setError(upErr.message);
      return;
    }
    const { error: insErr } = await supabase
      .from("kinerja_evidences")
      .insert({
        submission_id: submission.id,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        label: label.trim() || null,
        uploaded_by: user.id,
      });
    setBusy(false);
    if (insErr) {
      // Rollback storage upload
      await supabase.storage.from("kinerja-evidence").remove([path]);
      setError(insErr.message);
      return;
    }
    void loadAll();
  };

  const downloadEvidence = async (e: KinerjaEvidence) => {
    const { data, error: err } = await supabase.storage
      .from("kinerja-evidence")
      .createSignedUrl(e.storage_path, 60);
    if (err || !data?.signedUrl) {
      setError(err?.message ?? "Gagal buat link unduhan.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const removeEvidence = async (e: KinerjaEvidence) => {
    if (!confirm(`Hapus bukti "${e.file_name}"?`)) return;
    setBusy(true);
    await supabase.storage.from("kinerja-evidence").remove([e.storage_path]);
    const { error: err } = await supabase
      .from("kinerja_evidences")
      .delete()
      .eq("id", e.id);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    void loadAll();
  };

  /* --------------------------- Render -------------------------------- */

  return (
    <div className="app">
      <main className="app__main">
        <div className="page-header">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/kinerja")}
          >
            ← Kembali
          </button>
          <h1 className="page-title">
            {isNew
              ? "Buat Submission Kinerja"
              : `Submission${submission ? ": " + submission.title : ""}`}
          </h1>
        </div>

        {submission && (
          <section className="card">
            <p className="muted small" style={{ margin: 0 }}>
              <strong>Status:</strong>{" "}
              <span className={`pill ${pillStatusClass(submission.status)}`}>
                {KINERJA_SUBMISSION_STATUS_LABEL[submission.status]}
              </span>
              {submission.review_note && (
                <>
                  <br />
                  <strong>Catatan reviewer:</strong> {submission.review_note}
                </>
              )}
              {submission.computed_sks !== null && (
                <>
                  <br />
                  <strong>SKS tersimpan:</strong>{" "}
                  {submission.computed_sks.toFixed(2)}
                </>
              )}
            </p>
          </section>
        )}

        <section className="card">
          <h2 className="section-title">Data Utama</h2>
          {isNew && !presetAssignmentId && (
            <label className="field">
              <span className="field__label">Jenis Penugasan</span>
              <select
                className="field__input"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                style={{ minHeight: "2.5rem" }}
                disabled={!editable}
                required
              >
                <option value="">— Pilih —</option>
                {types
                  .filter((t) => t.is_active)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {assignment && (
            <p className="notice notice--info">
              Submission ini terkait dengan penugasan <strong>{assignment.title}</strong>.
            </p>
          )}
          {type && (
            <p className="muted small" style={{ margin: 0 }}>
              Jenis: <strong>{type.name}</strong>
              {type.description ? ` — ${type.description}` : ""}
            </p>
          )}
          <label className="field">
            <span className="field__label">Judul</span>
            <input
              type="text"
              className="field__input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="cth: Klaim semester ganjil 2025"
              style={{ minHeight: "2.5rem" }}
              disabled={!editable}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Deskripsi (opsional)</span>
            <textarea
              className="field__input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!editable}
            />
          </label>
        </section>

        {schema?.fields && schema.fields.length > 0 && (
          <section className="card">
            <h2 className="section-title">Form Penugasan</h2>
            {schema.fields.map((f) => (
              <FormFieldInput
                key={f.name}
                field={f}
                value={formData[f.name]}
                onChange={(v) =>
                  setFormData((prev) => ({ ...prev, [f.name]: v }))
                }
                disabled={!editable}
              />
            ))}
          </section>
        )}

        {indicators.length > 0 && (
          <section className="card">
            <h2 className="section-title">Indikator</h2>
            <p className="section-desc">
              Isi nilai indikator. Estimasi SKS dihitung otomatis dari
              formula yang ditetapkan superadmin.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(10rem, 1fr))",
                gap: "0.5rem",
              }}
            >
              {indicators.map((i) => (
                <label key={i.id} className="field" style={{ margin: 0 }}>
                  <span className="field__label">
                    {i.label}
                    {i.unit ? ` (${i.unit})` : ""}
                  </span>
                  <input
                    type="number"
                    className="field__input"
                    value={indValues[i.code] ?? ""}
                    onChange={(e) =>
                      setIndValues((prev) => ({
                        ...prev,
                        [i.code]: e.target.value,
                      }))
                    }
                    step="any"
                    style={{ minHeight: "2.5rem" }}
                    disabled={!editable}
                  />
                  <span className="muted small">
                    <code>{i.code}</code>
                  </span>
                </label>
              ))}
            </div>
            {computedSks &&
              ("value" in computedSks && computedSks.value !== undefined ? (
                <p
                  className="notice notice--info"
                  style={{ marginTop: "0.5rem" }}
                >
                  <strong>Estimasi SKS:</strong>{" "}
                  {computedSks.value.toFixed(2)}
                </p>
              ) : "error" in computedSks ? (
                <p
                  className="notice notice--warn"
                  style={{ marginTop: "0.5rem" }}
                >
                  Formula error: {computedSks.error}
                </p>
              ) : null)}
            {!type?.formula && (
              <p className="muted small">
                Belum ada formula untuk jenis ini. Hubungi superadmin.
              </p>
            )}
          </section>
        )}

        {!isNew && submission && (
          <EvidencesSection
            evidences={evidences}
            canModify={editable}
            onUpload={uploadEvidence}
            onDownload={downloadEvidence}
            onDelete={removeEvidence}
            busy={busy}
          />
        )}

        {!isNew && approvals.length > 0 && (
          <section className="card">
            <h2 className="section-title">Riwayat Aksi</h2>
            <ul className="list-rows">
              {approvals.map((a) => (
                <li key={a.id} className="list-row">
                  <div className="list-row__main">
                    <p className="list-row__title">{a.action}</p>
                    <p className="list-row__sub">
                      {new Date(a.created_at).toLocaleString("id-ID")}
                      {a.note ? ` · ${a.note}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card">
          {error && <p className="notice notice--warn">{error}</p>}
          {info && <p className="notice notice--info">{info}</p>}
          <div className="profile-actions">
            {editable && (
              <>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => void saveDraft()}
                  disabled={busy}
                >
                  {busy ? "Menyimpan..." : "Simpan Draft"}
                </button>
                {submission && (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void submitForReview()}
                    disabled={busy}
                  >
                    Kirim untuk Direview
                  </button>
                )}
              </>
            )}
            {canReviewerActOn(submission) && (
              <ReviewerActions
                status={submission!.status}
                onAct={review}
                busy={busy}
              />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

/* ============================================================================
 * Helper components
 * ============================================================================ */

function FormFieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: KinerjaFormField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  const id = `kinf_${field.name}`;
  const common = {
    id,
    className: "field__input",
    style: { minHeight: "2.5rem" },
    disabled,
  };
  return (
    <label className="field" htmlFor={id}>
      <span className="field__label">
        {field.label}
        {field.required ? " *" : ""}
      </span>
      {field.type === "textarea" ? (
        <textarea
          {...common}
          rows={3}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "number" ? (
        <input
          {...common}
          type="number"
          step="any"
          value={(value as number | string | undefined) ?? ""}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
        />
      ) : field.type === "date" ? (
        <input
          {...common}
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "select" ? (
        <select
          {...common}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— Pilih —</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.type === "multiselect" ? (
        <select
          {...common}
          multiple
          value={(value as string[]) ?? []}
          onChange={(e) =>
            onChange(
              Array.from(e.target.selectedOptions).map((o) => o.value),
            )
          }
        >
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.type === "checkbox" ? (
        <input
          {...common}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: "1.25rem", minHeight: "1.25rem" }}
        />
      ) : field.type === "file" ? (
        <span className="muted small">
          Untuk file, gunakan section "Bukti" di bawah.
        </span>
      ) : (
        <input
          {...common}
          type="text"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.help && <span className="muted small">{field.help}</span>}
    </label>
  );
}

function EvidencesSection({
  evidences,
  canModify,
  onUpload,
  onDownload,
  onDelete,
  busy,
}: {
  evidences: KinerjaEvidence[];
  canModify: boolean;
  onUpload: (file: File, label: string) => Promise<void>;
  onDownload: (e: KinerjaEvidence) => Promise<void>;
  onDelete: (e: KinerjaEvidence) => Promise<void>;
  busy: boolean;
}) {
  const [label, setLabel] = useState("");
  return (
    <section className="card">
      <h2 className="section-title">Bukti</h2>
      <p className="section-desc">
        Upload file pendukung (PDF/gambar/dokumen). File disimpan di
        bucket privat <code>kinerja-evidence</code> — link unduhan
        dibuat per-permintaan.
      </p>
      {canModify && (
        <div
          className="list-row"
          style={{ marginBottom: "0.5rem", flexWrap: "wrap" }}
        >
          <div className="list-row__main">
            <label className="field" style={{ margin: 0 }}>
              <span className="field__label">Label (opsional)</span>
              <input
                type="text"
                className="field__input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="cth: Sertifikat seminar"
                style={{ minHeight: "2.5rem" }}
              />
            </label>
          </div>
          <div className="list-row__actions">
            <label className="btn btn--primary" style={{ cursor: "pointer" }}>
              Upload File
              <input
                type="file"
                style={{ display: "none" }}
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    void onUpload(f, label).then(() => setLabel(""));
                  }
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
      )}
      {evidences.length === 0 ? (
        <p className="muted small">Belum ada bukti diunggah.</p>
      ) : (
        <ul className="list-rows">
          {evidences.map((e) => (
            <li key={e.id} className="list-row">
              <div className="list-row__main">
                <p className="list-row__title">
                  {e.label || e.file_name}
                </p>
                <p className="list-row__sub">
                  {e.file_name}
                  {e.size_bytes
                    ? ` · ${Math.round(e.size_bytes / 1024)} KB`
                    : ""}
                </p>
              </div>
              <div className="list-row__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void onDownload(e)}
                >
                  Unduh
                </button>
                {canModify && (
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    onClick={() => void onDelete(e)}
                  >
                    Hapus
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReviewerActions({
  status,
  onAct,
  busy,
}: {
  status: KinerjaSubmission["status"];
  onAct: (
    action: KinerjaReviewAction,
    note: string | null,
  ) => Promise<void> | void;
  busy: boolean;
}) {
  const [note, setNote] = useState("");
  if (status !== "submitted" && status !== "approved") return null;
  return (
    <div style={{ width: "100%" }}>
      <label className="field">
        <span className="field__label">
          Catatan (wajib untuk Revisi / Tolak)
        </span>
        <textarea
          className="field__input"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="profile-actions">
        {status === "submitted" && (
          <>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void onAct("approve", note || null)}
              disabled={busy}
            >
              Approve
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() =>
                note.trim()
                  ? void onAct("revise", note)
                  : alert("Catatan revisi wajib diisi.")
              }
              disabled={busy}
            >
              Minta Revisi
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() =>
                note.trim()
                  ? void onAct("reject", note)
                  : alert("Catatan penolakan wajib diisi.")
              }
              disabled={busy}
            >
              Tolak
            </button>
          </>
        )}
        {status === "approved" && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void onAct("verify", note || null)}
            disabled={busy}
          >
            Verifikasi Final
          </button>
        )}
      </div>
    </div>
  );
}

function pillStatusClass(status: KinerjaSubmission["status"]): string {
  switch (status) {
    case "draft":
      return "pill--info";
    case "submitted":
      return "pill--accent";
    case "needs_revision":
      return "pill--warn";
    case "approved":
      return "pill--ok";
    case "verified":
      return "pill--ok";
    case "rejected":
      return "pill--warn";
  }
}

export default KinerjaSubmissionEditor;
