import { useCallback, useState } from "react";
import { copyText } from "../lib/clipboard";

const RESET_DELAY = 2000;

export function useCopyToClipboard() {
  const [copied, setCopied] = useState(false);

  const copy = useCallback((text: string) => {
    void copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), RESET_DELAY);
  }, []);

  return { copied, copy } as const;
}
