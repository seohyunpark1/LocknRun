// Check-ins are phone-only. This is a guard against honest mistakes, not tamper-proof: a user agent can be spoofed.
export const isMobileUA = (ua: string) => /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
/** Browser side: a phone/tablet with a touch screen. */
export function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return isMobileUA(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); // iPadOS reports as a Mac
}
/** Server side: user agent or client hint says mobile. */
export const isMobileRequest = (req: Request) => req.headers.get("sec-ch-ua-mobile") === "?1" || isMobileUA(req.headers.get("user-agent") || "");
