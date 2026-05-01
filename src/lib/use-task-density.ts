import { useState } from "react";
import { DENSITY_VALUES, type Density } from "./density";

export type TaskDensity = Density;

const KEY = "mc.taskDensity";
const DEFAULT: TaskDensity = "regular";

function readSaved(): TaskDensity {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && (DENSITY_VALUES as readonly string[]).includes(saved)) {
      return saved as TaskDensity;
    }
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT;
}

export function useTaskDensity(): {
  density: TaskDensity;
  setDensity: (d: TaskDensity) => void;
} {
  const [density, setDensityState] = useState<TaskDensity>(readSaved);

  const setDensity = (d: TaskDensity) => {
    setDensityState(d);
    try {
      localStorage.setItem(KEY, d);
    } catch {
      /* swallow */
    }
  };

  return { density, setDensity };
}

export function taskGridCols(density: TaskDensity): string {
  if (density === "compact") return "repeat(auto-fill, minmax(260px, 1fr))";
  if (density === "spacious") return "repeat(auto-fill, minmax(460px, 1fr))";
  return "repeat(auto-fill, minmax(360px, 1fr))";
}
