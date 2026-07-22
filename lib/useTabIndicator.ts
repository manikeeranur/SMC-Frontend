"use client";

import { useEffect, useRef } from "react";

// Shows a small colored dot badge (bottom-right corner) on top of the site's
// actual favicon. The original icon stays visible — only a small
// notification-style dot is overlaid; the tab title is left untouched.
// color: "green" = actively scanning/monitoring or a live position is open.
//        "red"   = scanning has stopped AND the live tick feed is also down —
//                   nothing is being monitored right now.
//        null    = back to the page's normal favicon.
export function useTabIndicator(color: "green" | "red" | null) {
  const originalFaviconRef = useRef<string | null>(null);
  const baseImgRef         = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    let cancelled = false;

    const link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
      ?? (() => {
        const l = document.createElement("link");
        l.rel = "icon";
        document.head.appendChild(l);
        return l;
      })();
    if (originalFaviconRef.current === null) originalFaviconRef.current = link.href;

    function paint(base: HTMLImageElement | null) {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = 40; canvas.height = 40;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      try {
        if (base) ctx.drawImage(base, 0, 0, 40, 40);
        // medium badge dot, bottom-right corner, white ring for contrast
        ctx.beginPath();
        ctx.arc(24, 24, 14, 0, Math.PI * 2);
        ctx.fillStyle = color === "green" ? "#16a34a" : "#e11d48";
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
        link.href = canvas.toDataURL("image/png");
      } catch {}
    }

    if (color) {
      if (baseImgRef.current) {
        paint(baseImgRef.current);
      } else if (originalFaviconRef.current) {
        const img = new Image();
        img.onload  = () => { baseImgRef.current = img; paint(img); };
        img.onerror = () => paint(null);
        img.src = originalFaviconRef.current;
      } else {
        paint(null);
      }
    } else {
      link.href = originalFaviconRef.current ?? "";
    }

    return () => {
      cancelled = true;
      if (originalFaviconRef.current !== null) link.href = originalFaviconRef.current;
    };
  }, [color]);
}
