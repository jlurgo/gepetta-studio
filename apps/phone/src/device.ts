export type Platform = "ios" | "android" | "other";

export function detectPlatform(ua = navigator.userAgent): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS 13+ pretends to be a Mac.
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/** Short, friendly name shown on the computer, e.g. "iPhone" or "Android Pixel 7". */
export function deviceName(ua = navigator.userAgent): string {
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/iPhone|iPod/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) {
    // Reduced user agents report the model as "K"; skip anything that short.
    const model = /Android[^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?\s*[;)]/i.exec(ua)?.[1]?.trim();
    return model && model.length > 1 && !/^wv$/i.test(model) ? `Android ${model}`.slice(0, 40) : "Android";
  }
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh/i.test(ua)) return "Mac";
  return "Navegador";
}

export function pairingToken(): string | null {
  return new URLSearchParams(location.search).get("t");
}
