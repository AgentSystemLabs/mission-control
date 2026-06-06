/**
 * Sentinel projectId stamped on project-less "home" terminals (the dashboard
 * terminals) so a home_terminals row satisfies the `UserTerminal` shape the
 * renderer's terminal store / panel / pane already consume. No real project row
 * has this id and nothing ever looks it up as a project — home terminals are
 * keyed in the renderer by a separate scope key, not by this value.
 */
export const HOME_TERMINAL_PROJECT_ID = "__home__";
