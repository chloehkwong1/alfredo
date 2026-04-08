import { useCallback, useState } from "react";

const RESET_DELAY = 2000;

export function useCopyToClipboard() {
  const [copied, setCopied] = useState(false);

  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), RESET_DELAY);
  }, []);

  return { copied, copy } as const;
}
