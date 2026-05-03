import { useState } from "react";
import "./DetectionCard.css";
import BlockOverlay from "./BlockOverlay";
import CommentsSection from "./CommentsSection";
import { Wifi, Signal, Trash2, Loader2 } from "lucide-react";
import { supabase } from "../supabase";
import { useRoleContext } from "./RoleContext";

export default function DetectionCard({ detection, onDeleted }) {
  const { isAdmin, isTeacher } = useRoleContext();
  const canDelete = isAdmin || isTeacher;

  const [showOverlay, setShowOverlay] = useState(false);
  const [deleting,    setDeleting]    = useState(false);

  const rssi           = detection.rssi || 0;
  const signalStrength = rssi > -50 ? "strong" : rssi > -70 ? "medium" : "weak";
  const signalPercent  = Math.min(100, Math.max(0, ((rssi + 100) / 60) * 100));
  const activeBlock    = Number(detection.block);

  const handleDelete = async () => {
    if (!window.confirm(`Delete detection for "${detection.ssid || detection.mac}"?`)) return;
    setDeleting(true);
    await supabase.from("espData").delete().eq("mac", detection.mac);
    setDeleting(false);
    onDeleted?.(detection.mac);
  };

  return (
    <div
      className={`detection-card detection-${signalStrength} detection-relative`}
      onMouseEnter={() => setShowOverlay(true)}
      onMouseLeave={() => setShowOverlay(false)}
    >
      {showOverlay && <BlockOverlay activeBlock={activeBlock} />}

      <div className="detection-card-header">
        <div className={`detection-icon-circle detection-${signalStrength}`}>
          <Wifi className="detection-icon" />
        </div>

        <div className="detection-main-info">
          <h3 className="detection-ssid">{detection.ssid || "(no SSID)"}</h3>
          <p className="detection-mac-text">{detection.mac}</p>
        </div>

        <div className="detection-header-actions">
          <span className="detection-block-badge">Block #{detection.block}</span>
          {canDelete && (
            <button
              className="detection-action-btn detection-delete-btn"
              onClick={handleDelete}
              disabled={deleting}
              title="Delete detection"
            >
              {deleting
                ? <Loader2 size={13} className="spinning" />
                : <Trash2 size={13} />
              }
            </button>
          )}
        </div>
      </div>

      <div className="detection-signal-section">
        <div className="detection-signal-row">
          <span className="detection-signal-label">Signal strength</span>
          <span className={`detection-signal-value detection-${signalStrength}`}>
            {detection.rssi} dBm
          </span>
        </div>
        <div className="detection-signal-bar">
          <div
            className={`detection-signal-fill detection-${signalStrength}`}
            style={{ width: `${signalPercent}%` }}
          />
        </div>
      </div>

      <div className="detection-footer">
        <div className="detection-strength-text">
          <Signal className={`detection-strength-icon detection-${signalStrength}`} />
          <span>
            {signalStrength === "strong"
              ? "Excellent"
              : signalStrength === "medium"
              ? "Good"
              : "Weak"}{" "}
            signal
          </span>
        </div>
        <div className="detection-footer-separator" />
        <div className="detection-anchor">
          <span className="detection-anchor-label">Anchor:</span>
          <span className="detection-anchor-value">{detection.anchor}</span>
        </div>
      </div>

      {/* Comments replace the old note field */}
      <CommentsSection detectionMac={detection.mac} ssid={detection.ssid} />
    </div>
  );
}
