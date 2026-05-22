export const DIAGRAM_FORMATS = ["mermaid"] as const;
export type DiagramFormat = (typeof DIAGRAM_FORMATS)[number];

export const DIAGRAM_THEMES = ["dark", "light"] as const;
export type DiagramTheme = (typeof DIAGRAM_THEMES)[number];

export const DIAGRAM_SOURCE_MAX_BYTES = 64 * 1024;
export const DIAGRAM_TITLE_MAX_LENGTH = 120;

export type DiagramShowEvent = {
  type: "diagram:show";
  id: string;
  taskId: string;
  projectId: string;
  title: string | null;
  source: string;
  format: DiagramFormat;
};

export type StoredDiagram = Omit<DiagramShowEvent, "type">;
