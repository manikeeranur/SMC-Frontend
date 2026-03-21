"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KiteAuth } from "@/components/KiteAuth";
import { authApi, isDemoMode } from "@/lib/api";

function LoginInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const kiteStatus   = searchParams.get("kite");
  const kiteUser     = searchParams.get("user") ?? "";
  const kiteErrMsg   = searchParams.get("msg")  ?? "";
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // If Kite just redirected back with success
    if (kiteStatus === "connected") {
      localStorage.setItem("kite_auth", "1");
      if (kiteUser) localStorage.setItem("kite_user", kiteUser);
      router.replace("/options");
      return;
    }

    // If already authenticated (localStorage + backend)
    if (!isDemoMode && localStorage.getItem("kite_auth") === "1") {
      authApi.status().then(d => {
        if (d.authenticated) router.replace("/options");
        else {
          localStorage.removeItem("kite_auth");
          localStorage.removeItem("kite_user");
          setChecking(false);
        }
      }).catch(() => setChecking(false));
      return;
    }

    if (isDemoMode) { router.replace("/options"); return; }
    setChecking(false);
  }, [kiteStatus, kiteUser, router]);

  if (checking) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#080b0f]">
        <div className="text-[#4a6080] text-sm" style={{ fontFamily: "'Space Mono', monospace" }}>
          Checking session...
        </div>
      </div>
    );
  }

  return (
    <KiteAuth
      onConnected={(u) => {
        localStorage.setItem("kite_auth", "1");
        if (u) localStorage.setItem("kite_user", u);
        router.replace("/options");
      }}
      errorMsg={kiteStatus === "error" ? kiteErrMsg : undefined}
    />
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen bg-[#080b0f]">
        <div className="text-[#4a6080] text-sm" style={{ fontFamily: "'Space Mono', monospace" }}>
          Loading...
        </div>
      </div>
    }>
      <LoginInner />
    </Suspense>
  );
}
