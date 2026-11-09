# MineRadio provider adaptation

The provider adaptations in this directory derive from MineRadio 2.2.0 by XxHuberrr and contributors, licensed GPL-3.0-only. The user supplied its source at `C:/新建文件夹/DownLoad/Mineradio-paused-main/Mineradio-paused-main`. The original license is bundled in `assets/licenses/MineRadio-GPL-3.0.txt`.

- `qq.cjs` adapts QQ search signing, full-song search, profile, private liked-library verification, playlist field mappings, lyrics, file-quality prefixes, song detail and authorized vkey requests from `server.js`. Source SHA-256 is `536D569470BF7A9782577F3BA910A1B87272862D8D7E43DEFA5B8466B81B9FD9`.
- `kugou-core.cjs` retains the function dependency closure for account validation, bounded personal libraries and pages, search, signed authorized playback, membership checks and lyrics from `kugou-api.js`. Source SHA-256 is `9C1761325C10DF8B6C7595F9863F957CAA1CFCDB41099EBB550A9092B6AF43C0`.
- `../platform-login.cjs` adapts the isolated official-session pattern from `desktop/main.js`, source SHA-256 `26F6C78FA3A005998D6C7F7B201032BEC7244388BE1E448585BC771A0EC8C446`. The visible authentication host is changed to WebContentsView inside the existing account dialog, including trusted OAuth child views.

The Agent Pulse adapters inject a bounded metadata transport and own account session, use qualified provider IDs, cancel stale login generations, preserve source-provided restrictions, report delivered quality separately from requested quality, and expose public metadata through the application bridge. The original unbounded Kugou playlist enumeration branch is removed. Authentication values stay in main-process/session storage and are never part of renderer IPC. Audio is streamed by the existing no-store opaque protocol.

Spotify and Apple official-web sessions have separate origins and lifecycle handling. Their primary-player developer authorization requirements remain separate from website authentication.
