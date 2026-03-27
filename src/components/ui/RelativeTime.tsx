import { useState, useEffect } from "react";

function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return "";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface RelativeTimeProps {
  timestamp: number | undefined;
  className?: string;
}

function RelativeTime({ timestamp, className }: RelativeTimeProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!timestamp) return;
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [timestamp]);

  const text = formatRelativeTime(timestamp);
  if (!text) return null;

  return <span className={className}>{text}</span>;
}

export { RelativeTime, formatRelativeTime };
