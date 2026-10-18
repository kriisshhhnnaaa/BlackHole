# Black Hole

An interactive, full-screen 3D black hole observatory built with React, Three.js, React Three Fiber, and Vite.

The experience combines a cinematic accretion disk, a dark event-horizon silhouette, a layered photon-ring approximation, animated relativistic jets, mouse-reactive plasma particles, and a gravity lab for experimenting with simulated objects.

## What is included

- Animated accretion disk with procedural plasma detail, temperature-based color, turbulence, filaments, and multiple visual layers.
- Genuinely dark central shadow with a restrained photon-ring and lensing approximation.
- GPU-backed particles and trails that react to the pointer and can be stirred with a right-button drag.
- Relativistic-jet visualization and optional star field.
- Gravity lab with asteroids, gas particles, test particles, and stars.
- Selectable 3D objects with hover information, click selection, camera-plane dragging, and release velocity based on the drag motion.
- Simplified gravitational trajectories that allow objects to orbit, escape, approach the center, or cross the illustrative capture boundary.
- Capture feedback, disk disturbance, orbit paths, counters, telemetry, pause, reset, camera controls, and visibility toggles.
- Reduced-motion support and a compact HUD that keeps the scene as the main focus.

## How it is made

The application is a Vite-powered React single-page experience. React owns the interface, HUD state, settings, object menu, counters, and experiment controls. React Three Fiber provides the render loop and connects the React component tree to a Three.js scene.

The 3D scene is organized into focused systems:

- `BlackHoleScene.tsx` contains the scene, camera rig, central shadow, disk shader, photon halo, particle field, jets, orbit paths, and simulated bodies.
- Custom GLSL materials draw the accretion disk, photon-ring region, particle points, and particle trails with additive color and controlled opacity.
- The particle field keeps positions, velocities, history buffers, colors, sizes, and seeds in typed arrays so thousands of particles can update without creating a React render for every particle.
- Simulated bodies keep one position and velocity state for physics, visuals, orbit paths, and selected-object telemetry.
- Pointer picking uses Three.js raycasting. A selected body is moved on a stable camera-facing plane, and its release velocity is calculated from recent drag samples.
- The gravity lab uses a softened Newtonian model with normalized units. It is designed for visual experimentation and stability rather than precise relativistic prediction.

## Controls

| Input | Action |
| --- | --- |
| Left drag on empty space | Stir the disk field and particles |
| Right drag | Apply a stronger particle brush |
| Shift + left drag | Orbit the camera |
| Right drag on supported camera space | Pan the view when available |
| Mouse wheel | Zoom in or out |
| Hover an object | Inspect its simulated properties |
| Click an object | Select it |
| Click and drag an object | Move it through 3D space |
| Release an object | Apply a velocity based on the drag |
| `R` | Reset the camera |

The HUD also provides controls for pausing, resetting the simulation, spawning objects, toggling the disk, stars, lensing, particles, cursor field, orbit paths, jets, and settings.

## Run locally

Requirements:

- Node.js with npm

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Then open the local address shown by Vite.

## Build for production

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

## Simulation notes

The gravity and lensing views are educational visual approximations using normalized simulation units. The gravity lab uses a softened attraction model, frame-rate-limited integration, damping, capture checks, and scene bounds. The lensing layer is a shader-based visual approximation; it is not a full general-relativistic ray tracer.

The scene is tuned to keep the event horizon visibly black while retaining color separation between hot white plasma, gold, orange, violet, and cool blue material. Brightness, particle density, rotation speed, lensing strength, and interaction strength can be adjusted through the settings panel.

## AI assistance

Approximately 5% of the work used AI assistance for implementation support and wording suggestions. The project direction, feature choices, integration, testing, visual tuning, and final decisions were reviewed and completed as part of the project workflow.
