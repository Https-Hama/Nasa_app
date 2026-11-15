import * as THREE from 'three';
import { OrbitSimulation } from './simulation.js';

const TAU = Math.PI * 2;
const COLORS = { cyan: 0x73e4ef, orange: 0xff8d4b, cream: 0xf7ecd9, navy: 0x050d1b };
const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.25, ...extra });
const glowMaterial = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, toneMapped: false });

/** Procedural orbital world. Mission rules live in OrbitSimulation. */
export class OrbitGame {
  constructor({ canvas, onState = () => {}, onEvent = () => {} }) {
    if (!canvas) throw new TypeError('OrbitGame needs a canvas');
    this.canvas = canvas;
    this.onState = onState;
    this.onEvent = onEvent;
    this.simulation = new OrbitSimulation({ onEvent: event => this.onEvent(event) });
    this.visualTime = 0;
    this.lastTime = 0;
    this.publishIn = 0;
    this.destroyed = false;
    this.entityMeshes = new Map();
    this.combatMeshes = new Map();
    this.memoryFlash = { direction: '', time: 0 };
    this.width = 1;
    this.height = 1;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.75));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;
      this.makeWorld();
    } catch (error) {
      this.renderer?.dispose();
      this.renderer = null;
      try { this.fallback = canvas.getContext('2d'); } catch { this.fallback = null; }
      queueMicrotask(() => this.onEvent({ type: 'toast', message: 'WebGL unavailable · reduced graphics mode is active' }));
    }
    this.resize = this.resize.bind(this);
    if (globalThis.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(canvas);
    } else globalThis.addEventListener?.('resize', this.resize);
    this.resize();
    this.frame = this.frame.bind(this);
    this.frameId = requestAnimationFrame(this.frame);
  }

  makeWorld() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.navy);
    this.scene.fog = new THREE.FogExp2(0x081525, 0.0032);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1000);
    this.camera.position.set(0, 4, 19);
    this.camera.lookAt(0, 0, -25);
    this.scene.add(new THREE.HemisphereLight(0xb7d7ef, 0x15213b, 2.0));
    const sun = new THREE.DirectionalLight(0xffe0b5, 3.1);
    sun.position.set(-9, 12, 14);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x62d8ff, 2.8);
    rim.position.set(8, 4, -14);
    this.scene.add(rim);

    this.makeSky();
    this.makeEarth();
    this.makeLanes();
    this.shipGroup = this.makeShip();
    this.scene.add(this.shipGroup);
    this.makeRocks();
    this.combatGroup = new THREE.Group();
    this.scene.add(this.combatGroup);
    this.makeStation();
    this.makeMemory();
    this.makeParticles();
    this.setMissionVisibility();
  }

  makeSky() {
    // A fixed seed gives the landing scene a stable composition on every visit.
    let seed = 31;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const positions = [], colors = [];
    for (let i = 0; i < 1550; i += 1) {
      positions.push((random() - 0.5) * 650, (random() - 0.5) * 340, -50 - random() * 480);
      const brightness = 0.25 + random() * 0.6;
      colors.push(brightness * 0.85, brightness * 0.94, brightness);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.stars = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.6, vertexColors: true, transparent: true, opacity: 0.85, sizeAttenuation: true, depthWrite: false, fog: false }));
    this.scene.add(this.stars);

    const haze = new THREE.Mesh(new THREE.PlaneGeometry(800, 450), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec2 vUv; void main(){ vec2 p=vUv; float a=exp(-length((p-vec2(.7,.6))*vec2(2.5,4.0))*3.0); float b=exp(-length((p-vec2(.2,.3))*vec2(3.0,3.0))*3.0); gl_FragColor=vec4(vec3(.025,.09,.16)*a+vec3(.09,.035,.025)*b,.6); }',
    }));
    haze.position.z = -510;
    this.scene.add(haze);
    const sunGlow = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying vec2 vUv; void main(){float d=length(vUv-.5);float a=exp(-d*12.0)*.3;gl_FragColor=vec4(.6,.72,.8,a);}',
    }));
    sunGlow.position.set(115, 70, -300);
    this.scene.add(sunGlow);
  }

  makeEarth() {
    this.earth = new THREE.Group();
    this.earth.position.set(40, -72, -160);
    const earthMaterial = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec3 vNormal; varying vec3 vPosition; void main(){vNormal=normalize(normalMatrix*normal);vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `
        varying vec3 vNormal; varying vec3 vPosition; uniform float time;
        float terrain(vec3 p){return sin(p.x*.14+sin(p.z*.12)*2.0)+sin(p.y*.17+p.z*.08)*.6+sin(p.z*.2+p.x*.09)*.4;}
        void main(){
          vec3 n=normalize(vNormal); vec3 p=vPosition; p.x+=time*.12;
          float land=smoothstep(.25,.65,terrain(p));
          vec3 ocean=mix(vec3(.018,.08,.16),vec3(.035,.22,.31),max(0.0,n.z));
          vec3 ground=mix(vec3(.1,.17,.16),vec3(.22,.27,.21),terrain(p*2.0)*.2+.5);
          vec3 col=mix(ocean,ground,land);
          float cloud=smoothstep(1.0,1.65,terrain(p*1.7+vec3(8.0,3.0,time*.08)));
          col=mix(col,vec3(.62,.73,.78),cloud*.62);
          float light=clamp(dot(n,normalize(vec3(-.55,.8,1.0))),.09,1.0);
          float rim=pow(1.0-max(0.0,n.z),3.0);
          col=col*light+vec3(.04,.27,.51)*rim;
          gl_FragColor=vec4(col,1.0);
        }`,
    });
    this.earthSurface = new THREE.Mesh(new THREE.SphereGeometry(76, 64, 40), earthMaterial);
    this.earthSurface.rotation.z = -0.35;
    this.earth.add(this.earthSurface);
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(77, 56, 32), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      vertexShader: 'varying vec3 vNormal;varying vec3 vEye;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vEye=normalize(-p.xyz);vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*p;}',
      fragmentShader: 'varying vec3 vNormal;varying vec3 vEye;void main(){float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(vEye))),5.0);gl_FragColor=vec4(.13,.48,.95,rim*.72);}',
    }));
    this.earth.add(atmosphere);
    this.scene.add(this.earth);
  }

  makeLanes() {
    this.laneGroup = new THREE.Group();
    this.laneGroup.position.y = -1.4;
    this.laneGroup.scale.set(0.72, 0.65, 1);
    this.lanes = [];
    const geometry = new THREE.TorusGeometry(6.6, 0.017, 4, 72);
    const ringMaterial = glowMaterial(0x63bed1, 0.17);
    for (let i = 0; i < 9; i += 1) {
      const ring = new THREE.Mesh(geometry, ringMaterial);
      ring.position.z = -10 - i * 22;
      ring.scale.y = 0.7;
      this.lanes.push(ring);
      this.laneGroup.add(ring);
    }
    this.scene.add(this.laneGroup);
    const points = [];
    for (const x of [-5.2, 5.2]) {
      points.push(new THREE.Vector3(x, -3.4, -200), new THREE.Vector3(x, -3.4, 7));
      points.push(new THREE.Vector3(x, 3.4, -200), new THREE.Vector3(x, 3.4, 7));
    }
    this.laneGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x417c95, transparent: true, opacity: 0.1 })));
  }

  makeShip() {
    const group = new THREE.Group();
    const white = material(0xe5e4dc, { metalness: 0.5, roughness: 0.4 });
    const orange = material(0xec783c, { metalness: 0.3, roughness: 0.5 });
    const dark = material(0x172636, { metalness: 0.75, roughness: 0.36 });
    const glass = material(0x76cddd, { metalness: 0.8, roughness: 0.14, emissive: 0x173e50, emissiveIntensity: 0.3 });
    const add = (geometry, mat, position, rotation, scale) => {
      const mesh = new THREE.Mesh(geometry, mat);
      if (position) mesh.position.set(...position);
      if (rotation) mesh.rotation.set(...rotation);
      if (scale) mesh.scale.set(...scale);
      group.add(mesh);
      return mesh;
    };
    add(new THREE.SphereGeometry(1, 16, 10), orange, [0, 0, -0.2], null, [0.64, 0.42, 2.1]);
    add(new THREE.ConeGeometry(0.48, 1.35, 8), white, [0, -0.01, -2.05], [-Math.PI / 2, 0, 0]);
    add(new THREE.BoxGeometry(0.22, 0.04, 2.6), white, [0, 0.4, 0.25]);
    add(new THREE.SphereGeometry(1, 16, 10), dark, [0, 0.38, -0.8], null, [0.45, 0.22, 0.88]);
    add(new THREE.SphereGeometry(1, 16, 10), glass, [0, 0.43, -0.88], null, [0.35, 0.18, 0.72]);
    add(new THREE.BoxGeometry(0.06, 0.03, 1.4), white, [0, 0.61, -0.85]);
    add(new THREE.BoxGeometry(0.75, 0.07, 0.1), orange, [0, 0.58, -0.55]);
    this.flames = [];
    for (const side of [-1, 1]) {
      const vertices = new Float32Array([
        side * 0.4, -0.1, -0.8, side * 1.0, -0.1, -0.55, side * 2.65, -0.14, 1.65,
        side * 0.4, -0.1, -0.8, side * 2.65, -0.14, 1.65, side * 0.5, -0.1, 1.1,
      ]);
      const wingGeometry = new THREE.BufferGeometry();
      wingGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      wingGeometry.computeVertexNormals();
      add(wingGeometry, material(0xd5dbd7, { side: THREE.DoubleSide, metalness: 0.6 }));
      add(new THREE.BoxGeometry(0.14, 0.13, 1.22), orange, [side * 1.65, -0.04, 0.85], [0, side * 0.67, 0]);
      add(new THREE.BoxGeometry(0.16, 0.12, 0.55), dark, [side * 2.3, -0.03, 1.37], [0, side * 0.67, 0]);
      add(new THREE.CylinderGeometry(0.3, 0.36, 1.9, 12), white, [side * 0.88, -0.16, 0.8], [Math.PI / 2, 0, 0]);
      add(new THREE.CylinderGeometry(0.32, 0.32, 0.3, 12), orange, [side * 0.88, -0.16, 1.2], [Math.PI / 2, 0, 0]);
      add(new THREE.CylinderGeometry(0.28, 0.31, 0.35, 12), dark, [side * 0.88, -0.16, 1.83], [Math.PI / 2, 0, 0]);
      add(new THREE.TorusGeometry(0.24, 0.045, 6, 16), glowMaterial(0x75f4ff), [side * 0.88, -0.16, 2.02]);
      const flameGroup = new THREE.Group();
      flameGroup.position.set(side * 0.88, -0.16, 2.0);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.5, 12), new THREE.MeshBasicMaterial({ color: 0x62edff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.rotation.x = Math.PI / 2;
      flame.position.z = 0.72;
      flameGroup.add(flame);
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.34, 2.3, 12), new THREE.MeshBasicMaterial({ color: 0x1a89ff, transparent: true, opacity: 0.23, blending: THREE.AdditiveBlending, depthWrite: false }));
      outer.rotation.x = Math.PI / 2;
      outer.position.z = 1.1;
      flameGroup.add(outer);
      group.add(flameGroup);
      this.flames.push(flameGroup);
      add(new THREE.BoxGeometry(0.07, 0.035, 0.13), glowMaterial(side === -1 ? 0xff754e : 0x86f5d6), [side * 2.48, 0.02, 1.48]);
    }
    add(new THREE.BoxGeometry(0.08, 0.95, 0.85), orange, [0, 0.66, 1.24], [0.18, 0, 0]);
    add(new THREE.BoxGeometry(0.1, 0.22, 0.6), white, [0, 1.03, 1.25]);
    add(new THREE.BoxGeometry(0.28, 0.035, 0.24), dark, [0, 0.44, 0.2]);
    add(new THREE.BoxGeometry(0.035, 0.04, 0.12), glowMaterial(COLORS.cyan), [0, 0.47, 0.2]);

    this.shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(2.5, 32, 20), new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vNormal;varying vec3 vEye;varying vec3 vPos;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vEye=normalize(-p.xyz);vNormal=normalize(normalMatrix*normal);vPos=position;gl_Position=projectionMatrix*p;}',
      fragmentShader: 'varying vec3 vNormal;varying vec3 vEye;varying vec3 vPos;uniform float time;void main(){float edge=pow(1.0-abs(dot(normalize(vNormal),normalize(vEye))),2.6);float grid=pow(abs(sin(vPos.y*10.0+time)*sin(vPos.x*10.0)),20.0);gl_FragColor=vec4(.18,.8,1.0,edge*.38+grid*.035);}',
    }));
    this.shieldMesh.scale.set(1.15, 0.62, 1.5);
    this.shieldMesh.visible = false;
    group.add(this.shieldMesh);
    this.boostAura = new THREE.Mesh(new THREE.TorusGeometry(1.05, .06, 8, 36), glowMaterial(COLORS.cyan, .65));
    this.boostAura.position.z = 2.1;
    this.boostAura.scale.set(1.4, .65, 1);
    this.boostAura.visible = false;
    group.add(this.boostAura);
    return group;
  }

  makeRocks() {
    this.rockGeometries = [];
    for (let variant = 0; variant < 5; variant += 1) {
      const geometry = new THREE.IcosahedronGeometry(1, 1);
      const positions = geometry.getAttribute('position');
      const colors = [];
      for (let i = 0; i < positions.count; i += 1) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const noise = Math.sin(x * 7.2 + variant * 2.1) * Math.cos(y * 8.5 + z * 6.4) * 0.15;
        positions.setXYZ(i, x * (1 + noise), y * (0.85 + noise), z * (1.12 + noise));
        const color = new THREE.Color().setHSL(0.07 + variant * 0.012, 0.12, 0.19 + (noise + 0.15) * 0.45);
        colors.push(color.r, color.g, color.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      this.rockGeometries.push(geometry);
    }
    this.rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0.06 });
    this.rocksGroup = new THREE.Group();
    this.scene.add(this.rocksGroup);
    this.sceneryRocks = [];
    for (let i = 0; i < 20; i += 1) {
      const rock = new THREE.Mesh(this.rockGeometries[i % 5], this.rockMaterial);
      rock.position.set((i % 2 ? 1 : -1) * (9 + (i * 3.3) % 15), (Math.sin(i * 2.3) * 7) + 1, -8 - i * 12);
      const size = 1.15 + (i * 0.67) % 2.6;
      rock.scale.setScalar(size);
      rock.rotation.set(i, i * 2.1, i * 1.7);
      this.sceneryRocks.push(rock);
      this.scene.add(rock);
    }
  }

  makeStation() {
    this.station = new THREE.Group();
    this.station.position.set(0, 0, -62);
    const silver = material(0x9baeb7, { metalness: 0.72, roughness: 0.45 });
    const dark = material(0x253a4a, { metalness: 0.55 });
    const orange = material(0xdc7b3d, { emissive: 0x4c210e, emissiveIntensity: 0.3 });
    const add = (geometry, mat, x, y, z, rotation = 0) => {
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.z = rotation;
      this.station.add(mesh);
      return mesh;
    };
    add(new THREE.TorusGeometry(7, 0.5, 10, 64), silver, 0, 0, 0);
    add(new THREE.TorusGeometry(7.5, 0.09, 5, 64), glowMaterial(COLORS.cyan, 0.8), 0, 0, 0);
    add(new THREE.TorusGeometry(2.8, 0.35, 10, 48), silver, 0, 0, 1);
    add(new THREE.TorusGeometry(2.8, 0.12, 6, 48), glowMaterial(COLORS.orange), 0, 0, 1.4);
    add(new THREE.TorusGeometry(2.5, 0.22, 8, 48), dark, 0, 0, -3);
    add(new THREE.TorusGeometry(2.2, 0.13, 8, 48), glowMaterial(COLORS.cyan, 0.5), 0, 0, -7);
    for (let i = 0; i < 8; i += 1) {
      const angle = i * TAU / 8;
      const x = Math.cos(angle), y = Math.sin(angle);
      add(new THREE.BoxGeometry(4.0, 0.3, 0.4), silver, x * 4.8, y * 4.8, 0, angle);
      add(new THREE.BoxGeometry(1.3, 0.8, 1.25), i % 2 ? orange : dark, x * 7, y * 7, 0, angle);
      add(new THREE.BoxGeometry(0.5, 0.09, 0.1), glowMaterial(COLORS.cream), x * 7, y * 7, 0.67, angle);
    }
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(11, 0.25, 0.35), silver, side * 10.7, 0, -0.7);
      for (const y of [-2.2, 2.2]) {
        add(new THREE.BoxGeometry(9, 3.8, 0.13), material(0x123d64, { metalness: 0.65, roughness: 0.3, emissive: 0x08243e, emissiveIntensity: 0.4 }), side * 13.2, y, -0.7);
        for (let cell = 0; cell < 8; cell += 1) add(new THREE.BoxGeometry(0.025, 3.8, 0.03), silver, side * 13.2 - 3.9 + cell * 1.1, y, -0.6);
        for (let row = 0; row < 3; row += 1) add(new THREE.BoxGeometry(9, 0.025, 0.03), silver, side * 13.2, y - 1.3 + row * 1.3, -0.6);
      }
    }
    this.scene.add(this.station);
    this.dockGuide = new THREE.Group();
    this.dockRingMaterial = glowMaterial(COLORS.cyan, 0.8);
    this.dockGuide.add(new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.035, 6, 64), this.dockRingMaterial));
    this.dockGuide.add(new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.025, 4, 48), glowMaterial(COLORS.cyan, 0.8)));
    const corners = [];
    for (let i = 0; i < 4; i += 1) {
      const angle = i * Math.PI / 2 + Math.PI / 4;
      const x = Math.cos(angle) * 2.7, y = Math.sin(angle) * 2.7;
      corners.push(new THREE.Vector3(x, y - Math.sign(y) * 0.5, 0), new THREE.Vector3(x, y, 0), new THREE.Vector3(x, y, 0), new THREE.Vector3(x - Math.sign(x) * 0.5, y, 0));
    }
    this.dockGuide.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.85 })));
    this.dockGuide.position.z = -20;
    this.scene.add(this.dockGuide);
    this.dockCursor = new THREE.Group();
    const cursorPoints = [
      new THREE.Vector3(-0.5, 0, 0), new THREE.Vector3(-0.17, 0, 0),
      new THREE.Vector3(0.17, 0, 0), new THREE.Vector3(0.5, 0, 0),
      new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, -0.17, 0),
      new THREE.Vector3(0, 0.17, 0), new THREE.Vector3(0, 0.5, 0),
    ];
    this.dockCursor.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cursorPoints), new THREE.LineBasicMaterial({ color: COLORS.orange, depthTest: false, toneMapped: false })));
    this.dockCursor.add(new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 5, 24), glowMaterial(COLORS.orange)));
    this.dockCursor.position.z = -19.8;
    this.scene.add(this.dockCursor);
    this.trainingRing = new THREE.Mesh(new THREE.TorusGeometry(5.3, 0.055, 6, 72), glowMaterial(COLORS.orange, 0.7));
    this.trainingRing.position.set(0, 0.3, -14);
    this.scene.add(this.trainingRing);
  }

  makeMemory() {
    this.memoryGroup = new THREE.Group();
    this.memoryGroup.position.set(0, 0.6, -16);
    const configurations = [
      ['left', -4.8, 0.2, Math.PI / 2, 0x67dfe8],
      ['up', 0, 3.5, 0, 0xff9b55],
      ['right', 4.8, 0.2, -Math.PI / 2, 0xf6d879],
      ['down', 0, -3.1, Math.PI, 0xb9a5f2],
    ];
    this.memoryPads = [];
    for (const [direction, x, y, rotation, color] of configurations) {
      const group = new THREE.Group();
      group.position.set(x, y, 0);
      const ringMat = glowMaterial(color, 0.3);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.045, 6, 48), ringMat);
      group.add(ring);
      const background = new THREE.Mesh(new THREE.CircleGeometry(1.1, 32), glowMaterial(0x0d2336, 0.78));
      background.position.z = -0.01;
      group.add(background);
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.65); shape.lineTo(0.6, 0.05); shape.lineTo(0.2, 0.05);
      shape.lineTo(0.2, -0.55); shape.lineTo(-0.2, -0.55); shape.lineTo(-0.2, 0.05);
      shape.lineTo(-0.6, 0.05); shape.closePath();
      const arrowMat = glowMaterial(color, 0.45);
      const arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), arrowMat);
      arrow.rotation.z = rotation;
      arrow.position.z = 0.025;
      group.add(arrow);
      this.memoryPads.push({ group, ringMat, arrowMat, direction });
      this.memoryGroup.add(group);
    }
    this.memoryCore = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), material(0x285365, { emissive: 0x235a71, emissiveIntensity: 0.8, wireframe: true }));
    this.memoryCore.add(core);
    for (let i = 0; i < 2; i += 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2 + i * 0.25, 0.022, 4, 48), glowMaterial(COLORS.cyan, 0.4));
      ring.rotation.x = i ? 0.8 : -0.8;
      ring.rotation.y = i ? -0.5 : 0.5;
      this.memoryCore.add(ring);
    }
    this.memoryGroup.add(this.memoryCore);
    this.scene.add(this.memoryGroup);
  }

  makeParticles() {
    const positions = [];
    for (let i = 0; i < 140; i += 1) positions.push(Math.sin(i * 9.31) * 25, Math.cos(i * 13.6) * 15, -5 - (i * 1.79) % 180);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.dust = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x90d9e3, size: 0.055, transparent: true, opacity: 0.45, depthWrite: false }));
    this.scene.add(this.dust);
  }

  createEntityMesh(entity) {
    if (entity.type === 'asteroid') {
      const mesh = new THREE.Mesh(this.rockGeometries[entity.id % 5], this.rockMaterial);
      mesh.scale.setScalar(entity.radius);
      return mesh;
    }
    const group = new THREE.Group();
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), material(0x7ce7ed, { emissive: 0x49c1d0, emissiveIntensity: 1.4, metalness: 0.45 }));
    group.add(crystal);
    group.add(new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.04, 6, 24), glowMaterial(COLORS.cyan, 0.75)));
    return group;
  }

  createCombatMesh(entity, kind) {
    const group = new THREE.Group();
    if (kind === 'enemy') {
      const armor = material(0x273447, { metalness: .8, roughness: .3 });
      const glow = glowMaterial(0xff674a);
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(.65, 0), armor);
      core.scale.set(1, .65, 1.3);
      group.add(core);
      const reactor = new THREE.Mesh(new THREE.TorusGeometry(.37, .08, 6, 20), glow);
      reactor.position.z = .65;
      group.add(reactor);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.19, 10, 8), glowMaterial(COLORS.orange));
      eye.position.z = .7;
      group.add(eye);
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(.95, .16, .75), armor);
        wing.position.set(side * .9, 0, 0);
        wing.rotation.z = side * .2;
        group.add(wing);
        const engine = new THREE.Mesh(new THREE.CylinderGeometry(.27, .33, .6, 8), material(0x974837, { emissive: 0x7c1f0e, emissiveIntensity: .5 }));
        engine.rotation.x = Math.PI / 2;
        engine.position.set(side * 1.25, 0, .05);
        group.add(engine);
        const light = new THREE.Mesh(new THREE.BoxGeometry(.6, .04, .09), glow);
        light.position.set(side * .85, .14, .4);
        group.add(light);
      }
      const health = new THREE.Mesh(new THREE.PlaneGeometry(1.3, .07), glowMaterial(0xffa16e));
      health.position.set(0, .7, .45);
      group.add(health);
      group.userData.health = health;
    } else if (kind === 'projectile') {
      const player = entity.owner === 'player';
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, player ? 2.7 : 1.7, 5), glowMaterial(player ? COLORS.cyan : 0xff6247));
      group.add(bolt);
      const halo = new THREE.Mesh(new THREE.CylinderGeometry(.14, .14, player ? 2.5 : 1.5, 5), new THREE.MeshBasicMaterial({ color: player ? COLORS.cyan : 0xff6847, transparent: true, opacity: .23, blending: THREE.AdditiveBlending, depthWrite: false }));
      group.add(halo);
      const direction = new THREE.Vector3(entity.vx * .72, entity.vy * .65, entity.vz).normalize();
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    } else {
      const color = entity.color === 'cyan' ? COLORS.cyan : COLORS.orange;
      for (let i = 0; i < 12; i += 1) {
        const spark = new THREE.Mesh(new THREE.OctahedronGeometry(.09, 0), glowMaterial(color, .9));
        const direction = new THREE.Vector3(Math.sin(i * 2.4), Math.cos(i * 2.4), Math.sin(i * 5.7) * .6).normalize();
        spark.userData.direction = direction;
        group.add(spark);
      }
      const flash = new THREE.Mesh(new THREE.SphereGeometry(.35, 10, 8), glowMaterial(color, .6));
      flash.userData.flash = true;
      group.add(flash);
    }
    return group;
  }

  removeCombatMesh(key, mesh) {
    this.combatGroup.remove(mesh);
    const geometries = new Set(), materials = new Set();
    mesh.traverse(child => {
      if (child.geometry) geometries.add(child.geometry);
      if (child.material) (Array.isArray(child.material) ? child.material : [child.material]).forEach(mat => materials.add(mat));
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(mat => mat.dispose());
    this.combatMeshes.delete(key);
  }

  renderCombat() {
    const sim = this.simulation;
    const ids = new Set();
    for (const [kind, entities] of [['enemy', sim.enemies], ['projectile', sim.projectiles], ['effect', sim.effects]]) {
      for (const entity of entities) {
        const key = `${kind}-${entity.id}`;
        ids.add(key);
        let mesh = this.combatMeshes.get(key);
        if (!mesh) {
          mesh = this.createCombatMesh(entity, kind);
          this.combatMeshes.set(key, mesh);
          this.combatGroup.add(mesh);
        }
        mesh.position.set(entity.x * .72, entity.y * .65 - 1.4, entity.z);
        if (kind === 'enemy') {
          mesh.scale.set(.72, .65, 1);
          mesh.rotation.z = Math.sin(entity.age * 1.3 + entity.id) * .12;
          mesh.userData.health.scale.x = Math.max(0, entity.health / entity.maxHealth);
        } else if (kind === 'effect') {
          const progress = 1 - entity.life / entity.duration;
          for (const spark of mesh.children) {
            spark.material.opacity = (1 - progress) * .9;
            if (spark.userData.flash) spark.scale.setScalar(1 + progress * entity.size * 3);
            else {
              spark.position.copy(spark.userData.direction).multiplyScalar(progress * entity.size * 2.4);
              spark.rotation.set(progress * 5, progress * 7, progress * 3);
            }
          }
        }
      }
    }
    for (const [key, mesh] of this.combatMeshes) if (!ids.has(key)) this.removeCombatMesh(key, mesh);
  }

  setMissionVisibility() {
    if (!this.renderer) return;
    const mission = this.simulation.state.mission;
    this.rocksGroup.visible = mission === 'asteroids';
    this.combatGroup.visible = mission === 'asteroids';
    this.sceneryRocks.forEach(rock => { rock.visible = mission === 'asteroids'; });
    this.station.visible = mission === 'docking' || mission === 'exercise';
    this.dockGuide.visible = mission === 'docking';
    this.dockCursor.visible = mission === 'docking';
    this.trainingRing.visible = mission === 'exercise';
    this.memoryGroup.visible = mission === 'memory';
    this.laneGroup.visible = mission !== 'memory';
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width || this.canvas.clientWidth || 800);
    this.height = Math.max(1, rect.height || this.canvas.clientHeight || 500);
    if (this.renderer) {
      this.renderer.setSize(this.width, this.height, false);
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
    } else {
      const ratio = Math.min(globalThis.devicePixelRatio || 1, 1.5);
      this.canvas.width = Math.round(this.width * ratio);
      this.canvas.height = Math.round(this.height * ratio);
      this.fallback?.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
  }

  frame(time) {
    if (this.destroyed) return;
    const dt = this.lastTime ? Math.min(0.06, Math.max(0, (time - this.lastTime) / 1000)) : 0;
    this.lastTime = time;
    const wasRunning = this.simulation.state.status === 'running';
    this.simulation.tick(dt);
    const paused = this.simulation.state.status === 'paused';
    if (!paused) this.visualTime += dt;
    const worldDt = paused ? 0 : dt;
    if (!this.scenePaused) {
      if (this.renderer) {
        this.renderWorld(worldDt, wasRunning);
        this.renderer.render(this.scene, this.camera);
      } else this.renderFallback();
    }
    this.publishIn -= dt;
    if (this.publishIn <= 0) {
      this.onState(this.simulation.snapshot());
      this.publishIn = 0.08;
    }
    this.frameId = requestAnimationFrame(this.frame);
  }

  renderWorld(dt, running) {
    const sim = this.simulation;
    const state = sim.state;
    const t = this.visualTime;
    this.earthSurface.material.uniforms.time.value = t;
    this.earthSurface.rotation.y = t * 0.0015;
    this.stars.rotation.z = Math.sin(t * 0.007) * 0.008;
    const targetX = sim.ship.x * 0.72;
    const targetY = sim.flightPosition().y * 0.65 - 1.4;
    this.shipGroup.position.set(targetX, targetY + (!running && state.status !== 'paused' ? Math.sin(t * 1.4) * 0.055 : 0), 4);
    this.shipGroup.scale.y = state.duckRemaining > 0 ? .65 : 1;
    const bank = -sim.input.x * 0.28 + (state.status === 'ready' ? Math.sin(t * 0.5) * 0.035 : 0);
    this.shipGroup.rotation.z += (bank - this.shipGroup.rotation.z) * Math.min(1, dt * 7);
    this.shipGroup.rotation.x += ((sim.input.y * 0.1 + 0.045) - this.shipGroup.rotation.x) * Math.min(1, dt * 6);
    this.shipGroup.rotation.y += ((-sim.input.x * 0.08) - this.shipGroup.rotation.y) * Math.min(1, dt * 6);
    this.flames.forEach((flame, index) => { flame.scale.z = 0.84 + Math.sin(t * 38 + index) * 0.12 + (state.boostRemaining > 0 ? 1.8 : running ? 0.3 : 0); });
    this.boostAura.visible = state.boostRemaining > 0;
    this.boostAura.rotation.z = t * 5;
    this.boostAura.material.opacity = .3 + Math.sin(t * 18) * .12;
    this.shieldMesh.visible = state.stats.shieldActive;
    this.shieldMesh.material.uniforms.time.value = t * 2;
    this.camera.position.x += (sim.ship.x * 0.07 - this.camera.position.x) * Math.min(1, dt * 2);
    this.camera.position.y = 4 + sim.ship.y * 0.045;
    this.camera.lookAt(sim.ship.x * 0.02, 0, -25);

    const speed = running && state.mission === 'asteroids' ? (19 + sim.elapsed * 0.055) * (state.boostRemaining > 0 ? 1.7 : 1) : 2.6;
    for (const ring of this.lanes) {
      ring.position.z += speed * dt;
      if (ring.position.z > 11) ring.position.z -= 198;
    }
    const particles = this.dust.geometry.getAttribute('position');
    for (let i = 0; i < particles.count; i += 1) {
      let z = particles.getZ(i) + dt * speed * 1.4;
      if (z > 14) z -= 190;
      particles.setZ(i, z);
    }
    particles.needsUpdate = dt > 0;
    this.sceneryRocks.forEach((rock, index) => {
      rock.position.z += speed * dt * 0.7;
      rock.rotation.y += dt * (index % 2 ? 0.04 : -0.03);
      if (rock.position.z > 25) rock.position.z -= 265;
    });

    const ids = new Set();
    for (const entity of sim.entities) {
      ids.add(entity.id);
      let mesh = this.entityMeshes.get(entity.id);
      if (!mesh) {
        mesh = this.createEntityMesh(entity);
        this.entityMeshes.set(entity.id, mesh);
        this.rocksGroup.add(mesh);
      }
      // In the ready scene, drift the preview rocks through the same lane.
      const z = state.status === 'ready' ? ((entity.z + t * 2.6 + 250) % 260) - 240 : entity.z;
      mesh.position.set(entity.x * 0.72, entity.y * 0.65 - 1.4, z);
      mesh.rotation.set(entity.rotation * 0.55, entity.rotation, entity.rotation * 0.3);
      if (entity.type === 'asteroid') mesh.scale.set(entity.radius * 0.72, entity.radius * 0.65, entity.radius);
      else mesh.scale.set(0.72, 0.65, 1);
      if (entity.type === 'pickup') mesh.rotation.y = t * 1.4 + entity.id;
    }
    for (const [id, mesh] of this.entityMeshes) {
      if (!ids.has(id)) {
        this.rocksGroup.remove(mesh);
        if (mesh.isGroup) mesh.traverse(child => { if (child.isMesh) { child.geometry.dispose(); child.material.dispose(); } });
        this.entityMeshes.delete(id);
      }
    }
    this.renderCombat();
    this.station.position.z = state.mission === 'docking' ? -64 + state.progress * 25 : -82;
    this.station.rotation.z = Math.sin(t * 0.1) * 0.05;
    this.dockGuide.position.x = sim.dockTarget.x * 1.5;
    this.dockGuide.position.y = sim.dockTarget.y * 1.3;
    this.dockCursor.position.x = sim.ship.x * 1.5;
    this.dockCursor.position.y = sim.ship.y * 1.3;
    this.dockGuide.rotation.z = -t * 0.045;
    this.dockRingMaterial.color.setHex(state.dockPrecision >= 85 ? 0xb3efbd : COLORS.cyan);
    this.trainingRing.rotation.z = t * 0.1;
    this.trainingRing.scale.setScalar(1 + sim.repPulse * 0.18);
    this.trainingRing.material.opacity = 0.35 + sim.repPulse * 0.6;

    this.memoryFlash.time = Math.max(0, this.memoryFlash.time - dt);
    const snapshot = sim.snapshot();
    const shown = snapshot.showIndex >= 0 ? state.sequence[snapshot.showIndex] : '';
    for (const pad of this.memoryPads) {
      const active = state.sequencePhase === 'showing' ? pad.direction === shown : this.memoryFlash.time > 0 && pad.direction === this.memoryFlash.direction;
      pad.arrowMat.opacity = active ? 1 : 0.32;
      pad.ringMat.opacity = active ? 1 : 0.2;
      pad.group.scale.setScalar(active ? 1.08 : 1);
    }
    this.memoryCore.rotation.y = t * 0.2;
    this.memoryCore.rotation.z = t * 0.08;
  }

  renderFallback() {
    const ctx = this.fallback;
    if (!ctx) return;
    const width = this.width, height = this.height, t = this.visualTime;
    const sim = this.simulation, state = sim.snapshot();
    ctx.fillStyle = '#071020';
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 130; i += 1) {
      ctx.globalAlpha = 0.25 + (i % 5) * 0.13;
      ctx.fillStyle = '#c2deed';
      ctx.fillRect(((Math.sin(i * 31.7) + 1) * width * 0.5), (Math.cos(i * 7.1) + 1) * height * 0.4, i % 7 ? 1 : 2, i % 7 ? 1 : 2);
    }
    ctx.globalAlpha = 1;
    const planet = ctx.createRadialGradient(width * 0.7, height * 1.6, height * 0.6, width * 0.7, height * 1.6, height * 1.15);
    planet.addColorStop(0, '#102f47'); planet.addColorStop(0.96, '#15364a'); planet.addColorStop(0.985, '#417fb0'); planet.addColorStop(1, '#73c2f0');
    ctx.fillStyle = planet;
    ctx.beginPath(); ctx.arc(width * 0.7, height * 1.6, height * 1.15, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#73e4ef33';
    for (let i = 0; i < 6; i += 1) {
      const size = ((i + t * 0.12) % 6) / 6;
      ctx.beginPath(); ctx.ellipse(width / 2, height * 0.43, width * size * 0.45, height * size * 0.34, 0, 0, TAU); ctx.stroke();
    }
    if (state.mission === 'asteroids') {
      for (const entity of sim.entities) {
        const depth = Math.max(8, 25 - entity.z);
        const scale = height / depth;
        const x = width / 2 + entity.x * scale;
        const y = height * 0.43 - entity.y * scale;
        const radius = entity.radius * scale;
        ctx.fillStyle = entity.type === 'pickup' ? '#73e4ef' : '#55534f';
        ctx.strokeStyle = entity.type === 'pickup' ? '#b8fbff' : '#9b968a';
        ctx.beginPath();
        for (let point = 0; point < 7; point += 1) {
          const angle = point * TAU / 7 + entity.rotation;
          const r = radius * (point % 2 ? 0.85 : 1);
          const px = x + Math.cos(angle) * r, py = y + Math.sin(angle) * r;
          if (point) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      for (const enemy of sim.enemies) {
        const scale = height / Math.max(8, 25 - enemy.z);
        const x = width / 2 + enemy.x * scale, y = height * .43 - enemy.y * scale;
        ctx.fillStyle = '#29374c'; ctx.strokeStyle = '#ff895d'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y - scale * .65); ctx.lineTo(x + scale * 1.5, y + scale * .2);
        ctx.lineTo(x + scale * .55, y + scale * .4); ctx.lineTo(x, y + scale * .2);
        ctx.lineTo(x - scale * .55, y + scale * .4); ctx.lineTo(x - scale * 1.5, y + scale * .2);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ff764c'; ctx.fillRect(x - scale * .12, y - scale * .1, scale * .24, scale * .2);
      }
      for (const projectile of sim.projectiles) {
        const scale = height / Math.max(8, 25 - projectile.z);
        const x = width / 2 + projectile.x * scale, y = height * .43 - projectile.y * scale;
        ctx.strokeStyle = projectile.owner === 'player' ? '#73e4ef' : '#ff6b4e';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + (projectile.owner === 'player' ? 10 : -8)); ctx.stroke();
      }
      for (const effect of sim.effects) {
        const scale = height / Math.max(8, 25 - effect.z), progress = 1 - effect.life / effect.duration;
        ctx.strokeStyle = effect.color === 'cyan' ? '#73e4ef' : '#ff9c55';
        ctx.globalAlpha = 1 - progress;
        ctx.beginPath(); ctx.arc(width / 2 + effect.x * scale, height * .43 - effect.y * scale, (progress * 2 + .1) * effect.size * scale, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (state.mission === 'memory') {
      const arrows = { left: '←', up: '↑', right: '→', down: '↓' };
      const positions = [[0.32, 0.35], [0.5, 0.2], [0.68, 0.35], [0.5, 0.5]];
      Object.keys(arrows).forEach((direction, i) => {
        ctx.fillStyle = state.showIndex >= 0 && state.sequence[state.showIndex] === direction ? '#ffab65' : '#73e4ef88';
        ctx.font = `${Math.max(24, height * 0.08)}px sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(arrows[direction], width * positions[i][0], height * positions[i][1]);
      });
    } else {
      ctx.strokeStyle = '#73e4ef'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(width * (0.5 + sim.dockTarget.x * 0.04), height * (0.35 - sim.dockTarget.y * 0.05), height * 0.14, 0, TAU); ctx.stroke();
    }
    const shipX = width * (0.5 + sim.ship.x * 0.034), shipY = height * (0.78 - sim.flightPosition().y * 0.045);
    ctx.save(); ctx.translate(shipX, shipY); ctx.rotate(-sim.input.x * 0.15);
    const scale = Math.min(width / 7, height / 3.5);
    ctx.scale(scale, scale);
    if (state.duckRemaining > 0) ctx.scale(1, .65);
    ctx.fillStyle = '#ed8247'; ctx.strokeStyle = '#eedbc7'; ctx.lineWidth = 0.015;
    ctx.beginPath(); ctx.moveTo(0, -0.5); ctx.lineTo(0.22, 0.04); ctx.lineTo(0.65, 0.28); ctx.lineTo(0.12, 0.22); ctx.lineTo(0, 0.3); ctx.lineTo(-0.12, 0.22); ctx.lineTo(-0.65, 0.28); ctx.lineTo(-0.22, 0.04); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#80dcf2'; ctx.fillRect(-0.045, -0.32, 0.09, 0.23);
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#73e4ef'; ctx.beginPath(); ctx.moveTo(side * 0.13 - 0.035, 0.25); ctx.lineTo(side * 0.13, (state.boostRemaining > 0 ? .85 : .53) + Math.sin(t * 30) * 0.03); ctx.lineTo(side * 0.13 + 0.035, 0.25); ctx.fill();
    }
    if (state.stats.shieldActive) { ctx.strokeStyle = '#73e4efaa'; ctx.beginPath(); ctx.ellipse(0, 0, 0.78, 0.6, 0, 0, TAU); ctx.stroke(); }
    ctx.restore();
  }

  start(mission, options = {}) {
    const snapshot = this.simulation.start(mission, options);
    if (this.combatGroup) for (const [key, mesh] of this.combatMeshes) this.removeCombatMesh(key, mesh);
    this.setMissionVisibility();
    this.lastTime = 0;
    this.onState(snapshot);
    return snapshot;
  }

  preview(mission) {
    const snapshot = this.simulation.preview(mission);
    this.setMissionVisibility();
    this.onState(snapshot);
    return snapshot;
  }

  updateInput(input) { this.simulation.updateInput(input); }

  action(action) {
    this.memoryFlash = { direction: action, time: 0.28 };
    this.simulation.action(action);
    this.onState(this.simulation.snapshot());
  }

  setScenePaused(paused) { this.scenePaused=Boolean(paused); }
  pause() { const state = this.simulation.pause(); this.onState(state); return state; }
  resume() { this.lastTime = 0; const state = this.simulation.resume(); this.onState(state); return state; }
  end() { const state = this.simulation.end(); this.onState(state); return state; }
  snapshot() { return this.simulation.snapshot(); }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    globalThis.removeEventListener?.('resize', this.resize);
    if (this.scene) {
      const geometries = new Set(), materials = new Set();
      this.scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(mat => materials.add(mat));
      });
      this.rockGeometries.forEach(geometry => geometries.add(geometry));
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(mat => mat.dispose());
    }
    this.renderer?.dispose();
  }
}
