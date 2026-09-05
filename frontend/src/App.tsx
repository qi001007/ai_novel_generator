import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";

import BookshelfPage from "./pages/BookshelfPage";
import PreferencesPage from "./pages/PreferencesPage";
import WorkbenchPage from "./pages/WorkbenchPage";
import GenerationRunDetailPage from "./pages/GenerationRunDetailPage";
import PaintingDetailPanel from "./components/PaintingDetailPanel";
import { useAppearance } from "./store/appearance";
import { useWorkbench } from "./store/workbench";

export default function App() {
  const init = useWorkbench((state) => state.init);

  useEffect(() => {
    init();
  }, []);

  // 系统 is a live choice: when the machine flips to dark, the app flips with it,
  // without the reader going back to settings.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => useAppearance.getState().followSystem();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", follow);
      return () => media.removeEventListener("change", follow);
    }
    media.addListener(follow);
    return () => media.removeListener(follow);
  }, []);

  return (
    <Routes>
      <Route path="/" element={<BookshelfPage />} />
      <Route path="/settings" element={<PreferencesPage />} />
      <Route path="/novels/:novelId" element={<WorkbenchPage />} />
      <Route
        path="/novels/:novelId/chapters/:chapterId/runs/:runId"
        element={<GenerationRunDetailPage />}
      />
      <Route
        path="/novels/:novelId/artworks/:artworkId"
        element={
          <div className="painting-page">
            <PaintingDetailPanel />
          </div>
        }
      />
    </Routes>
  );
}
