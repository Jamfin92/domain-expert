// A local stand-in for the axios import: this fixture has no node_modules, and
// the reader matches the callee by name, not by where it came from.
interface Http {
  get(url: string): unknown;
  post(url: string, body?: unknown): unknown;
}
declare const axios: { create(config: { baseURL?: string }): Http };

// Statically readable bases.
export const api = axios.create({ baseURL: "/api/" });
export const API = "/api";

// Not statically readable: an env var.
export const envApi = axios.create({ baseURL: process.env.VITE_API_URL });
