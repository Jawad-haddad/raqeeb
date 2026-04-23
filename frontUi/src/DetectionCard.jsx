import { useState } from "react";
import "./DetectionCard.css";
import BlockOverlay from "./BlockOverlay";
import CommentsSection from "./CommentsSection";
import Modal from "./Modal";
import { Wifi, Signal, Trash2, Edit3, Loader2 } from "lucide-react";
import { supabase } from "../supabase";
import { useRoleContext } from "./RoleContext";

const STATUS_COLOR = {
  active: "#22c55e",
  resolved: "#0ea5e9",
  flagged: "#f97373",
};

export default function DetectionCard({ detection, onDeleted, onUpdated }) {
  const { isAdmin, isTeacher } = useRoleContext();
  const canEdit = isAdmin || isTeacher;
  const [showOverlay, setShowOverlay] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [note, setNote] = useState(detection.note || "");
  const [status, setStatus] = useState(detection.status || "active");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const rssi = detection.rssi || 0;
  const signalStrength = rssi > -50 ? "strong" : rssi > -70 ? "medium" : "weak";
  const signalPercent = Math.min(100, Math.max(0, ((rssi + 100) / 60) * 100));
  const activeBlock = Number(detection.block);

  const handleDelete = async () => {
    if (!window.confirm(`Delete detection for "${detection.ssid || detection.mac}"?`)) return;
    setDeleting(true);
    await supabase.from("espData").delete().eq("mac", detection.mac);
    setDeleting(false);
    onDeleted?.(detection.mac);
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    setSaveError("");
    const { error } = await supabase
      .from("espData")
      .update({ note: note.trim() || null, status })
      .eq("mac", detection.mac);
    setSaving(false);
    if (error) {
      setSaveError("Save failed: " + error.message);
    } else {
      onUpdated?.({ ...detection, note: note.trim() || null, status });
      setShowEditModal(false);
    }
  };

  const currentStatus = detection.status || "active";

  return (
    <>
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
            {canEdit && (
              <>
                <button
                  className="detection-action-btn detection-edit-btn"
                  onClick={() => {
                    setNote(detection.note || "");
                    setStatus(detection.status || "active");
                    setShowEditModal(true);
                  }}
                  title="Edit note / status"
                >
                  <Edit3 size={13} />
                </button>
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
              </>
            )}
          </div>
        </div>

        <div className="detection-meta-row">
          <span
            className="detection-status-badge"
            style={{ color: STATUS_COLOR[currentStatus] || STATUS_COLOR.active }}
          >
            ● {currentStatus}
          </span>
          {detection.note && (
            <span className="detection-note-text">{detection.note}</span>
          )}
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

        <CommentsSection detectionMac={detection.mac} ssid={detection.ssid} />
      </div>

      {showEditModal && (
        <Modal title="Edit Detection" onClose={() => setShowEditModal(false)}>
          <div className="edit-form">
            <div className="edit-field">
              <label className="edit-label">Status</label>
              <select
                className="edit-select"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="active">Active</option>
                <option value="resolved">Resolved</option>
                <option value="flagged">Flagged</option>
              </select>
            </div>
            <div className="edit-field">
              <label className="edit-label">Note</label>
              <textarea
                className="edit-textarea"
                rows={3}
                placeholder="Add a note about this device..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {saveError && <p className="edit-error">{saveError}</p>}
            <div className="edit-actions">
              <button
                className="edit-cancel-btn"
                onClick={() => setShowEditModal(false)}
              >
                Cancel
              </button>
              <button
                className="edit-save-btn"
                onClick={handleSaveEdit}
                disabled={saving}
              >
                {saving && <Loader2 size={13} className="spinning" />}
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
