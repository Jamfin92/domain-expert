/**
 * A grouped client: the members of the NESTED object are the definitions.
 * A call in api.users.list must attribute only through list's callers, never
 * through find's — the innermost-ownerDef guard one nesting level down.
 */
export const api = {
  users: {
    async list(): Promise<unknown> {
      const res = await fetch("/api/users");
      return res.json();
    },
    async find(id: string): Promise<unknown> {
      const res = await fetch(`/api/users/${id}`);
      return res.json();
    },
  },
};
