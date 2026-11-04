# Test fixtures

These files are development fixtures, not a personal sample library:

- `reference-audio.f32`: synthetic mono floating-point test signal used for numerical feature checks; not a human recording.
- `reference-features.json`: reference vectors computed from that synthetic signal, used to compare the JavaScript implementation against its numerical reference.
- `legacy-profile.npz`: three artificial examples for testing legacy NPZ parsing and migration; contains no original user audio.

Tests generate temporary media and Kdenlive projects inside `tests/.tmp`. That directory is excluded from Git and public source archives.
