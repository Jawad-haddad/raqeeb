import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { supabaseAdmin } from "./supabase-admin";
import {
  Activity, RefreshCw, Loader2, Plus, Trash2,
  ChevronDown, ChevronUp, BookOpen,
} from "lucide-react";
import { useRoleContext } from "./RoleContext";

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}
function duration(start, end) {
  if (!start) return "—";
  const mins = Math.round((new Date(end || Date.now()) - new Date(start)) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const STATUS_CLASS = {
  pending: "session-status-pending",
  active:  "session-status-live",
  ended:   "session-status-done",
};
const STATUS_LABEL = { pending: "Pending", active: "Live", ended: "Done" };

// Derive an exam's display status from its sessions
function examStatus(sessions) {
  if (!sessions?.length) return "pending";
  if (sessions.some((s) => s.status === "active"))  return "active";
  if (sessions.every((s) => s.status === "ended"))   return "ended";
  return "pending";
}

export default function SessionsView() {
  const { isAdmin } = useRoleContext();

  // ── Data ─────────────────────────────────────────────────
  const [exams,      setExams]      = useState([]);
  const [standalone, setStandalone] = useState([]); // legacy sessions without exam_id
  const [halls,      setHalls]      = useState([]);
  const [taUsers,    setTaUsers]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [expandedExam, setExpandedExam] = useState(null);

  // ── Create-exam form ─────────────────────────────────────
  const [examTitle,   setExamTitle]   = useState("");
  const [courseName,  setCourseName]  = useState("");
  const [examStart,   setExamStart]   = useState("");
  const [examEnd,     setExamEnd]     = useState("");
  // Dynamic list of hall-TA pairs — one per hall running this exam
  const [hallRows, setHallRows] = useState([{ hallId: "", taId: "" }]);
  const [creating,     setCreating]     = useState(false);
  const [createError,  setCreateError]  = useState("");
  const [createOk,     setCreateOk]     = useState("");

  // ── Load ─────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);

    // Exams with their child sessions + hall info
    const { data: examData } = await supabase
      .from("exams")
      .select(`
        id, title, course_name, exam_start, exam_end, status, created_at,
        sessions(id, status, hall_id, ta_id, halls(id, name, location))
      `)
      .order("created_at", { ascending: false });
    setExams(examData || []);

    // Legacy standalone sessions (created before the exams table existed)
    const { data: standData } = await supabase
      .from("sessions")
      .select("id, status, course_name, exam_start, exam_end, actual_started_at, actual_ended_at, created_at, hall_id, ta_id, halls(id, name, location)")
      .is("exam_id", null)
      .order("created_at", { ascending: false });
    setStandalone(standData || []);

    // Halls (include hall_code for display)
    const { data: hallData } = await supabase
      .from("halls")
      .select("id, name, location, hall_code")
      .order("name");
    setHalls(hallData || []);

    // TAs: fetch role rows then resolve emails via admin client
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "ta");
    const taIds = (roleRows || []).map((r) => r.user_id);
    if (taIds.length) {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
      const filtered = (usersData?.users || []).filter((u) => taIds.includes(u.id));
      setTaUsers(filtered.map((u) => ({ id: u.id, email: u.email })));
    } else {
      setTaUsers([]);
    }

    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const taEmail = (id) => taUsers.find((u) => u.id === id)?.email || id?.slice(0, 8) + "…";

  // ── Hall-row helpers ──────────────────────────────────────
  const addHallRow    = () => setHallRows((p) => [...p, { hallId: "", taId: "" }]);
  const removeHallRow = (i) => setHallRows((p) => p.filter((_, idx) => idx !== i));
  const updateHallRow = (i, field, val) =>
    setHallRows((p) => p.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));

  // ── Create exam ───────────────────────────────────────────
  const createExam = async (e) => {
    e.preventDefault();
    setCreateError(""); setCreateOk("");

    if (!examTitle.trim())  { setCreateError("Enter an exam title."); return; }
    if (!courseName.trim()) { setCreateError("Enter a course name."); return; }
    if (!examStart)         { setCreateError("Set exam start time."); return; }
    if (!examEnd)           { setCreateError("Set exam end time."); return; }
    if (new Date(examEnd) <= new Date(examStart)) {
      setCreateError("End time must be after start time."); return;
    }
    if (hallRows.some((r) => !r.hallId || !r.taId)) {
      setCreateError("Every hall assignment needs a hall and a TA."); return;
    }
    const hallIds = hallRows.map((r) => r.hallId);
    if (new Set(hallIds).size !== hallIds.length) {
      setCreateError("The same hall cannot appear twice in one exam."); return;
    }

    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();

    // Step 1: create the exam record
    const { data: exam, error: examErr } = await supabase
      .from("exams")
      .insert({
        title:       examTitle.trim(),
        course_name: courseName.trim(),
        teacher_id:  user.id,
        exam_start:  new Date(examStart).toISOString(),
        exam_end:    new Date(examEnd).toISOString(),
        status:      "pending",
      })
      .select()
      .single();

    if (examErr) {
      setCreateError(
        examErr.message.includes("exams_unique_per_teacher")
          ? `An exam titled "${examTitle.trim()}" with this exact time window already exists. Change the title or time.`
          : examErr.message
      );
      setCreating(false);
      return;
    }

    // Step 2: create one session per hall
    // hall_code is copied here so the trigger can route espData
    // detections without joining the halls table.
    const { error: sessErr } = await supabase
      .from("sessions")
      .insert(
        hallRows.map((row) => {
          const hall = halls.find((h) => h.id === row.hallId);
          return {
            exam_id:     exam.id,
            hall_id:     row.hallId,
            hall_code:   hall?.hall_code || null,
            ta_id:       row.taId,
            teacher_id:  user.id,
            course_name: courseName.trim(),
            exam_start:  new Date(examStart).toISOString(),
            exam_end:    new Date(examEnd).toISOString(),
            status:      "pending",
          };
        })
      );

    if (sessErr) {
      // Roll back the exam so we don't leave orphaned records
      await supabase.from("exams").delete().eq("id", exam.id);
      setCreateError(
        sessErr.message.includes("uq_one_active_session_per_ta")
          ? "One or more selected TAs already have an active session."
          : sessErr.message
      );
      setCreating(false);
      return;
    }

    setCreateOk(`Exam "${examTitle.trim()}" created with ${hallRows.length} hall(s).`);
    setExamTitle(""); setCourseName(""); setExamStart(""); setExamEnd("");
    setHallRows([{ hallId: "", taId: "" }]);
    load();
    setCreating(false);
  };

  // ── Delete exam (cascades to sessions) ───────────────────
  const deleteExam = async (id, title) => {
    if (!window.confirm(`Delete exam "${title}" and all its sessions?`)) return;
    await supabase.from("exams").delete().eq("id", id);
    setExams((prev) => prev.filter((ex) => ex.id !== id));
  };

  const deleteStandalone = async (id) => {
    if (!window.confirm("Delete this session?")) return;
    await supabase.from("sessions").delete().eq("id", id);
    setStandalone((prev) => prev.filter((s) => s.id !== id));
  };

  // ── Group exams by derived status ─────────────────────────
  const examGroups = {
    active:  exams.filter((ex) => examStatus(ex.sessions) === "active"),
    pending: exams.filter((ex) => examStatus(ex.sessions) === "pending"),
    ended:   exams.filter((ex) => examStatus(ex.sessions) === "ended"),
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="am-page">
      {/* Header */}
      <div className="am-top-bar">
        <div className="am-top-bar-left">
          <div className="am-icon-circle"><Activity size={18} /></div>
          <div>
            <h2 className="am-title">Exams & Sessions</h2>
            <p className="am-subtitle">{isAdmin ? "All exams" : "Your exams"}</p>
          </div>
        </div>
        <button className="am-refresh-btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spinning" : ""} />
        </button>
      </div>

      {/* ── Create-exam form ── */}
      <div className="session-create-card">
        <h3 className="am-card-title" style={{ marginBottom: 14 }}>
          <Plus size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />
          Create New Exam
        </h3>

        <form onSubmit={createExam} className="session-create-form">
          {/* Title + course */}
          <div className="session-form-row">
            <div className="am-field">
              <label className="am-label">Exam Title *</label>
              <input className="am-input" placeholder="e.g. CS101 Midterm"
                value={examTitle} onChange={(e) => setExamTitle(e.target.value)} />
            </div>
            <div className="am-field">
              <label className="am-label">Course Name *</label>
              <input className="am-input" placeholder="e.g. Data Structures"
                value={courseName} onChange={(e) => setCourseName(e.target.value)} />
            </div>
          </div>

          {/* Time window */}
          <div className="session-form-row">
            <div className="am-field">
              <label className="am-label">Exam Start *</label>
              <input className="am-input" type="datetime-local"
                value={examStart} onChange={(e) => setExamStart(e.target.value)} />
            </div>
            <div className="am-field">
              <label className="am-label">Exam End *</label>
              <input className="am-input" type="datetime-local"
                value={examEnd} onChange={(e) => setExamEnd(e.target.value)} />
            </div>
          </div>

          {/* Dynamic hall-TA assignments */}
          <div className="am-field">
            <label className="am-label">Hall Assignments *</label>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 8px" }}>
              Add one row per hall. Each hall will have its own monitoring session.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {hallRows.map((row, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select
                    className="am-input am-select"
                    style={{ flex: 1 }}
                    value={row.hallId}
                    onChange={(e) => updateHallRow(i, "hallId", e.target.value)}
                  >
                    <option value="">Select hall…</option>
                    {halls.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                        {h.hall_code ? ` [${h.hall_code}]` : ""}
                        {h.location  ? ` — ${h.location}` : ""}
                      </option>
                    ))}
                  </select>
                  <select
                    className="am-input am-select"
                    style={{ flex: 1 }}
                    value={row.taId}
                    onChange={(e) => updateHallRow(i, "taId", e.target.value)}
                  >
                    <option value="">Assign TA…</option>
                    {taUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.email}</option>
                    ))}
                  </select>
                  {hallRows.length > 1 && (
                    <button
                      type="button"
                      className="am-delete-btn"
                      onClick={() => removeHallRow(i)}
                      title="Remove this hall"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addHallRow}
              style={{
                marginTop: 8,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                fontSize: 12,
                background: "transparent",
                border: "1px dashed var(--border)",
                borderRadius: 6,
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              <Plus size={13} /> Add Another Hall
            </button>
          </div>

          {createError && <p className="am-error">{createError}</p>}
          {createOk    && <p className="am-success">{createOk}</p>}

          <button
            type="submit"
            disabled={creating}
            className="am-submit-btn"
            style={{ alignSelf: "flex-start" }}
          >
            {creating ? <Loader2 size={14} className="spinning" /> : <BookOpen size={14} />}
            Create Exam
          </button>
        </form>
      </div>

      {/* ── Exams list ── */}
      {loading ? (
        <div className="am-loading" style={{ marginTop: 32 }}>
          <Loader2 size={24} className="spinning" />
        </div>
      ) : (
        <>
          {(["active", "pending", "ended"]).map((group) =>
            examGroups[group].length === 0 ? null : (
              <div className="sessions-section" key={group}>
                <h3 className="sessions-section-title">
                  {group === "active" && <span className="sessions-live-dot" />}
                  {group === "active" ? "Live Exams" : group === "pending" ? "Upcoming Exams" : "Past Exams"}
                  {" "}({examGroups[group].length})
                </h3>

                <div className="sessions-grid">
                  {examGroups[group].map((exam) => {
                    const sessions  = exam.sessions || [];
                    const isLive    = sessions.some((s) => s.status === "active");
                    const isOpen    = expandedExam === exam.id;

                    return (
                      <div
                        key={exam.id}
                        className={`session-card ${isLive ? "session-card-live" : ""}`}
                      >
                        <div className="session-card-header">
                          <span className="session-hall-name">{exam.title}</span>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <span className="hall-meta-badge">
                              {sessions.length} hall{sessions.length !== 1 ? "s" : ""}
                            </span>
                            {isLive && (
                              <span className={`session-status-badge ${STATUS_CLASS.active}`}>
                                {STATUS_LABEL.active}
                              </span>
                            )}
                          </div>
                        </div>

                        <p className="session-meta session-course">{exam.course_name}</p>
                        <p className="session-meta">
                          {fmtTime(exam.exam_start)} → {fmtTime(exam.exam_end)}
                        </p>
                        {isLive && (
                          <p className="session-meta" style={{ color: "#22c55e" }}>
                            Running for {duration(exam.exam_start, null)}
                          </p>
                        )}

                        {/* Expand to see individual hall sessions */}
                        <button
                          className="rcv2-expand-btn"
                          onClick={() => setExpandedExam(isOpen ? null : exam.id)}
                          style={{ marginTop: 8 }}
                        >
                          {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          {isOpen ? "Hide halls" : `View ${sessions.length} hall${sessions.length !== 1 ? "s" : ""}`}
                        </button>

                        {isOpen && (
                          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                            {sessions.map((s) => (
                              <div
                                key={s.id}
                                style={{
                                  background: "var(--bg-secondary, rgba(255,255,255,0.04))",
                                  borderRadius: 6,
                                  padding: "8px 10px",
                                  fontSize: 12,
                                  border: "1px solid var(--border, rgba(255,255,255,0.08))",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                                  <span style={{ fontWeight: 600 }}>
                                    {s.halls?.name || "Unknown hall"}
                                  </span>
                                  <span className={`session-status-badge ${STATUS_CLASS[s.status]}`}>
                                    {STATUS_LABEL[s.status]}
                                  </span>
                                </div>
                                <p style={{ color: "var(--text-muted)", margin: 0 }}>
                                  TA: {taEmail(s.ta_id)}
                                </p>
                                {s.halls?.location && (
                                  <p style={{ color: "var(--text-muted)", margin: "2px 0 0", fontSize: 11 }}>
                                    {s.halls.location}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Delete only for admin, or if all sessions are still pending */}
                        {(isAdmin || sessions.every((s) => s.status === "pending")) && (
                          <button
                            className="session-delete-btn"
                            onClick={() => deleteExam(exam.id, exam.title)}
                            title="Delete exam and all its sessions"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          )}

          {/* Legacy standalone sessions (created before exams table) */}
          {standalone.length > 0 && (
            <div className="sessions-section">
              <h3 className="sessions-section-title" style={{ color: "var(--text-muted)" }}>
                Legacy Sessions
              </h3>
              <div className="sessions-grid">
                {standalone.map((s) => (
                  <div key={s.id} className={`session-card ${s.status === "active" ? "session-card-live" : ""}`}>
                    <div className="session-card-header">
                      <span className="session-hall-name">{s.halls?.name || "Unknown hall"}</span>
                      <span className={`session-status-badge ${STATUS_CLASS[s.status]}`}>
                        {STATUS_LABEL[s.status]}
                      </span>
                    </div>
                    <p className="session-meta session-course">{s.course_name || "No course"}</p>
                    <p className="session-meta">TA: {taEmail(s.ta_id)}</p>
                    <p className="session-meta">
                      {fmtTime(s.exam_start)} → {fmtTime(s.exam_end)}
                    </p>
                    {(isAdmin || s.status === "pending") && (
                      <button
                        className="session-delete-btn"
                        onClick={() => deleteStandalone(s.id)}
                        title="Delete session"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {exams.length === 0 && standalone.length === 0 && (
            <p className="am-empty" style={{ marginTop: 24 }}>
              No exams yet. Create one above.
            </p>
          )}
        </>
      )}
    </div>
  );
}
