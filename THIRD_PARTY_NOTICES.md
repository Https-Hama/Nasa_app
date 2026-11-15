# Third-party notices

## Game runtime

Bundled runtime notices are retained in `licenses/`:

- Three.js 0.181.1 — MIT; https://github.com/mrdoob/three.js
- React and React DOM 19.2.0 — MIT; https://github.com/facebook/react
- MediaPipe Tasks Vision 0.10.22-rc.20250304 — Apache 2.0; https://github.com/google-ai-edge/mediapipe
- OpenCV.js — official 4.x distribution downloaded on 14 November 2026; Apache 2.0; https://opencv.org/
- MediaPipe face model — https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- MediaPipe lite pose model — https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task

The four mission illustrations are custom AI-generated assets. Exact prompts and generation provenance are retained in `public/art/PROMPTS.md`. Official NASA Human Research Program source material is loaded from `public/data/nasa-reference.json`, displayed in the NASA basis view and cited in observation reports; no NASA endorsement is implied.

## React Bits — StarBorder and ShinyText

Copyright (c) 2026 David Haz. The source-adapted components in `src/react-bits.jsx` and `src/react-bits.css` are bundled locally as part of HUMAN.exe — Orbital.

- Project: https://github.com/DavidHDev/react-bits
- Pinned revision: `4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce` (retrieved 14 November 2026)
- StarBorder: https://github.com/DavidHDev/react-bits/blob/4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce/src/content/Animations/StarBorder/StarBorder.jsx
- StarBorder styles: https://github.com/DavidHDev/react-bits/blob/4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce/src/content/Animations/StarBorder/StarBorder.css
- ShinyText: https://github.com/DavidHDev/react-bits/blob/4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce/src/content/TextAnimations/ShinyText/ShinyText.jsx
- ShinyText styles: https://github.com/DavidHDev/react-bits/blob/4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce/src/content/TextAnimations/ShinyText/ShinyText.css
- Original license: https://github.com/DavidHDev/react-bits/blob/4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce/LICENSE.md

Local adaptations combine the component modules, forward decorative StarBorder hover/focus effects from the existing native launch button, add local mount points, and show static alternatives while the page is hidden or reduced motion is requested. These components require React and React DOM; they do not load a hosted component runtime.

The full upstream license text follows unchanged.

---

MIT + Commons Clause License Condition v1.0

Copyright (c) 2026 David Haz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

## Commons Clause Restriction

You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**

The same restriction covers the React Bits tools (Background Studio, Texture Lab, Shape Magic, Center Stage, Sound Lab and any tools added later) and the sounds in the sound library. **You may not sell, sublicense, or redistribute the tools or the sounds themselves, or offer the tools or a substantially similar copy of them as a hosted service-whether alone, in a bundle, or as a ported version.**

What you make with the tools is yours to use. You can use exported code, images, videos, and audio files in any personal or commercial application, website, or product, including paid ones. **You may not sell or redistribute the exports on their own, either individually or as the product itself, such as a sound, texture, background, or template pack.**

## No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
