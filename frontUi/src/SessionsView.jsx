import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { supabaseAdmin } from "./supabase-admin";
import { Activity, RefreshCw, Loader2, Plus, Trash2 } from "lucide-react";
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

const STATUS_CLASS = { pending: "session-status-pending", active: "session-status-live", ended: "session-status-done" };
const STATUS_LABEL = { pending: "Pending", active: "Live", ended: "Done" };

export default function SessionsView() {
  const { isAdmin } = useRoleContext();

  // ── Data ─────────────────────────────────────────────────
  const [sessions, setSessions]   = useState([]);
  const [halls,    setHalls]      = useState([]);
  const [taUsers,  setTaUsers]    = useState([]);   // [{id, email}]
  const [loading,  setLoading]    = useState(true);

  // ── Create-session form ──────────────────────────────────
  const [selHall,  setSelHall]    = useState("");
  const [selTA,    setSelTA]      = useState("");
  const [courseName, setCourseName] = useState("");
  const [examStart,  setExamStart]  = useState("");
  const [examEnd,    setExamEnd]    = useState("");
  const [creating, setCreating]   = useState(false);
  const [createError, setCreateError] = useState("");
  const [createOk,    setCreateOk]    = useState("");

  // ── Load ─────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);

    // Sessions (RLS limits to teacher's own or admin sees all)
    const { data: sess } = await supabase
      .from("sessions")
      .select("id, status, course_name, exam_start, exam_end, actual_started_at, actual_ended_at, created_at, hall_id, ta_id, halls(id, name, location)")
      .order("created_at", { ascending: false });
    setSessions(sess || []);

    // Halls
    const { data: hallData } = await supabase.from("halls").select("id, name, location").order("name");
    setHalls(hallData || []);

    // TAs: pull role rows, then resolve emails via admin client
    const { data: roleRows } = await supabase.from("user_roles").select("user_id").eq("role", "ta");
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

  // ── Helper: TA email lookup ───────────────────────────────
  const taEmail = (id) => taUsers.find((u) => u.id === id)?.email || id?.slice(0, 8) + "…";

  // ── Create session ────────────────────────────────────────
  const createSession = async (e) => {
    e.preventDefault();
    setCreateError(""); setCreateOk("");

    if (!selHall)     { setCreateError("Select a hall."); return; }
    if (!selTA)       { setCreateError("Select a TA."); return; }
    if (!courseName.trim()) { setCreateError("Enter a course name."); return; }
    if (!examStart)   { setCreateError("Set exam start time."); return; }
    if (!examEnd)     { setCreateError("Set exam end time."); return; }
    if (new Date(examEnd) <= new Date(examStart)) {
      setCreateError("End time must be after start time."); return;
    }

    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase.from("sessions").insert({
      hall_id:     selHall,
      ta_id:       selTA,
      teacher_id:  user.id,
      course_name: courseName.trim(),
      exam_start:  new Date(examStart).toISOString(),
      exam_end:    new Date(examEnd).toISOString(),
      status:      "pending",
    });

    if (error) {
      setCreateError(
        error.message.includes("uq_one_active_session_per_ta")
          ? "This TA already has a pending or active session."
          : error.message
      );
    } else {
      setCreateOk("Session created — TA will see it on their next login.");
      setSelHall(""); setSelTA(""); setCourseName(""); setExamStart(""); setExamEnd("");
      load();
    }
    setCreating(false);
  };

  // ── Delete session ────────────────────────────────────────
  const deleteSession = async (id) => {
    if (!window.confirm("Delete this session?")) return;
    await supabase.from("sessions").delete().eq("id", id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  };

  // ── Group by status ───────────────────────────────────────
  const groups = {
    active:  sessions.filter((s) => s.status === "active"),
    pending: sessions.filter((s) => s.status === "pending"),
    ended:   sessions.filter((s) => s.status === "ended"),
  };

  return (
    <div className="am-page">
      {/* Header */}
      <div className="am-top-bar">
        <div className="am-top-bar-left">
          <div className="am-icon-circle"><Activity size={18} /></div>
          <div>
            <h2 className="am-title">Sessions</h2>
            <p className="am-subtitle">{isAdmin ? "All exam sessions" : "Your exam sessions"}</p>
          </div>
        </div>
        <button className="am-refresh-btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spinning" : ""} />
        </button>
      </div>

      {/* Create-session form */}
      <div className="session-create-card">
        <h3 className="am-card-title" style={{ marginBottom: 14 }}>
          <Plus size={14} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} />
          Create New Session
        </h3>

        <form onSubmit={createSession} className="session-create-form">
          {/* Row 1: Hall + TA */}
          <div className="session-form-row">
            <div className="am-field">
              <label className="am-label">Hall</label>
              <select className="am-input am-select" value={selHall} onChange={(e) => setSelHall(e.target.value)}>
                <option value="">Select hall…</option>
                {halls.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}{h.location ? ` — ${h.location}` : ""}</option>
                ))}
              </select>
            </div>
            <div className="am-field">
              <label className="am-label">Assign TA</label>
              <select className="am-input am-select" value={selTA} onChange={(e) => setSelTA(e.target.value)}>
                <option value="">Select TA…</option>
                {taUsers.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
              </select>
            </div>
          </div>

          {/* Row 2: Course name */}
          <div className="am-field">
            <label className="am-label">Course Name</label>
            <input className="am-input" placeholder="e.g. Data Structures Midterm"
              value={courseName} onChange={(e) => setCourseName(e.target.value)} />
          </div>

          {/* Row 3: Times */}
          <div className="session-form-row">
            <div className="am-field">
              <label className="am-label">Exam Start</label>
              <input className="am-input" type="datetime-local"
                value={examStart} onChange={(e) => setExamStart(e.target.value)} />
            </div>
            <div className="am-field">
              <label className="am-label">Exam End</label>
              <input className="am-input" type="datetime-local"
                value={examEnd} onChange={(e) => setExamEnd(e.target.value)} />
            </div>
          </div>

          {createError && <p className="am-error">{createError}</p>}
          {createOk    && <p className="am-success">{createOk}</p>}

          <button type="submit" disabled={creating} className="am-submit-btn" style={{ alignSelf: "flex-start" }}>
            {creating ? <Loader2 size={14} className="spinning" /> : <Plus size={14} />}
            Create Session
          </button>
        </form>
      </div>

      {/* Sessions list */}
      {loading ? (
        <div className="am-loading" style={{ marginTop: 32 }}><Loader2 size={24} className="spinning" /></div>
      ) : sessions.length === 0 ? (
        <p className="am-empty" style={{ marginTop: 24 }}>No sessions yet. Create one above.</p>
      ) : (
        <>
          {(["active", "pending", "ended"]).map((status) =>
            groups[status].length === 0 ? null : (
              <div className="sessions-section" key={status}>
                <h3 className="sessions-section-title">
                  {status === "active" && <span className="sessions-live-dot" />}
                  {STATUS_LABEL[status]} ({groups[status].length})
                </h3>
                <div className="sessions-grid">
                  {groups[status].map((s) => (
                    <div key={s.id} className={`session-card ${status === "active" ? "session-card-live" : ""}`}>
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
                      {s.status === "active" && s.actual_started_at && (
                        <p className="session-meta" style={{ color: "#22c55e" }}>
                          Running for {duration(s.actual_started_at, null)}
                        </p>
                      )}
                      {s.status === "ended" && s.actual_started_at && (
                        <p className="session-meta">
                          Ran: {duration(s.actual_started_at, s.actual_ended_at)}
                        </p>
                      )}
                      {(isAdmin || s.status === "pending") && (
                        <button className="session-delete-btn" onClick={() => deleteSession(s.id)} title="Delete">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
