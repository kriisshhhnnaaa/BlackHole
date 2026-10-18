import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Stars, Sparkles } from '@react-three/drei'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'

export type ObjectKind = 'ASTEROID' | 'TEST PARTICLE' | 'GAS PARTICLE' | 'STAR'
export type SimObject = { id: string; kind: ObjectKind; position: [number, number, number]; velocity: [number, number, number]; color: string; mass: number; age: number }
export type FeatureInfo = { name: string; description: string; id?: string }
export type SceneOptions = { rotation: boolean; disk: boolean; lensing: boolean; particles: boolean; stars: boolean; jets: boolean; orbitPaths: boolean; interactionEnabled: boolean; cursorForce: number; brightness: number; density: number; lensingStrength: number; rotationSpeed: number; sensitivity: number; mode: 'cinematic' | 'scientific' }
export type SceneHandle = { resetCamera: () => void; resetSimulation: () => void }
type Props = { options: SceneOptions; objects: SimObject[]; paused: boolean; experiment: boolean; onObjectsChange: (objects: SimObject[]) => void; onCaptured: () => void; onHover: (feature: FeatureInfo | null) => void; onCameraDistance: (distance: number) => void }
type CameraRigProps = { options: SceneOptions; onCameraDistance: (distance: number) => void; resetSignal: MutableRefObject<number>; onFeature: (feature: FeatureInfo | null) => void; pointerField: MutableRefObject<{ point: THREE.Vector3; strength: number; speed: number; active: boolean }> }

const descriptions: Record<string, string> = {
  'EVENT HORIZON': 'The boundary beyond which light cannot escape to a distant observer. It is not a solid surface.',
  'ACCRETION DISK': 'Superheated gas and plasma orbiting the black hole. Dissipative processes can release enormous gravitational energy.',
  'PHOTON RING REGION': 'Light following strongly curved paths near a black hole can contribute to a narrow, bright ring-like feature.',
  'TEST PARTICLE': 'A simulated object whose trajectory follows the simplified gravity model used in this experiment.',
  ASTEROID: 'A simulated rocky body that can orbit, escape, or fall inward depending on its initial conditions.',
  'GAS PARTICLE': 'A lightweight tracer used to visualize material moving through the illustrative gravitational field.',
  STAR: 'A simplified demonstration object. Its path is simulated and is not an astronomical prediction.',
  'BLACK HOLE': 'A compact region of spacetime represented by a dark silhouette and a luminous surrounding plasma disk.',
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  return hash >>> 0
}

type ParticleState = { positions: Float32Array; velocities: Float32Array; histories: Float32Array; colors: Float32Array; sizes: Float32Array; seeds: Float32Array; cursors: Uint8Array; trailLength: number }

function makeParticleState(count: number, trailLength: number): ParticleState {
  const positions = new Float32Array(count * 3), velocities = new Float32Array(count * 3), histories = new Float32Array(count * trailLength * 3), colors = new Float32Array(count * 3), sizes = new Float32Array(count), seeds = new Float32Array(count * 4), cursors = new Uint8Array(count)
  const palette = [new THREE.Color('#fff5d9'), new THREE.Color('#ffd09a'), new THREE.Color('#ff995d'), new THREE.Color('#e9b9ff'), new THREE.Color('#9bcaff')]
  for (let i = 0; i < count; i++) {
    const u = Math.random(), r = 1.18 + Math.pow(u, .74) * 3.65, a = Math.random() * Math.PI * 2
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = (Math.random() - .5) * (.035 + r * .085)
    const orbital = Math.sqrt(1.8 / Math.max(r, 1)) * (.76 + Math.random() * .5)
    const k = i * 3, s = i * 4
    positions[k] = x; positions[k + 1] = y; positions[k + 2] = z
    velocities[k] = -Math.sin(a) * orbital; velocities[k + 1] = (Math.random() - .5) * .07; velocities[k + 2] = Math.cos(a) * orbital
    const c = palette[Math.random() < .57 ? 0 : Math.floor(Math.random() * palette.length)]
    const warmth = .65 + Math.random() * .6
    colors[k] = c.r * warmth; colors[k + 1] = c.g * warmth; colors[k + 2] = c.b * warmth
    sizes[i] = .45 + Math.pow(Math.random(), 1.9) * 3.1
    seeds[s] = Math.random() * 6.283; seeds[s + 1] = .25 + Math.random() * 1.35; seeds[s + 2] = .3 + Math.random() * 1.8; seeds[s + 3] = Math.random()
    // Seed a smooth, connected arc behind each particle so no first-frame spokes appear.
    for (let j = 0; j < trailLength; j++) {
      const age = (trailLength - 1 - j) / (trailLength - 1), h = (i * trailLength + j) * 3
      const ang = a - age * (0.16 + 0.10 / Math.sqrt(r))
      const rr = r + age * .06
      histories[h] = Math.cos(ang) * rr
      histories[h + 1] = y - age * velocities[k + 1] * .22
      histories[h + 2] = Math.sin(ang) * rr
    }
    cursors[i] = trailLength - 1
  }
  return { positions, velocities, histories, colors, sizes, seeds, cursors, trailLength }
}

function InteractiveParticleField({ options, paused, pointerField, diskRoot }: { options: SceneOptions; paused: boolean; pointerField: MutableRefObject<{ point: THREE.Vector3; strength: number; speed: number; active: boolean }>; diskRoot: MutableRefObject<THREE.Group | null> }) {
  const count = Math.round(6800 * options.density), trailLength = 68
  const points = useRef<THREE.Points>(null), trails = useRef<THREE.LineSegments>(null)
  const state = useMemo(() => makeParticleState(count, trailLength), [count, trailLength])
  const pointGeometry = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(state.positions, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('color', new THREE.BufferAttribute(state.colors, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(state.sizes, 1)); return g }, [state])
  const trailGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const p = new Float32Array(count * (trailLength - 1) * 2 * 3), c = new Float32Array(p.length)
    // Trail tint and taper depend only on each particle's seed and the segment age.
    // Bake them once instead of rebuilding and uploading the color buffer every frame.
    for (let i = 0; i < count; i++) {
      const seed = state.seeds[i * 4 + 3], base = i * (trailLength - 1) * 2
      for (let j = 0; j < trailLength - 1; j++) {
        const vertex = (base + j * 2) * 3
        const age = (j + 1) / (trailLength - 1), taper = Math.pow(age, 1.25) * (.25 + seed * .5)
        c[vertex] = 1.05 * taper; c[vertex + 1] = .43 * taper; c[vertex + 2] = .17 * taper
        c[vertex + 3] = 1.0 * taper * .82; c[vertex + 4] = .57 * taper * .8; c[vertex + 5] = .33 * taper * .72
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('color', new THREE.BufferAttribute(c, 3))
    return g
  }, [count, trailLength, state])
  const pointMaterial = useMemo(() => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, toneMapped: false, uniforms: { uPixelRatio: { value: 1 }, uPointOpacity: { value: .4 } }, vertexShader: `attribute float aSize; varying vec3 vColor; uniform float uPixelRatio; void main(){vColor=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=clamp(aSize*uPixelRatio*(320.0/-mv.z),1.0,18.0);}`, fragmentShader: `varying vec3 vColor; uniform float uPointOpacity; void main(){vec2 q=gl_PointCoord-.5; float r=length(q); float core=exp(-r*r*34.0); float halo=exp(-r*r*8.0); float a=(core*.95+halo*.25)*uPointOpacity; if(a<.006) discard; gl_FragColor=vec4(vColor*(.4+core*.24),a);}` }), [])
  const trailMaterial = useMemo(() => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, toneMapped: false, vertexShader: `varying vec3 vTrailColor; varying float vDepth; void main(){vTrailColor=color; vec4 mv=modelViewMatrix*vec4(position,1.0); vDepth=-mv.z; gl_Position=projectionMatrix*mv;}`, fragmentShader: `varying vec3 vTrailColor; varying float vDepth; void main(){float depthFade=clamp(1.15-vDepth/58.0,.18,1.0); float intensity=0.128*depthFade; float alpha=clamp(max(max(vTrailColor.r,vTrailColor.g),vTrailColor.b)*0.36,0.0,0.128)*depthFade; gl_FragColor=vec4(vTrailColor*intensity,alpha);}` }), [])
  useEffect(() => () => { pointGeometry.dispose(); trailGeometry.dispose(); pointMaterial.dispose(); trailMaterial.dispose() }, [pointGeometry, trailGeometry, pointMaterial, trailMaterial])
  useFrame((_, delta) => {
    if (paused) return
    const dt = Math.min(delta, .022), { positions, velocities, histories, seeds, cursors } = state, field = pointerField.current
    const diskWorldToLocal = new THREE.Matrix4()
    if (diskRoot.current) { diskRoot.current.updateMatrixWorld(); diskWorldToLocal.copy(diskRoot.current.matrixWorld).invert() }
    // Convert the pointer once per frame. The previous version cloned and
    // transformed this vector separately for every particle while dragging.
    const hasCursorForce = options.interactionEnabled && field.active && field.strength > .001
    const localCursor = hasCursorForce ? field.point.clone().applyMatrix4(diskWorldToLocal) : null
    const omegaScale = options.rotationSpeed, now = performance.now() * .001
    for (let i = 0; i < count; i++) {
      const k = i * 3, s = i * 4, x = positions[k], y = positions[k + 1], z = positions[k + 2]
      const r2 = x*x + z*z + .22, r = Math.sqrt(r2), inv = 1 / (r2 * Math.sqrt(r2))
      let ax = -1.65*x*inv, az = -1.65*z*inv, ay = -1.65*y*inv*.18
      // Maintain a radius-dependent near-circular orbit against numerical damping.
      // Inner plasma responds faster; the outer field has a slower, more varied drift.
      const orbitSpeed = Math.sqrt(1.65 / Math.max(r, 1.08)) * (.84 + seeds[s+3] * .34)
      const tangentialSpeed = (-z / r) * velocities[k] + (x / r) * velocities[k+2]
      const drive = THREE.MathUtils.clamp((orbitSpeed - tangentialSpeed) * (r < 2.2 ? 1.25 : .72), -.7, .7)
      ax += (-z / r) * drive
      az += (x / r) * drive
      const turbulence = Math.sin(seeds[s] + now*.28*seeds[s+1] + r*2.2) * .055
      ax += -z/r * turbulence; az += x/r * turbulence
      if (localCursor) {
        // The cursor is mapped onto the disk plane in world coordinates; transform
        // it into the rotating black-hole group's local coordinates before stirring.
        const dx = x - localCursor.x, dy = y - localCursor.y, dz = z - localCursor.z, d2 = dx*dx + dy*dy + dz*dz + .06
        const reach = 1 / (1 + d2 * .38), falloff = reach*reach, force = field.strength * (1 + Math.min(field.speed, 3)*1.2) * falloff
        const invD = 1/Math.sqrt(d2)
        // A moving, softened vortex repels and sweeps nearby material, leaving the change in its history trail.
        ax += dx*invD*force*2.8 - dz*force*(1.35 + field.speed*.8)
        az += dz*invD*force*2.8 + dx*force*(1.35 + field.speed*.8)
        ay += dy*invD*force*1.4 + Math.sin(seeds[s]+now*1.5)*force*.8
      }
      velocities[k] = (velocities[k] + ax*dt) * Math.pow(.9995, dt*60)
      velocities[k+1] = (velocities[k+1] + ay*dt) * Math.pow(.996, dt*60)
      velocities[k+2] = (velocities[k+2] + az*dt) * Math.pow(.9995, dt*60)
      positions[k] = x + velocities[k]*dt*omegaScale
      positions[k+1] = y + velocities[k+1]*dt + Math.sin(seeds[s]+now*.6)*dt*.012
      positions[k+2] = z + velocities[k+2]*dt*omegaScale
      const nr = Math.hypot(positions[k], positions[k+2])
      // Keep the normal orbital field bounded, but let a deliberate right-button
      // brush push particles beyond the original ring. Respawn only if they travel
      // far enough away to be lost from the scene, or enter the horizon.
      const brushActive = localCursor !== null && field.strength > .35
      if (!Number.isFinite(nr) || nr < 1.13 || (!brushActive && nr > 5.45)) {
        const a = seeds[s] + now*.08, rr = 1.28 + seeds[s+3]*3.95
        positions[k] = Math.cos(a)*rr; positions[k+1] = (seeds[s+3]-.5)*rr*.075; positions[k+2] = Math.sin(a)*rr
        velocities[k] = -Math.sin(a)*Math.sqrt(1.7/rr); velocities[k+1] = 0; velocities[k+2] = Math.cos(a)*Math.sqrt(1.7/rr)
        // Teleporting a respawned particle must not draw a streak back from its old orbit.
        // Start with a compact arc at the respawn location; rebuilding a long extrapolated
        // history can create a visible spoke when the particle teleports between orbits.
        const respawnAngle = Math.atan2(positions[k+2], positions[k])
        for (let j = 0; j < trailLength; j++) {
          const h = (i*trailLength + j)*3
          const age = (trailLength - 1 - j) / (trailLength - 1)
          const angle = respawnAngle - age * 0.025
          const historyRadius = rr + age * 0.012
          histories[h] = Math.cos(angle) * historyRadius
          histories[h+1] = positions[k+1]
          histories[h+2] = Math.sin(angle) * historyRadius
        }
        cursors[i] = trailLength - 1
      }
    }
    const posAttr = pointGeometry.getAttribute('position') as THREE.BufferAttribute; posAttr.needsUpdate = true
    // Update every particle's history in the same frame; each trail reads its own circular cursor.
    const trailPos = trailGeometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < count; i++) {
        const k = i*3, cursor = cursors[i], head = (i*trailLength+cursor)*3
      histories[head] = positions[k]; histories[head+1] = positions[k+1]; histories[head+2] = positions[k+2]
      const base = i*(trailLength-1)*2
      for (let j = 0; j < trailLength-1; j++) {
        // Traverse from the oldest sample to the newest, stopping at the head.
        // The previous offset was one sample too far and wrapped to the oldest point,
        // creating a straight closing chord that could read as a central axis.
        const idxA = (cursor+2+j)%trailLength, idxB = (cursor+3+j)%trailLength
        const a = (i*trailLength+idxA)*3, b = (i*trailLength+idxB)*3, vertex = (base+j*2)*3
        // Oldest point is j=0, newest point is at the particle head.
        trailPos.setXYZ(vertex, histories[a], histories[a+1], histories[a+2]); trailPos.setXYZ(vertex+3, histories[b], histories[b+1], histories[b+2])
      }
      cursors[i] = (cursor+1)%trailLength
    }
    trailPos.needsUpdate = true
  })
  return <group>
    <points ref={points} geometry={pointGeometry} material={pointMaterial} frustumCulled={false} />
    <lineSegments ref={trails} geometry={trailGeometry} material={trailMaterial} frustumCulled={false} renderOrder={2} />
  </group>
}

function RelativisticJets({ paused }: { paused: boolean }) {
  const count = 280
  const pointsRef = useRef<THREE.Points>(null)
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const p = new Float32Array(count * 3), c = new Float32Array(count * 3), sizes = new Float32Array(count), phases = new Float32Array(count * 3)
    const cyan = new THREE.Color('#83edff'), white = new THREE.Color('#e7f8ff')
    for (let i = 0; i < count; i++) {
      phases[i*3] = Math.random() * Math.PI * 2
      phases[i*3+1] = .6 + Math.random() * 5.5
      phases[i*3+2] = Math.random()
      const color = cyan.clone().lerp(white, Math.random() * .72), k = i * 3
      c[k] = color.r; c[k+1] = color.g; c[k+2] = color.b
      sizes[i] = .45 + Math.random() * 1.15
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('color', new THREE.BufferAttribute(c, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    g.userData.phases = phases
    return g
  }, [])
  const material = useMemo(() => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, toneMapped: false, vertexShader: `attribute float aSize; varying vec3 vColor; void main(){vColor=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=clamp(aSize*(170.0/-mv.z),1.0,8.0);}`, fragmentShader: `varying vec3 vColor; void main(){float r=length(gl_PointCoord-.5); float glow=exp(-r*r*28.0); if(glow<.035) discard; gl_FragColor=vec4(vColor,glow*.78);}` }), [])
  const wisps = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const positions = new Float32Array(92 * 3)
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const m = new THREE.LineBasicMaterial({ color: i % 2 ? '#66bfe8' : '#c5f4ff', transparent: true, opacity: .13 + (i % 3) * .035, depthWrite: false, blending: THREE.AdditiveBlending })
    return { geometry: g, material: m, phase: i * 1.7, side: i % 2 ? -1 : 1, width: .025 + (i % 3) * .02 }
  }), [])
  useEffect(() => () => { geometry.dispose(); material.dispose(); wisps.forEach(w => { w.geometry.dispose(); w.material.dispose() }) }, [geometry, material, wisps])
  useFrame(() => {
    if (paused) return
    const t = performance.now() * .001
    const attr = geometry.getAttribute('position') as THREE.BufferAttribute
    const phases = geometry.userData.phases as Float32Array
    for (let i = 0; i < count; i++) {
      const k = i*3, phase = phases[k], rate = phases[k+1], side = phases[k+2] < .5 ? 1 : -1
      const travel = (t * (.42 + rate * .055) + phase * 1.8) % 1
      const y = side * (1.0 + travel * 5.3)
      const radius = .018 + travel * (.12 + phases[k+2] * .13)
      const angle = phase + t * (1.1 + rate * .08) + travel * 11
      const turbulence = Math.sin(t * 3.1 + phase * 4 + travel * 17) * radius * .24
      attr.setXYZ(i, Math.cos(angle)*radius + turbulence, y, Math.sin(angle)*radius + Math.cos(t*2+phase)*radius*.18)
    }
    attr.needsUpdate = true
    for (const w of wisps) {
      const a = w.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let j = 0; j < 92; j++) {
        const u = j / 91, y = w.side * (1.02 + u * 5.0), radius = w.width + u * (.09 + w.width)
        const angle = w.phase + t * .62 + u * 8.5 + Math.sin(t*1.8+u*13+w.phase)*.13
        a.setXYZ(j, Math.cos(angle)*radius, y, Math.sin(angle)*radius)
      }
      a.needsUpdate = true
    }
  })
  return <group>
    <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
    {wisps.map((w, i) => <primitive key={i} object={new THREE.Line(w.geometry, w.material)} />)}
  </group>
}

function AccretionDisk({ paused, visible, brightness, speed }: { paused: boolean; visible: boolean; brightness: number; speed: number }) {
  const group = useRef<THREE.Group>(null)
  const diskMaterial = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uBrightness: { value: .78 }, uPulse: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vLocal; void main(){vUv=uv; vLocal=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      varying vec2 vUv; varying vec3 vLocal; uniform float uTime; uniform float uBrightness; uniform float uPulse;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
      void main(){
        vec2 p=vUv*2.0-1.0; float r=length(p); float a=atan(p.y,p.x);
        if(r<0.285 || r>0.965) discard;
        float radial=clamp((r-.285)/.68,0.0,1.0);
        float n=noise(vec2(a*5.4-r*12.0,uTime*.17+r*6.0));
        float turbulence=noise(vec2(a*13.0+uTime*.11,r*23.0-uTime*.28));
        float filament=pow(max(0.0,.5+.5*sin(a*37.0+uTime*(.45+1.8/(r+.2))+n*5.4+turbulence*3.8)),9.0);
        float streak=pow(max(0.0,.5+.5*sin(a*91.0-r*26.0+noise(vec2(a*11.0,r*9.0))*5.0+uTime*.65)),13.0);
        float clump=smoothstep(.28,.9,noise(vec2(a*19.0+uTime*.12,r*32.0)));
        float inner=1.0-smoothstep(.30,.52,r); float outerFade=1.0-smoothstep(.78,.97,r);
        float energy=(.16+n*.22+turbulence*.2+filament*.55+streak*.26+clump*.2)*(0.68+inner*.7)*outerFade;
        vec3 cool=vec3(.42,.075,.035), gold=vec3(1.0,.31,.075), hot=vec3(1.0,.78,.42), white=vec3(1.0,.94,.78);
        vec3 col=mix(cool,gold,smoothstep(.0,.62,energy)); col=mix(col,hot,smoothstep(.48,.95,energy)); col=mix(col,white,smoothstep(.9,1.25,energy)*.48);
        // Preserve plasma color and texture by reducing alpha and highlight clipping.
        float alpha=clamp(energy*(.23+uPulse*.07)*uBrightness,0.0,.32);
        gl_FragColor=vec4(col*min(1.08,energy*.78+uPulse*.1),alpha);
      }`
  }), [])
  const diskGeometry = useMemo(() => new THREE.PlaneGeometry(2, 2, 1, 1), [])
  const stream = useMemo(() => {
    const count = 1150, positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), params = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      params[i * 4] = 1.2 + Math.random() * 2.9
      params[i * 4 + 1] = Math.random() * Math.PI * 2
      params[i * 4 + 2] = .15 + Math.random() * .85
      params[i * 4 + 3] = Math.random() * 6.28
      const c = new THREE.Color(Math.random() < .12 ? '#fff9e9' : Math.random() < .58 ? '#ffb35f' : '#ff603b')
      colors.set([c.r, c.g, c.b], i * 3)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.userData.params = params
    const material = new THREE.PointsMaterial({ size: .04, sizeAttenuation: true, transparent: true, opacity: .25, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    return { geometry, material, count }
  }, [])
  useEffect(() => () => { diskGeometry.dispose(); diskMaterial.dispose(); stream.geometry.dispose(); stream.material.dispose() }, [diskGeometry, diskMaterial, stream])
  useFrame(() => {
    if (group.current) group.current.visible = visible
    if (!visible || paused) return
    const t = performance.now() * .001 * speed
    diskMaterial.uniforms.uTime.value = t
    diskMaterial.uniforms.uBrightness.value = brightness
    const p = stream.geometry.getAttribute('position') as THREE.BufferAttribute, params = stream.geometry.userData.params as Float32Array
    for (let i = 0; i < stream.count; i++) {
      const q = i * 4, r = params[q], a = params[q + 1] + t * (.42 + 1.4 / r) * params[q + 2], clump = Math.sin(a * 17 + params[q + 3])
      p.setXYZ(i, Math.cos(a) * r, Math.sin(a * 17 + params[q + 3]) * .025, Math.sin(a) * r)
      if (clump < -.97) { p.setXYZ(i, Math.cos(a) * r * 1.08, Math.sin(a * 11) * .03, Math.sin(a) * r * 1.08) }
    }
    p.needsUpdate = true
  })
  return <group ref={group}>
    <mesh geometry={diskGeometry} material={diskMaterial} rotation={[-Math.PI / 2, 0, 0]} scale={[3.72, 3.72, 1]} renderOrder={4} />
    <points geometry={stream.geometry} material={stream.material} frustumCulled={false} renderOrder={12} />
  </group>
}

function PhotonHalo({ paused, visible, strength }: { paused: boolean; visible: boolean; strength: number }) {
  const material = useMemo(() => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uStrength: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uStrength; float hash(vec2 p){return fract(sin(dot(p,vec2(41.7,289.3)))*43758.5453);} void main(){vec2 p=vUv*2.0-1.0; float r=length(p); if(r<.255||r>.74) discard; float a0=atan(p.y,p.x); float irregular=sin(a0*5.0+uTime*.2)*.0018+sin(a0*11.0-uTime*.12)*.0007; float ring=exp(-pow((r-(.302+irregular))*56.0,2.0)); float fine=exp(-pow((r-(.318+irregular*1.4+.002*sin(a0*7.0+uTime*.2)))*105.0,2.0)); float outerFade=1.0-smoothstep(.69,.74,r); float innerFade=1.0-smoothstep(.255,.285,r); float fade=outerFade*innerFade; float speck=hash(floor(p*260.0+uTime*.08)); float a=(ring*.055+fine*.065+step(.94,speck)*ring*.055)*fade*uStrength; vec3 c=mix(vec3(.25,.43,.76),vec3(.92,.43,.22),smoothstep(-.5,.5,p.y)); gl_FragColor=vec4(c,a);}`
  }), [])
  useEffect(() => () => material.dispose(), [material])
  useFrame((_, delta) => { if (!paused) material.uniforms.uTime.value += delta; material.uniforms.uStrength.value = visible ? strength : 0 })
  return <mesh visible={visible} geometry={sharedLensingGeometry} material={material} rotation={[-Math.PI / 2, 0, 0]} scale={[2.65, 2.65, 1]} renderOrder={3} />
}

const sharedLensingGeometry = new THREE.PlaneGeometry(2, 2, 1, 1)

function BlackHole({ options, paused, diskHot, simulationTime, pointerField }: { options: SceneOptions; paused: boolean; diskHot: MutableRefObject<number>; simulationTime: MutableRefObject<number>; pointerField: MutableRefObject<{ point: THREE.Vector3; strength: number; speed: number; active: boolean }> }) {
  const root = useRef<THREE.Group>(null)
  const disk = useRef<THREE.Mesh>(null)
  const glowMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: '#f47743', transparent: true, opacity: .035, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }), [])
  useEffect(() => () => { glowMaterial.dispose() }, [glowMaterial])
  useFrame((_, delta) => {
    if (root.current && options.rotation && !paused) root.current.rotation.y += delta * .045 * options.rotationSpeed
    if (!paused) simulationTime.current += delta
    if (disk.current) disk.current.visible = options.disk
    glowMaterial.opacity = options.disk ? .018 + diskHot.current * .075 : 0
  })
  return <group ref={root}>
    <mesh userData={{ feature: 'EVENT HORIZON' }}><sphereGeometry args={[1.015, 128, 96]} /><meshBasicMaterial color="#000000" toneMapped={false} /></mesh>
    <mesh scale={[1.46, .105, 1.46]}><sphereGeometry args={[1, 48, 32]} /><primitive object={glowMaterial} attach="material" /></mesh>
    <AccretionDisk paused={paused} visible={options.disk} brightness={options.brightness} speed={options.rotationSpeed} />
    <PhotonHalo paused={paused} visible={options.lensing} strength={options.lensingStrength} />
    {options.particles && <InteractiveParticleField options={options} paused={paused} pointerField={pointerField} diskRoot={root} />}
    {options.jets && <RelativisticJets paused={paused} />}
  </group>
}

function OrbitPath({ points, color, visible }: { points: THREE.Vector3[]; color: string; visible: boolean }) {
  const geometry = useMemo(() => new THREE.BufferGeometry(), [])
  const material = useMemo(() => new THREE.LineBasicMaterial({ color, transparent: true, opacity: .38, depthWrite: false }), [color])
  const line = useMemo(() => new THREE.Line(geometry, material), [geometry, material])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  useFrame(() => {
    const needed = points.length * 3
    let attr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!attr || attr.array.length !== needed) {
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(needed), 3))
      attr = geometry.getAttribute('position') as THREE.BufferAttribute
    }
    for (let i = 0; i < points.length; i++) attr.setXYZ(i, points[i].x, points[i].y, points[i].z)
    attr.needsUpdate = true
    geometry.setDrawRange(0, points.length)
    geometry.computeBoundingSphere()
  })
  if (!visible) return null
  return <primitive object={line} />
}
function SimulatedBodies({ objects, setObjects, paused, onCaptured, onFeature, orbitPaths, experiment, pointerField, interactionEnabled, cursorForce, diskHot }: { objects: SimObject[]; setObjects: (next: SimObject[]) => void; paused: boolean; onCaptured: () => void; onFeature: (feature: FeatureInfo | null) => void; orbitPaths: boolean; experiment: boolean; pointerField: MutableRefObject<{ point: THREE.Vector3; strength: number; speed: number; active: boolean }>; interactionEnabled: boolean; cursorForce: number; diskHot: MutableRefObject<number> }) {
  const objectRefs = useRef(new Map<string, THREE.Mesh>())
  const positionsRef = useRef(new Map<string, THREE.Vector3>())
  const velocitiesRef = useRef(new Map<string, THREE.Vector3>())
  const pathsRef = useRef(new Map<string, THREE.Vector3[]>())
  const dragging = useRef<{ id: string; plane: THREE.Plane; offset: THREE.Vector3 } | null>(null)
  const selectedId = useRef<string | undefined>(undefined)
  const hoveredId = useRef<string | undefined>(undefined)
  const telemetryClock = useRef(0)
  const dragSamples = useRef<{ p: THREE.Vector3; t: number }[]>([])
  const hoverPointer = useRef({ x: 0, y: 0, inside: false, lastMove: 0 })
  const { camera, gl, raycaster, pointer, scene } = useThree()
  const scratch = useMemo(() => ({ p: new THREE.Vector3(), planeHit: new THREE.Vector3(), normal: new THREE.Vector3() }), [])
  useEffect(() => {
    const ids = new Set(objects.map(o => o.id))
    for (const map of [positionsRef.current, velocitiesRef.current, pathsRef.current, objectRefs.current] as Map<string, unknown>[]) for (const id of map.keys()) if (!ids.has(id)) map.delete(id)
    for (const o of objects) {
      if (!positionsRef.current.has(o.id)) positionsRef.current.set(o.id, new THREE.Vector3(...o.position))
      if (!velocitiesRef.current.has(o.id)) velocitiesRef.current.set(o.id, new THREE.Vector3(...o.velocity))
      if (!pathsRef.current.has(o.id)) pathsRef.current.set(o.id, [])
    }
  }, [objects])
  useEffect(() => {
    const el = gl.domElement
    const move = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect(); pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1; raycaster.setFromCamera(pointer, camera)
      if (dragging.current) {
        if (raycaster.ray.intersectPlane(dragging.current.plane, scratch.planeHit)) {
          scratch.planeHit.add(dragging.current.offset)
          positionsRef.current.get(dragging.current.id)?.copy(scratch.planeHit)
          velocitiesRef.current.get(dragging.current.id)?.set(0, 0, 0)
          const now = performance.now()
          dragSamples.current.push({ p: scratch.planeHit.clone(), t: now })
          while (dragSamples.current.length > 2 && now - dragSamples.current[0].t > 140) dragSamples.current.shift()
        }
        return
      }
      // Right-button dragging is the particle brush. Ignore other held buttons,
      // while keeping a gentle force on hover for discoverability.
      const rightDragging = (e.buttons & 2) !== 0
      if (!interactionEnabled || (e.buttons !== 0 && !rightDragging)) { pointerField.current.active = false; pointerField.current.strength = 0; hoverPointer.current.lastMove = performance.now(); return }
      // Project the pointer onto the accretion-disk plane; scene coordinates match the particle streams.
      const diskPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const hit = raycaster.ray.intersectPlane(diskPlane, scratch.planeHit)
      if (hit) {
        pointerField.current.point.copy(scratch.planeHit)
        hoverPointer.current.x = pointer.x; hoverPointer.current.y = pointer.y; hoverPointer.current.inside = true; hoverPointer.current.lastMove = performance.now()
        pointerField.current.speed = Math.min(4, Math.hypot(e.movementX || 0, e.movementY || 0) / 24)
        pointerField.current.strength = Math.min(cursorForce, (rightDragging ? .98 : .14) + pointerField.current.speed * (rightDragging ? 1.15 : .3))
        pointerField.current.active = true
      } else { pointerField.current.active = false; pointerField.current.strength = 0 }
    }
    const fieldReset = () => { if (!dragging.current) { pointerField.current.active = false; pointerField.current.strength = 0; pointerField.current.speed = 0 } }
    const leave = () => { hoverPointer.current.inside = false; fieldReset() }
    const up = () => {
      if (dragging.current) {
        const id = dragging.current.id, v = velocitiesRef.current.get(id), samples = dragSamples.current
        if (v && samples.length >= 2) {
          const first = samples[0], last = samples[samples.length - 1], elapsed = Math.max(.025, (last.t - first.t) / 1000)
          v.copy(last.p).sub(first.p).multiplyScalar(1 / elapsed).multiplyScalar(.22).clampLength(0, 2.5)
        }
        dragging.current = null; dragSamples.current = []; el.style.cursor = 'grab'
      }
      fieldReset()
    }
    const cancel = () => { if (dragging.current) { dragging.current = null; dragSamples.current = []; el.style.cursor = 'grab' } fieldReset() }
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel)
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel) }
  }, [gl, camera, raycaster, pointer, scratch, scene, pointerField, interactionEnabled, cursorForce])
  useFrame((_, delta) => {
    // Keep the force attached to a stationary cursor, but decay its motion boost smoothly.
    // Orbiting the camera or dragging a body suspends the field to avoid gesture conflicts.
    if (hoverPointer.current.inside && !dragging.current && pointerField.current.active) {
      const idle = (performance.now() - hoverPointer.current.lastMove) / 1000
      pointerField.current.speed = THREE.MathUtils.damp(pointerField.current.speed, 0, 3.8, delta)
      pointerField.current.strength = THREE.MathUtils.damp(pointerField.current.strength, Math.min(cursorForce, .2), 1.7, delta)
      if (idle > 2.5) { pointerField.current.active = false; pointerField.current.strength = 0; pointerField.current.speed = 0 }
    }
    if (paused) return
    let captureCount = 0
    let removedAny = false
    const dt = Math.min(delta, .035)
    const removedIds = new Set<string>()
    objects.forEach(o => {
      const mesh = objectRefs.current.get(o.id), p = positionsRef.current.get(o.id), v = velocitiesRef.current.get(o.id)
      if (!mesh || !p || !v) return
      if (dragging.current?.id === o.id) { mesh.position.copy(p); return }
      const r2 = Math.max(p.lengthSq(), .02), r = Math.sqrt(r2)
      // Illustrative softened Newtonian gravity: a = -mu * r_vec / (r² + eps²)^(3/2).
      // It is intentionally not a general-relativistic orbit integrator near the horizon.
      const mu = 2.05, softened = r2 + .22
      v.addScaledVector(p, -mu * dt / (softened * Math.sqrt(softened)))
      v.multiplyScalar(Math.pow(.999, dt * 60))
      p.addScaledVector(v, dt)
      if (r > .3 && r < 2.75) v.addScaledVector(p, -dt * .08 / r)
      mesh.position.copy(p)
      mesh.rotation.x += dt * .8; mesh.rotation.y += dt * 1.3
      const path = pathsRef.current.get(o.id)!
      if (path.length === 0 || path[path.length - 1].distanceToSquared(p) > .012) { path.push(p.clone()); if (path.length > 160) path.shift() }
      o.age += dt
      if (p.length() < 1.13) { captureCount++; removedAny = true; removedIds.add(o.id); positionsRef.current.delete(o.id); velocitiesRef.current.delete(o.id); pathsRef.current.delete(o.id); objectRefs.current.delete(o.id); if (dragging.current?.id === o.id) { dragging.current = null; dragSamples.current = [] }; if (hoveredId.current === o.id) hoveredId.current = undefined; if (selectedId.current === o.id) { selectedId.current = undefined; onFeature(null) } }
      else if (p.length() > 24 || o.age > 240) { removedAny = true; removedIds.add(o.id); positionsRef.current.delete(o.id); velocitiesRef.current.delete(o.id); pathsRef.current.delete(o.id); objectRefs.current.delete(o.id) }
    })
    if (removedAny) setObjects(objects.filter(o => !removedIds.has(o.id)))
    if (captureCount) diskHot.current = Math.min(1.6, diskHot.current + captureCount * .32)
    telemetryClock.current += delta
    if (telemetryClock.current > .2) {
      telemetryClock.current = 0
      const selectedObject = objects.find(o => o.id === selectedId.current)
      const position = selectedObject && positionsRef.current.get(selectedObject.id)
      const velocity = selectedObject && velocitiesRef.current.get(selectedObject.id)
      if (selectedObject && position && velocity) {
        const nextPosition: [number, number, number] = [position.x, position.y, position.z]
        const nextVelocity: [number, number, number] = [velocity.x, velocity.y, velocity.z]
        if (nextPosition.some((n, i) => Math.abs(n - selectedObject.position[i]) > .015) || nextVelocity.some((n, i) => Math.abs(n - selectedObject.velocity[i]) > .025)) {
          setObjects(objects.map(o => o.id === selectedObject.id ? { ...o, position: nextPosition, velocity: nextVelocity, age: selectedObject.age } : o))
        }
      }
    }
    for (let i = 0; i < captureCount; i++) onCaptured()
  })
  const setMesh = (id: string, node: THREE.Mesh | null) => { if (node) { objectRefs.current.set(id, node); const p = positionsRef.current.get(id); if (p) node.position.copy(p) } else objectRefs.current.delete(id) }
  return <>
    {objects.map(o => <group key={o.id}>
      <mesh ref={node => setMesh(o.id, node)} position={o.position} userData={{ feature: o.kind, id: o.id }} onPointerOver={e => { e.stopPropagation(); hoveredId.current = o.id; onFeature({ name: o.kind, description: descriptions[o.kind] ?? descriptions['TEST PARTICLE'], id: o.id }); gl.domElement.style.cursor = 'pointer' }} onPointerOut={() => { if (hoveredId.current === o.id) { hoveredId.current = undefined; if (selectedId.current === o.id) onFeature({ name: o.kind, description: descriptions[o.kind] ?? descriptions['TEST PARTICLE'], id: o.id }); else if (!selectedId.current) onFeature(null) } if (!dragging.current) gl.domElement.style.cursor = 'grab' }} onClick={e => { e.stopPropagation(); selectedId.current = o.id; onFeature({ name: o.kind, description: descriptions[o.kind] ?? descriptions['TEST PARTICLE'], id: o.id }) }} onPointerDown={e => {
        if (e.button !== 0) return
        e.stopPropagation(); selectedId.current = o.id; onFeature({ name: o.kind, description: descriptions[o.kind] ?? descriptions['TEST PARTICLE'], id: o.id }); raycaster.setFromCamera(pointer, camera); scratch.normal.copy(camera.getWorldDirection(scratch.normal)); const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(scratch.normal, e.point); const p = positionsRef.current.get(o.id); if (!p) return
        dragSamples.current = [{ p: p.clone(), t: performance.now() }]; dragging.current = { id: o.id, plane, offset: p.clone().sub(e.point) }; pointerField.current.active = false; gl.domElement.style.cursor = 'grabbing'
      }}>
        {o.kind === 'ASTEROID' ? <dodecahedronGeometry args={[(.12 + o.mass * .028) * (0.82 + (stableHash(o.id) % 35) / 100), 1]} /> : o.kind === 'STAR' ? <icosahedronGeometry args={[.12, 1]} /> : <sphereGeometry args={[o.kind === 'GAS PARTICLE' ? .055 : .085, 16, 12]} />}
        <meshStandardMaterial color={o.color} emissive={o.color} emissiveIntensity={o.kind === 'ASTEROID' ? (hoveredId.current === o.id || selectedId.current === o.id ? .18 : .035) : (hoveredId.current === o.id || selectedId.current === o.id ? .62 : .38)} roughness={o.kind === 'ASTEROID' ? .88 : .62} metalness={o.kind === 'ASTEROID' ? .08 : .18} />
      </mesh>
      <OrbitPath points={pathsRef.current.get(o.id) ?? []} color={experiment ? '#66dcff' : o.color} visible={orbitPaths} />
    </group>)}
    <mesh visible={false} onPointerOver={() => { selectedId.current = undefined; onFeature({ name: 'BLACK HOLE', description: descriptions['BLACK HOLE'] }) }} onPointerOut={() => { if (!selectedId.current) onFeature(null) }}><sphereGeometry args={[1.01, 32, 24]} /><meshBasicMaterial /></mesh>
  </>
}

function CameraRig({ options, onCameraDistance, resetSignal, onFeature, pointerField }: CameraRigProps) {
  const { camera, gl, raycaster, scene, pointer } = useThree()
  const spherical = useRef(new THREE.Spherical(6.65, Math.PI / 2.45, .32))
  const targetSpherical = useRef(spherical.current.clone())
  const target = useRef(new THREE.Vector3())
  const targetGoal = useRef(new THREE.Vector3())
  const pointerState = useRef({ x: 0, y: 0, button: 0, active: false, moved: false })
  const lastReset = useRef(resetSignal.current)
  const lastDistance = useRef(6.65)
  useEffect(() => {
    const el = gl.domElement; el.style.touchAction = 'none'
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return
      // Selectable bodies handle their own left-button drag. Right-drag stirs
      // particles; Shift+LMB orbits the camera.
      if (e.button === 0) {
        const rect = el.getBoundingClientRect()
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(pointer, camera)
        const hits = raycaster.intersectObjects(scene.children, true)
        if (hits.some(hit => hit.object.userData.id && hit.object.userData.feature)) return
        if (!e.shiftKey) return
      }
      pointerState.current = { x: e.clientX, y: e.clientY, button: e.button, active: true, moved: false }
      try { el.setPointerCapture(e.pointerId) } catch { /* capture is optional */ }
      if (e.button === 2) e.preventDefault()
    }
    const move = (e: PointerEvent) => {
      const state = pointerState.current
      if (state.active && state.button === 0) {
        const dx = e.clientX - state.x, dy = e.clientY - state.y; state.x = e.clientX; state.y = e.clientY
        if (Math.abs(dx) + Math.abs(dy) > 2) state.moved = true
        targetSpherical.current.theta -= dx * .006 * options.sensitivity
        targetSpherical.current.phi = THREE.MathUtils.clamp(targetSpherical.current.phi - dy * .006 * options.sensitivity, .12, Math.PI - .12)
        if (state.moved) onFeature(null)
      }
      const rect = el.getBoundingClientRect(); pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects(scene.children, true)
      const featureHit = hits.find(hit => hit.object.userData.feature)
      if (!state.active && featureHit) { const name = featureHit.object.userData.feature as string; onFeature({ name, description: descriptions[name] ?? descriptions['TEST PARTICLE'], id: featureHit.object.userData.id }) }
      // SimulatedBodies owns the cursor field's 3D ray-to-disk-plane mapping.
    }
    const up = (e?: PointerEvent) => { if (!pointerState.current.active) return; pointerState.current.active = false; if (e && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId) }
    const wheel = (e: WheelEvent) => { e.preventDefault(); targetSpherical.current.radius = THREE.MathUtils.clamp(targetSpherical.current.radius * Math.exp(e.deltaY * .001), 2.25, 18) }
    const reset = () => { targetGoal.current.set(0, 0, 0); targetSpherical.current.set(6.65, Math.PI / 2.45, .32) }
    const double = () => reset()
    const context = (e: MouseEvent) => e.preventDefault()
    const key = (e: KeyboardEvent) => { const tag = (e.target as HTMLElement | null)?.tagName; if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return; if (e.key.toLowerCase() === 'r') reset() }
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('wheel', wheel, { passive: false }); el.addEventListener('dblclick', double); el.addEventListener('contextmenu', context); window.addEventListener('pointerup', up); window.addEventListener('keydown', key)
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('wheel', wheel); el.removeEventListener('dblclick', double); el.removeEventListener('contextmenu', context); window.removeEventListener('pointerup', up); window.removeEventListener('keydown', key) }
  }, [camera, gl, options.sensitivity, onFeature, pointer, raycaster, scene, pointerField, options.interactionEnabled, options.cursorForce])
  useEffect(() => { if (resetSignal.current !== lastReset.current) { targetGoal.current.set(0, 0, 0); targetSpherical.current.set(6.65, Math.PI / 2.45, .32); lastReset.current = resetSignal.current } }, [resetSignal])
  useFrame((_, delta) => {
    const t = targetSpherical.current, s = spherical.current
    s.radius = THREE.MathUtils.damp(s.radius, t.radius, 5.8, delta); s.theta = THREE.MathUtils.damp(s.theta, t.theta, 7, delta); s.phi = THREE.MathUtils.damp(s.phi, t.phi, 7, delta)
    target.current.lerp(targetGoal.current, 1 - Math.pow(.0008, delta)); camera.position.setFromSpherical(s).add(target.current); camera.lookAt(target.current)
    if (Math.abs(lastDistance.current - s.radius) > .025) { lastDistance.current = s.radius; onCameraDistance(s.radius) }
  })
  return null
}

const BlackHoleScene = forwardRef<SceneHandle, Props>(function BlackHoleScene({ options, objects, paused, experiment, onObjectsChange, onCaptured, onHover, onCameraDistance }, forwardedRef) {
  const resetSignal = useRef(0)
  const pointerField = useRef({ point: new THREE.Vector3(0, 0, 0), strength: 0, speed: 0, active: false })
  const diskHot = useRef(0)
  const simulationTime = useRef(0)
  const objectRef = useRef(objects)
  objectRef.current = objects
  useImperativeHandle(forwardedRef, () => ({ resetCamera: () => { resetSignal.current += 1 }, resetSimulation: () => { diskHot.current = 0; simulationTime.current = 0 } }), [])
  const stableSetObjects = (next: SimObject[]) => { objectRef.current = next; onObjectsChange(next) }
  return <div className="black-hole-canvas" aria-label="Interactive 3D black hole simulation">
    <Canvas camera={{ position: [1.6, 2.0, 6.3], fov: 48 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }} onPointerMissed={() => onHover(null)}>
      <color attach="background" args={['#020307']} /><fog attach="fog" args={['#020307', 12, 36]} />
      <ambientLight intensity={.25} /><pointLight position={[4, 2, 3]} intensity={3.1} color="#517dff" /><pointLight position={[-4, -1.5, 2]} intensity={2.2} color="#fd784b" />
      {options.stars && <><Stars radius={110} depth={75} count={Math.round(2500 * options.density)} factor={3.2} saturation={.22} fade speed={paused ? 0 : .12} /><Stars radius={42} depth={18} count={Math.round(600 * options.density)} factor={1.8} saturation={.1} fade speed={paused ? 0 : .035} /></>}
      <BlackHole options={options} paused={paused} diskHot={diskHot} simulationTime={simulationTime} pointerField={pointerField} />
      {options.particles && <Sparkles count={Math.round(120 * options.density)} scale={[8.5, 6.2, 8.5]} size={1.5} speed={paused ? 0 : .14} color="#adcaff" opacity={.34} />}
      <SimulatedBodies objects={objects} setObjects={stableSetObjects} paused={paused} onCaptured={onCaptured} onFeature={onHover} orbitPaths={options.orbitPaths} experiment={experiment} pointerField={pointerField} interactionEnabled={options.interactionEnabled} cursorForce={options.cursorForce} diskHot={diskHot} />
      <CameraRig options={options} onCameraDistance={onCameraDistance} resetSignal={resetSignal} onFeature={onHover} pointerField={pointerField} />
    </Canvas>
  </div>
})

export default BlackHoleScene

