import { useCallback, useState } from "react";
import { askAlfredo, type AskAlfredoAnswer } from "../../api";

export interface Turn {
  id: number;
  question: string;
  answer?: AskAlfredoAnswer;
  error?: string;
}

export function useAskAlfredo() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);

  const submit = useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    const id = Date.now();
    setTurns((t) => [...t, { id, question: trimmed }]);
    setLoading(true);
    try {
      const answer = await askAlfredo(trimmed);
      setTurns((t) =>
        t.map((turn) => (turn.id === id ? { ...turn, answer } : turn)),
      );
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      setTurns((t) =>
        t.map((turn) => (turn.id === id ? { ...turn, error } : turn)),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => setTurns([]), []);

  return { turns, loading, submit, reset };
}
