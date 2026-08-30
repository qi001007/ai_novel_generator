import { useEffect } from "react";

import BookshelfPage from "./pages/BookshelfPage";
import WorkbenchPage from "./pages/WorkbenchPage";
import { useWorkbench } from "./store/workbench";

export default function App() {
  const view = useWorkbench((state) => state.view);
  const init = useWorkbench((state) => state.init);

  useEffect(() => {
    init();
  }, []);

  return view === "bookshelf" ? <BookshelfPage /> : <WorkbenchPage />;
}
