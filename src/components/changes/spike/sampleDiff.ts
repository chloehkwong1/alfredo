export const sampleOriginal = `import { useState, useEffect } from "react";
import { fetchUser } from "./api";

type User = {
  id: string;
  name: string;
  email: string;
};

export function useUser(userId: string) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchUser(userId).then((u) => {
      if (cancelled) return;
      setUser(u);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { user, loading };
}

// ── unchanged region below ───────────────────────────────────────────
// Helper utilities used across the codebase. Intentionally verbose so
// that there is a substantial unchanged region for the hide-unchanged
// regions feature to collapse.
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function debounce<T extends (...args: never[]) => unknown>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i];
}

export const VERY_LONG_LINE = "this is a deliberately very long line of code intended to force horizontal scrolling in the monaco diff editor so that the spike can verify whether the gutter stays pinned to the left edge during horizontal scroll behaviour";
`;

export const sampleModified = `import { useState, useEffect, useMemo } from "react";
import { fetchUser } from "./api";

type User = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
};

export function useUser(userId: string) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchUser(userId)
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const displayName = useMemo(() => user?.name ?? "Anonymous", [user]);

  return { user, loading, error, displayName };
}

// ── unchanged region below ───────────────────────────────────────────
// Helper utilities used across the codebase. Intentionally verbose so
// that there is a substantial unchanged region for the hide-unchanged
// regions feature to collapse.
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function debounce<T extends (...args: never[]) => unknown>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i];
}

export const VERY_LONG_LINE = "this is a deliberately very long line of code intended to force horizontal scrolling in the monaco diff editor so that the spike can verify whether the gutter stays pinned to the left edge during horizontal scroll behaviour and to test word-level diff on long lines";
`;

export type SpikeAnnotation = {
  id: string;
  /** 1-indexed line in the MODIFIED side */
  lineNumber: number;
  body: string;
};

export const sampleAnnotations: SpikeAnnotation[] = [
  { id: "a1", lineNumber: 1, body: "Adding `useMemo` — is the displayName memo actually worth it?" },
  { id: "a2", lineNumber: 8, body: "New optional field. Bumping the type, but does the server actually return this yet?" },
  { id: "a3", lineNumber: 21, body: "Error handling here is good — but should we surface this to a toast?" },
];
