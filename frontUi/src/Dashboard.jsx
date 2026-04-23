import { useEffect, useState, useRef } from "react";
import { supabase } from "../supabase";
import { getDetectionsFromSupabase } from "../data-utils";
import WhitelistForm from "./whitelist";
import DetectionCard from "./DetectionCard";
import AccountManager from "./AccountManager";
import HallsManager from "./HallsManager";
import CoursesManager from "./CoursesManager";
import SessionsView from "./SessionsView";
import ReportsView from "./ReportsView";
import TAHallView from "./TAHallView";
import { useRoleContext } from "./RoleContext";
import {
  Radio, Activity, Wifi, Shield, LogOut,
  Users, Building2, BookOpen, FileText, ClipboardList,
} from "lucide-react";

// ── Admin all-detections view (unchanged look) ───────────────
function AllDetectionsView() {
  const { isAdmin, isTeacher } = useRoleContext();
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasNewDetection, setHasNewDetection] = useState(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [whitelistCount, setWhitelistCount] = useState(0);
  const prevDataRef = useRef([]);

  const norm    = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
  const normMac = (v) => norm(v);
  const uniqueKey = (d) => norm(d.ssid) || normMac(d.mac) || String(d.id ?? JSON.stringify(d));

  const fetchFromSupabase = async () => {
    setIsLoading(true);
    try {
      const { data: wlRows } = await supabase.from("whitelist").select("mac");
      const wlMAC = (wlRows || []).map((w) => normMac(w.mac)).filter(Boolean);
      setWhitelistCount(wlMAC.length);

      const detections = await getDetectionsFromSupabase();
      const filtered   = (detections || []).filter((d) => !wlMAC.includes(normMac(d.mac)));
      const unique     = Array.from(new Map(filtered.map((d) => [uniqueKey(d), d])).values());

      const newOnes = unique.filter((d) => !prevDataRef.current.some((p) => uniqueKey(p) === uniqueKey(d)));
      if (newOnes.length > 0) {
        setHasNewDetection(true);
        setToastMessage(`${newOnes.length} new detection(s) found!`);
      } else {
        setHasNewDetection(false);
        setToastMessage("No new detections");
      }
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
      setData(unique);
      prevDataRef.current = unique;
    } catch (err) {
      setToastMessage("Failed to fetch data");
      setShowToast(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchFromSupabase(); }, []);
  useEffect(() => {
    const iv = setInterval(fetchFromSupabase, 9000);
    return () => clearInterval(iv);
  }, []);

  const handleDeleted = (mac) => {
    setData((prev) => prev.filter((d) => d.mac !== mac));
    prevDataRef.current = prevDataRef.current.filter((d) => d.mac !== mac);
  };
  const handleUpdated = (upd) => {
    setData((prev) => prev.map((d) => (d.mac === upd.mac ? upd : d)));
    prevDataRef.current = prevDataRef.current.map((d) => (d.mac === upd.mac ? upd : d));
  };

  const totalDetections = data.length;
  const uniqueAnchors   = new Set(data.map((d) => d.anchor_id ?? d.anchor)).size;

  return (
    <>
      {showToast && (
        <div className={`toast ${hasNewDetection ? "toast-success" : "toast-neutral"}`}>
          {toastMessage}
        </div>
      )}
      <header className="dashboard-header">
        <div>
          <h2 className="dashboard-header-title">All Detections</h2>
          <p className="dashboard-header-subtitle">Real-time WiFi detection overview · auto-refresh every 9s</p>
        </div>
      </header>
      <div className="dashboard-content">
        <div className="dashboard-top-row">
          <div className={`status-card ${isLoading ? "status-card-loading" : hasNewDetection ? "status-card-ok" : "status-card-empty"}`}>
            <div className="status-icon-wrapper">
              {isLoading ? <Activity className="status-icon spinning" /> : <Activity className="status-icon" />}
            </div>
            <div>
              <h3 className="status-title">{isLoading ? "Scanning…" : hasNewDetection ? "New detections" : "No new detections"}</h3>
              <p className="status-subtitle">Last check just now</p>
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-icon-circle"><Shield className="summary-icon" /></div>
            <div>
              <h3 className="summary-title">Network overview</h3>
              <p className="summary-subtitle">{totalDetections} devices · {uniqueAnchors} anchors · {whitelistCount} whitelisted</p>
            </div>
          </div>
        </div>

        <div className="detections-header">
          <h3 className="detections-title">Detected devices</h3>
          <span className="detections-count">{data.length} device{data.length !== 1 ? "s" : ""}</span>
        </div>

        {data.length === 0 && !isLoading ? (
          <div className="detections-empty">
            <div className="detections-empty-icon"><Radio className="detections-empty-radio" /></div>
            <h3>No detections yet</h3>
            <p>Waiting for ESP32 nodes to send data.</p>
          </div>
        ) : (
          <div className="detections-grid">
            {data.map((d, i) => (
              <DetectionCard
                key={`${d.mac ?? "no-mac"}-${d.anchor ?? "no-anchor"}-${i}`}
                detection={d}
                onDeleted={handleDeleted}
                onUpdated={handleUpdated}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Role label ───────────────────────────────────────────────
function roleLabel(role) {
  if (role === "admin")   return "Admin";
  if (role === "teacher") return "Teacher";
  if (role === "ta")      return "TA";
  return role || "User";
}

// ── Nav config per role ──────────────────────────────────────
function navItems(role) {
  if (role === "admin") return [
    { id: "sessions",   label: "Sessions",     Icon: Activity },
    { id: "halls",      label: "Halls",        Icon: Building2 },
    { id: "courses",    label: "Courses",      Icon: BookOpen },
    { id: "detections", label: "All Detections", Icon: Wifi },
    { id: "accounts",   label: "Accounts",     Icon: Users },
    { id: "reports",    label: "Reports",      Icon: FileText },
  ];
  if (role === "teacher") return [
    { id: "sessions",   label: "Sessions",     Icon: Activity },
    { id: "courses",    label: "Courses",      Icon: BookOpen },
    { id: "accounts",   label: "Manage TAs",   Icon: Users },
    { id: "reports",    label: "Reports",      Icon: FileText },
  ];
  // TA
  return [
    { id: "ta-session", label: "My Session",   Icon: ClipboardList },
    { id: "reports",    label: "My Reports",   Icon: FileText },
  ];
}

function defaultView(role) {
  if (role === "admin")   return "sessions";
  if (role === "teacher") return "sessions";
  return "ta-session";
}

// ── Main Dashboard ───────────────────────────────────────────
export default function Dashboard({ onLogout, userEmail }) {
  const { role, isAdmin, isTeacher, isTA } = useRoleContext();
  const [view, setView] = useState(() => defaultView(role));

  // Reset view when role resolves
  useEffect(() => { if (role) setView(defaultView(role)); }, [role]);

  const items = navItems(role);
  const avatarLetter = (userEmail || "U")[0].toUpperCase();
  const showWhitelist = isAdmin || isTeacher;

  const renderMain = () => {
    switch (view) {
      case "sessions":   return <SessionsView />;
      case "halls":      return <HallsManager />;
      case "courses":    return <CoursesManager />;
      case "detections": return <AllDetectionsView />;
      case "accounts":   return <AccountManager />;
      case "reports":    return <ReportsView />;
      case "ta-session": return <TAHallView />;
      default:           return null;
    }
  };

  return (
    <div className="dashboard">
      <aside className="dashboard-sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo-circle">
            <Radio className="sidebar-logo-icon" />
          </div>
          <div>
            <h1 className="sidebar-title">Raqeeb</h1>
            <p className="sidebar-subtitle">
              <span className="sidebar-status-dot" />
              {roleLabel(role)}
            </p>
          </div>
        </div>

        <nav className="sidebar-nav">
          {items.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`sidebar-nav-btn ${view === id ? "sidebar-nav-active" : ""}`}
              onClick={() => setView(id)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>

        {showWhitelist && (
          <div className="sidebar-whitelist">
            <WhitelistForm />
          </div>
        )}

        <div className="sidebar-user">
          <div className="sidebar-user-info">
            <div className="sidebar-user-avatar">{avatarLetter}</div>
            <div>
              <p className="sidebar-user-name">{userEmail || "User"}</p>
              <p className="sidebar-user-role">{roleLabel(role)}</p>
            </div>
          </div>
          <button className="sidebar-logout-btn" onClick={onLogout}>
            <LogOut className="sidebar-logout-icon" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="dashboard-main">
        {renderMain()}
      </main>
    </div>
  );
}
