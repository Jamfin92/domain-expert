import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api, type EntityRefsResult, type EntitySearchHit } from "@/lib/api";
import { refsState, type RefsState } from "@/lib/refs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { desktop, isDesktop } from "@/lib/desktop";

/**
 * Search -> pick an entity -> where it is mentioned, by file then method.
 *
 * The server answers both (`/search`, `/refs`); the grouping and the
 * unknown-vs-zero distinction live in `lib/refs.ts`. Refs are MENTIONS, not
 * call sites (`EntityRef`), and the panel says so.
 */

interface Props {
  repoId: string;
  repoPath: string;
  selected: string | null;
  onSelect: (name: string) => void;
}

export function EntitySearch({ repoId, repoPath, selected, onSelect }: Props): React.ReactElement {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<EntitySearchHit[] | null>(null);
  const [target, setTarget] = useState<string | null>(selected);
  const [refs, setRefs] = useState<EntityRefsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A new repo is a new vocabulary: nothing from the last one may linger.
  useEffect(() => {
    setQuery("");
    setHits(null);
    setRefs(null);
    setError(null);
  }, [repoId]);

  // Selection from the diagram, the search, or the flow all land here.
  useEffect(() => {
    setTarget(selected);
  }, [selected]);

  useEffect(() => {
    if (query.trim() === "") {
      setHits(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .search(repoId, query)
        .then((r) => {
          if (!cancelled) setHits(r.hits);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [repoId, query]);

  useEffect(() => {
    if (target === null) {
      setRefs(null);
      return;
    }
    let cancelled = false;
    setRefs(null);
    api
      .refs(repoId, target)
      .then((r) => {
        if (!cancelled) setRefs(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, target]);

  const state: RefsState | null = refs ? refsState(refs) : null;

  return (
    <Card className="gap-3 py-4" data-psq="entity-search">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Search className="size-4" />
          Find an entity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-4">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Part of an entity, table or property name"
          className="h-8 text-xs"
          spellCheck={false}
          aria-label="Search entities"
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {hits !== null && hits.length === 0 ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>No entity, table or property name contains “{query.trim()}”.</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              data-psq="lookup-exact"
              onClick={() => setTarget(query.trim())}
            >
              Look up refs for “{query.trim()}” anyway
            </Button>
          </div>
        ) : null}
        {hits !== null && hits.length > 0 ? (
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
            {hits.map((h) => (
              <li key={`${h.file}:${h.name}`}>
                <button
                  type="button"
                  data-psq="search-hit"
                  className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-accent/50"
                  onClick={() => onSelect(h.name)}
                >
                  <span className="font-mono font-semibold">{h.name}</span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {h.reasons.map((r) => (r.property ?? r.matched)).slice(0, 2).join(", ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {target !== null ? (
          <div data-psq="refs-panel" className="space-y-1.5 border-t pt-2 text-xs">
            <div className="font-semibold">
              Mentions of <span className="font-mono">{target}</span>
            </div>
            {state === null ? (
              <p className="text-muted-foreground">Looking…</p>
            ) : state.kind === "unknown" ? (
              <p data-psq="refs-unknown" className="text-[var(--warning)]">
                psq has no entity named {target}. That is not the same as zero mentions.
              </p>
            ) : state.kind === "none" ? (
              <p data-psq="refs-none" className="text-muted-foreground">
                Known entity, zero mentions found in method bodies psq can read.
              </p>
            ) : (
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                <p className="text-[10px] text-muted-foreground">
                  {state.count} mention{state.count === 1 ? "" : "s"} — a name appearing, not
                  necessarily a call.
                </p>
                {state.files.map((f) => (
                  <div key={f.file} data-psq="refs-file">
                    <div className="truncate font-mono text-[10px] text-muted-foreground" title={f.file}>
                      {f.file}
                    </div>
                    {f.methods.map((m) => (
                      <div key={`${m.type}.${m.method}`} className="pl-2">
                        <span className="font-mono">{m.type}.{m.method}</span>
                        <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                          {m.refs.map((r, i) => (
                            <span key={`${r.line}:${i}`}>
                              {i > 0 ? ", " : ""}
                              {isDesktop() ? (
                                <button
                                  type="button"
                                  className="underline-offset-2 hover:underline"
                                  onClick={() => {
                                    void desktop()?.openInEditor(`${repoPath}/${f.file}`, r.line);
                                  }}
                                >
                                  :{r.line}
                                </button>
                              ) : (
                                `:${r.line}`
                              )}
                            </span>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
