import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SceneOptions, SimObject, ObjectKind, FeatureInfo, SceneHandle } from './BlackHoleScene'
import { Activity, Atom, CircleHelp, Crosshair, Eye, EyeOff, Maximize, Minimize, Orbit, Pause, Play, Plus, RotateCcw, SlidersHorizontal, Sparkles, Waves, Wind, X } from 'lucide-react'

const BlackHoleScene = lazy(() => import('./BlackHoleScene'))
const defaults: SceneOptions = { rotation: true, disk: true, lensing: true, particles: true, stars: true, jets: true, orbitPaths: true, interactionEnabled: true, cursorForce: 1, brightness: .78, density: 1, lensingStrength: 1, rotationSpeed: 1, sensitivity: 1, mode: 'cinematic' }

const descriptions: Record<string, string> = {
  'EVENT HORIZON': 'The boundary beyond which light cannot escape to a distant observer. It is not a solid surface.',
  'ACCRETION DISK': 'Superheated gas and plasma orbiting the black hole. Dissipative processes can release enormous gravitational energy.',
  'PHOTON RING REGION': 'Light following strongly curved paths near a black hole can contribute to a narrow, bright ring-like feature.',
  'TEST PARTICLE': 'A simulated object whose trajectory follows the simplified gravity model used in this experiment.',
  ASTEROID: 'A small test body that can orbit, escape, or fall inward depending on its starting position and velocity.',
  'GAS PARTICLE': 'A lightweight tracer used to visualize material moving through the illustrative gravitational field.',
  STAR: 'A simplified demonstration object. Its path is simulated and is not a real astronomical prediction.',
  'BLACK HOLE': 'A compact region of spacetime represented here by a dark event-horizon silhouette and a luminous surrounding disk.',
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>
}

export default function App() {
  const [options, setOptions] = useState<SceneOptions>(defaults)
  const [objects, setObjects] = useState<SimObject[]>([])
  const [paused, setPaused] = useState(false)
  const [hud, setHud] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [experiment, setExperiment] = useState(false)
  const [selected, setSelected] = useState<FeatureInfo | null>(null)
  const [cameraDistance, setCameraDistance] = useState(8)
  const [captured, setCaptured] = useState(0)
  const [spawnKind, setSpawnKind] = useState<ObjectKind>('ASTEROID')
  const [speed, setSpeed] = useState(1.4)
  const [launchAngle, setLaunchAngle] = useState(0.7)
  const [launchRadius, setLaunchRadius] = useState(4.2)
  const [showSettings, setShowSettings] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const sceneRef = useRef<SceneHandle>(null)
  const objectsRef = useRef(objects)
  objectsRef.current = objects

  const setOption = useCallback(<K extends keyof SceneOptions>(key: K, value: SceneOptions[K]) => setOptions(prev => ({ ...prev, [key]: value })), [])
  const addObject = useCallback((kind: ObjectKind = spawnKind, position?: [number, number, number], velocity?: [number, number, number]) => {
    const radius = position ? Math.hypot(...position) : 3.4 + Math.random() * 2.0
    const angle = position ? Math.atan2(position[2], position[0]) : Math.random() * Math.PI * 2
    const tangent = velocity ?? [-Math.sin(angle) * speed, (Math.random() - 0.5) * 0.12, Math.cos(angle) * speed]
    const obj: SimObject = { id: crypto.randomUUID(), kind, position: position ?? [Math.cos(angle) * radius, (Math.random() - 0.5) * 1.4, Math.sin(angle) * radius], velocity: tangent, color: kind === 'ASTEROID' ? '#a9b6c7' : kind === 'GAS PARTICLE' ? '#ff9c59' : kind === 'STAR' ? '#fff0be' : '#63d9ff', mass: kind === 'ASTEROID' ? 1.6 : kind === 'STAR' ? 2.2 : kind === 'GAS PARTICLE' ? 0.25 : 0.7, age: 0 }
    setObjects(prev => [...prev.slice(-79), obj])
    setSelected({ name: kind, description: descriptions[kind] ?? descriptions['TEST PARTICLE'], id: obj.id })
  }, [spawnKind, speed])
  const reset = () => { setObjects([]); setCaptured(0); setPaused(false); setSelected(null); setOptions(defaults); sceneRef.current?.resetCamera(); sceneRef.current?.resetSimulation() }
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await rootRef.current?.requestFullscreen()
      else await document.exitFullscreen()
    } catch { /* Fullscreen may be unavailable in an embedded browser. */ }
  }
  useEffect(() => { const fn = () => setFullscreen(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', fn); return () => document.removeEventListener('fullscreenchange', fn) }, [])
  const activeCount = objects.length
  const selectedDescription = selected ? selected.description || descriptions[selected.name] || descriptions['TEST PARTICLE'] : ''
  const panelName = selected?.name ?? 'BLACK HOLE'
  const selectedObject = selected?.id ? objects.find(object => object.id === selected.id) : undefined
  const selectedRadius = selectedObject ? Math.hypot(...selectedObject.position) : 0
  const selectedSpeed = selectedObject ? Math.hypot(...selectedObject.velocity) : 0
  const selectedStatus = !selectedObject ? '' : selectedRadius < 1.8 ? 'CLOSE APPROACH' : selectedSpeed > 1.9 && selectedRadius > 4 ? 'ESCAPING' : selectedRadius < 3.2 ? 'ORBIT / APPROACH' : 'FREE FLIGHT'
  const trajectoryInfo = useMemo(() => `r₀ ${launchRadius.toFixed(1)} u · v₀ ${speed.toFixed(2)} u/s · θ ${launchAngle.toFixed(2)} rad`, [launchRadius, speed, launchAngle])

  return <main ref={rootRef} className={`black-hole-only ${hud ? '' : 'hud-hidden'}`}>
    <Suspense fallback={<div className="scene-loading"><span className="loading-orb" /><div>INITIALIZING GRAVITY FIELD</div></div>}>
      <BlackHoleScene ref={sceneRef} options={options} objects={objects} paused={paused} experiment={experiment} onObjectsChange={setObjects} onCaptured={() => setCaptured(v => v + 1)} onHover={setSelected} onCameraDistance={setCameraDistance} />
    </Suspense>

    {hud && <>
      <header className="hud-header glass">
        <div className="brand-mark"><span className="brand-orbit" /><span className="brand-core" /></div>
        <div className="brand-copy"><strong>EVENT HORIZON</strong><span>GRAVITATIONAL FIELD OBSERVATORY <i>•</i> SIMULATION 01</span></div>
        <div className="header-live"><span className={`live-dot ${paused ? 'paused' : ''}`} />{paused ? 'SIMULATION PAUSED' : 'SIMULATION LIVE'}</div>
      </header>

      <section className="object-panel glass">
        <div className="eyebrow"><Crosshair size={12} /> TARGET IDENTIFICATION</div>
        <h1>{panelName}</h1>
        <p>{selectedDescription || descriptions['BLACK HOLE']}</p>
        {selected?.id && <>
          {selectedObject && <div className="selected-telemetry">
            <Metric label="STATUS" value={selectedStatus} />
            <Metric label="RADIUS" value={`${selectedRadius.toFixed(2)} u`} />
            <Metric label="SPEED" value={`${selectedSpeed.toFixed(2)} u/s`} />
            <Metric label="POSITION" value={selectedObject.position.map(value => value.toFixed(1)).join(', ')} />
          </div>}
          <button className="text-action" onClick={() => setSelected(null)}>DESELECT OBJECT <X size={12} /></button>
          <button className="text-action delete-action" onClick={() => { setObjects(current => current.filter(object => object.id !== selected.id)); setSelected(null) }}>DELETE SELECTED <X size={12} /></button>
        </>}
        <div className="panel-rule" />
        <div className="eyebrow">SIMULATED ENVIRONMENT</div>
        <Metric label="CAMERA RANGE" value={`${cameraDistance.toFixed(2)} u`} />
        <Metric label="FREE OBJECTS" value={String(activeCount).padStart(2, '0')} />
        <Metric label="CAPTURED OBJECTS" value={String(captured).padStart(2, '0')} />
      </section>

      <section className="status-panel glass">
        <div className="eyebrow"><Activity size={12} /> SYSTEM TELEMETRY</div>
        <div className="status-grid">
          <Metric label="VIEW" value={options.mode.toUpperCase()} />
          <Metric label="ACCRETION" value={options.rotation ? 'ACTIVE' : 'STATIC'} />
          <Metric label="LENSING" value={options.lensing ? `${Math.round(options.lensingStrength * 100)}%` : 'OFF'} />
          <Metric label="PARTICLES" value={options.particles ? 'ENABLED' : 'OFF'} />
        </div>
        <div className="telemetry-foot"><span>MODEL: NEWTONIAN DEMO</span><span>NOT OBSERVATIONAL DATA</span></div>
      </section>

      {selected && <aside className="hover-card glass" role="status">
        <div className="eyebrow"><CircleHelp size={12} /> FEATURE INSPECTOR</div><strong>{selected.name}</strong><p>{selectedDescription}</p>
      </aside>}

      <section className="help-panel glass"><div className="eyebrow"><Orbit size={12} /> NAVIGATION</div><div className="help-row"><kbd>LMB + DRAG</kbd><span>Stir disk particles</span></div><div className="help-row"><kbd>SHIFT + LMB</kbd><span>Orbit camera</span></div><div className="help-row"><kbd>SCROLL</kbd><span>Zoom in / out</span></div><div className="help-row"><kbd>RMB</kbd><span>Pan viewpoint</span></div><div className="help-row"><kbd>HOVER</kbd><span>Inspect features</span></div><div className="help-row"><kbd>R</kbd><span>Reset camera</span></div></section>

      <section className="control-dock glass">
        <div className="dock-heading"><span>SIMULATION CONTROLS</span><span className="dock-build">EH / 01.7</span></div>
        <div className="control-primary">
          <button className={`primary-control ${paused ? 'is-active' : ''}`} onClick={() => setPaused(v => !v)} title="Pause or resume the simulation">{paused ? <Play size={15} /> : <Pause size={15} />}<span>{paused ? 'RESUME' : 'PAUSE'}</span></button>
          <button className="primary-control" onClick={() => { sceneRef.current?.resetCamera(); setSelected(null) }} title="Reset camera"><RotateCcw size={15} /><span>CAMERA</span></button>
          <button className="primary-control" onClick={reset} title="Reset simulation"><Waves size={15} /><span>RESET</span></button>
        </div>
        <div className="control-toggles">
          <button className={options.disk ? 'toggle active' : 'toggle'} onClick={() => setOption('disk', !options.disk)}><Waves size={14} /> ACCRETION DISK <span>{options.disk ? 'ON' : 'OFF'}</span></button>
          <button className={options.stars ? 'toggle active' : 'toggle'} onClick={() => setOption('stars', !options.stars)}><Sparkles size={14} /> STAR FIELD <span>{options.stars ? 'ON' : 'OFF'}</span></button>
          <button className={options.lensing ? 'toggle active' : 'toggle'} onClick={() => setOption('lensing', !options.lensing)}><Orbit size={14} /> LENSING <span>{options.lensing ? 'ON' : 'OFF'}</span></button>
          <button className={options.particles ? 'toggle active' : 'toggle'} onClick={() => setOption('particles', !options.particles)}><Atom size={14} /> PARTICLES <span>{options.particles ? 'ON' : 'OFF'}</span></button>
          <button className={options.interactionEnabled ? 'toggle active' : 'toggle'} onClick={() => setOption('interactionEnabled', !options.interactionEnabled)}><Crosshair size={14} /> CURSOR FIELD <span>{options.interactionEnabled ? 'ON' : 'OFF'}</span></button>
          <button className={options.orbitPaths ? 'toggle active' : 'toggle'} onClick={() => setOption('orbitPaths', !options.orbitPaths)}><Activity size={14} /> ORBIT PATHS <span>{options.orbitPaths ? 'ON' : 'OFF'}</span></button>
          <button className={options.jets ? 'toggle active' : 'toggle'} onClick={() => setOption('jets', !options.jets)} title="Illustrative opposing relativistic jets"><Wind size={14} /> RELATIVISTIC JETS <span>{options.jets ? 'ON' : 'OFF'}</span></button>
        </div>
        <div className="dock-actions">
          <button onClick={() => setShowSettings(v => !v)} className={showSettings ? 'dock-action selected' : 'dock-action'}><SlidersHorizontal size={14} /> SETTINGS</button>
          <button onClick={() => setExperiment(v => !v)} className={experiment ? 'dock-action selected' : 'dock-action'}><Crosshair size={14} /> {experiment ? 'EXIT EXPERIMENT' : 'GRAVITY LAB'}</button>
          <button onClick={toggleFullscreen} className="icon-action" title="Toggle fullscreen">{fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}</button>
        </div>
      </section>

      {showSettings && <section className="settings-panel glass">
        <div className="panel-title"><div><div className="eyebrow">RENDER CONFIGURATION</div><strong>Scene parameters</strong></div><button className="icon-action" onClick={() => setShowSettings(false)}><X size={15} /></button></div>
        <label className="range-control"><span>Cursor force <b>{options.cursorForce.toFixed(1)}×</b></span><input type="range" min="0" max="2" step="0.1" value={options.cursorForce} onChange={e => setOption('cursorForce', Number(e.target.value))} /></label>
        <label className="range-control"><span>Disk brightness <b>{options.brightness.toFixed(2)}</b></span><input type="range" min="0.4" max="2" step="0.05" value={options.brightness} onChange={e => setOption('brightness', Number(e.target.value))} /></label>
        <label className="range-control"><span>Accretion speed <b>{options.rotationSpeed.toFixed(1)}×</b></span><input type="range" min="0" max="3" step="0.1" value={options.rotationSpeed} onChange={e => setOption('rotationSpeed', Number(e.target.value))} /></label>
        <label className="range-control"><span>Particle density <b>{options.density.toFixed(1)}×</b></span><input type="range" min="0.3" max="2.5" step="0.1" value={options.density} onChange={e => setOption('density', Number(e.target.value))} /></label>
        <label className="range-control"><span>Lensing strength <b>{options.lensingStrength.toFixed(1)}×</b></span><input type="range" min="0" max="2" step="0.1" value={options.lensingStrength} onChange={e => setOption('lensingStrength', Number(e.target.value))} /></label>
        <label className="range-control"><span>Camera sensitivity <b>{options.sensitivity.toFixed(1)}×</b></span><input type="range" min="0.3" max="2.2" step="0.1" value={options.sensitivity} onChange={e => setOption('sensitivity', Number(e.target.value))} /></label>
        <div className="mode-switch"><button onClick={() => setOption('mode', 'cinematic')} className={options.mode === 'cinematic' ? 'selected' : ''}>CINEMATIC</button><button onClick={() => setOption('mode', 'scientific')} className={options.mode === 'scientific' ? 'selected' : ''}>SCIENTIFIC</button></div>
        <button className="reset-settings" onClick={() => setOptions(defaults)}>RESET PARAMETERS TO DEFAULTS</button>
      </section>}

      {experiment && <section className="experiment-panel glass">
        <div className="panel-title"><div><div className="eyebrow"><Atom size={12} /> GRAVITY EXPERIMENT</div><strong>Initial conditions</strong></div><button className="icon-action" onClick={() => { setObjects([]); setSelected(null); sceneRef.current?.resetSimulation() }}><RotateCcw size={14} /></button></div>
        <p className="science-note">Illustrative Newtonian gravity with a softened central potential. Near-horizon paths are not relativistically accurate.</p>
        <label className="range-control"><span>Start radius <b>{launchRadius.toFixed(1)} u</b></span><input type="range" min="2.5" max="6.5" step="0.1" value={launchRadius} onChange={e => setLaunchRadius(Number(e.target.value))} /></label>
        <label className="range-control"><span>Initial speed <b>{speed.toFixed(2)} u/s</b></span><input type="range" min="0.1" max="3.8" step="0.05" value={speed} onChange={e => setSpeed(Number(e.target.value))} /></label>
        <label className="range-control"><span>Launch angle <b>{launchAngle.toFixed(2)} rad</b></span><input type="range" min="-1.57" max="1.57" step="0.05" value={launchAngle} onChange={e => setLaunchAngle(Number(e.target.value))} /></label>
        <div className="experiment-summary">{trajectoryInfo}</div>
        <button className="spawn-primary" onClick={() => addObject('TEST PARTICLE', [Math.cos(launchAngle) * launchRadius, 0.12, Math.sin(launchAngle) * launchRadius], [-Math.sin(launchAngle) * speed, 0, Math.cos(launchAngle) * speed])}><Plus size={15} /> LAUNCH TEST PARTICLE</button>
        <div className="legend"><span><i className="legend-dot cyan" /> Live trajectory</span><span><i className="legend-dot amber" /> Captured object</span></div>
      </section>}

      <section className="spawn-panel glass"><div className="eyebrow">ADD TO SIMULATION</div><div className="spawn-row"><select value={spawnKind} onChange={e => setSpawnKind(e.target.value as ObjectKind)} aria-label="Object type"><option>ASTEROID</option><option>TEST PARTICLE</option><option>GAS PARTICLE</option><option>STAR</option></select><button onClick={() => addObject()} title="Spawn selected object"><Plus size={16} /></button></div><span className="spawn-caption">Select an object, then drag it in 3D space.</span></section>

      <footer className="hud-footer"><span>ILLUSTRATIVE GRAVITY MODEL <i>•</i> SIMULATED UNITS</span><span>THREE-DIMENSIONAL ENVIRONMENT <i>•</i> {activeCount} OBJECTS IN FIELD</span></footer>
    </>}

    <button className="hud-toggle glass" onClick={() => setHud(v => !v)} title={hud ? 'Hide HUD' : 'Show HUD'} aria-label={hud ? 'Hide HUD' : 'Show HUD'}>{hud ? <EyeOff size={15} /> : <Eye size={15} />}{hud && <span>HIDE HUD</span>}</button>
  </main>
}
