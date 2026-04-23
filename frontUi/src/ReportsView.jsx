import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { FileText, RefreshCw, Loader2, AlertTriangle, CheckCircle, Wifi } from "lucide-react";
import { useRoleContext } from "./RoleContext";

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function duration(start, end) {
  if (!start || !end) return "—";
  const mins = Math.round((new Date(end) - new Date(start)) / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function ReportsView() {
  const { isAdmin, isTeacher, isTA } = useRoleContext();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchReports = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("reports")
      .select(`
        id, total_detections, flagged_count, resolved_count, active_count,
        started_at, ended_at, created_at, course_name,
        halls(id, name, location)
      `)
      .order("created_at", { ascending: false });

    if (!error) setReports(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchReports(); }, []);

  const who = isAdmin ? "All reports" : isTeacher ? "Reports for your halls" : "Your reports";

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
        <div className="reports-grid">
          {reports.map((r) => (
            <div key={r.id} className="report-card">
              <div className="report-card-header">
                <div>
                  <h3 className="report-hall-name">{r.halls?.name || "Unknown hall"}</h3>
                  {r.halls?.location && <p className="report-hall-loc">{r.halls.location}</p>}
                </div>
                <span className="report-date">{fmtTime(r.created_at)}</span>
              </div>

              {r.course_name && <p className="report-course">{r.course_name}</p>}

              <div className="report-time-row">
                <span>{fmtTime(r.started_at)}</span>
                <span className="report-arrow">→</span>
                <span>{fmtTime(r.ended_at)}</span>
                <span className="report-duration">({duration(r.started_at, r.ended_at)})</span>
              </div>

              <div className="report-stats-row">
                <div className="report-stat">
                  <Wifi size={12} />
                  <span className="report-stat-value">{r.total_detections}</span>
                  <span className="report-stat-label">total</span>
                </div>
                <div className="report-stat report-stat-flagged">
                  <AlertTriangle size={12} />
                  <span className="report-stat-value">{r.flagged_count}</span>
                  <span className="report-stat-label">flagged</span>
                </div>
                <div className="report-stat report-stat-resolved">
                  <CheckCircle size={12} />
                  <span className="report-stat-value">{r.resolved_count}</span>
                  <span className="report-stat-label">resolved</span>
                </div>
                <div className="report-stat">
                  <span className="report-stat-value">{r.active_count}</span>
                  <span className="report-stat-label">active</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
