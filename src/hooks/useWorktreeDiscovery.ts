export interface DiscoveryInput {
  /** Baseline ids from a previous tick; undefined until the first successful
   *  listing for this repo (the baseline tick must adopt nothing — at startup
   *  every existing worktree would otherwise look "new" and get re-set-up). */
  known: Set<string> | undefined;
  freshIds: string[];
}

export interface DiscoveryDecision {
  /** Ids that appeared since the baseline — externally created, to adopt. */
  adoptIds: string[];
  /** The baseline to record for the next tick. */
  nextKnown: Set<string>;
}

export function computeDiscovery({ known, freshIds }: DiscoveryInput): DiscoveryDecision {
  const nextKnown = new Set(freshIds);
  if (!known) {
    return { adoptIds: [], nextKnown };
  }
  return { adoptIds: freshIds.filter((id) => !known.has(id)), nextKnown };
}
