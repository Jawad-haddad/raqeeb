import { useState } from "react";
import "./DetectionCard.css";
import BlockOverlay from "./BlockOverlay";
import { Wifi, Signal } from "lucide-react";

export default function DetectionCard({ detection }) {
  const [showOverlay, setShowOverlay] = useState(false);

  const rssi = detection.rssi || 0;
  const signalStrength = rssi > -50 ? "strong" : rssi > -70 ? "medium" : "weak";

  const signalPercent = Math.min(100, Math.max(0, ((rssi + 100) / 60) * 100));

  const activeBlock = Number(detection.block);

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
        </div>

        <span className="detection-block-badge">Block #{detection.block}</span>
      </div>

      <div className="detection-signal-section">
        <div className="detection-signal-row">
          <span className="detection-signal-label">Signal strength</span>
          <span
            className={`detection-signal-value detection-${signalStrength}`}
          >
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
          <Signal
            className={`detection-strength-icon detection-${signalStrength}`}
          />
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
    </div>
  );
}
// FORCE_CHANGE
