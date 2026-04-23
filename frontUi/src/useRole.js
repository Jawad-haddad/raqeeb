import { useState, useEffect } from "react";
import { supabase } from "../supabase";

export function useRole(userId) {
  const [role, setRole] = useState(null);
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setRole(null);
      setRoleLoading(false);
      return;
    }

    let cancelled = false;

    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .single()
      .then(({ data, error }) => {
        if (!cancelled) {
          setRole(error ? "ta" : data.role);
          setRoleLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [userId]);

  return {
    role,
    roleLoading,
    isAdmin:   role === "admin",
    isTeacher: role === "teacher",
    isTA:      role === "ta",
  };
}
