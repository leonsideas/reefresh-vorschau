/* The 3D set each specimen stands in.
 *
 * Every scenario in data/corals.json carries a `set` block — seabed colour,
 * water colour and density, a lighting preset, a particle kind and a list of
 * props. This module turns those numbers into an actual seafloor: one
 * continuous strip whose ground colour shifts from scenario to scenario, a
 * lighting rig that cross-fades as you travel, drifting matter, and small
 * procedural objects scattered around each specimen.
 *
 * The props that carry a scene — boulder, kelp, fish, shell — are generated
 * models loaded from assets/props/. Everything else is still built from
 * primitives here, so changing a colour in the table changes the world. If a
 * model is missing or has not arrived yet, the primitive version of that prop
 * stands in and the scene is never left empty.
 */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

const TAU = Math.PI * 2;

/* deterministic noise so a set looks the same on every visit */
function rng(seed){
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------
   Lighting presets
   ------------------------------------------------------------------ */
const LIGHT = {
  day:   {hemi:1.55, sky:'#eaf6ff', key:1.5,  keyCol:'#fff6e2', rimI:0.55, shafts:0.5,  contact:0.55},
  dim:   {hemi:0.85, sky:'#b9ccd6', key:0.75, keyCol:'#dbe7ee', rimI:0.4,  shafts:0.18, contact:0.42},
  dark:  {hemi:0.3,  sky:'#42606f', key:0.28, keyCol:'#b9d6e6', rimI:0.25, shafts:0.0,  contact:0.25},
  lamp:  {hemi:0.5,  sky:'#9fc0d4', key:1.9,  keyCol:'#eaf6ff', rimI:0.3,  shafts:0.42, contact:0.6},
  storm: {hemi:0.7,  sky:'#a8b4c4', key:0.6,  keyCol:'#cdd8e6', rimI:0.35, shafts:0.1,  contact:0.4},
  dry:   {hemi:1.5,  sky:'#f2ead8', key:2.1,  keyCol:'#fff3d8', rimI:0.3,  shafts:0.0,  contact:0.8},
};
const DEFAULT_LIGHT = LIGHT.dim;

/* ------------------------------------------------------------------
   Depth grade
   ------------------------------------------------------------------
   The presets above describe each scenario's own weather. This grade puts
   all of them where the archive actually lives: far enough down that no
   daylight arrives. The ambient rig is dimmed and the water is pulled toward
   a near-black blue, so what remains of the light is the survey lamp — and
   the specimen is the only thing it falls on. Every number here is a
   fraction of what the scenario asked for, so the scenarios keep their
   relative character; they just happen deeper. */
const DEPTH = {
  ambient: 0.3,     // share of the preset's sky light that survives
  key:     0.42,    // the broad key dims with it
  rim:     1.6,     // the rim does not: it cuts the specimen out of the water
  shafts:  0.3,     // barely any sun reaches this far
  water:   0.66,    // how far the water colour is pulled toward `deep`
  deep:    '#04101a',
  haze:    0.042,   // no scenario reads clearer than this far down
  lamp:    155,     // the survey lamp standing over the current specimen
  fill:    34,      // a little light from the visitor's side
};

/* The CSS water column above the horizon has to be graded with the scene, or
   the two stop meeting at the seabed. index.html tints the page with this. */
export function deepenWater(hex, amount = DEPTH.water){
  return '#' + new THREE.Color(hex)
    .lerp(new THREE.Color(DEPTH.deep), amount).getHexString();
}

/* ------------------------------------------------------------------
   Props — small procedural objects scattered around a specimen
   ------------------------------------------------------------------ */
function makeRock(rand, tone){
  const geo = new THREE.DodecahedronGeometry(0.22 + rand() * 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({color: tone, roughness: 1, flatShading: true});
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.set(rand() * TAU, rand() * TAU, rand() * TAU);
  mesh.scale.y *= 0.55 + rand() * 0.3;
  return mesh;
}

function makeRubble(rand){
  // broken coral: pale angular chips lying flat
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({color: 0xded5c4, roughness: .95, flatShading: true});
  const n = 3 + Math.floor(rand() * 4);
  for(let i = 0; i < n; i++){
    const chip = new THREE.Mesh(new THREE.TetrahedronGeometry(0.06 + rand() * 0.13), mat);
    chip.position.set((rand() - .5) * 0.7, 0.03, (rand() - .5) * 0.7);
    chip.rotation.set(rand() * TAU, rand() * TAU, rand() * TAU);
    chip.scale.y *= 0.5;
    group.add(chip);
  }
  return group;
}

function makeKelp(rand){
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4a6f45, roughness: .9, side: THREE.DoubleSide, transparent: true, opacity: .9
  });
  // several tapered blades from one holdfast, rather than one flat rectangle
  const blades = 3 + Math.floor(rand() * 3);
  for(let i = 0; i < blades; i++){
    const height = 0.55 + rand() * 0.95;
    const width = 0.05 + rand() * 0.05;
    const shape = new THREE.Shape();
    shape.moveTo(-width, 0);
    shape.quadraticCurveTo(-width * 1.5, height * 0.55, -width * 0.25, height);
    shape.lineTo(width * 0.25, height);
    shape.quadraticCurveTo(width * 1.5, height * 0.55, width, 0);
    shape.closePath();
    const blade = new THREE.Mesh(new THREE.ShapeGeometry(shape, 10), mat);
    blade.rotation.y = rand() * TAU;
    blade.rotation.z = (rand() - .5) * 0.35;
    blade.position.set((rand() - .5) * 0.18, 0, (rand() - .5) * 0.18);
    group.add(blade);
  }
  group.userData.sway = 0.05 + rand() * 0.08;
  group.userData.phase = rand() * TAU;
  return group;
}

function makeBones(rand){
  // a picked-clean fish: spine, ribs, skull
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({color: 0xe4dfd2, roughness: .85});
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.72, 6), mat);
  spine.rotation.z = Math.PI / 2;
  group.add(spine);
  for(let i = 0; i < 7; i++){
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.15 - i * 0.012, 5), mat);
    rib.position.x = -0.3 + i * 0.09;
    rib.rotation.x = Math.PI / 2;
    rib.rotation.z = 0.3;
    group.add(rib);
  }
  const skull = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 6), mat);
  skull.position.x = 0.4;
  skull.rotation.z = -Math.PI / 2;
  group.add(skull);
  group.rotation.y = rand() * TAU;
  group.position.y = 0.05;
  return group;
}

function makeFish(rand, alive = true){
  const group = new THREE.Group();
  const palette = [0xb9c6c8, 0xc9bd93, 0x8fa6ad, 0xa9b7ba, 0x9ab0a0];
  const colour = palette[Math.floor(rand() * palette.length)];
  const skin = new THREE.MeshStandardMaterial({color: colour, roughness: .5, metalness: .2});
  const fin = new THREE.MeshStandardMaterial({
    color: colour, roughness: .7, transparent: true, opacity: .8, side: THREE.DoubleSide
  });

  const profile = [[0.004,0],[0.05,0.14],[0.11,0.36],[0.17,0.64],[0.2,0.95],
                   [0.18,1.26],[0.11,1.62],[0.04,1.9],[0.008,2.0]];
  const bodyGeo = new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(p[0], p[1])), 14);
  bodyGeo.translate(0, -1, 0);
  const body = new THREE.Mesh(bodyGeo, skin);
  // Head on -x: the orbit in update() turns the model by -angle + 90°, and only
  // a fish facing -x ends up pointing along its own direction of travel.
  body.rotation.z = -Math.PI / 2;
  body.scale.set(1, 1, 0.5);
  group.add(body);

  const tailShape = new THREE.Shape();
  tailShape.moveTo(0,0); tailShape.lineTo(-0.5,0.38); tailShape.lineTo(-0.36,0);
  tailShape.lineTo(-0.5,-0.38); tailShape.closePath();
  const tail = new THREE.Mesh(new THREE.ShapeGeometry(tailShape), fin);
  tail.position.x = 1;
  tail.rotation.y = Math.PI;
  group.add(tail);

  group.scale.setScalar(0.11 + rand() * 0.09);
  group.userData.alive = alive;
  group.userData.phase = rand() * TAU;
  group.userData.speed = 0.15 + rand() * 0.25;
  return group;
}

function makePlastic(rand){
  const group = new THREE.Group();
  const cols = [0xef6f8e, 0x64c9c2, 0xf4c65a, 0x7d9bf0, 0xef9d5a, 0xe8e8e8];
  const n = 3 + Math.floor(rand() * 5);
  for(let i = 0; i < n; i++){
    const mat = new THREE.MeshStandardMaterial({
      color: cols[Math.floor(rand() * cols.length)], roughness: .35, metalness: .05,
      side: THREE.DoubleSide, transparent: true, opacity: .9
    });
    const bit = new THREE.Mesh(new THREE.PlaneGeometry(0.09 + rand() * 0.16, 0.07 + rand() * 0.13), mat);
    bit.position.set((rand() - .5) * 1.1, 0.02 + rand() * 0.05, (rand() - .5) * 1.1);
    bit.rotation.set(-Math.PI/2 + (rand() - .5) * 0.8, rand() * TAU, 0);
    group.add(bit);
  }
  return group;
}

function makeIce(rand){
  const size = 0.22 + rand() * 0.3;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xdcf0fa, roughness: .12, metalness: 0, transparent: true, opacity: .55
  });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat);
  cube.rotation.set(rand() * TAU, rand() * TAU, rand() * TAU);
  cube.userData.bob = 0.1 + rand() * 0.2;
  cube.userData.phase = rand() * TAU;
  return cube;
}

function makeNet(rand){
  // a torn mesh panel, snagged and hanging
  const w = 1.5 + rand(), h = 1.0 + rand() * 0.9;
  const cols = 7, rows = 5;
  const pts = [];
  for(let r = 0; r <= rows; r++){
    for(let c = 0; c <= cols; c++){
      const x = (c / cols - .5) * w;
      const y = (1 - r / rows) * h;
      const z = Math.sin(c * 0.9 + r * 0.5) * 0.09;
      if(c < cols) pts.push(x, y, z, ((c+1)/cols - .5) * w, y, Math.sin((c+1)*0.9 + r*0.5) * 0.09);
      if(r < rows) pts.push(x, y, z, x, (1 - (r+1)/rows) * h, Math.sin(c*0.9 + (r+1)*0.5) * 0.09);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const net = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: 0x6f7a72, transparent: true, opacity: .55
  }));
  net.rotation.y = (rand() - .5) * 1.2;
  net.rotation.z = (rand() - .5) * 0.3;
  return net;
}

function makeShells(rand){
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({color: 0xe8dcc8, roughness: .7});
  const n = 2 + Math.floor(rand() * 4);
  for(let i = 0; i < n; i++){
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.05 + rand() * 0.06, 8, 6, 0, TAU, 0, Math.PI/2), mat);
    shell.position.set((rand() - .5) * 0.8, 0.01, (rand() - .5) * 0.8);
    shell.rotation.set(rand() * 0.6, rand() * TAU, rand() * 0.6);
    group.add(shell);
  }
  return group;
}

const PROP_BUILDERS = {
  rock: makeRock, rubble: makeRubble, kelp: makeKelp, bones: makeBones,
  fish: makeFish, plastic: makePlastic, ice: makeIce, net: makeNet, shells: makeShells,
};

/* ------------------------------------------------------------------
   Generated props
   ------------------------------------------------------------------
   Four kinds carry the look of a scene, and primitives were never going to
   hold their own beside a coral of two million triangles. These are made the
   same way the specimens are — a render, then image-to-3D — and loaded once
   for the whole archive, then cloned per instance so the geometry is uploaded
   to the card a single time.

   `span` is the largest dimension the clone is scaled to, in world units,
   taken from the range the primitive version used so nothing changes size.
   `swims` marks the ones that float rather than stand: they are centred on
   their own middle instead of set on the floor. */
const PROP_ASSETS = {
  rock:   {url: 'assets/props/fels.glb',    span: [0.55, 1.35]},
  kelp:   {url: 'assets/props/tang.glb',    span: [1.05, 2.00]},
  fish:   {url: 'assets/props/fisch.glb',   span: [0.30, 0.52], swims: true, turn: -Math.PI / 2},
  shells: {url: 'assets/props/muschel.glb', span: [0.13, 0.26]},
};

const assetLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const loadedAssets = new Map();     // kind -> THREE.Object3D, ready to clone

/* Bring a loaded model into the coordinate system the placement code assumes:
   centred on x and z, standing on y = 0 (or centred, if it swims), and one
   unit across its longest side so `span` alone decides the size. */
function normalise(root, swims){
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const unit = 1 / Math.max(size.x, size.y, size.z, 1e-6);
  root.scale.setScalar(unit);
  root.position.set(-centre.x * unit,
                    swims ? -centre.y * unit : -box.min.y * unit,
                    -centre.z * unit);
  root.traverse(o => { if(o.isMesh) o.frustumCulled = false; });
  return root;
}

export function loadPropAssets(){
  return Promise.all(Object.entries(PROP_ASSETS).map(([kind, spec]) =>
    new Promise(resolve => {
      assetLoader.load(spec.url, (gltf) => {
        const holder = new THREE.Group();
        holder.add(normalise(gltf.scene, spec.swims));
        // The generated fish came out of its render facing the camera, along
        // +z. The orbit expects a head on -x, so it is turned once here rather
        // than on every fish in the archive.
        if(spec.turn) holder.rotation.y = spec.turn;
        loadedAssets.set(kind, holder);
        resolve(kind);
      }, undefined, () => resolve(null));   // missing file: the primitive stays
    })));
}

/* A clone at a random size within the kind's range. Returns null when the
   model is not there, so the caller falls back to the primitive. */
function assetProp(kind, rand){
  const source = loadedAssets.get(kind);
  if(!source) return null;
  const spec = PROP_ASSETS[kind];
  const item = source.clone(true);
  const [lo, hi] = spec.span;
  item.scale.setScalar(lo + rand() * (hi - lo));
  item.rotation.y += rand() * TAU;

  // the same userData the primitive builders set, or the update loop finds
  // nothing to read and the prop stands dead still
  if(kind === 'kelp'){
    item.userData.sway = 0.05 + rand() * 0.08;
    item.userData.phase = rand() * TAU;
  } else if(kind === 'fish'){
    item.userData.alive = true;
    item.userData.phase = rand() * TAU;
    item.userData.speed = 0.15 + rand() * 0.25;
  } else {
    item.rotation.z = (rand() - 0.5) * 0.12;   // nothing lies perfectly flat
  }
  return item;
}

/* ------------------------------------------------------------------
   Environment
   ------------------------------------------------------------------ */
export class Environment {
  constructor(scene, {spacing, specimens}){
    this.scene = scene;
    this.spacing = spacing;
    this.specimens = specimens;
    this.sets = specimens.map(s => (s.scenario && s.scenario.set) || {});
    this.props = new Map();          // index -> THREE.Group
    this.kelp = [];
    this.fish = [];
    this.ice = [];
    this.clock = 0;

    this._buildLights();
    this._buildFloor();
    this._buildDrift();

    // The models arrive after the first specimens are already standing, so
    // whatever was built from primitives in the meantime is thrown away and
    // built again — otherwise the specimen you land on keeps the placeholders
    // for as long as you look at it.
    loadPropAssets().then(() => {
      for(const index of [...this.props.keys()]){
        this.releaseProps(index);
        this.ensureProps(index);
      }
    });
    this.fog = new THREE.FogExp2(0x9fc0d4, 0.03);
    this.submerged = true;
    this.scene.fog = this.fog;
  }

  /* Drawing mode shows the sheets themselves and nothing else — no seabed, no
     water, no drifting matter. The set is not torn down, because the visitor
     flips straight back to it; it is only taken out of the frame. */
  setSubmerged(on){
    on = !!on;
    if(this.submerged === on) return;
    this.submerged = on;
    this.floor.visible = on;
    this.drift.visible = on;
    for(const group of this.props.values()) group.visible = on;
    this.scene.fog = on ? this.fog : null;
  }

  /* ---- lighting rig; values cross-fade in update() ---- */
  _buildLights(){
    this.hemi = new THREE.HemisphereLight(0xeaf6ff, 0x6d6a5e, 1.2);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffffff, 1.2);
    this.key.position.set(4, 9, 6);
    this.scene.add(this.key);
    this.rim = new THREE.DirectionalLight(0xdfeaf2, 0.4);
    this.rim.position.set(-6, 3, -5);
    this.scene.add(this.rim);
    // stands in for sunlight raking down through the water
    this.shafts = new THREE.SpotLight(0xffffff, 0, 40, 0.55, 0.9, 0.6);
    this.shafts.position.set(2, 16, 4);
    this.scene.add(this.shafts, this.shafts.target);

    // The exhibit lamp: a cool survey light that always stands over the
    // current specimen, like an ROV hovering just out of frame. At this depth
    // it is not a garnish — it is the reason the specimen is visible at all,
    // so it runs tight and hot and falls off fast enough to leave the seabed
    // around it dark.
    this.lamp = new THREE.SpotLight(0xdff0fa, DEPTH.lamp, 34, 0.34, 0.7, 1.25);
    this.lamp.position.set(0, 8.8, 4.6);
    this.scene.add(this.lamp, this.lamp.target);

    // a weak fill from the visitor's side, so the faces turned toward the
    // camera are modelled instead of solid black
    this.fill = new THREE.SpotLight(0xa8c9de, DEPTH.fill, 30, 0.52, 0.9, 1.2);
    this.fill.position.set(-3.6, 4.4, 7.4);
    this.scene.add(this.fill, this.fill.target);
  }

  /* Ground height at a world position. Specimens stand on a strip that is
     dead flat at y = 0, so nothing is ever half-buried; the dunes only start
     once you are clear of that strip. Props sample this to sit on the sand. */
  heightAt(worldX, worldZ){
    const flat = 4.4, ramp = 3.2;
    const band = Math.abs(worldZ);
    if(band <= flat) return 0;
    const rise = Math.min(1, (band - flat) / ramp);
    const dune = Math.sin(worldX * 0.16) * Math.cos(worldZ * 0.21) * 0.55
               + Math.sin(worldX * 0.61 + 1.7) * 0.16;
    return dune * rise;
  }

  /* ---- one continuous seabed, tinted per scenario ---- */
  _buildFloor(){
    const n = this.specimens.length;
    const length = (n - 1) * this.spacing + 120;
    const depth = 110;
    const geo = new THREE.PlaneGeometry(length, depth, Math.min(520, n * 14), 78);
    const pos = geo.attributes.position;
    const colours = new Float32Array(pos.count * 3);
    const tones = this.sets.map(s => new THREE.Color(s.floor || '#b3a795'));
    const originX = length / 2 - 55;   // world x of the plane's local x = 0

    const c = new THREE.Color();
    for(let i = 0; i < pos.count; i++){
      const lx = pos.getX(i), ly = pos.getY(i);
      // the plane is laid flat by rotating -90° about X, so local (lx, ly)
      // lands at world (lx + originX, height, -ly)
      const worldX = lx + originX;
      const worldZ = -ly;
      const h = this.heightAt(worldX, worldZ);
      pos.setZ(i, h);

      // ground colour blends from one scenario to the next
      const t = worldX / this.spacing;
      const i0 = Math.max(0, Math.min(n - 1, Math.floor(t)));
      const i1 = Math.max(0, Math.min(n - 1, i0 + 1));
      const f = Math.max(0, Math.min(1, t - i0));
      c.copy(tones[i0]).lerp(tones[i1], f);
      const shade = 0.88 + Math.min(0.12, Math.abs(h) * 0.18);
      colours[i*3] = c.r * shade; colours[i*3+1] = c.g * shade; colours[i*3+2] = c.b * shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geo.computeVertexNormals();

    // A near-white sediment detail map, multiplied by the per-scenario vertex
    // colour: it adds ripples and grain without changing any scenario's tone.
    const grain = new THREE.TextureLoader().load('assets/tex/seabed.webp');
    grain.colorSpace = THREE.SRGBColorSpace;
    grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
    grain.anisotropy = 8;
    grain.repeat.set(length / 2.6, depth / 2.6);

    this.floor = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, map: grain, roughness: 1, metalness: 0
    }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(originX, 0, 0);
    this.scene.add(this.floor);
  }

  /* ---- drifting matter around the camera, recoloured per scenario ---- */
  _buildDrift(){
    const N = 700;
    const positions = new Float32Array(N * 3);
    const rand = rng(99);
    for(let i = 0; i < N; i++){
      positions[i*3]   = (rand() - .5) * 34;
      positions[i*3+1] = rand() * 12;
      positions[i*3+2] = (rand() - .5) * 30;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.drift = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xdfeef2, size: 0.04, transparent: true, opacity: 0.5, depthWrite: false
    }));
    this.drift.frustumCulled = false;
    this.scene.add(this.drift);
  }

  /* ---- props for one specimen, built on demand ---- */
  ensureProps(index){
    if(this.props.has(index)) return;
    const set = this.sets[index] || {};
    const list = set.props || [];
    const rand = rng(1000 + index * 37);
    const group = new THREE.Group();
    group.position.x = index * this.spacing;

    const floorTone = new THREE.Color(set.floor || '#9a9384').multiplyScalar(0.72);
    for(const kind of list){
      const build = PROP_BUILDERS[kind];
      if(!build) continue;
      const count = kind === 'net' ? 1 : (kind === 'fish' ? 3 : 2 + Math.floor(rand() * 3));
      for(let i = 0; i < count; i++){
        const item = assetProp(kind, rand)
                  ?? (kind === 'rock' ? build(rand, floorTone) : build(rand));

        // Ring the specimen but never stand in front of it: the viewer looks
        // from +z, so anything that lands on the near side is mirrored to the
        // far side. Props end up behind and to the sides.
        let angle = rand() * TAU;
        if(Math.sin(angle) > 0.1) angle = -angle;
        const radius = 3.4 + rand() * 5.2;
        const px = group.position.x + Math.cos(angle) * radius;
        const pz = Math.sin(angle) * radius - 1.2;
        item.position.x += Math.cos(angle) * radius;
        item.position.z += pz;

        const ground = this.heightAt(px, pz);
        if(kind === 'fish'){
          item.position.y = ground + 0.8 + rand() * 1.6;
          item.userData.orbit = radius;
          item.userData.angle = angle;
          item.userData.baseZ = pz - Math.sin(angle) * radius;
          this.fish.push(item);
        } else if(kind === 'ice'){
          item.position.y = ground + 0.5 + rand() * 2.0;
          this.ice.push(item);
        } else if(kind === 'net'){
          item.position.y = ground + 0.35;
        } else {
          item.position.y += ground;
          if(kind === 'kelp') this.kelp.push(item);
        }
        group.add(item);
      }
    }
    group.visible = this.submerged;
    this.scene.add(group);
    this.props.set(index, group);
  }

  releaseProps(index){
    const group = this.props.get(index);
    if(!group) return;
    this.scene.remove(group);
    group.traverse(o => {
      if(o.geometry) o.geometry.dispose();
      if(o.material){
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => m.dispose());
      }
    });
    this.kelp = this.kelp.filter(k => k.parent);
    this.fish = this.fish.filter(f => f.parent);
    this.ice = this.ice.filter(i => i.parent);
    this.props.delete(index);
  }

  /* ---- cross-fade the whole set as the camera travels ---- */
  update(position, dt, cameraX){
    this.clock += dt;
    const n = this.sets.length;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(position)));
    const i1 = Math.max(0, Math.min(n - 1, i0 + 1));
    const f = Math.max(0, Math.min(1, position - i0));
    const a = this.sets[i0] || {}, b = this.sets[i1] || {};

    const mix = (x, y) => (x === undefined ? y : (y === undefined ? x : x + (y - x) * f));
    const la = LIGHT[a.light] || DEFAULT_LIGHT;
    const lb = LIGHT[b.light] || DEFAULT_LIGHT;

    this.hemi.intensity = mix(la.hemi, lb.hemi) * DEPTH.ambient;
    this.hemi.color.set(la.sky).lerp(new THREE.Color(lb.sky), f)
      .lerp(new THREE.Color(DEPTH.deep), DEPTH.water * 0.7);
    this.key.intensity = mix(la.key, lb.key) * DEPTH.key;
    this.key.color.set(la.keyCol).lerp(new THREE.Color(lb.keyCol), f);
    this.rim.intensity = mix(la.rimI, lb.rimI) * DEPTH.rim;
    this.shafts.intensity = mix(la.shafts, lb.shafts) * 26 * DEPTH.shafts;
    this.shafts.position.x = cameraX + 2;
    this.shafts.target.position.set(cameraX, 0, 0);
    this.shafts.target.updateMatrixWorld();

    // the survey lamp locks onto the nearest specimen and carries the scene:
    // the darker the water, the more the lamp does
    const focusX = Math.round(position) * this.spacing;
    this.lamp.position.set(focusX + 1.6, 8.8, 4.6);
    this.lamp.target.position.set(focusX, 1.7, 0);
    this.lamp.target.updateMatrixWorld();
    const ambient = mix(la.hemi, lb.hemi);
    // the darker the scenario's own sky, the more the lamp has to carry
    this.lamp.intensity = DEPTH.lamp * (1 + Math.max(0, 1.2 - ambient) * 0.45);

    this.fill.position.set(focusX - 3.6, 4.4, 7.4);
    this.fill.target.position.set(focusX, 1.8, 0);
    this.fill.target.updateMatrixWorld();

    // storms flicker; everything else holds steady
    if(a.light === 'storm' || b.light === 'storm'){
      const strike = Math.max(0, Math.sin(this.clock * 2.3) - 0.985) * 60;
      this.key.intensity += strike * (a.light === 'storm' ? 1 - f : f);
    }

    // water colour and how far you can see through it
    const fogA = new THREE.Color(a.fog || '#9fc0d4');
    const fogB = new THREE.Color(b.fog || '#9fc0d4');
    this.fog.color.copy(fogA).lerp(fogB, f)
      .lerp(new THREE.Color(DEPTH.deep), DEPTH.water);
    // a floor on the haze, never a ceiling: clear scenarios lose their far
    // horizon, murky ones stay exactly as murky as they were written
    this.fog.density = Math.max(DEPTH.haze,
      mix(a.density ?? 0.03, b.density ?? 0.03));

    // drifting matter takes on the character of the water
    const kind = f < 0.5 ? a.particles : b.particles;
    const mat = this.drift.material;
    if(kind === 'none'){
      mat.opacity = 0;
    } else if(kind === 'plastic'){
      mat.opacity = 0.62; mat.size = 0.075; mat.color.set(0xe9e2d2);
    } else if(kind === 'dust'){
      mat.opacity = 0.42; mat.size = 0.05; mat.color.set(0xcdbfa6);
    } else if(kind === 'bubbles'){
      mat.opacity = 0.5; mat.size = 0.06; mat.color.set(0xdff2fb);
    } else {
      mat.opacity = 0.46; mat.size = 0.042; mat.color.set(0xe6eff2);
    }

    // bubbles rise, everything else sinks
    const rising = kind === 'bubbles';
    const pos = this.drift.geometry.attributes.position;
    const step = (rising ? 0.55 : -0.30) * dt;
    for(let i = 0; i < pos.count; i++){
      let y = pos.getY(i) + step;
      if(y > 12) y -= 12; else if(y < 0) y += 12;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    this.drift.position.x = cameraX;

    // living things keep moving
    const t = this.clock;
    for(const k of this.kelp) k.rotation.z = Math.sin(t * 0.8 + k.userData.phase) * k.userData.sway;
    for(const fsh of this.fish){
      const ang = fsh.userData.angle + t * fsh.userData.speed * 0.25;
      const r = fsh.userData.orbit;
      fsh.position.x = Math.cos(ang) * r;
      fsh.position.z = Math.sin(ang) * r - 1.2;
      fsh.rotation.y = -ang + Math.PI / 2;
    }
    for(const cube of this.ice){
      cube.position.y += Math.sin(t * 0.7 + cube.userData.phase) * 0.0016;
      cube.rotation.y += dt * 0.15;
    }
  }
}
