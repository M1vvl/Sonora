# 0.3.22 playback control audit

Scope: music controls, queue metadata persistence, account-write picker and feedback projection. No anime/movie, user-account writes, screen automation or GPU/visual acceptance was performed. The parent release task owns versioning and packaging.

## MineRadio source evidence

- `C:\新建文件夹\DownLoad\Mineradio-paused-main\Mineradio-paused-main\public\js\modules\05-playback\14-player-controls.js` SHA-256 `c44df9ce56382ea73aa33229dc04159f4e165e82f6ba52ef11c25f9305b630bf`
- `C:\新建文件夹\DownLoad\Mineradio-paused-main\Mineradio-paused-main\public\js\modules\05-playback\06-track-detail-lyrics-actions.js` SHA-256 `d65c7ce7d787739803b54e9613c71bb8b21a53e7d3631ca0364fea8ab46bf3b4`

- `14-player-controls.js:689–750`: one button cycles modes, updates title/aria/icon/data-mode together; `628–659` separates manual previous/next from repeat treatment. MineRadio has three modes, with its `loop` equivalent to list repeat. Agent Pulse adds the user's explicit distinct sequential mode: natural ending at queue tail stops; explicit previous/next still wraps. The user's requested order is sequence → repeat-one → shuffle → repeat-all → sequence.
- `06-track-detail-lyrics-actions.js:1390–1445` and `1586–1621`: account likes/collection operate on a target song, guard concurrent writes, await a real provider result and use a dedicated collection overlay. Agent Pulse keeps the existing provider API and requires boolean acknowledgement rather than treating an empty response as success. It does not import MineRadio credentials, endpoint unlocks or offline media.

## Requirement checks

- [x] A single directly clickable mode button cycles four modes; four distinct SVGs, title, aria-label and data-mode agree. Single repeat uses one self-returning circular arrow with a 1. The mode menu and its keyboard/menu-dismiss listeners/styles were removed.
- [x] Natural sequential queue tail stops; repeat-all wraps; repeat-one repeats only natural endings; shuffle retains its no-repeat bag and real previous history. Four modes persist in metadata and reopen paused without fetching audio.
- [x] Immersive transport reuses the same original controls and single audio; no separate shuffle button or extra visual-settings gear. The existing DIY button remains under the immersive controller.
- [x] Like actions remain bound to original player delegation after portal relocation; a confirmed response changes current/queued liked state without replacing stream, position or mode. Unconfirmed API writes cannot turn the heart on.
- [x] Collection/queue use an explicit panel presentation rather than inheriting pointer-transparent 3D shelf CSS. The panel/header/content remain interactive above the active immersive surface. Explicit queue/collection still opens if the decorative shelf is disabled.
- [x] Opening collection invalidates stale pending shelf-detail results. Only owned destinations are offered; no mutation occurs until the user selects a destination; the panel closes only after `added:true`.
- [x] Short account/action feedback follows the active immersive root, so it cannot remain invisible inside the inert primary page; it returns with the primary page.
- [x] Root's music interaction-policy module is initialized/disposed by the UI lifecycle; actual form editing remains available. Themes and live profile/credentials were not changed.

## Verification

`node --test tests/music-library-ui.test.cjs tests/music-immersive-integration.test.cjs tests/music-playback-session.test.cjs tests/music-ui.test.cjs`

53 / 53 passed. Tests use isolated JSDOM, mocked media and mocked account replies; the collection regression also evaluates loaded CSS hit-testing rules. They prove control routing, state and API contracts, not that a production account write or visual fidelity has passed. No credentials/network writes or GPU surface checks were used.
