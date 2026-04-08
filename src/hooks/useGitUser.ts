import { useEffect, useState } from "react";
import { getGitUser } from "../api";

export function useGitUser(repoPath: string): string | null {
  const [gitUser, setGitUser] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getGitUser(repoPath)
      .then((user) => { if (!cancelled) setGitUser(user); })
      .catch(() => { /* git user is optional — graceful no-op */ });
    return () => { cancelled = true; };
  }, [repoPath]);

  return gitUser;
}
