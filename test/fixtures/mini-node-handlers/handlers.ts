export function listCrews(_req: unknown, res: { json(v: unknown): void }) {
  res.json([]);
}

export const showCrew = (_req: unknown, res: { json(v: unknown): void }) => {
  res.json({});
};

export class VoyageController {
  create(_req: unknown, res: { json(v: unknown): void }) {
    res.json({});
  }
}

export const legacy = {
  ping(_req: unknown, res: { json(v: unknown): void }) {
    res.json({});
  },
};
