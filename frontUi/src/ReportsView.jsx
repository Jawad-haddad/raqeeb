import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import {
  FileText, RefreshCw, Loader2, Wifi,
  ChevronDown, ChevronUp, Radio, MapPin, Clock,
} from "lucide-react";
import { useRoleContext } from "./RoleContext";

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function fmtShortTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function duration(start, end) {
  if (!start || !end) return "—";
  const mins = Math.round((new Date(end) - new Date(start)) / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function rssiLabel(rssi) {
  if (rssi > -50) return "Excellent";
  if (rssi > -65) return "Good";
  if (rssi > -80) return "Fair";
  return "Weak";
}

// ── Per-report detail section ────────────────────────────────
function ReportDetail({ sessionId }) {
  const [devices, setDevices] = useState(null);

  useEffect(() => {
    if (!sessionId) return;
    supabase
      .from("espData")
      .select("ssid, mac, rssi, block_number, anchor_id, note, created_at")
      .eq("session_id", sessionId)
      .order("block_number", { ascending: true, nullsFirst: false })
      .then(({ data }) => setDevices(data || []));
  }, [sessionId]);

  if (!devices) {
    return (
      <div className="report-detail-loading">
        <Loader2 size={16} className="spinning" />
        Loading detections…
      </div>
    );
  }

  if (devices.length === 0) {
    return <p className="report-detail-empty">No device records linked to this session.</p>;
  }

  // Group by block
  const byBlock = {};
  const unlocated = [];
  for (const d of devices) {
    const b = d.block_number;
    if (b != null && b >= 1) {
      if (!byBlock[b]) byBlock[b] = [];
      byBlock[b].push(d);
    } else {
      unlocated.push(d);
    }
  }

  const uniqueMacs   = new Set(devices.map((d) => d.mac)).size;
  const uniqueSSIDs  = new Set(devices.map((d) => d.ssid).filter(Boolean)).size;
  const anchorsUsed  = [...new Set(devices.map((d) => d.anchor_id).filter(Boolean))];
  const blocksHit    = Object.keys(byBlock).length;
  const avgRssi      = Math.round(devices.reduce((s, d) => s + (d.rssi ?? 0), 0) / devices.length);
  const strongestDev = devices.reduce((best, d) => (d.rssi > (best?.rssi ?? -999) ? d : best), null);

  return (
    <div className="report-detail">

      {/* ── Quick-scan summary ── */}
      <div className="report-detail-summary">
        <div className="rds-chip">
          <span className="rds-value">{uniqueMacs}</span>
          <span className="rds-label">unique device{uniqueMacs !== 1 ? "s" : ""}</span>
        </div>
        <div className="rds-chip">
          <span className="rds-value">{uniqueSSIDs}</span>
          <span className="rds-label">unique SSID{uniqueSSIDs !== 1 ? "s" : ""}</span>
        </div>
        <div className="rds-chip">
          <span className="rds-value">{blocksHit}</span>
          <span className="rds-label">block{blocksHit !== 1 ? "s" : ""} affected</span>
        </div>
        <div className="rds-chip">
          <span className="rds-value">{anchorsUsed.length}</span>
          <span className="rds-label">anchor{anchorsUsed.length !== 1 ? "s" : ""} active</span>
        </div>
        <div className="rds-chip">
          <span className="rds-value">{avgRssi} dBm</span>
          <span className="rds-label">avg signal</span>
        </div>
      </div>

      {/* ── Anchors involved ── */}
      {anchorsUsed.length > 0 && (
        <div className="report-detail-anchors">
          <span className="rda-label">
            <Radio size={11} /> Anchors:
          </span>
          {anchorsUsed.map((a) => (
            <span key={a} className="rda-tag">{a}</span>
          ))}
        </div>
      )}

      {/* ── Strongest signal note ── */}
      {strongestDev && (
        <p className="report-detail-insight">
          Strongest signal: <strong>{strongestDev.ssid || strongestDev.mac}</strong> at{" "}
          {strongestDev.rssi} dBm ({rssiLabel(strongestDev.rssi)})
          {strongestDev.block_number != null ? `, Block ${strongestDev.block_number}` : ""}.
        </p>
      )}

      {/* ── Per-block breakdown ── */}
      {Object.entries(byBlock)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([block, devs]) => (
          <div key={block} className="report-block-group">
            <div className="rbg-header">
              <MapPin size={11} />
              Block {block}
              <span className="rbg-count">{devs.length} device{devs.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="rbg-devices">
              {devs
                .sort((a, b) => (b.rssi ?? -100) - (a.rssi ?? -100))
                .map((d, i) => (
                  <div key={i} className="rbg-device">
                    <div className="rbg-device-main">
                      <Wifi size={11} style={{ color: "#22c55e", flexShrink: 0 }} />
                      <span className="rbg-ssid">{d.ssid || "(no SSID)"}</span>
                      <span className="rbg-mac">{d.mac}</span>
                    </div>
                    <div className="rbg-device-meta">
                      <span className="rbg-rssi">{d.rssi} dBm</span>
                      {d.anchor_id && <span className="rbg-anchor">via {d.anchor_id}</span>}
                      <span className="rbg-time">
                        <Clock size={9} /> {fmtShortTime(d.created_at)}
                      </span>
                    </div>
                    {d.note && <p className="rbg-note">Note: {d.note}</p>}
                  </div>
                ))}
            </div>
          </div>
        ))}

      {/* ── Unlocated ── */}
      {unlocated.length > 0 && (
        <div className="report-block-group">
          <div className="rbg-header">
            <MapPin size={11} style={{ color: "#6b7280" }} />
            Unlocated devices
            <span className="rbg-count">{unlocated.length}</span>
          </div>
          <div className="rbg-devices">
            {unlocated.map((d, i) => (
              <div key={i} className="rbg-device">
                <div className="rbg-device-main">
                  <Wifi size={11} style={{ color: "#6b7280", flexShrink: 0 }} />
                  <span className="rbg-ssid">{d.ssid || "(no SSID)"}</span>
                  <span className="rbg-mac">{d.mac}</span>
                </div>
                <div className="rbg-device-meta">
                  <span className="rbg-rssi">{d.rssi} dBm</span>
                  {d.anchor_id && <span className="rbg-anchor">via {d.anchor_id}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────
export default function ReportsView() {
  const { isAdmin, isTeacher, isTA } = useRoleContext();
  const [reports, setReports]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState(null);

  const fetchReports = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("reports")
      .select(`
        id, session_id, total_detections,
        started_at, ended_at, created_at, course_name,
        halls(id, name, location, rows, columns)
      `)
      .order("created_at", { ascending: false });

    if (!error) setReports(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchReports(); }, []);

  const who = isAdmin ? "All reports" : isTeacher ? "Reports for your halls" : "Your reports";

  const toggleExpand = (id) => setExpanded((prev) => (prev === id ? null : id));

  return (
    <div className="am-page">
      <div className="am-top-bar">
        <div className="am-top-bar-left">
          <div className="am-icon-circle"><FileText size={18} /></div>
          <div>
            <h2 className="am-title">Reports</h2>
            <p className="am-subtitle">{who}</p>
          </div>
        </div>
        <button className="am-refresh-btn" onClick={fetchReports} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spinning" : ""} />
        </button>
      </div>

      {loading ? (
        <div className="am-loading" style={{ marginTop: 40 }}><Loader2 size={24} className="spinning" /></div>
      ) : reports.length === 0 ? (
        <div className="detections-empty" style={{ marginTop: 20 }}>
          <div className="detections-empty-icon">
            <FileText style={{ width: 30, height: 30, color: "#6b7280" }} />
          </div>
          <h3>No reports yet</h3>
          <p>Reports are generated when a TA ends a session.</p>
        </div>
      ) : (
        <div className="reports-list">
          {reports.map((r) => {
            const isOpen = expanded === r.id;
            return (
              <div key={r.id} className="report-card-v2">
                {/* ── Header row ── */}
                <div className="rcv2-header">
                  <div className="rcv2-hall">
                    <span className="rcv2-hall-name">{r.halls?.name || "Unknown hall"}</span>
                    {r.halls?.location && (
                      <span className="rcv2-hall-loc">{r.halls.location}</span>
                    )}
                    {r.halls && (
                      <span className="rcv2-grid-badge">
                        {r.halls.rows}×{r.halls.columns}
                      </span>
                    )}
                  </div>
                  <span className="rcv2-date">{fmtTime(r.created_at)}</span>
                </div>

                {/* ── Course + duration ── */}
                <div className="rcv2-meta">
                  {r.course_name && (
                    <span className="rcv2-course">{r.course_name}</span>
                  )}
                  <span className="rcv2-duration">
                    <Clock size={11} />
                    {fmtTime(r.started_at)} → {fmtTime(r.ended_at)}
                    &nbsp;({duration(r.started_at, r.ended_at)})
                  </span>
                </div>

                {/* ── Counts ── */}
                <div className="rcv2-stats">
                  <div className="rcv2-stat">
                    <Wifi size={12} />
                    <span className="rcv2-stat-val">{r.total_detections}</span>
                    <span className="rcv2-stat-lbl">detections recorded</span>
                  </div>
                </div>

                {/* ── Expand toggle ── */}
                {r.session_id && (
                  <button
                    className="rcv2-expand-btn"
                    onClick={() => toggleExpand(r.id)}
                  >
                    {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    {isOpen ? "Hide device details" : "View device details"}
                  </button>
                )}

                {/* ── Expanded detail ── */}
                {isOpen && r.session_id && (
                  <ReportDetail sessionId={r.session_id} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
