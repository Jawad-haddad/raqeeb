import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../supabase";
import { getDetectionsFromSupabase } from "../data-utils";
import HallGrid from "./HallGrid";
import { Building2, Play, Square, Loader2, Clock, BookOpen, Radio } from "lucide-react";

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function countdown(target) {
  const diff = new Date(target) - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function TAHallView() {
  const [session,      setSession]      = useState(undefined); // undefined = loading
  const [detections,   setDetections]   = useState([]);
  const [loadingDet,   setLoadingDet]   = useState(false);
  const [starting,     setStarting]     = useState(false);
  const [ending,       setEnding]       = useState(false);
  const [error,        setError]        = useState("");
  const [tick,         setTick]         = useState(0);   // for countdown re-renders

  const prevDataRef = useRef([]);

  // ── Bootstrap: fetch TA's current session ────────────────
  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase
        .from("sessions")
        .select(`
          id, status, course_name, exam_start, exam_end,
          actual_started_at, actual_ended_at, teacher_id,
          halls(id, name, location, rows, columns, anchor_ref)
        `)
        .in("status", ["pending", "active"])
        .maybeSingle();
      setSession(sess || null);
    })();
  }, []);

  // ── Countdown ticker ─────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // ── Auto-end when exam_end passes ────────────────────────
  useEffect(() => {
    if (session?.status === "active" && session.exam_end) {
      if (new Date(session.exam_end) <= new Date()) {
        endSession(true);
      }
    }
  }, [tick, session]);

  // ── Fetch detections for active session ─────────────────
  const fetchDetections = useCallback(async () => {
    if (!session || session.status !== "active") return;
    setLoadingDet(true);

    const { data: wlRows } = await supabase.from("whitelist").select("mac");
    const wlMAC = new Set((wlRows || []).map((w) => w.mac.trim().toLowerCase()));

    const raw = await getDetectionsFromSupabase({ sessionId: session.id });

    const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
    const filtered = (raw || []).filter((d) => !wlMAC.has(norm(d.mac)));
    const uniqueKey = (d) => norm(d.mac) || norm(d.ssid) || String(d.id ?? "");
    const unique = Array.from(new Map(filtered.map((d) => [uniqueKey(d), d])).values());

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
    const { error: err } = await supabase
      .from("sessions")
      .update({ status: "active", actual_started_at: new Date().toISOString() })
      .eq("id", session.id);

    if (err) { setError(err.message); }
    else { setSession((s) => ({ ...s, status: "active", actual_started_at: new Date().toISOString() })); }
    setStarting(false);
  };

  // ── End session → generate report ───────────────────────
  const endSession = async (auto = false) => {
    if (!auto && !window.confirm("End this session and generate the report?")) return;
    setEnding(true);
    const endedAt = new Date().toISOString();

    // Count detections for this session
    const { count: total }    = await supabase.from("espData").select("id", { count: "exact", head: true }).eq("session_id", session.id);
    const { count: flagged }  = await supabase.from("espData").select("id", { count: "exact", head: true }).eq("session_id", session.id).eq("status", "flagged");
    const { count: resolved } = await supabase.from("espData").select("id", { count: "exact", head: true }).eq("session_id", session.id).eq("status", "resolved");
    const { count: active }   = await supabase.from("espData").select("id", { count: "exact", head: true }).eq("session_id", session.id).eq("status", "active");

    // Close session
    await supabase.from("sessions").update({
      status: "ended",
      actual_ended_at: endedAt,
    }).eq("id", session.id);

    // Store report (linked to teacher, TA, hall, course)
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("reports").insert({
      session_id:       session.id,
      hall_id:          session.halls?.id,
      teacher_id:       session.teacher_id,
      ta_id:            user.id,
      course_name:      session.course_name,
      total_detections: total   || 0,
      flagged_count:    flagged  || 0,
      resolved_count:   resolved || 0,
      active_count:     active   || 0,
      started_at:       session.actual_started_at,
      ended_at:         endedAt,
    });

    setSession(null);
    setDetections([]);
    setEnding(false);
  };

  const handleDeleted = (mac) => setDetections((prev) => prev.filter((d) => d.mac !== mac));
  const handleUpdated = (upd) => setDetections((prev) => prev.map((d) => d.mac === upd.mac ? upd : d));

  // ── Loading ──────────────────────────────────────────────
  if (session === undefined) {
    return <div className="ta-view-center"><Loader2 size={28} className="spinning" /></div>;
  }

  // ── No session ───────────────────────────────────────────
  if (!session) {
    return (
      <div className="ta-view-center">
        <div className="ta-no-hall-card">
          <Building2 size={32} style={{ color: "var(--text-muted)", marginBottom: 12 }} />
          <h3>No Session Assigned</h3>
          <p>Your teacher hasn't created a session for you yet. Check back later or contact your teacher.</p>
        </div>
      </div>
    );
  }

  const hall = session.halls;
  const isPending = session.status === "pending";
  const isActive  = session.status === "active";

  const toStart = countdown(session.exam_start);
  const toEnd   = countdown(session.exam_end);

  return (
    <div style={{ padding: "20px 28px" }}>

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
      </div>

      {/* ── PENDING STATE ── */}
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

      {/* ── ACTIVE STATE ── */}
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
              <span className="ta-since-label">since {fmtTime(session.actual_started_at)}</span>
            </div>
            <button className="ta-end-btn" onClick={() => endSession(false)} disabled={ending}>
              {ending ? <Loader2 size={14} className="spinning" /> : <Square size={14} />}
              End Session
            </button>
          </div>

          {/* Hall grid */}
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
