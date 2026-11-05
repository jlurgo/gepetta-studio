import { usePaint } from "../state/paint";
import { Mixer } from "./Mixer";
import { Section } from "./Section";

/**
 * The «Sonidos» tool: how the film's sounds mix. Sound files and the sound
 * effects that come with the app are in the library.
 */
export function SoundToolPanel() {
  return (
    <div className="tool-options">
      <p className="hint">
        Música, voces y efectos se agregan en la{" "}
        <button className="link-btn" onClick={() => usePaint.getState().setTool("import")}>
          Biblioteca
        </button>{" "}
        y de ahí se arrastran a la línea de tiempo. Para grabar, agregá un micrófono en la barra (al lado de las cámaras).
      </p>
      <Section title="Mezcla">
        <Mixer />
      </Section>
    </div>
  );
}
