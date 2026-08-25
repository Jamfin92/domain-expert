/**
 * An object-literal service with two methods. A call in one method must NOT
 * attribute through the other: ownerDef is the innermost definition
 * (thingsService.getThings), never the holding object (thingsService).
 */
export const thingsService = {
  async getThings(): Promise<unknown> {
    const res = await fetch("/api/things");
    return res.json();
  },
  async removeThing(id: string): Promise<void> {
    await fetch(`/api/things/${id}`, { method: "DELETE" });
  },
};
