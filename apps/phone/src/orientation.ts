/**
 * How the phone is held, from gravity, so a sideways shot can be turned
 * upright on the computer even with the screen rotation locked.
 */

type Angle = 0 | 90 | 180 | 270;

/** Counterclockwise rotation of the device from portrait, or null until known. */
let deviceAngle: Angle | null = null;
let listening = false;

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function onMotion(e: DeviceMotionEvent) {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x === null || g.y === null) return;
  // W3C convention: upright portrait reads y ≈ +9.8. Safari on iOS reports the opposite sign.
  const sign = isIOS ? -1 : 1;
  const x = (g.x ?? 0) * sign;
  const y = (g.y ?? 0) * sign;
  if (Math.hypot(x, y) < 4) return; // lying flat: keep the last known way
  // A little hysteresis so it does not flicker around 45°.
  const strong = (a: number, b: number) => Math.abs(a) > Math.abs(b) * 1.3;
  if (strong(y, x)) deviceAngle = y > 0 ? 0 : 180;
  else if (strong(x, y)) deviceAngle = x > 0 ? 90 : 270; // right edge up = turned counterclockwise
}

function screenAngle(): number {
  const legacy = (window as { orientation?: number }).orientation;
  if (typeof legacy === "number") return (legacy + 360) % 360;
  return screen.orientation?.angle ?? 0;
}

/** Starts listening; on iOS this must run inside a tap (it asks for permission once). */
export async function watchOrientation(): Promise<boolean> {
  if (listening) return true;
  const Motion = window.DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
  if (!Motion) return false;
  try {
    if (typeof Motion.requestPermission === "function" && (await Motion.requestPermission()) !== "granted") return false;
  } catch {
    return false;
  }
  window.addEventListener("devicemotion", onMotion);
  listening = true;
  return true;
}

/**
 * Clockwise degrees the camera picture must turn to look upright, or undefined
 * when unknown. The camera image follows the screen, so only the difference
 * between how the phone is held and how the screen is turned matters.
 */
export function uprightRotation(): number | undefined {
  if (deviceAngle === null) return undefined;
  // Turning the camera counterclockwise turns the world clockwise in the picture: undo it.
  return (360 - ((deviceAngle - screenAngle() + 360) % 360)) % 360;
}
