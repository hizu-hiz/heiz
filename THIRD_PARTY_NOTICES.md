# Third-party notices

The MIT license in `LICENSE` covers Heiz's own source code. Bundled third-party material keeps its own license:

| Component | License | Location |
|---|---|---|
| Leaflet 1.9.4 | BSD-2-Clause | `web/assets/vendor/leaflet/` |
| Bricolage Grotesque, Atkinson Hyperlegible (fonts) | SIL Open Font License 1.1 | `web/assets/fonts/` (licence files alongside) |
| Earthquake data | BMKG, used with attribution ("Source: BMKG") | fetched at runtime, not bundled |
| Map tiles | Esri, OpenTopoMap / OpenStreetMap contributors (CC-BY-SA) | loaded by the browser at runtime |
| Offline map outline (`web/assets/data/outline.json`) | Natural Earth (public domain), via `world-atlas` 2.0.2 (ISC) | bundled |
| Font: Poppins (splash screen) | The Poppins Project Authors, SIL OFL 1.1, via `@fontsource/poppins` 5.3.0 | bundled in `web/assets/fonts` |

The Heiz name and the logo files in `web/assets/img/heiz-logo-*.svg` are the owner's brand assets and are **not**
licensed under MIT; do not reuse them for a different project without permission.
