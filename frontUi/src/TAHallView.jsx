import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../supabase";
import { getDetectionsFromSupabase } from "../data-utils";
import HallGrid from "./HallGrid";
import { Building2, Play, Square, Loader2, Clock, BookOpen, Radio, ChevronRight, RefreshCw } from "lucide-react";

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}
function countdown(target) {
  if (!target) return null;
  const diff = new Date(target) - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}
function duration(start, end) {
  if (!start) return "—";
  const mins = Math.round((new Date(end || Date.now()) - new Date(start)) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function TAHallView() {
  const [allSessions, setAllSessions]   = useState(undefined);
  const [session,     setSession]       = useState(null);
  const [currentUser, setCurrentUser]   = useState(null);
  const [detections,  setDetections]    = useState([]);
  const [loadingDet,  setLoadingDet]    = useState(false);
  const [starting,    setStarting]      = useState(false);
  const [ending,      setEnding]        = useState(false);
  const [error,       setError]         = useState("");
  const [tick,        setTick]          = useState(0);

  const prevDataRef = useRef([]);
  const endingRef   = useRef(false); // guard against double-fire from tick effect

  // ── Bootstrap: fetch all pending/active sessions for this TA ─
  const loadSessions = useCallback(async () => {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) { setAllSessions([]); return; }
    setCurrentUser(user);

    const { data: sessions, error: sessErr } = await supabase
      .from("sessions")
      .select(`
        id, status, exam_id, course_name, exam_start, exam_end,
        actual_started_at, actual_ended_at, teacher_id,
        halls(id, name, location, rows, columns, anchor_ref)
      `)
      .eq("ta_id", user.id)
      .in("status", ["pending", "active"])
      .order("exam_start", { ascending: true });

    if (sessErr) {
      console.error("Sessions load error:", sessErr.message);
      setAllSessions([]);
      return;
    }

    const rows = sessions || [];
    setAllSessions(rows);

    // Auto-select: prefer active session, then auto-select if exactly 1
    const active = rows.find((s) => s.status === "active");
    if (active) {
      setSession(active);
    } else if (rows.length === 1) {
      setSession(rows[0]);
    }
    // Multiple pending → show picker (session stays null)
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── Countdown ticker ─────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // ── Auto-end when exam window closes ─────────────────────
  useEffect(() => {
    if (session?.status === "active" && session.exam_end && !endingRef.current) {
      if (new Date(session.exam_end) <= new Date()) {
        endSession(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, session]);

  // ── Fetch detections for active session ──────────────────
  const fetchDetections = useCallback(async () => {
    if (!session || session.status !== "active") return;
    setLoadingDet(true);

    const { data: wlRows } = await supabase.from("whitelist").select("mac");
    const wlMAC = new Set((wlRows || []).map((w) => w.mac.trim().toLowerCase()));

    const raw = await getDetectionsFromSupabase({ sessionId: session.id });

    const norm     = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
    const filtered = (raw || []).filter((d) => !wlMAC.has(norm(d.mac)));
    const uniqueKey = (d) => norm(d.mac) || norm(d.ssid) || String(d.id ?? "");
    const unique   = Array.from(new Map(filtered.map((d) => [uniqueKey(d), d])).values());

    setDetections(unique);
    prevDataRef.current = unique;
    setLoadingDet(false);
  }, [session]);

  useEffect(() => {
    fetchDetections();
    if (!session || session.status !== "active") return;
    const iv = setInterval(fetchDetections, 9000);
    return () => clearInterval(iv);
  }, [fetchDetections]);

  // ── Start session ────────────────────────────────────────
  const startSession = async () => {
    setError("");
    setStarting(true);
    const now = new Date().toISOString();

    const doStart = async () => {
      const { data: updated, error: err } = await supabase
        .from("sessions")
        .update({ status: "active", actual_started_at: now })
        .eq("id", session.id)
        .select()
        .single();
      return { updated, err };
    };

    let { updated, err } = await doStart();

    // Handle the "hall already has an active session" constraint error.
    // This happens when a previous session got stuck in 'active' state.
    if (err?.message?.includes("uq_one_active_session_per_hall")) {
      // Find the blocking session for this hall
      const { data: blocker } = await supabase
        .from("sessions")
        .select("id, ta_id, actual_started_at")
        .eq("hall_id", session.halls?.id)
        .eq("status", "active")
        .maybeSingle();

      if (blocker && blocker.ta_id === currentUser?.id) {
        // It belongs to this same TA — it's a stuck session from a previous run.
        // End it automatically and retry.
        await supabase
          .from("sessions")
          .update({ status: "ended", actual_ended_at: now })
          .eq("id", blocker.id);

        const retry = await doStart();
        updated = retry.updated;
        err     = retry.err;
      } else {
        // Belongs to a different TA — can't touch it.
        setError("This hall already has an active session from another TA. Ask your teacher to end it first.");
        setStarting(false);
        return;
      }
    }

    if (err) {
      setError(err.message);
    } else if (!updated) {
      setError("Session could not be started — please refresh and try again.");
    } else {
      const merged = { ...session, ...updated };
      setSession(merged);
      setAllSessions((prev) =>
        (prev || []).map((s) => s.id === session.id ? merged : s)
      );
    }
    setStarting(false);
  };

  // ── End session → generate report ───────────────────────
  const endSession = async (auto = false) => {
    if (endingRef.current) return;
    if (!auto && !window.confirm("End this session and generate the report?")) return;

    endingRef.current = true;
    setEnding(true);
    setError("");
    const endedAt = new Date().toISOString();

    try {
      // Count total detections for this session
      const { count: total } = await supabase
        .from("espData")
        .select("id", { count: "exact", head: true })
        .eq("session_id", session.id);

      // Mark session ended
      const { error: sessErr } = await supabase
        .from("sessions")
        .update({ status: "ended", actual_ended_at: endedAt })
        .eq("id", session.id);

      if (sessErr) {
        setError("Failed to end session: " + sessErr.message);
        return;
      }

      // Insert report
      const { data: { user } } = await supabase.auth.getUser();
      const { error: repErr } = await supabase.from("reports").insert({
        session_id:       session.id,
        exam_id:          session.exam_id   || null,
        hall_id:          session.halls?.id || null,
        teacher_id:       session.teacher_id,
        ta_id:            user.id,
        course_name:      session.course_name,
        total_detections: total || 0,
        started_at:       session.actual_started_at,
        ended_at:         endedAt,
      });

      if (repErr) {
        // Report failed but session is ended — log and continue
        console.error("Report insert failed:", repErr.message);
      }

      setSession(null);
      setAllSessions([]);
      setDetections([]);
    } finally {
      endingRef.current = false;
      setEnding(false);
    }
  };

  const handleDeleted = (mac) => setDetections((prev) => prev.filter((d) => d.mac !== mac));
  const handleUpdated = (upd) => setDetections((prev) => prev.map((d) => d.mac === upd.mac ? upd : d));

  // ── Loading ──────────────────────────────────────────────
  if (allSessions === undefined) {
    return <div className="ta-view-center"><Loader2 size={28} className="spinning" /></div>;
  }

  // ── No sessions assigned ─────────────────────────────────
  if (allSessions.length === 0) {
    return (
      <div className="ta-view-center">
        <div className="ta-no-hall-card">
          <Building2 size={32} style={{ color: "var(--text-muted)", marginBottom: 12 }} />
          <h3>No Session Assigned</h3>
          <p>Your teacher hasn't created a session for you yet. Check back later.</p>
          <button
            onClick={loadSessions}
            style={{
              marginTop: 16, display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 14px", fontSize: 13, borderRadius: 6, cursor: "pointer",
              background: "rgba(96,165,250,0.12)",
              border: "1px solid rgba(96,165,250,0.3)",
              color: "#60a5fa",
            }}
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>
    );
  }

  // ── Session picker (multiple pending) ────────────────────
  const pendingSessions = (allSessions || []).filter((s) => s.status === "pending");
  if (!session && pendingSessions.length > 1) {
    return (
      <div className="ta-view-center">
        <div className="ta-no-hall-card" style={{ maxWidth: 480, textAlign: "left" }}>
          <BookOpen size={28} style={{ color: "#60a5fa", marginBottom: 12 }} />
          <h3 style={{ marginBottom: 6 }}>Select a Session</h3>
          <p style={{ marginBottom: 16, color: "var(--text-muted)" }}>
            You have {pendingSessions.length} upcoming sessions. Select one to open it.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingSessions.map((s) => {
              const toStart = countdown(s.exam_start);
              return (
                <button
                  key={s.id}
                  onClick={() => setSession(s)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 14px",
                    background: "var(--bg-secondary, rgba(255,255,255,0.05))",
                    border: "1px solid var(--border, rgba(255,255,255,0.1))",
                    borderRadius: 8, cursor: "pointer", textAlign: "left", color: "inherit",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {s.halls?.name || "Unknown hall"}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      {s.course_name} · {fmtTime(s.exam_start)}
                    </div>
                    {toStart && (
                      <div style={{ fontSize: 11, color: "#facc15", marginTop: 2 }}>
                        Starts in {toStart}
                      </div>
                    )}
                  </div>
                  <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (!session) return null;

  const hall      = session.halls;
  const isPending = session.status === "pending";
  const isActive  = session.status === "active";
  const toStart   = countdown(session.exam_start);
  const toEnd     = countdown(session.exam_end);

  return (
    <div style={{ padding: "20px 28px" }}>

      {/* Back to session list */}
      {pendingSessions.length > 1 && (
        <button
          onClick={() => setSession(null)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            marginBottom: 16, fontSize: 12, color: "var(--text-muted)",
            background: "none", border: "none", cursor: "pointer", padding: 0,
          }}
        >
          ← Back to session list
        </button>
      )}

      {/* Hall + course header */}
      <div className="ta-hall-header">
        <div className="ta-hall-info">
          <Building2 size={18} style={{ color: "#22c55e" }} />
          <div>
            <h2 className="ta-hall-name">{hall?.name || "Assigned Hall"}</h2>
            {hall?.location && <p className="ta-hall-loc">{hall.location}</p>}
          </div>
        </div>
        {hall && <div className="ta-hall-grid-badge">{hall.rows}×{hall.columns} grid</div>}
      </div>

      {/* Course + scheduled times */}
      <div className="ta-session-info-bar">
        {session.course_name && (
          <div className="ta-info-chip">
            <BookOpen size={12} />
            {session.course_name}
          </div>
        )}
        <div className="ta-info-chip">
          <Clock size={12} />
          {fmtTime(session.exam_start)} → {fmtTime(session.exam_end)}
        </div>
        {isPending && toStart && (
          <div className="ta-info-chip" style={{ color: "#facc15" }}>
            <Clock size={12} />
            Starts in {toStart}
          </div>
        )}
      </div>

      {/* ── PENDING ── */}
      {isPending && (
        <div className="ta-session-start-card">
          <h3 className="ta-session-start-title">Session not started</h3>
          {toStart ? (
            <p className="ta-session-start-sub">
              Exam starts in <strong style={{ color: "#facc15" }}>{toStart}</strong>.
              You can start monitoring early or wait for the scheduled time.
            </p>
          ) : (
            <p className="ta-session-start-sub" style={{ color: "#22c55e" }}>
              Exam start time has passed — ready to begin.
            </p>
          )}
          {error && <p className="am-error" style={{ marginBottom: 12 }}>{error}</p>}
          <button className="ta-start-btn" onClick={startSession} disabled={starting}>
            {starting ? <Loader2 size={14} className="spinning" /> : <Play size={14} />}
            Start Session
          </button>
        </div>
      )}

      {/* ── ACTIVE ── */}
      {isActive && (
        <>
          <div className="ta-session-live-bar">
            <div className="ta-session-live-info">
              <span className="ta-live-dot" />
              <span className="ta-live-label">Live</span>
              {toEnd ? (
                <span className="ta-course-tag">
                  <Clock size={11} /> ends in {toEnd}
                </span>
              ) : (
                <span className="ta-course-tag" style={{ color: "#f97373" }}>
                  <Clock size={11} /> ending…
                </span>
              )}
              <span className="ta-since-label">
                since {fmtTime(session.actual_started_at)} · running {duration(session.actual_started_at, null)}
              </span>
            </div>
            <button className="ta-end-btn" onClick={() => endSession(false)} disabled={ending}>
              {ending ? <Loader2 size={14} className="spinning" /> : <Square size={14} />}
              End Session
            </button>
          </div>

          {error && <p className="am-error" style={{ margin: "8px 0" }}>{error}</p>}

          <div style={{ marginTop: 16 }}>
            <div className="detections-header" style={{ marginBottom: 4, padding: "0 28px" }}>
              <h3 className="detections-title" style={{ padding: 0 }}>Detections this session</h3>
              <span className="detections-count">
                {detections.length} device{detections.length !== 1 ? "s" : ""}
                {loadingDet && " · refreshing…"}
              </span>
            </div>

            {detections.length === 0 && !loadingDet ? (
              <div className="detections-empty">
                <div className="detections-empty-icon">
                  <Radio style={{ width: 30, height: 30, color: "#6b7280" }} />
                </div>
                <h3>No detections yet</h3>
                <p>Waiting for ESP32 nodes to report unauthorized devices.</p>
              </div>
            ) : (
              <HallGrid
                rows={hall?.rows ?? 3}
                columns={hall?.columns ?? 3}
                detections={detections}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
