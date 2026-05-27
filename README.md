<div align="center">
  <img src="app/public/logo192.png" width="68" alt="Cyclemetry">
  <h1>Cyclemetry</h1>
  <p><strong>Open-source desktop app for creating cycling telemetry video overlays from GPX data.</strong><br>
  Import a ride, design your overlay in a live editor, and export a finished video — no subscription, no cloud.</p>

[![License: MIT](https://img.shields.io/badge/license-MIT-crimson?style=flat-square)](LICENSE)
[![macOS](https://img.shields.io/badge/macOS-supported-333?style=flat-square&logo=apple&logoColor=white)](https://cyclemetry.walkersutton.com/install)
[![Windows](https://img.shields.io/badge/Windows-supported-333?style=flat-square&logo=windows&logoColor=0078D4)](https://cyclemetry.walkersutton.com/install)
[![Linux](https://img.shields.io/badge/Linux-supported-333?style=flat-square&logo=linux&logoColor=white)](https://cyclemetry.walkersutton.com/install)

</div>

<br>

![Cyclemetry editor demo](https://github.com/user-attachments/assets/7e578b89-070b-4709-b016-075fcc364b13)

<br>

## What it does

Cyclemetry reads a GPX file and renders cycling metrics — **speed, power, heart rate, elevation, cadence, gradient, and live map position** — directly into your video as a customizable overlay. The output is a standalone video file ready to upload to YouTube.

**Key details:**

- Drag-and-drop overlay editor with a live preview canvas
- Template system: start from a built-in template or build your own from scratch
- Native Rust rendering pipeline — fast
- FFmpeg-based export at your chosen resolution
- Runs entirely on your machine — no account, no internet connection, no recurring cost

## Install

Download for **macOS** (Apple Silicon & Intel), **Windows**, or **Linux**:

**→ [cyclemetry.walkersutton.com/install](https://cyclemetry.walkersutton.com/install)**

## Templates

Built-in templates give you a starting point. Drag elements, adjust colors and typography, and save your own.

<table>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/walkersutton/cyclemetry/main/templates/safa/preview.jpg" width="280" alt="Safa template"><br><sub>Safa</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/walkersutton/cyclemetry/main/templates/norcal/preview.jpg" width="280" alt="NorCal template"><br><sub>NorCal</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/walkersutton/cyclemetry/main/templates/will/preview.jpg" width="280" alt="Will template"><br><sub>Will</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/walkersutton/cyclemetry/main/templates/jeff/preview.jpg" width="280" alt="Jeff template"><br><sub>Jeff</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/walkersutton/cyclemetry/main/templates/crit/preview.jpg" width="280" alt="Crit template"><br><sub>Crit</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/walkersutton/cyclemetry/main/templates/aaron/preview.jpg" width="280" alt="Aaron template"><br><sub>Aaron</sub></td>
  </tr>
</table>

## Showcase

Videos made with Cyclemetry. Click any thumbnail to watch on YouTube.

<table>
  <tr>
    <td align="center">
      <a href="https://www.youtube.com/watch?v=i2vdPIfIswc">
        <img src="https://img.youtube.com/vi/i2vdPIfIswc/hqdefault.jpg" width="280" alt="Descent into Rincon">
      </a><br><sub><b>Descent into Rincon</b> · Walker Sutton</sub>
    </td>
    <td align="center">
      <a href="https://www.youtube.com/watch?v=gKugPA0xGhw">
        <img src="https://img.youtube.com/vi/gKugPA0xGhw/hqdefault.jpg" width="280" alt="Seward Park Crit">
      </a><br><sub><b>Seward Park Crit</b> · Walker Sutton</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://www.youtube.com/watch?v=96_nwEF-Bfc">
        <img src="https://img.youtube.com/vi/96_nwEF-Bfc/hqdefault.jpg" width="280" alt="Stunt Descent">
      </a><br><sub><b>Stunt Descent</b> · Walker Sutton</sub>
    </td>
    <td align="center">
      <a href="https://www.youtube.com/watch?v=JmavtEU6Vvo">
        <img src="https://img.youtube.com/vi/JmavtEU6Vvo/hqdefault.jpg" width="280" alt="Testing Cyclemetry">
      </a><br><sub><b>Testing Cyclemetry</b> · Paolo Tagliaferri</sub>
    </td>
  </tr>
</table>

→ **[cyclemetry.walkersutton.com/showcase](https://cyclemetry.walkersutton.com/showcase)** · submit your own video

## Built with

| Layer        | Technology              |
| ------------ | ----------------------- |
| UI           | Svelte 5 + Vite         |
| Shell        | Tauri 2                 |
| Rendering    | Rust (native pipeline)  |
| Video export | FFmpeg                  |
| Platforms    | macOS · Windows · Linux |

## Development

Local setup, resource bundling, and release steps: **[cyclemetry.walkersutton.com/developing](https://cyclemetry.walkersutton.com/developing)**

```bash
pnpm dev      # run with hot-reload
pnpm build    # full distribution build
pnpm lint     # ESLint
pnpm format   # Prettier
```

## Contributing

Pull requests are welcome. For larger changes, open an issue first to discuss direction.
