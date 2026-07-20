"use client";

import { useEffect, useRef } from "react";

// Shows a colored dot on the browser tab's favicon + title prefix.
// color: "green" = actively scanning/monitoring or a live position is open.
//        "red"   = scanning has stopped AND the live tick feed is also down —
//                   nothing is being monitored right now.
//        null    = back to the page's normal favicon/title.
export function useTabIndicator(color: "green" | "red" | null) {
  const originalTitleRef   = useRef<string | null>(null);
  const originalFaviconRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;

    if (originalTitleRef.current === null) {
      originalTitleRef.current = document.title.replace(/^(?:🟢|🔴)\s*/, "");
    }
    const dot = color === "green" ? "🟢 " : color === "red" ? "🔴 " : "";
    document.title = `${dot}${originalTitleRef.current}`;

    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    if (originalFaviconRef.current === null) originalFaviconRef.current = link.href;

    if (color) {
      const canvas = document.createElement("canvas");
      canvas.width = 32; canvas.height = 32;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.beginPath();
        ctx.arc(16, 16, 14, 0, Math.PI * 2);
        ctx.fillStyle = color === "green" ? "#16a34a" : "#e11d48";
        ctx.fill();
        link.href = canvas.toDataURL("image/png");
      }
    } else {
      link.href = originalFaviconRef.current;
    }

    return () => {
      if (originalTitleRef.current !== null) document.title = originalTitleRef.current;
      if (originalFaviconRef.current !== null && link) link.href = originalFaviconRef.current;
    };
  }, [color]);
}
