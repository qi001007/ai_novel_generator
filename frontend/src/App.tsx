import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";

import BookshelfPage from "./pages/BookshelfPage";
import WorkbenchPage from "./pages/WorkbenchPage";
import { useWorkbench } from "./store/workbench";

export default function App() {
  const init = useWorkbench((state) => state.init);

  useEffect(() => {
    init();
  }, []);

  return (
    <Routes>
      <Route path="/" element={<BookshelfPage />} />
      <Route path="/novels/:novelId" element={<WorkbenchPage />} />
    </Routes>
  );
}
