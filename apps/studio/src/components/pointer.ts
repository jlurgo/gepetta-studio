/** Keeps receiving moves outside the element while dragging (best effort). */
export function capturePointer(e: React.PointerEvent) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // Not a real pointer (e.g. synthetic); dragging still works inside the element.
  }
}
