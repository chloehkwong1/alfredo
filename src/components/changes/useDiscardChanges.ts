import { useCallback, useState } from "react";
import { discardFile, discardAllUncommitted } from "../../api";
import type { DiffFile } from "../../types";

export type DiscardTarget =
  | null
  | { type: "file"; path: string; status: string }
  | { type: "all" };

export function useDiscardChanges(
  repoPath: string,
  uncommittedFiles: DiffFile[],
  refetchUncommitted: () => void,
) {
  const [discardTarget, setDiscardTarget] = useState<DiscardTarget>(null);

  const handleDiscardFile = useCallback((path: string, status: string) => {
    setDiscardTarget({ type: "file", path, status });
  }, []);

  const handleDiscardAll = useCallback(() => {
    setDiscardTarget({ type: "all" });
  }, []);

  const handleCancelDiscard = useCallback(() => {
    setDiscardTarget(null);
  }, []);

  const handleConfirmDiscard = useCallback(async () => {
    if (!discardTarget) return;
    try {
      if (discardTarget.type === "file") {
        await discardFile(repoPath, discardTarget.path, discardTarget.status);
      } else {
        const files = uncommittedFiles.map((f) => ({
          path: f.path,
          oldPath: f.oldPath,
          status: f.status,
        }));
        await discardAllUncommitted(repoPath, files);
      }
      refetchUncommitted();
    } catch (err) {
      console.error("Discard failed:", err);
    } finally {
      setDiscardTarget(null);
    }
  }, [discardTarget, repoPath, uncommittedFiles, refetchUncommitted]);

  return {
    discardTarget,
    handleDiscardFile,
    handleDiscardAll,
    handleCancelDiscard,
    handleConfirmDiscard,
  };
}
