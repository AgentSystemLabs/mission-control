export type FilePathTreeNode =
  | {
      kind: "dir";
      name: string;
      path: string;
      fileCount: number;
      children: FilePathTreeNode[];
    }
  | {
      kind: "file";
      name: string;
      path: string;
    };

type MutableFilePathTreeDir = {
  name: string;
  path: string;
  fileCount: number;
  dirs: Map<string, MutableFilePathTreeDir>;
  files: string[];
};

export function buildFilePathTree(paths: string[]): FilePathTreeNode[] {
  const root: MutableFilePathTreeDir = {
    name: "",
    path: "",
    fileCount: 0,
    dirs: new Map(),
    files: [],
  };

  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    if (parts.length === 1) {
      root.files.push(path);
      continue;
    }

    let current = root;
    for (const part of parts.slice(0, -1)) {
      const dirPath = current.path ? `${current.path}/${part}` : part;
      let dir = current.dirs.get(part);
      if (!dir) {
        dir = {
          name: part,
          path: dirPath,
          fileCount: 0,
          dirs: new Map(),
          files: [],
        };
        current.dirs.set(part, dir);
      }
      dir.fileCount += 1;
      current = dir;
    }

    current.files.push(path);
  }

  return dirChildren(root);
}

export function flattenFilePathTree(
  nodes: FilePathTreeNode[],
  collapsedFolders: Set<string> = new Set(),
): string[] {
  const paths: string[] = [];

  for (const node of nodes) {
    if (node.kind === "file") {
      paths.push(node.path);
      continue;
    }
    if (!collapsedFolders.has(node.path)) {
      paths.push(...flattenFilePathTree(node.children, collapsedFolders));
    }
  }

  return paths;
}

export function displayFilePath(path: string): { basename: string; dir: string } {
  const idx = path.lastIndexOf("/");
  if (idx < 0) return { basename: path, dir: "" };
  return { basename: path.slice(idx + 1), dir: path.slice(0, idx) };
}

function dirChildren(dir: MutableFilePathTreeDir): FilePathTreeNode[] {
  const dirs: FilePathTreeNode[] = Array.from(dir.dirs.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((child) => ({
      kind: "dir" as const,
      name: child.name,
      path: child.path,
      fileCount: child.fileCount,
      children: dirChildren(child),
    }));

  const files: FilePathTreeNode[] = dir.files
    .slice()
    .sort((a, b) => {
      const byName = displayFilePath(a).basename.localeCompare(displayFilePath(b).basename);
      return byName || a.localeCompare(b);
    })
    .map((path) => ({
      kind: "file" as const,
      name: displayFilePath(path).basename,
      path,
    }));

  return [...dirs, ...files];
}
