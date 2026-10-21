import { Editor } from "./components/Editor";
import { Library } from "./components/Library";
import { Toasts } from "./components/Toasts";
import { useEditor } from "./state/editor";

export function App() {
  const filmId = useEditor((s) => s.filmId);
  return (
    <>
      {filmId ? <Editor key={filmId} /> : <Library />}
      <Toasts />
    </>
  );
}
