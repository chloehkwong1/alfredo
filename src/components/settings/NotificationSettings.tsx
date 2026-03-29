import { useCallback, useState } from "react";
import { Bell, Play, Volume2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Toggle } from "../ui/Toggle";
import type { NotificationConfig } from "../../types";
import { SOUNDS, playSoundById } from "../../hooks/useNotifications";


const SOUND_OPTIONS = Object.keys(SOUNDS).map((id) => ({
  id,
  label: id.charAt(0).toUpperCase() + id.slice(1),
}));

interface NotificationSettingsProps {
  config: NotificationConfig;
  onChange: (config: NotificationConfig) => void;
}

function NotificationSettings({ config, onChange }: NotificationSettingsProps) {
  const [permissionState, setPermissionState] = useState<
    NotificationPermission | "unsupported"
  >(() => {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission;
  });

  const update = useCallback(
    <K extends keyof NotificationConfig>(
      key: K,
      value: NotificationConfig[K],
    ) => {
      onChange({ ...config, [key]: value });
    },
    [config, onChange],
  );

  const handleEnableToggle = useCallback(() => {
    const next = !config.enabled;
    if (next && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      Notification.requestPermission().then((perm) => {
        setPermissionState(perm);
        if (perm === "granted") {
          update("enabled", true);
        }
      });
    } else {
      update("enabled", next);
    }
  }, [config.enabled, update]);

  const handleTestNotification = useCallback(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Alfredo", { body: "This is a test notification" });
    }
    playSoundById(config.sound);
  }, [config.sound]);

  return (
    <div className="space-y-5">
      {/* Master toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-text-secondary" />
          <label className="text-sm font-medium text-text-primary">
            Enable Notifications
          </label>
        </div>
        <Toggle checked={config.enabled} onChange={() => handleEnableToggle()} />
      </div>

      {permissionState === "denied" && (
        <p className="text-xs text-status-error">
          Notification permission was denied. Please enable it in your system
          settings.
        </p>
      )}

      {permissionState === "unsupported" && (
        <p className="text-xs text-text-tertiary">
          Browser notifications are not supported in this environment.
        </p>
      )}

      {/* Notification triggers */}
      {config.enabled && (
        <>
          <div className="space-y-3">
            <label className="text-sm font-medium text-text-primary">
              Notify When
            </label>

            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">
                Agent waiting for input
              </span>
              <Toggle
                checked={config.notifyOnWaiting}
                onChange={(v) => update("notifyOnWaiting", v)}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">
                Agent finished work
              </span>
              <Toggle
                checked={config.notifyOnIdle}
                onChange={(v) => update("notifyOnIdle", v)}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Agent error</span>
              <Toggle
                checked={config.notifyOnError}
                onChange={(v) => update("notifyOnError", v)}
              />
            </div>
          </div>

          {/* Sound picker */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-text-secondary" />
              <label className="text-sm font-medium text-text-primary">
                Notification Sound
              </label>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {SOUND_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => update("sound", opt.id)}
                  className={[
                    "flex items-center justify-between gap-1 px-3 py-1.5 text-sm rounded-[var(--radius-md)]",
                    "border transition-all duration-[var(--transition-fast)]",
                    "cursor-pointer",
                    config.sound === opt.id
                      ? "border-accent-primary bg-accent-muted text-text-primary"
                      : "border-border-default bg-bg-secondary text-text-secondary hover:border-border-hover",
                  ].join(" ")}
                >
                  <span>{opt.label}</span>
                  {opt.id !== "none" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        playSoundById(opt.id);
                      }}
                      className="text-text-tertiary hover:text-text-primary cursor-pointer"
                    >
                      <Play className="h-3 w-3" />
                    </button>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Test button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTestNotification}
          >
            Test Notification
          </Button>
        </>
      )}
    </div>
  );
}

export { NotificationSettings };
