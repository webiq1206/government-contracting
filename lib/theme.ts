/** Theme preference for the logged-in product shell. */

export type Theme = "light" | "dark";

export const THEME_COOKIE = "brost.theme";
export const THEME_STORAGE_KEY = "brost.theme";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/** Serialize theme into a year-long cookie usable from client or server. */
export function themeCookie(theme: Theme): string {
  const maxAge = 60 * 60 * 24 * 365;
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

/** Blocking script: apply saved theme before first paint to avoid flash. */
export function themeInitScript(): string {
  return `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var c=${JSON.stringify(THEME_COOKIE)};var t=null;try{t=localStorage.getItem(k)}catch(e){}if(t!=="light"&&t!=="dark"){var m=document.cookie.match(new RegExp("(?:^|; )"+c+"=([^;]*)"));t=m?decodeURIComponent(m[1]):null}if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}var r=document.documentElement;if(t==="dark")r.classList.add("dark");else r.classList.remove("dark");r.style.colorScheme=t}catch(e){}})();`;
}
