// Command registry used by the command palette. Features register commands
// with registerCommand(); the palette reads them with useCommands().

import { create } from "zustand";

export interface Command {
  id: string;
  title: string;
  section: string;
  shortcut?: string;
  keywords?: string;
  run: () => void | Promise<void>;
  /** Hidden from the palette when this returns false. */
  enabled?: () => boolean;
}

interface CommandStoreState {
  commands: Command[];
}

const useCommandStore = create<CommandStoreState>()(() => ({ commands: [] }));

/** Register (or replace, by id) a command. Returns an unregister function. */
export function registerCommand(cmd: Command): () => void {
  useCommandStore.setState((st) => ({ commands: [...st.commands.filter((c) => c.id !== cmd.id), cmd] }));
  return () => {
    useCommandStore.setState((st) => ({ commands: st.commands.filter((c) => c.id !== cmd.id) }));
  };
}

export function registerCommands(cmds: Command[]): () => void {
  const disposers = cmds.map(registerCommand);
  return () => disposers.forEach((d) => d());
}

export function useCommands(): Command[] {
  return useCommandStore((st) => st.commands);
}

export function getCommands(): Command[] {
  return useCommandStore.getState().commands;
}
