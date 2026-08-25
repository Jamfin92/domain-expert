export const statusService = {
  async load(): Promise<unknown> {
    const res = await fetch("/api/status");
    return res.json();
  },
};
