import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, X } from "lucide-react";
import { api, type AnswerOutcome, type PublicQuestion } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * One question at a time, graded on the server.
 *
 * The client never receives the answer until after it has submitted, so a
 * curious reader cannot read it out of the network tab and the score means
 * something.
 */

interface Props {
  sessionId: string;
  questions: PublicQuestion[];
  onExit: () => void;
}

export function Quiz({ sessionId, questions, onExit }: Props): React.ReactElement {
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [outcome, setOutcome] = useState<AnswerOutcome | null>(null);
  const [correct, setCorrect] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  const q = questions[index];
  const finished = index >= questions.length;

  useEffect(() => {
    setTyped("");
    setOutcome(null);
    setError(null);
    // Typing should just work when a question needs the keyboard.
    queueMicrotask(() => (inputRef.current ?? areaRef.current)?.focus());
  }, [index]);

  const submit = useCallback(
    async (answer: string) => {
      if (!q || busy || outcome) return;
      setBusy(true);
      setError(null);
      try {
        const res = await api.answer(sessionId, q.id, answer);
        setOutcome(res);
        if (res.result.correct) setCorrect((c) => c + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [q, busy, outcome, sessionId],
  );

  const next = useCallback(() => setIndex((i) => i + 1), []);

  // Keyboard: a/b/c/d to choose, Enter to submit or advance.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (finished || !q) return;
      if (ev.key === "Enter" && outcome) {
        ev.preventDefault();
        next();
        return;
      }
      if (outcome || q.kind !== "mcq" || !q.choices) return;
      const i = ev.key.toLowerCase().charCodeAt(0) - 97;
      if (i >= 0 && i < q.choices.length && !ev.metaKey && !ev.ctrlKey) {
        ev.preventDefault();
        void submit(q.choices[i]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q, outcome, finished, submit, next]);

  if (finished) {
    const pct = questions.length === 0 ? 0 : Math.round((correct / questions.length) * 100);
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>
            {correct} / {questions.length} ({pct}%)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={pct} />
          <Button onClick={onExit} className="w-full">
            <ArrowLeft className="size-4" />
            Back to the graph
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!q) return <div className="text-sm text-muted-foreground">No questions.</div>;

  const freeSql = q.kind === "sql" && q.templated === false;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onExit}>
          <ArrowLeft className="size-4" />
        </Button>
        <Progress value={(index / questions.length) * 100} className="h-1.5 flex-1" />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {index + 1} / {questions.length}
        </span>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <Badge variant="outline" className="font-mono text-[10px]">{q.generator}</Badge>
          {q.subjects.length > 0 ? (
            <span className="text-xs text-muted-foreground">{q.subjects.join(" · ")}</span>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="whitespace-pre-wrap font-[450] leading-relaxed">{q.prompt}</p>

          {q.kind === "mcq" && q.choices ? (
            <div className="flex flex-col gap-2">
              {q.choices.map((choice, i) => {
                const chosen = outcome && typed === choice;
                const isAnswer = outcome && outcome.modelAnswer === choice;
                return (
                  <button
                    key={choice}
                    disabled={Boolean(outcome) || busy}
                    onClick={() => {
                      setTyped(choice);
                      void submit(choice);
                    }}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                      "disabled:cursor-default",
                      !outcome && "hover:border-ring hover:bg-accent",
                      isAnswer && "border-[var(--success)] bg-[var(--success)]/10",
                      chosen && !isAnswer && "border-destructive bg-destructive/10",
                    )}
                  >
                    <span className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {String.fromCharCode(97 + i)}
                    </span>
                    <span className="flex-1">{choice}</span>
                    {isAnswer ? <Check className="size-4 text-[var(--success)]" /> : null}
                    {chosen && !isAnswer ? <X className="size-4 text-destructive" /> : null}
                  </button>
                );
              })}
            </div>
          ) : freeSql ? (
            <textarea
              ref={areaRef}
              value={typed}
              disabled={Boolean(outcome) || busy}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(typed);
              }}
              rows={5}
              spellCheck={false}
              placeholder="SELECT …"
              className={cn(
                "w-full rounded-lg border bg-background p-3 font-mono text-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            />
          ) : (
            <Input
              ref={inputRef}
              value={typed}
              disabled={Boolean(outcome) || busy}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !outcome) void submit(typed);
              }}
              spellCheck={false}
              placeholder="Your answer, comma separated for several blanks"
              className="font-mono"
            />
          )}

          {q.kind !== "mcq" && !outcome ? (
            <Button onClick={() => void submit(typed)} disabled={busy || typed.trim() === ""}>
              {busy ? "Checking…" : "Check"}
            </Button>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {outcome ? (
            <div
              className={cn(
                "space-y-2 rounded-lg border p-3 text-sm",
                outcome.result.correct
                  ? "border-[var(--success)]/40 bg-[var(--success)]/10"
                  : "border-destructive/40 bg-destructive/5",
              )}
            >
              <p className="flex items-center gap-2 font-medium">
                {outcome.result.correct ? (
                  <>
                    <Check className="size-4 text-[var(--success)]" /> Correct
                  </>
                ) : (
                  <>
                    <X className="size-4 text-destructive" /> Not quite
                  </>
                )}
                <span className="font-normal text-muted-foreground">{outcome.result.detail}</span>
              </p>
              {!outcome.result.correct ? (
                <p className="font-mono text-xs">{outcome.modelAnswer}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">{outcome.rationale}</p>
              <Button size="sm" onClick={next}>
                {index + 1 === questions.length ? "See the score" : "Next"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
