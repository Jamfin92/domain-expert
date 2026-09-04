import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { adoptTokenFromFragment } from "@/lib/api";
import { ThemeProvider } from "@/lib/theme";
import "@/styles.css";

// Before anything renders, so the first request App makes already carries it.
adoptTokenFromFragment();

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
