/** Pulls stills out of a video file by seeking a <video> element. */

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
}

export async function loadVideo(file: File): Promise<{ video: HTMLVideoElement; info: VideoInfo; dispose(): void }> {
  const url = URL.createObjectURL(file);
  const video = Object.assign(document.createElement("video"), { src: url, muted: true, preload: "auto", playsInline: true });
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("No se pudo leer el video (¿formato no soportado?)"));
    });
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  return {
    video,
    info: { duration: video.duration, width: video.videoWidth, height: video.videoHeight },
    dispose: () => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    video.onseeked = () => resolve();
    video.onerror = () => reject(new Error("Error al leer el video"));
    video.currentTime = t;
  });
}

/** Times (s) of the stills to take between `from` and `to` at `fps`. */
export function sampleTimes(from: number, to: number, fps: number): number[] {
  const times: number[] = [];
  const step = 1 / fps;
  for (let t = from; t < to - 1e-6; t += step) times.push(Number(t.toFixed(4)));
  return times;
}

export async function grabStill(video: HTMLVideoElement, t: number): Promise<Blob> {
  await seek(video, t);
  const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
  canvas.getContext("2d")!.drawImage(video, 0, 0);
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
}
