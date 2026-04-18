import ReactDOM from "react-dom/client";
import "@excalidraw/excalidraw/index.css";
import "./index.css";
import App from "./App";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

const baseAssetPath = import.meta.env.BASE_URL;
window.EXCALIDRAW_ASSET_PATH = [
  baseAssetPath,
  `${baseAssetPath}excalidraw-assets/`,
];

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
