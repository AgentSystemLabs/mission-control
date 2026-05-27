export const NOTIFICATION_WEB_PERMISSION = "notifications";

export function shouldAllowWebPermission(permission: string): boolean {
  return permission === NOTIFICATION_WEB_PERMISSION;
}
