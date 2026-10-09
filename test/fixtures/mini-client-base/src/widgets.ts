import { api, API, envApi } from "./http.js";

export const listWidgets = () => api.get("/widgets");
export const addWidget = (body: unknown) => api.post("/widgets", body);
export const getWidget = (id: number) => fetch(`${API}/widgets/${id}`);
export const health = () => fetch("/api/health");
export const missing = () => api.get("/nothing");

export const listOrders = () => envApi.get("/orders");
export const getOrder = (id: number) => envApi.get(`/orders/${id}`);
export const ping = () => fetch(`${process.env.API_URL}/ping`);
export const ping2 = () => fetch(`${process.env.API_URL}/ping2`);
