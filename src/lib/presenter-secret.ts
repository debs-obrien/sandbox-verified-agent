/**
 * Presenter-only run secret helpers for the browser UI.
 * Kept in sessionStorage so Shareable Link viewers never receive it from the
 * page source — only the presenter pastes it once per tab session.
 */

export const RUN_SECRET_SESSION_KEY = "sva_run_secret";

export function readPresenterRunSecret(): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(RUN_SECRET_SESSION_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function writePresenterRunSecret(secret: string): void {
  if (typeof window === "undefined") return;
  const value = secret.trim();
  try {
    if (value) sessionStorage.setItem(RUN_SECRET_SESSION_KEY, value);
    else sessionStorage.removeItem(RUN_SECRET_SESSION_KEY);
  } catch {
    // sessionStorage may be blocked; ignore — fetch will 401 without a header.
  }
}

export function clearPresenterRunSecret(): void {
  writePresenterRunSecret("");
}
