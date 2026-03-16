import config from "#config";

import { loadConfig, updateConfig } from "./config-manager";

/**
 * Makes a GET request to `base_url` and refreshes cookies if the server returns Set-Cookie headers.
 * Updates both in-memory cookies and `config.json`.
 */
async function refreshCookies(
  base_url: string,
  cookie: string,
): Promise<string | undefined> {
  try {
    console.info(
      "[CookieManager] Attempting to refresh cookies from base URL...",
    );
    const resp = await fetch(base_url, { headers: { cookie } });
    if (!resp.ok) {
      console.error(
        `[CookieManager] Failed to refresh cookies: status ${resp.status}`,
      );
      return;
    }

    const setCookieHeaders = resp.headers.getSetCookie();
    if (!setCookieHeaders.length) {
      console.warn("[CookieManager] No Set-Cookie headers found in response.");
      return;
    }

    const cookieString = setCookieHeaders
      .map((header) => {
        const cookie = Bun.Cookie.parse(header);
        return `${cookie.name}=${cookie.value}`;
      })
      .join("; ");

    saveCookieToConfig(cookieString);
    return cookieString;
  } catch (e) {
    console.error(`[CookieManager] Error refreshing cookies: ${e}`);
  }
}

async function saveCookieToConfig(new_cookie: string): Promise<void> {
  try {
    const config = await loadConfig();
    config.cookie = new_cookie;
    updateConfig(config);
    console.info("[CookieManager] Updated cookies in config.json");
  } catch (e) {
    console.error(`[CookieManager] Failed to update config.json: ${e}`);
  }
}

export function is_jwt_expired(resp_json: unknown): boolean {
  if (!resp_json) return false;
  if (!(typeof resp_json === "object")) return false;
  if (!("error" in resp_json)) return false;

  console.log(resp_json);

  if (!(typeof resp_json.error === "object")) return false;
  if (!resp_json.error) return false;
  if (!("name" in resp_json.error)) return false;
  if (resp_json.error.name !== "ResponseError") return false;

  // return (
  //   resp_json["error"].get("cause", {}).get("message", "") == "JWT expired"
  // ) or (
  //   "JWTExpired" in resp_json["error"].get("message", "")
  // )

  return true;
}

export const cookie = await (async () => {
  let cookie = config.cookie;

  return {
    get() {
      return cookie;
    },
    async refresh() {
      const new_cookies = await refreshCookies(config.base_url, cookie);
      if (new_cookies) {
        cookie = new_cookies;
      }
    },
  };
})();
