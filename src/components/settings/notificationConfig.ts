import type { NotificationConfig } from "../../types";

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  enabled: false,
  sound: "chime",
  notifyOnWaiting: true,
  notifyOnIdle: true,
  notifyOnError: false,
};
