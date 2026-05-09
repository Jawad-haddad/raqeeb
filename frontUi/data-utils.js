import { supabase } from "./supabase";

export const getDetectionsFromSupabase = async ({ sessionId, fromTime, toTime, limit = 200 } = {}) => {
  let query = supabase
    .from("espData")
    .select("anchor_id, ssid, rssi, block_number, mac, created_at, session_id")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (sessionId) query = query.eq("session_id", sessionId);
  if (fromTime)  query = query.gte("created_at", fromTime);
  if (toTime)    query = query.lte("created_at", toTime);

  const { data, error } = await query;

  if (error) {
    // Fallback without newer columns — still filter by sessionId to avoid
    // returning all rows from the table.
    let fbQuery = supabase
      .from("espData")
      .select("anchor_id, ssid, rssi, block_number, mac")
      .limit(limit);
    if (sessionId) fbQuery = fbQuery.eq("session_id", sessionId);
    const { data: fallback, error: fbErr } = await fbQuery;
    if (fbErr) { console.error("Supabase fetch error:", fbErr.message); return []; }
    return (fallback || []).map((row) => ({
      mac:          row.mac,
      anchor_id:    row.anchor_id,
      ssid:         row.ssid,
      rssi:         row.rssi,
      block_number: row.block_number,
      created_at:   null,
      session_id:   null,
    }));
  }

  return (data || []).map((row) => ({
    mac:          row.mac,
    anchor_id:    row.anchor_id,
    ssid:         row.ssid,
    rssi:         row.rssi,
    block_number: row.block_number,
    created_at:   row.created_at,
    session_id:   row.session_id,
  }));
};
