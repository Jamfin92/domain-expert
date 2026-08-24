/** A string-literal union, which is how both real fixtures spell an enum. */
export type Weather = "calm" | "squall" | "gale" | "fog";

/** A real TS enum, which no Node corpus repo has. */
export enum Rating {
  Bronze = "bronze",
  Silver = "silver",
  Gold = "gold",
}

/** Mirrors the voyages table exactly. */
export interface VoyageRow {
  id: string;
  crew_id: string;
  destination: string;
  cargo_tons: number;
  departed_at: number;
}

/**
 * What the API returns. Drops one column and adds one field with nothing behind
 * it — one gap in each direction, which is what both drift generators need.
 */
export interface Voyage {
  id: string;
  crew_id: string;
  destination: string;
  cargo_tons: number;
  weather: Weather;
}

export interface PortCall {
  kind: "port";
  code: string;
  hours: number;
}

export interface SeaLeg {
  kind: "sea";
  miles: number;
  hours: number;
}

/** A discriminated union. `kind` is the only property that tells them apart. */
export type Leg = PortCall | SeaLeg;

export interface Manifest {
  id: string;
  crew: string;
  tons: number;
  sealed: boolean;
}

/**
 * A utility type over an intersection. A syntactic reader sees two properties
 * here; there are four, and only the checker knows that.
 */
export type WireManifest = Omit<Manifest, "tons" | "sealed"> & {
  tons: number | "Infinity";
  sealed: "yes" | "no";
};

/**
 * One collection among scalars. Without a shape shaped like this there is
 * nothing for the array-vs-scalar generator to ask about.
 */
export interface CrewRoster {
  callsign: string;
  captain: string;
  ratings: Rating[];
  updatedAt: number;
}
