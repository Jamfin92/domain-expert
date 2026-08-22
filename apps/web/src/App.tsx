import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Loader2, X } from "lucide-react";
import { api, type PublicQuestion, type RepoSummary, type Section } from "@/lib/api";
import { desktop, isDesktop } from "@/lib/desktop";
import { Dashboard } from "@/views/Dashboard";
import { Quiz } from "@/views/Quiz";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Session {
  id: string;
  questions: PublicQuestion[];
}

export function App(): React.ReactElement {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const refresh = useCallback(async () => {
    const { repos: list } = await api.listRepos();
    setRepos(list);
    setActiveId((cur) => cur ?? list[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [refresh]);

  const open = useCallback(
    async (target: string) => {
      if (!target.trim()) return;
      setOpening(true);
      setError(null);
      try {
        const { repo } = await api.openRepo(target.trim());
        await refresh();
        setActiveId(repo.id);
        setPath("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setOpening(false);
      }
    },
    [refresh],
  );

  /**
   * In Electron this opens a real folder picker. A browser cannot return a
   * filesystem path at all, so it falls back to the text field beside it.
   */
  const browse = useCallback(async () => {
    const chosen = await desktop()?.pickFolder();
    if (chosen) void open(chosen);
  }, [open]);

  const startQuiz = useCallback(
    async (n: number, sections?: Section[]) => {
      if (!activeId) return;
      try {
        const res = await api.startQuiz(activeId, n, { sections });
        setSession({ id: res.session.id, questions: res.questions });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [activeId],
  );

  const active = repos.find((r) => r.id === activeId) ?? null;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[100rem] flex-wrap items-center gap-3 px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-tight">psq</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">Ps and Qs</span>
          </div>

          <div className="flex flex-1 items-center gap-2">
            {isDesktop() ? (
              <Button variant="secondary" size="sm" onClick={() => void browse()} disabled={opening}>
                <FolderOpen className="size-3.5" />
                Open repo
              </Button>
            ) : null}
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void open(path);
              }}
              placeholder="/path/to/a/dotnet-or-node/project"
              className="h-8 max-w-md font-mono text-xs"
              spellCheck={false}
            />
            <Button size="sm" onClick={() => void open(path)} disabled={opening || !path.trim()}>
              {opening ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Analyze
            </Button>
          </div>

          <ThemeToggle />
        </div>

        {repos.length > 0 ? (
          <div className="mx-auto flex max-w-[100rem] flex-wrap items-center gap-1 px-4 pb-2">
            {repos.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setActiveId(r.id);
                  setSession(null);
                }}
                className={cn(
                  "group flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                  r.id === activeId
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r.name}
                <span className="tabular-nums opacity-60">{r.entities}</span>
                <X
                  className="size-3 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    void api.closeRepo(r.id).then(() => {
                      if (activeId === r.id) setActiveId(null);
                      setSession(null);
                      return refresh();
                    });
                  }}
                />
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-[100rem] flex-1 px-4 py-4">
        {error ? (
          <Card className="mb-4 border-destructive/40">
            <CardContent className="flex items-start justify-between gap-4 pt-6 text-sm">
              <span className="whitespace-pre-wrap text-destructive">{error}</span>
              <Button variant="ghost" size="sm" onClick={() => setError(null)}>
                Dismiss
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {session ? (
          <Quiz
            sessionId={session.id}
            questions={session.questions}
            onExit={() => setSession(null)}
          />
        ) : active ? (
          <Dashboard repo={active} onStartQuiz={(n, sections) => void startQuiz(n, sections)} />
        ) : (
          <Card className="mx-auto mt-16 max-w-lg">
            <CardHeader>
              <CardTitle>Point psq at a project</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                psq reads a .NET project with an EF Core DbContext, or a Node backend with a
                SQLite schema, builds its entity graph, and generates questions it can grade
                without a model.
              </p>
              {!isDesktop() ? (
                <p className="text-xs">
                  A browser cannot return a filesystem path, so type one above. The desktop
                  app has a folder picker.
                </p>
              ) : null}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
