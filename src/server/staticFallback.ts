import path from "node:path";

export function requestPathname(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split("?")[0] || "/";
  }
}

export function shouldServeClientIndex(pathname: string): boolean {
  if (pathname.startsWith("/api") || pathname.startsWith("/healthz") || pathname.startsWith("/assets/")) {
    return false;
  }
  return path.extname(pathname) === "";
}
