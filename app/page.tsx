"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  useEffect(() => { router.replace("/options"); }, [router]);
  return (
    <div className="flex items-center justify-center h-screen bg-[#080b0f]">
      <div className="text-[#4a6080] text-sm" style={{ fontFamily: "'Space Mono', monospace" }}>
        Loading Options Terminal...
      </div>
    </div>
  );
}
