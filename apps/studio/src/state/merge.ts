import { type Clip, IDENTITY_TRANSFORM, type Op, type TrackId, clipEnd, newId, trackSounds } from "@gepetta/core";
import { mixSound } from "../export/audio";
import { ingestSound } from "../media/sound";
import { wavBlob } from "../media/wav";
import { newTrackOp } from "./actions";
import { runTask, useBusy } from "./busy";
import { useEditor } from "./editor";

/**
 * Mixes sound tracks into one new sound, as they are heard (volumes, speaker,
 * voice effects, music going down), on a new track on top; the tracks mixed
 * are silenced, so it is not heard twice (they stay, to change and mix again).
 */
export async function mergeSounds(tracks: TrackId[], name: string) {
  const { film, filmId } = useEditor.getState();
  if (!film || !filmId) return;
  const sounding = film.tracks.filter((t) => tracks.includes(t.id) && trackSounds(film, t)).map((t) => t.id);
  const clips = Object.values(film.clips).filter((c) => c.sound && sounding.includes(c.track));
  if (!clips.length) {
    useBusy.getState().notify("No hay nada que suene para unir.");
    return;
  }
  const start = Math.min(...clips.map((c) => c.start));
  const end = Math.max(...clips.map(clipEnd));
  const cells = Array.from({ length: end - start }, (_, i) => start + i);
  const read = await runTask("Uniendo los sonidos", 1, async () => {
    const mix = await mixSound(filmId, film, cells, sounding);
    return mix ? ingestSound(filmId, wavBlob(mix)) : null;
  });
  const now = useEditor.getState().film;
  if (!read || !now || useEditor.getState().filmId !== filmId) return;
  const made = newTrackOp(name, { kind: "sound" });
  const clip: Clip = { id: newId(), track: made.id, start, length: cells.length, media: read.media, name, visible: true, opacity: 1, transform: IDENTITY_TRANSFORM, sound: { ref: read.ref, from: 0 } };
  const ops: Op[] = [
    made.op,
    { type: "track.move", trackId: made.id, index: 0 },
    { type: "clip.place", clips: [clip] },
    ...sounding.map((trackId): Op => ({ type: "track.update", trackId, patch: { visible: false } })),
  ];
  useEditor.getState().commit(ops, `Unir ${sounding.length} ${sounding.length === 1 ? "sonido" : "sonidos"} en «${name}»`, { cursor: { track: made.id, cell: start }, selection: [] });
  useBusy.getState().notify(`Listo: «${name}» tiene la mezcla; los tracks que se unieron quedaron silenciados.`);
}
