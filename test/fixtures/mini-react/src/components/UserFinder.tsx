import { api } from "@/services/api";

/** Touches ONLY api.users.find of the grouped client. */
export function UserFinder() {
  const find = () => api.users.find("1");
  return <form onSubmit={find}>find</form>;
}
