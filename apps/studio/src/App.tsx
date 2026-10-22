import { Editor } from "./components/Editor";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Library } from "./components/Library";
import { Toasts } from "./components/Toasts";
import { useEditor } from "./state/editor";

export function App() {
  const filmId = useEditor((s) => s.filmId);
  return (
    <>
      <ErrorBoundary label="la aplicación">{filmId ? <Editor key={filmId} /> : <Library />}</ErrorBoundary>
      <Toasts />
    </>
  );
}
