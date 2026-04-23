import { useState } from "react";
import { Wifi, MapPin, X } from "lucide-react";
import CommentsSection from "./CommentsSection";

// ── Helpers ─────────────────────────────────────────────────
function hasDetections(dets) {
  return dets && dets.length > 0;
}

function sortByRssi(dets) {
  return [...dets].sort((a, b) => (b.rssi ?? -100) - (a.rssi ?? -100));
}

const COL_LABELS_3 = ["Left", "Center", "Right"];
const ROW_LABELS_3 = ["Front", "Middle", "Back"];

function axisLabel(arr, defaultLabels, i) {
  return (arr.length <= 3 ? defaultLabels[i] : null) ?? `${i + 1}`;
}

// ── Signal strength mini-bars ────────────────────────────────
function SignalBars({ rssi }) {
  const lvl = rssi > -50 ? 3 : rssi > -70 ? 2 : 1;
  return (
    <div className="hc-signal">
      {[1, 2, 3].map((n) => (
        <span key={n} className={`hc-bar ${n <= lvl ? "hc-bar-on" : "hc-bar-off"}`} />
      ))}
      <span className="hc-rssi-text">{rssi} dBm</span>
    </div>
  );
}

// ── Single grid cell ─────────────────────────────────────────
function HallCell({ blockNum, dets: rawDets, isSelected, onClick }) {
  const dets    = sortByRssi(rawDets);
  const occupied = hasDetections(dets);
  const primary  = dets[0];

  return (
    <div
      className={`hall-cell ${occupied ? "hc-occupied" : "hc-empty"} ${isSelected ? "hc-selected" : ""}`}
      onClick={onClick}
      title={occupied ? `Block ${blockNum} — click for details` : `Block ${blockNum} — clear`}
    >
      <div className="hc-block-badge">B{blockNum}</div>

      {occupied ? (
        <>
          <div className="hc-body">
            <div className="hc-ssid">{primary.ssid || "(no SSID)"}</div>
            <div className="hc-mac">{primary.mac}</div>
            <SignalBars rssi={primary.rssi} />
          </div>

          <div className="hc-footer">
            {dets.length > 1 && (
              <span className="hc-more-badge">+{dets.length - 1} more</span>
            )}
          </div>
        </>
      ) : (
        <div className="hc-clear">
          <div className="hc-clear-dot" />
          <span className="hc-clear-label">Clear</span>
        </div>
      )}
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────
function DetailPanel({ blockNum, dets, onClose }) {
  const sorted = sortByRssi(dets);
  return (
    <div className="hdp">
      <div className="hdp-header">
        <span>Block {blockNum} — {sorted.length} device{sorted.length !== 1 ? "s" : ""}</span>
        <button className="hdp-close" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="hdp-list">
        {sorted.map((d, i) => (
          <div key={i} className="hdp-item">
            <div className="hdp-item-top">
              <Wifi size={12} />
              <span className="hdp-ssid">{d.ssid || "(no SSID)"}</span>
            </div>
            <div className="hdp-item-meta">
              <span className="hdp-mac">{d.mac}</span>
              <span className="hdp-rssi-text">{d.rssi} dBm</span>
              {d.anchor_id && <span className="hdp-mac">via {d.anchor_id}</span>}
            </div>
            {d.note && <p className="hdp-note">{d.note}</p>}
            <div style={{ marginTop: 6 }}>
              <CommentsSection detectionMac={d.mac} ssid={d.ssid} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function HallGrid({ rows = 3, columns = 3, detections = [] }) {
  const [selectedBlock, setSelectedBlock] = useState(null);
  const totalCells = rows * columns;

  const byBlock   = {};
  const unlocated = [];
  for (const d of detections) {
    const b = Number(d.block_number ?? d.block);
    if (b >= 1 && b <= totalCells) {
      if (!byBlock[b]) byBlock[b] = [];
      byBlock[b].push(d);
    } else {
      unlocated.push(d);
    }
  }

  const occupiedCount = Object.keys(byBlock).length;
  const emptyCount    = totalCells - occupiedCount;

  const toggleBlock = (b) => setSelectedBlock((prev) => (prev === b ? null : b));

  return (
    <div className="hall-grid-container">

      {/* ── Stats bar ── */}
      <div className="hg-stats">
        <span className="hg-stat">
          <span className="hg-dot" style={{ background: "#22c55e" }} />
          {detections.length} device{detections.length !== 1 ? "s" : ""}
        </span>
        <span className="hg-stat">
          <span className="hg-dot" style={{ background: "#22c55e", opacity: 0.5 }} />
          {occupiedCount} block{occupiedCount !== 1 ? "s" : ""} occupied
        </span>
        <span className="hg-stat hg-stat-muted">
          <span className="hg-dot" style={{ background: "#374151" }} />
          {emptyCount} clear
        </span>
      </div>

      {/* ── Column headers ── */}
      <div
        className="hg-col-header"
        style={{ gridTemplateColumns: `52px repeat(${columns}, 1fr)` }}
      >
        <div />
        {Array.from({ length: columns }, (_, i) => (
          <div key={i} className="hg-axis-label">
            {axisLabel(Array(columns), COL_LABELS_3, i)}
          </div>
        ))}
      </div>

      {/* ── Grid rows ── */}
      <div className="hg-body">
        {Array.from({ length: rows }, (_, rowIdx) => (
          <div
            key={rowIdx}
            className="hg-row"
            style={{ gridTemplateColumns: `52px repeat(${columns}, 1fr)` }}
          >
            <div className="hg-row-label">
              {axisLabel(Array(rows), ROW_LABELS_3, rowIdx)}
            </div>

            {Array.from({ length: columns }, (_, colIdx) => {
              const blockNum = rowIdx * columns + colIdx + 1;
              return (
                <HallCell
                  key={blockNum}
                  blockNum={blockNum}
                  dets={byBlock[blockNum] || []}
                  isSelected={selectedBlock === blockNum}
                  onClick={() => toggleBlock(blockNum)}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Detail panel ── */}
      {selectedBlock !== null && (
        <DetailPanel
          blockNum={selectedBlock}
          dets={byBlock[selectedBlock] || []}
          onClose={() => setSelectedBlock(null)}
        />
      )}

      {/* ── Unlocated ── */}
      {unlocated.length > 0 && (
        <div className="hg-unlocated">
          <div className="hg-unlocated-title">
            <MapPin size={13} />
            Unlocated / calculating ({unlocated.length})
          </div>
          <div className="hg-unlocated-list">
            {unlocated.map((d, i) => (
              <div key={i} className="hg-unlocated-item">
                <Wifi size={11} />
                <span>{d.ssid || d.mac}</span>
                <span className="hdp-rssi-text">{d.rssi} dBm</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
