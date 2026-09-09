import { useAppConfigStore } from "../stores/appConfigStore";
import { sessionManager } from "./sessionManager";

let started = false;

/**
 * Keep SessionManager's idle-hibernation window in sync with the
 * `hibernateIdleMinutes` setting. Started once from the App root (like
 * startDockBadgeMirror) rather than at sessionManager module load:
 * appConfigStore transitively imports sessionManager (RepoSelector → prStore
 * → portReclaim), so a store subscription inside sessionManager.ts would sit
 * on an undefined binding whenever the store is the cycle's entry point.
 * Safe to call more than once.
 */
export function startHibernateConfigMirror(): void {
  if (started) return;
  started = true;
  const apply = () =>
    sessionManager.setHibernateIdleMinutes(useAppConfigStore.getState().config?.hibernateIdleMinutes);
  useAppConfigStore.subscribe(apply);
  apply();
}
