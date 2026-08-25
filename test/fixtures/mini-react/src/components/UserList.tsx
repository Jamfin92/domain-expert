import { api } from "@/services/api";

/** Touches ONLY api.users.list of the grouped client. */
export function UserList() {
  const load = () => api.users.list();
  return <ol onClick={load}>users</ol>;
}
