import { storage } from "../storage";
import { useCamera } from "../state/camera";
import { useEditor } from "../state/editor";
import { sendToPhone } from "./remote";

const ONION_MAX = 960;

/**
 * Keeps the phone's onion skin in sync: whenever the frame before the insertion
 * point changes, the phone in use gets a downscaled copy of it.
 */
let lastKey = "";

async function sync() {
  const { source } = useCamera.getState();
  const { film, filmId, selected } = useEditor.getState();
  if (source?.kind !== "phone") {
    lastKey = "";
    return;
  }
  const sessionId = source.id.slice("phone:".length);
  const frame = film && selected ? film.frames[selected] : undefined;
  const asset = frame?.layers[0]?.media.proxy;
  const key = `${sessionId}|${filmId}|${asset ?? ""}`;
  if (key === lastKey) return;
  lastKey = key;
  const filmName = film?.settings.name ?? null;
  if (!filmId || !asset) return void sendToPhone(sessionId, { t: "onion", filmName });
  try {
    const bitmap = await createImageBitmap(await storage.getAsset(filmId, asset));
    const scale = Math.min(1, ONION_MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 })).arrayBuffer());
    if (lastKey === key) await sendToPhone(sessionId, { t: "onion", filmName }, jpeg);
  } catch (e) {
    console.warn("[gepetta] onion to phone", e);
  }
}

useEditor.subscribe((s, prev) => {
  if (s.selected !== prev.selected || s.film !== prev.film) void sync();
});
useCamera.subscribe((s, prev) => {
  if (s.source !== prev.source) void sync();
});
