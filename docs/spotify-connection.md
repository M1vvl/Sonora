# Spotify connection in Sonara

- The official-client entry opens Spotify using its registered `spotify:` URI. It does not require a Sonara developer login. Windows media integration continues to observe the official player.
- Enhanced integration is optional. It uses Authorization Code with PKCE, a one-time loopback state, and the application's public Client ID. The registered redirect URI must be `http://127.0.0.1:43821/spotify/callback`.
- The browser authorization screen belongs to Spotify. Sonara stores only an OS-encrypted refresh token; access tokens stay in the main process. Logout clears this authorization. No installed Spotify credentials are read.
- Enhanced integration exposes account playlists, saved tracks, search, and top/saved songs. These are labelled as the user's library, not as Spotify's inaccessible personalized homepage recommendations.
- Playback uses an available Spotify Computer device through Spotify Connect. The official client supplies decoding and audio quality. Sonara's quality entry opens the official settings rather than inventing bitrate controls.
- The two heart controls share a single, provider-bound mutation. Their state changes only after an affirmative response. Spotify also reads back the library state. Unsupported QQ/Kugou/Qishui writes currently report that nothing was changed; they never write to NetEase or silently create a local favorite instead.
- Development-mode allowlists, Premium requirements, and API quota limits still apply to enhanced integration. Client ID configuration is not proof that an account or endpoint has been authorized.

Validation uses synthetic profiles and audio metadata. Tests do not modify a real account's favorites or playlists. Real Spotify authorization and entitlement checks require the user to complete the official grant screen.
