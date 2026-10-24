import { wrapCell } from "@gepetta/core";
import { useEffect } from "react";
import { deleteBack, moveRow, shoot } from "./actions";
import { useBusy } from "./busy";
import { useCamera } from "./camera";
import { useEditor } from "./editor";

/**
 * A game controller (an Xbox one over Bluetooth or USB, or any the browser
 * maps the standard way) as a remote for shooting: photos, moving around the
 * cells and tracks, where each camera's photos go, onion skin, playing.
 */

/** Standard mapping button numbers. */
const BTN = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, menu: 9, stickPress: 10, up: 12, down: 13, left: 14, right: 15 } as const;

/** What each button does, as told when a controller connects (and in the docs). */
export const GAMEPAD_HELP: [string, string][] = [
  ["A o gatillo derecho", "sacar foto (o empezar y parar el video, como el botón grande)"],
  ["Cruz ← →", "celda anterior / siguiente (mantenela para ir rápido)"],
  ["Cruz ↑ ↓", "track de arriba / de abajo (arriba de todo, el resultado; abajo de todo, un track nuevo)"],
  ["Palanca derecha ← →", "un segundo para atrás / adelante"],
  ["X", "poner el vivo de la cámara en esta celda"],
  ["Y", "papel cebolla sí / no"],
  ["B", "borrar la celda (como borrar al escribir; en la del vivo, la anterior)"],
  ["LB / RB", "cámara anterior / siguiente"],
  ["Gatillo izquierdo", "reproducir / detener"],
  ["View (⧉)", "deshacer"],
  ["Apretar la palanca izquierda", "ir a la celda del vivo de la cámara"],
  ["Menú (☰)", "cambiar entre foto y video"],
];

/** Held directions repeat: after this long, this often (ms). */
const REPEAT_DELAY = 350;
const REPEAT_EVERY = 90;
/** How far a stick or trigger must go to count as pressed. */
const STICK = 0.6;
const TRIGGER = 0.5;

type Control = keyof typeof BTN | "stickLeft" | "stickRight" | "stickUp" | "stickDown" | "jumpBack" | "jumpOn";

/** Which controls are pressed now on a controller. */
function pressed(pad: Gamepad): Set<Control> {
  const on = new Set<Control>();
  for (const [name, i] of Object.entries(BTN) as [keyof typeof BTN, number][]) {
    const b = pad.buttons[i];
    if (b && (b.pressed || b.value > (name === "lt" || name === "rt" ? TRIGGER : 0.5))) on.add(name);
  }
  const [lx = 0, ly = 0, rx = 0] = pad.axes;
  if (lx < -STICK) on.add("stickLeft");
  if (lx > STICK) on.add("stickRight");
  if (ly < -STICK) on.add("stickUp");
  if (ly > STICK) on.add("stickDown");
  if (rx < -STICK) on.add("jumpBack");
  if (rx > STICK) on.add("jumpOn");
  return on;
}

/** Controls that repeat while held. */
const REPEATS = new Set<Control>(["b", "left", "right", "up", "down", "stickLeft", "stickRight", "stickUp", "stickDown", "jumpBack", "jumpOn"]);

/** Moves the cursor by cells (going round in a loop film). */
function moveCells(by: number) {
  const { film, cursor, moveTo } = useEditor.getState();
  if (!film) return;
  moveTo(film.settings.loop ? wrapCell(film, cursor.cell + by) : Math.max(0, cursor.cell + by), cursor.track);
}

/** The next (or previous) camera becomes the active one. */
function cycleCamera(by: number) {
  const { rigs, activeRig, activate } = useCamera.getState();
  if (!rigs.length) return useBusy.getState().notify("No hay cámaras: agregalas con el botón de cámara con «+».");
  const i = rigs.findIndex((r) => r.id === activeRig);
  const next = rigs[(i + by + rigs.length) % rigs.length]!;
  activate(next.id);
}

function act(control: Control, pad: Gamepad) {
  const editor = useEditor.getState();
  const camera = useCamera.getState();
  const rig = camera.rigs.find((r) => r.id === camera.activeRig);
  switch (control) {
    case "a":
    case "rt":
      shoot();
      void pad.vibrationActuator?.playEffect("dual-rumble", { duration: 60, strongMagnitude: 0.2, weakMagnitude: 0.4 }).catch(() => undefined);
      return;
    case "left":
    case "stickLeft":
      return moveCells(-1);
    case "right":
    case "stickRight":
      return moveCells(1);
    case "jumpBack":
      return moveCells(-(editor.film?.settings.fps ?? 12));
    case "jumpOn":
      return moveCells(editor.film?.settings.fps ?? 12);
    case "up":
    case "stickUp":
      return moveRow("up");
    case "down":
    case "stickDown":
      return moveRow("down");
    case "x":
      if (!rig) return useBusy.getState().notify("No hay una cámara elegida.");
      camera.setTarget(rig.id, { ...editor.cursor });
      return useBusy.getState().notify(`Las fotos de la cámara van a la celda ${editor.cursor.cell + 1}.`);
    case "y":
      editor.setOnion({ enabled: !editor.onion.enabled });
      return useBusy.getState().notify(editor.onion.enabled ? "Papel cebolla apagado." : "Papel cebolla prendido.");
    case "b":
      return deleteBack();
    case "lb":
      return cycleCamera(-1);
    case "rb":
      return cycleCamera(1);
    case "lt":
      return editor.playback ? editor.stop() : editor.play(true);
    case "view":
      return editor.undo();
    case "stickPress":
      if (rig) editor.moveTo(camera.targetOf(rig).cell, camera.targetOf(rig).track);
      return;
    case "menu":
      if (camera.rigs.some((r) => r.recording)) return;
      editor.set({ captureMode: editor.captureMode === "photo" ? "video" : "photo" });
      return useBusy.getState().notify(editor.captureMode === "photo" ? "Modo video." : "Modo foto.");
  }
}

/** Reads the controllers while the editor is open. */
export function useGamepad() {
  useEffect(() => {
    let raf = 0;
    const before = new Map<number, Set<Control>>();
    /** When each held control next repeats. */
    const nextRepeat = new Map<string, number>();
    const onConnect = (e: GamepadEvent) => {
      useBusy.getState().notify(`Control conectado (${e.gamepad.id.replace(/\s*\(.*\)\s*$/, "")}): A foto · cruz para moverte · X vivo acá · Y cebolla · B borrar celda · View deshacer · LB/RB cámara · gatillo izq. reproducir`);
    };
    window.addEventListener("gamepadconnected", onConnect);
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const pads = navigator.getGamepads?.() ?? [];
      // A dialog open (export, versions…) takes no controller input.
      const busy = !!document.querySelector(".dialog-backdrop");
      for (const pad of pads) {
        if (!pad || !pad.connected) continue;
        const now_ = pressed(pad);
        const prev = before.get(pad.index) ?? new Set<Control>();
        before.set(pad.index, now_);
        if (busy) continue;
        for (const c of now_) {
          const key = `${pad.index}:${c}`;
          if (!prev.has(c)) {
            act(c, pad);
            if (REPEATS.has(c)) nextRepeat.set(key, now + REPEAT_DELAY);
          } else if (REPEATS.has(c) && now >= (nextRepeat.get(key) ?? Infinity)) {
            act(c, pad);
            nextRepeat.set(key, now + REPEAT_EVERY);
          }
        }
        for (const c of prev) if (!now_.has(c)) nextRepeat.delete(`${pad.index}:${c}`);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("gamepadconnected", onConnect);
    };
  }, []);
}
