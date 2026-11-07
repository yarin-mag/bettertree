import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useThemeStore } from "../store/themeStore";
import { invokeGetSettings, type Settings } from "../lib/tauri";

export default function SettingsSync() {
  const applySettings = useThemeStore((s) => s.applySettings);

  useEffect(() => {
    let cancelled = false;

    invokeGetSettings()
      .then((settings) => {
        if (!cancelled) applySettings(settings);
      })
      .catch((e) => console.warn("failed to load settings.json", e));

    const unlistenPromise = listen<Settings>("settings-changed", (event) => {
      applySettings(event.payload);
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [applySettings]);

  return null;
}
