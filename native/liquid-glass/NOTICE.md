# Veyra Liquid Glass migration

Migrated from the user's Veyra source, `src/Veyra/Rendering`, on 2026-11-12.
`migration.json` records byte hashes of the unmodified optical shader, compiled
shader resources, renderer, capture implementation, material parameters and
contrast logic. No Veyra Dock, tray, taskbar replacement or settings code is used.

The only change inside the compositor adds Sonara's main process to its local
capture exclusion set. It does not set Windows capture exclusion: screenshots
and recording can still include Sonara. `Program.cs` adapts the existing WPF
bitmap output to an acknowledged binary pipe; Sonara paints it below DOM content.
No desktop frames are saved to files or sent over a network.

Dependencies: Vortice / SharpGen (MIT), Windows SDK / .NET Windows Desktop runtime.
Their distribution notices are in `assets/licenses/veyra` in the complete project.
