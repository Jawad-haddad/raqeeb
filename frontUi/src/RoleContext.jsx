import { createContext, useContext } from "react";

export const RoleContext = createContext({
  role: null,
  roleLoading: true,
  isAdmin: false,
  isTeacher: false,
  isTA: false,
});

export function useRoleContext() {
  return useContext(RoleContext);
}
