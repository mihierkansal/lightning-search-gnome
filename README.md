# Spotlight GNOME Launcher

## About

Spotlight GNOME Launcher is a lightweight launcher that looks like macOS's Spotlight. It searches files, apps, and the web, and even evaluates calculations, right from a single search box.

## Installation

Make sure you're using GNOME.
Run the installer:

```bash
./install.sh
```

You'll be instructed how to configure the launcher.
Defaults to Control + Super + Space to open it.

## Packaging

To pack it for upload to [extensions.gnome.org](https://extensions.gnome.org/upload/), run `./pack.sh`. It creates the zip file in the project directory, gitignored.

## Usage

Type to search. Use the arrow keys (or Tab) to move between results and press
Enter to open the selected one. Escape closes the launcher.
What you can search:
**Apps**: Type part or all of the name of an app - depending on how fuzzy the matching setting is, you can omit some characters in between; for example, on "loose", typing "vsc" will bring up "Visual Studio Code."
**Files**: Type part or all of a file name/path. Same fuzziness rule.
**Calculator**: Type a math expression, like 4 + 3 \* 8 (it follows order of operations)
**URL**: Type a URL/website, like https://example.com, example.com, localhost:3000, 192.168.1.1; Only some domains are recognized if you don't type https://, since the .something kind of naming is used for both files and websites - like .zip, .com, etc.
**Web**: Shown when not very many other things (apps, files, calculator, etc) match what you typed. Defaults to Google, but you can change it.

## Controlling from the terminal

You can run it from the terminal, so a custom
`.desktop` file, a GNOME custom keyboard shortcut, or a button mapped to a
keybinding can open the launcher.

The installer places a command in `~/.local/bin`:

```bash
lightning-launcher open
lightning-launcher hide
lightning-launcher search "Some search term"
```

Alternatively:

```bash
gdbus call --session \
  --dest org.gnome.Shell.Extensions.LightningLauncher \
  --object-path /org/gnome/Shell/Extensions/LightningLauncher \
  --method org.gnome.Shell.Extensions.LightningLauncher.Toggle
```

## Configuration

Open the extension's preferences to customize it:

- **Shortcut**: the global keybinding that opens the launcher.
- **Panel**: show or hide the search icon on the right of the top bar.
- **Launcher**: the placeholder text shown in the search box while it is empty, plus
  whether the search icon is shown and how large its magnifying glass is drawn.
- **Appearance**: the background color of the highlighted result row.
- **Search**: the search engine used for the “Search web” fallback result.

## Screenshots

<img src="Screenshot/main-box.png" alt="Launcher view" width="600" style="border-radius:6px;display:block;margin:6px;">
<img src="Screenshot/app-search.png" alt="Application search" width="600" style="border-radius:6px;display:block;margin:6px;">
<img src="Screenshot/file-search.png" alt="Files search" width="600" style="border-radius:6px;display:block;margin:6px;"> 
<img src="Screenshot/calculator.png" alt="Calculator" width="600" style="border-radius:6px;display:block;margin:6px;">

## The reason it exists, despite alternatives

Why not just use the app grid/search that comes with GNOME? It pushes away your entire desktop into those tiny boxes to render the launcher full screen. Not everyone wants that. Also, it's sometimes slow or laggy to open. This extension is fast, because it's more minimal.

Why not Rofi? Unfortunately Rofi doesn't work on GNOME Wayland - it requires wlroots, which GNOME explicitly said they will not implement.

Why not Ulauncher? It requires more styling to feel at home on GNOME.

Why not Search Light? The styling and alignment are a bit off. It doesn't respect your shell theme very well. Also it's finicky on GNOME 50+ - you CAN try to edit the metadata but it won't always actually work.

Why not Vicinae? It doesn't look like your GNOME setup (ignores GTK/shell theme) so you have to theme it separately to match. And the font keeps resetting to the default. Additionally, for some reason it uses adwaita or fallback (often blurry) icons for apps rather than your selected icon theme, and text is blurry on GNOME 50/51.

## License

Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal

This project is licensed under the GNU General Public License v3 or later.
See the LICENSE file for details.

Forked from https://gitlab.com/rimal.avimanyu/lightning-gnome-launcher-extension, styling modified, animations added, file search improved.
