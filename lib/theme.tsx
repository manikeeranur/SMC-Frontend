"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { IconMoon, IconSun } from "@tabler/icons-react";

type Theme = "light" | "dark";

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const saved = (localStorage.getItem("smc_theme") as Theme) ?? "light";
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved);
  }, []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("smc_theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeToggle({ className, variant = "default" }: { className?: string; variant?: "default" | "icon" }) {
  const { theme, toggle } = useTheme();
  if (variant === "icon") {
    return (
      <button onClick={toggle} title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        className="flex flex-col items-center justify-center w-11 h-11 rounded-xl cursor-pointer transition-all"
        style={{ color: "#94a3b8" }}>
        {theme === "light" ? <IconMoon size={20} /> : <IconSun size={20} />}
      </button>
    );
  }
  return (
    <button onClick={toggle} title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      className={`flex items-center justify-center w-7 h-7 border rounded-sm cursor-pointer transition-all ${className ?? ""}`}
      style={{
        background: theme === "dark" ? "rgba(2,132,199,0.1)" : "rgba(0,0,0,0.04)",
        borderColor: theme === "dark" ? "#1e2a3a" : "#cbd5e1",
        color: theme === "dark" ? "#94a3b8" : "#64748b",
      }}>
      {theme === "light" ? <IconMoon size={14} /> : <IconSun size={14} />}
    </button>
  );
}
