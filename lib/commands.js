/*
 * Lightning Search Launcher, terminal command runner
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 *
 */
import Gio from "gi://Gio";
import GLib from "gi://GLib";

const COMMAND_SCORE = 1100;

const TERMINAL_SCHEMA = "org.gnome.desktop.default-applications.terminal";
const FALLBACK_TERMINAL = { exec: "gnome-terminal", arg: "--" };

const PROGRAM_NAME = /^[A-Za-z0-9][A-Za-z0-9._+@-]*$/;

const executableCache = new Map();

export function makeCommandItem(query, _ = (text) => text) {
  const trimmed = query.trim();
  if (trimmed === "") return null;

  const name = trimmed.split(/\s+/)[0];
  if (!PROGRAM_NAME.test(name)) return null;
  if (!findExecutable(name)) return null;

  return {
    type: "command",
    title: trimmed,
    subtitle: _("Run in background (Ctrl + Enter for terminal window)"),
    command: trimmed,
    score: COMMAND_SCORE,
  };
}

function findExecutable(name) {
  if (executableCache.has(name)) return executableCache.get(name);

  let resolved = null;
  try {
    resolved = GLib.find_program_in_path(name) || null;
  } catch (_error) {
    resolved = null;
  }
  executableCache.set(name, resolved);
  return resolved;
}

export function clearCommandCache() {
  executableCache.clear();
}

export function runCommand(item, mode = "background") {
  if (!item.command) return;
  if (mode === "terminal") {
    launchInTerminal(item.command);
    return;
  }
  launchInBackground(item.command);
}

function launchInBackground(command) {
  const shell = GLib.getenv("SHELL") || "/bin/bash";
  try {
    const launcher = new Gio.SubprocessLauncher({
      flags:
        Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
    });
    launcher.set_cwd(GLib.get_home_dir());
    const process = launcher.spawnv([shell, "-c", command]);
    // Reap the child asynchronously so it never lingers as a zombie.
    process.wait_async(null, () => {});
  } catch (error) {
    console.error(
      `[Lightning Search Launcher] Could not run command: ${error}`,
    );
  }
}

function launchInTerminal(command) {
  const { exec: terminal, arg } = terminalCommand();
  const shell = GLib.getenv("SHELL") || "/bin/bash";
  const script = `${command}; exec ${shellQuote(shell)}`;
  const argv =
    arg === "-e"
      ? [terminal, "-e", `${shellQuote(shell)} -c ${shellQuote(script)}`]
      : [terminal, arg || "--", shell, "-c", script];

  try {
    const process = Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    process.wait_async(null, () => {});
  } catch (error) {
    console.error(
      `[Lightning Search Launcher] Could not launch terminal: ${error}`,
    );
  }
}

function terminalCommand() {
  try {
    const settings = new Gio.Settings({ schema_id: TERMINAL_SCHEMA });
    const exec = settings.get_string("exec") || "";
    if (exec) return { exec, arg: settings.get_string("exec-arg") || "--" };
  } catch (_error) {}
  return FALLBACK_TERMINAL;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
