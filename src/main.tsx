import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { LanguageProvider } from "./lib/i18n";
import { SettingsProvider } from "./lib/settings";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SettingsProvider><LanguageProvider>
        <App />
      </LanguageProvider></SettingsProvider>
    </BrowserRouter>
  </StrictMode>
);
