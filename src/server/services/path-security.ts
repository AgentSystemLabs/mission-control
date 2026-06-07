import * as fs from "node:fs";
import * as path from "node:path";
import { findAllProjects } from "../repositories/projects.repo";

function realpathDirectory(dir: string, label: string): string {
  const trimmed = dir.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  const stat = fs.statSync(trimmed);
  if (!stat.isDirectory()) throw new Error(`${label} is not a directory: ${dir}`);
  return fs.realpathSync(trimmed);
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

export function resolveRegisteredProjectPath(projectPath: string): string {
  let realProjectPath: string;
  try {
    realProjectPath = realpathDirectory(projectPath, "projectPath");
  } catch {
    throw new Error(`projectPath is not a directory: ${projectPath}`);
  }

  for (const project of findAllProjects()) {
    try {
      if (samePath(realProjectPath, fs.realpathSync(project.path))) {
        return realProjectPath;
      }
    } catch {
      // Ignore stale project rows; they should not grant writes anywhere.
    }
  }
  throw new Error("projectPath must be a registered Mission Control project");
}
