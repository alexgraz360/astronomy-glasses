/* Reality Engine · Phase 1 — Tap-to-simulate planet dashboards (Handoff 04)
 *
 * Reusable three.js dashboard: full-screen interactive 3D planet driven by
 * Astronomy Engine so axial tilt, rotation phase, illumination/terminator,
 * Saturn's ring opening, and moon positions are correct for the displayed
 * time. One scene alive at a time; textures lazy-load on open and all GPU
 * resources are disposed on close.
 *
 * Coordinate conventions (verified in Node against Astronomy Engine before
 * this file was written — see Build Log, Handoff 04):
 *   - Scene frame: EQJ (J2000 equatorial) mapped to three.js as
 *     (x, y, z)_EQJ -> (x, z, -y)_three  [right-handed, celestial north = +Y].
 *   - Body orientation: IAU convention via Astronomy.RotationAxis:
 *     pole = north vector (EQJ); node n = z_ICRF x pole; prime meridian
 *     X_pm = n rotated about pole by `spin` deg; Y_pm = pole x X_pm (=90degE).
 *     Verified: reproduces Earth's independent sub-solar point to 0.6deg lon,
 *     0.0deg lat.
 *   - three.js SphereGeometry UV (verified r185): texture center (u=.5)
 *     faces local +X, east (u=.75) faces local -Z, north = +Y. So the mesh
 *     basis is (X_pm, pole, X_pm x pole) and geographic (lat,lon) maps to
 *     local (cos lat cos lon, sin lat, -cos lat sin lon).
 *   - Sun light dir = -HelioVector(planet); camera home = -GeoVector(planet)
 *     (i.e. the planet as seen from Earth, north up). Earth itself is viewed
 *     from above the AR observer's GPS position (fallback: sub-solar point).
 *
 * Moon ephemerides: Jupiter's four Galilean moons are EXACT
 * (Astronomy.JupiterMoons, jovicentric EQJ). Earth's Moon is EXACT
 * (Astronomy.GeoMoon). Saturn (Titan/Rhea/Dione/Tethys) and Mars
 * (Phobos/Deimos) are APPROXIMATE: circular orbits in the planet's
 * equatorial plane from JPL SSD mean elements (ssd.jpl.nasa.gov/sats/elem/,
 * epoch 2000-01-01.5 TT): angle = (node+w+M) + 360*t_days/P measured from
 * the IAU equator node. Labeled "approx" in the UI.
 *
 * Textures: Solar System Scope (solarsystemscope.com/textures), CC BY 4.0,
 * NASA-derived. three.js r185 (MIT). Technique references: classic fresnel
 * rim atmosphere + day/night terminator blends as used across open-source
 * three.js planet demos (e.g. franky-adl/threejs-earth, jeromeetienne
 * threex.planets); ring plane-intersection shadowing is our own.
 */

import * as THREE from "three";

var A = window.Astronomy;
var D2R = Math.PI / 180, R2D = 180 / Math.PI;
var AU_KM = 149597870.7;
var TEX = "textures/";

/* ============================== planet data ============================== */
/* Static facts from NASA planetary fact sheets (real values, not invented).
   radiusKm = equatorial; flat = polar/equatorial ratio. */
var PLANETS = {
  Saturn: {
    glyph: "♄", radiusKm: 60268, flat: 0.902, camDist: 7.6, // rings must fit (outer edge 2.33 R)
    map: "2k_saturn.jpg",
    atmosphere: { color: [0.85, 0.80, 0.62], strength: 0.35 },
    rings: { map: "2k_saturn_ring_alpha.png", innerKm: 74500, outerKm: 140220 },
    moons: [
      { name: "Titan",  radiusKm: 2575, aKm: 1221900, periodDays: 15.945448, lon0: 168.6, tint: [0.95, 0.75, 0.45], approx: true },
      { name: "Rhea",   radiusKm: 764,  aKm: 527200,  periodDays: 4.517503,  lon0: 209.5, tint: [0.85, 0.84, 0.82], approx: true },
      { name: "Dione",  radiusKm: 561,  aKm: 377700,  periodDays: 2.736916,  lon0: 328.0, tint: [0.86, 0.85, 0.83], approx: true },
      { name: "Tethys", radiusKm: 531,  aKm: 295000,  periodDays: 1.887802,  lon0: 248.3, tint: [0.88, 0.87, 0.85], approx: true }
    ],
    desc: "The ringed gas giant. Ring tilt, lighting and rotation are live for the displayed time — the rings are opening back up after their 2025 edge-on crossing.",
    stats: { "Radius (equatorial)": "60,268 km", "Mass": "5.68 × 10²⁶ kg", "Day length": "10.7 h", "Axial tilt": "26.7°", "Known moons": "274" }
  },
  Jupiter: {
    glyph: "♃", radiusKm: 71492, flat: 0.935, camDist: 4.6,
    map: "2k_jupiter.jpg",
    atmosphere: { color: [0.85, 0.78, 0.65], strength: 0.30 },
    limbDarken: 0.45,
    moons: [
      { name: "Io",       radiusKm: 1822, jm: "io",       tint: [0.95, 0.85, 0.45] },
      { name: "Europa",   radiusKm: 1561, jm: "europa",   tint: [0.90, 0.83, 0.72] },
      { name: "Ganymede", radiusKm: 2634, jm: "ganymede", tint: [0.78, 0.74, 0.68] },
      { name: "Callisto", radiusKm: 2410, jm: "callisto", tint: [0.62, 0.58, 0.53] }
    ],
    desc: "The largest planet. The Great Red Spot and cloud bands rotate in real time (a Jupiter day is under 10 hours), and the four Galilean moons are at their exact current positions.",
    stats: { "Radius (equatorial)": "71,492 km", "Mass": "1.90 × 10²⁷ kg", "Day length": "9.93 h", "Axial tilt": "3.1°", "Known moons": "95" }
  },
  Earth: {
    glyph: "⊕", radiusKm: 6378, flat: 0.9966, camDist: 3.4,
    map: "2k_earth_daymap.jpg", nightMap: "2k_earth_nightmap.jpg", cloudMap: "2k_earth_clouds.jpg",
    atmosphere: { color: [0.35, 0.55, 1.0], strength: 0.65 },
    moons: [
      { name: "Moon", radiusKm: 1737, geoMoon: true, map: "1k_moon.jpg", tint: [1, 1, 1] }
    ],
    desc: "Home, lit exactly as it is right now — the day/night terminator, city lights and season match the displayed time. Starts over your GPS position.",
    stats: { "Radius (equatorial)": "6,378 km", "Mass": "5.97 × 10²⁴ kg", "Day length": "23.93 h", "Axial tilt": "23.44°", "Known moons": "1" }
  },
  Mercury: {
    glyph: "☿", radiusKm: 2440, flat: 1.0, camDist: 3.4,
    map: "2k_mercury.jpg",
    moons: [],
    desc: "The innermost planet: a cratered, airless world. Its 3:2 spin–orbit resonance means one solar day lasts about two Mercury years (~176 Earth days). Its phase follows the app clock.",
    stats: { "Radius": "2,440 km", "Mass": "3.30 × 10²³ kg", "Rotation (sidereal)": "58.65 d (3:2 resonance)", "Solar day": "~176 d", "Axial tilt": "0.03°", "Known moons": "0" }
  },
  Venus: {
    glyph: "♀", radiusKm: 6052, flat: 1.0, camDist: 3.4,
    map: "2k_venus_atmosphere.jpg",
    atmosphere: { color: [0.95, 0.88, 0.70], strength: 0.5 },
    moons: [],
    desc: "You are seeing Venus's cloud tops — the solid surface is permanently hidden beneath its dense CO₂ atmosphere. It rotates retrograde, so slowly that its day (243 d) outlasts its year (225 d). Venus shows dramatic phases: scrub Time Travel to watch them.",
    stats: { "Radius": "6,052 km", "Mass": "4.87 × 10²⁴ kg", "Rotation (sidereal)": "243 d, retrograde", "Axial tilt": "177.4°", "Known moons": "0" }
  },
  Moon: {
    glyph: "☾", radiusKm: 1737, flat: 1.0, camDist: 3.2,
    map: "2k_moon.jpg",
    moons: [],
    desc: "Earth's Moon at its current phase. The terminator and the slight wobble of the visible face (optical libration, approximate — mean IAU rotation) follow the app clock: scrub Time Travel to watch it wax, wane, and nod.",
    stats: { "Radius": "1,737 km", "Mass": "7.35 × 10²² kg", "Rotation": "27.32 d (synchronous)", "Axial tilt": "6.68° (to ecliptic)" }
  },
  Sun: {
    glyph: "☉", radiusKm: 695700, flat: 1.0, camDist: 3.0,
    map: "2k_sun.jpg", unlit: true, limbDarken: 0.35,
    atmosphere: { color: [1.0, 0.72, 0.35], strength: 0.85 },
    moons: [],
    desc: "Our star, rotating once every ~25 days at its equator. ⚠ Never look at the real Sun with the naked eye or unfiltered optics — this rendering is safe; the real sky is not.",
    stats: { "Radius": "695,700 km", "Mass": "1.99 × 10³⁰ kg", "Rotation (equator)": "~25.4 d", "Surface temp": "5,772 K", "Spectral type": "G2V" }
  },
  Mars: {
    glyph: "♂", radiusKm: 3396, flat: 0.9941, camDist: 3.4,
    map: "2k_mars.jpg",
    atmosphere: { color: [0.85, 0.55, 0.35], strength: 0.28 },
    moons: [
      { name: "Phobos", radiusKm: 11, aKm: 9375,  periodDays: 0.3187, lon0: 255.2, tint: [0.65, 0.58, 0.52], approx: true, minPx: true },
      { name: "Deimos", radiusKm: 6,  aKm: 23457, periodDays: 1.2625, lon0: 259.3, tint: [0.70, 0.64, 0.58], approx: true, minPx: true }
    ],
    desc: "The red planet: Olympus Mons, Valles Marineris and the polar ice caps, with its real rotation, tilt and phase for the displayed time.",
    stats: { "Radius (equatorial)": "3,396 km", "Mass": "6.42 × 10²³ kg", "Day length": "24.62 h", "Axial tilt": "25.19°", "Known moons": "2" }
  }
};

var CREDIT = "Textures © Solar System Scope, CC BY 4.0 (NASA-derived) · Ephemeris: Astronomy Engine (MIT) · three.js r185 (MIT)";

/* H14 Deep Time / Eras: curated epochs per body, from data/deep-time.json.
   COMPLETELY separate from SimClock — no positions are computed; selecting
   an era only morphs appearance (procedural shader params) and swaps in
   sourced facts with confidence tags. */
var ERAS_BODIES = { Mars: 1, Saturn: 1, Sun: 1, Earth: 1 };
var deepTimePromise = null;
function loadDeepTime() {
  if (!deepTimePromise) deepTimePromise = fetch("data/deep-time.json").then(function (r) { return r.json(); });
  return deepTimePromise;
}

/* ============================== shaders ============================== */

var PLANET_VERT = `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/* One fragment shader for every globe; features switch on by uniform/define.
   Lighting: soft terminator smoothstep; optional night map (Earth), limb
   darkening (Jupiter), ring shadow (Saturn: intersect sun ray with equator
   plane, sample ring alpha radially). */
var PLANET_FRAG = `
  uniform sampler2D map;
  uniform vec3 sunDir;
  uniform float ambient;
  uniform float limbDarken;
  uniform vec3 tint;
  /* H14 Deep Time era morph uniforms — all no-ops at their defaults
     (tint (1,1,1)/mix 0, white 0, ocean 0, desat 0, nightMul 1, ringMul 1)
     so present-day rendering is pixel-identical when Eras is unused. */
  uniform vec3 eraTintColor;
  uniform float eraTintMix;
  uniform float eraWhite;
  uniform float eraOcean;
  uniform float eraDesat;
  #ifdef HAS_NIGHT
    uniform sampler2D nightMap;
    uniform float eraNightMul;
  #endif
  #ifdef HAS_RINGSHADOW
    uniform sampler2D ringMap;
    uniform vec3 poleDir;
    uniform float ringInner;
    uniform float ringOuter;
    uniform float eraRingMul;
  #endif
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float ndotl = dot(N, sunDir);
    float day = smoothstep(-0.03, 0.14, ndotl);
    vec3 base = texture2D(map, vUv).rgb * tint;
    /* era: schematic ocean keyed to dark (lowland) albedo with a northern
       bias — an artist's-impression wet Mars, labeled as such in the UI */
    if (eraOcean > 0.001) {
      float lum0 = dot(base, vec3(0.3333));
      float northBias = smoothstep(0.42, 0.72, vUv.y);
      float lowland = smoothstep(0.5, 0.25, lum0);
      float om = clamp(lowland * 0.75 + northBias * 0.55, 0.0, 1.0) * eraOcean;
      base = mix(base, vec3(0.07, 0.18, 0.38), om);
    }
    if (eraDesat > 0.001) base = mix(base, vec3(dot(base, vec3(0.3333))), eraDesat);
    #ifdef HAS_RINGSHADOW
      float sPole = dot(sunDir, poleDir);
      if (abs(sPole) > 1e-4) {
        float t = -dot(vPosW, poleDir) / sPole;
        if (t > 0.0) {
          vec3 hit = vPosW + sunDir * t;
          float r = length(hit);
          if (r > ringInner && r < ringOuter) {
            float a = texture2D(ringMap, vec2((r - ringInner) / (ringOuter - ringInner), 0.5)).a;
            day *= 1.0 - 0.88 * a * eraRingMul;
          }
        }
      }
    #endif
    vec3 col = base * (ambient + (1.0 - ambient) * day);
    #ifdef HAS_NIGHT
      vec3 lights = texture2D(nightMap, vUv).rgb;
      float night = 1.0 - smoothstep(-0.12, 0.05, ndotl);
      col += lights * vec3(1.0, 0.92, 0.75) * night * 1.15 * eraNightMul;
      /* subtle ocean glint: day map water is dark + blue-dominant */
      float water = smoothstep(0.05, 0.25, base.b - base.r);
      vec3 H = normalize(sunDir + V);
      col += water * day * pow(max(dot(N, H), 0.0), 60.0) * vec3(0.35);
    #endif
    col = mix(col, col * eraTintColor, eraTintMix);
    col = mix(col, vec3(0.93, 0.96, 1.02) * (ambient + (1.0 - ambient) * day), eraWhite);
    if (limbDarken > 0.0) {
      col *= mix(1.0, pow(max(dot(N, V), 0.0), 0.55), limbDarken);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* Fresnel rim atmosphere, additive, drawn on a slightly larger back-side
   sphere; brightest on the sunlit limb. */
var ATMO_FRAG = `
  uniform vec3 sunDir;
  uniform vec3 glowColor;
  uniform float strength;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float rim = pow(1.0 - abs(dot(N, V)), 3.0);
    float lit = 0.25 + 0.75 * smoothstep(-0.35, 0.45, dot(N, sunDir));
    gl_FragColor = vec4(glowColor, 1.0) * rim * lit * strength;
  }
`;

/* Earth cloud layer: cloud map luminance = alpha, lit by the sun with a hint
   of visibility on the night side. */
var CLOUD_FRAG = `
  uniform sampler2D map;
  uniform vec3 sunDir;
  uniform float eraCloudMul; // H14: era cloud-cover multiplier (1 = today)
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    float c = texture2D(map, vUv).r;
    float day = smoothstep(-0.05, 0.15, dot(normalize(vNormalW), sunDir));
    gl_FragColor = vec4(vec3(1.0), c * (0.06 + 0.94 * day) * 0.92 * eraCloudMul);
  }
`;

/* Rings: color+alpha sampled radially from the SSS strip; lit/unlit face
   factor; planet shadow = cylinder behind the globe along -sunDir. */
var RING_VERT = `
  varying vec2 vUv;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
var RING_FRAG = `
  uniform sampler2D map;
  uniform vec3 sunDir;
  uniform vec3 poleDir;
  uniform float eraRingMul; // H14: 1 = today; ->0 as ring rain drains them
  varying vec2 vUv;
  varying vec3 vPosW;
  void main() {
    vec4 tex = texture2D(map, vec2(vUv.x, 0.5));
    if (tex.a < 0.02) discard;
    /* which face of the ring plane is the sun on vs the camera? */
    float sunSide = sign(dot(sunDir, poleDir));
    float camSide = sign(dot(normalize(cameraPosition - vPosW), poleDir));
    float lit = (sunSide == camSide) ? 1.0 : 0.55; /* backlit side dimmer */
    /* planet shadow: behind the globe relative to the sun */
    float along = dot(vPosW, sunDir);
    vec3 perp = vPosW - sunDir * along;
    float shadow = 1.0;
    if (along < 0.0) {
      shadow = 0.06 + 0.94 * smoothstep(0.98, 1.12, length(perp));
    }
    vec3 col = tex.rgb * (0.18 + 0.82 * lit * shadow);
    /* H14: inner rings drain first (ring rain), per the cited science */
    float eraFade = mix(eraRingMul * eraRingMul, eraRingMul, vUv.x);
    gl_FragColor = vec4(col, tex.a * eraFade);
  }
`;

/* ============================== helpers ============================== */

function toScene(v) { return new THREE.Vector3(v.x, v.z, -v.y); } // EQJ -> three

function bodyOrientation(body, time) {
  var ax = A.RotationAxis(body, time);
  var pole = toScene(ax.north).normalize();
  var zN = new THREE.Vector3(0, 1, 0); // ICRF north in scene coords
  var node = new THREE.Vector3().crossVectors(zN, pole);
  if (node.lengthSq() < 1e-12) node.set(1, 0, 0); else node.normalize();
  var q = new THREE.Quaternion().setFromAxisAngle(pole, ax.spin * D2R);
  var Xpm = node.clone().applyQuaternion(q).normalize();
  var basis = new THREE.Matrix4().makeBasis(Xpm, pole, new THREE.Vector3().crossVectors(Xpm, pole));
  return { pole: pole, Xpm: Xpm, Ypm: new THREE.Vector3().crossVectors(pole, Xpm), quat: new THREE.Quaternion().setFromRotationMatrix(basis) };
}

function sunDirOf(body, time) {
  // The Sun is self-luminous: its heliocentric vector is ~0 (normalize would
  // NaN). Its material is unlit (ambient=1) so this placeholder is unused.
  if (body === "Sun") return new THREE.Vector3(0, 1, 0);
  var hv = A.HelioVector(body, time);
  return toScene({ x: -hv.x, y: -hv.y, z: -hv.z }).normalize();
}

function moonPhaseName(angleDeg) { // 0=new, 90=first quarter, 180=full, 270=last
  var names = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
               "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
  return names[Math.round(angleDeg / 45) % 8];
}

function earthDirOf(body, time) { // planet -> Earth (scene)
  var gv = A.GeoVector(body, time, true);
  return toScene({ x: -gv.x, y: -gv.y, z: -gv.z }).normalize();
}

function geoDir(orient, latDeg, lonDeg) { // geographic point -> world direction
  var la = latDeg * D2R, lo = lonDeg * D2R, c = Math.cos(la);
  return orient.Xpm.clone().multiplyScalar(c * Math.cos(lo))
    .add(orient.Ypm.clone().multiplyScalar(c * Math.sin(lo)))
    .add(orient.pole.clone().multiplyScalar(Math.sin(la))).normalize();
}

function fmt(n, digits) { return n.toLocaleString("en-US", { maximumFractionDigits: digits == null ? 0 : digits }); }

/* ============================== dashboard ============================== */

var session = null;

export function openDashboard(name, opts) {
  if (session) closeDashboard();
  var cfg = PLANETS[name];
  if (!cfg) throw new Error("No dashboard config for " + name);
  session = new Dashboard(name, cfg, opts || {});
}

export function closeDashboard() {
  if (session) { session.dispose(); session = null; }
}

function Dashboard(name, cfg, opts) {
  var self = this;
  this.name = name; this.cfg = cfg; this.opts = opts;
  this.scaleMode = "enhanced"; // "enhanced" | "true"
  this.disposed = false;
  this.moons = [];
  this.rafId = null;
  this.timer = null;

  this.buildDom();
  this.buildRenderer();
  this.loadTextures().then(function (tex) {
    if (self.disposed) { Object.keys(tex).forEach(function (k) { tex[k].dispose(); }); return; }
    self.buildScene(tex);
    self.updateEphemeris();
    self.resetCamera();
    self.el.spinner.style.display = "none";
    self.timer = setInterval(function () { self.updateEphemeris(); self.updateStats(); }, 1000);
    self.loop();
  }).catch(function (err) {
    self.el.spinner.textContent = "Failed to load textures: " + err;
  });
}

/* ---------- DOM ---------- */

Dashboard.prototype.buildDom = function () {
  var self = this, cfg = this.cfg;
  if (!document.getElementById("pdb-style")) {
    var st = document.createElement("style");
    st.id = "pdb-style";
    st.textContent = [
      "#pdb{position:fixed;inset:0;z-index:40;background:#000;touch-action:none;}",
      "#pdb canvas{position:absolute;inset:0;width:100%;height:100%;}",
      ".pdb-top{position:absolute;top:env(safe-area-inset-top,0);left:0;right:0;display:flex;align-items:center;padding:10px 12px;z-index:3;}",
      ".pdb-title{font-size:17px;font-weight:700;color:#e6ebff;text-shadow:0 1px 6px #000;}",
      ".pdb-sub{font-size:11px;color:#8a93b2;margin-left:8px;}",
      ".pdb-close{margin-left:auto;width:38px;height:38px;border-radius:999px;border:1px solid #222c47;background:rgba(13,17,32,.85);color:#e6ebff;font-size:17px;font-weight:700;}",
      ".pdb-bot{position:absolute;left:0;right:0;bottom:env(safe-area-inset-bottom,0);padding:10px 14px 14px;z-index:3;background:linear-gradient(180deg,transparent,rgba(0,0,0,.72));}",
      ".pdb-timerow{display:flex;align-items:center;gap:10px;}",
      ".pdb-timerow input{flex:1;accent-color:#6ea8ff;}",
      ".pdb-now{padding:6px 14px;border-radius:999px;border:1px solid #222c47;background:rgba(13,17,32,.85);color:#6ea8ff;font-size:12px;font-weight:700;}",
      ".pdb-tlabel{text-align:center;font:600 12px 'SF Mono',ui-monospace,Menlo,monospace;color:#8a93b2;margin-bottom:6px;}",
      ".pdb-btnrow{display:flex;gap:8px;margin-top:8px;justify-content:center;}",
      ".pdb-chip{padding:6px 13px;border-radius:999px;border:1px solid #222c47;background:rgba(13,17,32,.85);color:#e6ebff;font-size:12px;font-weight:600;}",
      ".pdb-chip.on{border-color:#6ea8ff;color:#6ea8ff;}",
      ".pdb-info{position:absolute;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 118px);max-height:46vh;overflow-y:auto;z-index:3;background:rgba(13,17,32,.92);border:1px solid #222c47;border-radius:14px;padding:12px 14px;display:none;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}",
      ".pdb-info h3{margin:0 0 6px;font-size:13px;color:#6ea8ff;}",
      ".pdb-info p{margin:0 0 8px;font-size:12px;line-height:1.5;color:#c8d0e8;}",
      ".pdb-info table{width:100%;border-collapse:collapse;font-size:12px;}",
      ".pdb-info td{padding:3px 4px;border-bottom:1px solid rgba(255,255,255,.05);}",
      ".pdb-info td:first-child{color:#8a93b2;}",
      ".pdb-info td:last-child{text-align:right;font-family:'SF Mono',ui-monospace,Menlo,monospace;color:#e6ebff;}",
      ".pdb-credit{font-size:10px;color:#5c6480;margin-top:8px;line-height:1.4;}",
      ".pdb-spin{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#8a93b2;font-size:13px;z-index:2;background:#000;}",
      ".pdb-mlabel{position:absolute;z-index:2;font:600 10px -apple-system,sans-serif;color:#cfe0ff;text-shadow:0 1px 3px #000;pointer-events:none;transform:translate(-50%,-140%);white-space:nowrap;}",
      /* H14 Deep Time: amber/gold visual language, deliberately distinct from
         the blue SimClock time bar so the two are never confused */
      ".pdb-eras{position:absolute;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 118px);max-height:52vh;overflow-y:auto;-webkit-overflow-scrolling:touch;z-index:3;background:rgba(30,22,6,.94);border:1px solid #6b5416;border-radius:14px;padding:12px 14px;display:none;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}",
      ".pdb-eras h3{margin:0 0 4px;font-size:12px;color:#ffc94d;letter-spacing:1.2px;text-transform:uppercase;}",
      ".pdb-eras .disc{font-size:10px;color:#b39b5e;line-height:1.45;margin-bottom:10px;}",
      ".pdb-erastops{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;}",
      ".pdb-erastop{padding:7px 12px;border-radius:999px;border:1px solid #6b5416;background:rgba(60,44,12,.6);color:#f0deb0;font-size:12px;font-weight:600;}",
      ".pdb-erastop.now{border-color:#4fd08a;}",
      ".pdb-erastop.active{background:#8a6a1a;color:#fff;border-color:#ffc94d;}",
      ".pdb-erainfo{font-size:12px;line-height:1.55;color:#e8dcc0;}",
      ".pdb-erainfo .etime{color:#ffc94d;font-weight:700;}",
      ".pdb-conf{display:inline-block;font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;margin-left:6px;vertical-align:1px;}",
      ".pdb-conf.established{background:rgba(79,208,138,.2);color:#4fd08a;}",
      ".pdb-conf.projected{background:rgba(255,201,77,.2);color:#ffc94d;}",
      ".pdb-conf.speculative{background:rgba(255,107,107,.2);color:#ff6b6b;}",
      ".pdb-erasrc{font-size:10px;color:#b39b5e;margin-top:6px;line-height:1.45;}",
      ".pdb-erabadge{display:none;margin-left:8px;font-size:10px;font-weight:800;color:#ffc94d;background:rgba(255,201,77,.15);padding:3px 8px;border-radius:999px;vertical-align:2px;}"
    ].join("\n");
    document.head.appendChild(st);
  }

  var root = document.createElement("div");
  root.id = "pdb";
  root.innerHTML =
    '<div class="pdb-spin">Loading ' + this.name + "…</div>" +
    '<div class="pdb-top"><span class="pdb-title">' + cfg.glyph + " " + this.name + '</span>' +
    '<span class="pdb-erabadge"></span>' +
    '<span class="pdb-sub">live · drag to orbit · pinch to zoom</span>' +
    '<button class="pdb-close" aria-label="Close">✕</button></div>' +
    '<div class="pdb-bot">' +
    '<div class="pdb-tlabel"></div>' +
    '<div class="pdb-timerow"><input type="range" min="-7" max="7" step="0.01" value="0"><button class="pdb-now">Now</button></div>' +
    '<div class="pdb-btnrow"><button class="pdb-chip pdb-i">ⓘ Info</button>' +
    (cfg.moons && cfg.moons.length ? '<button class="pdb-chip pdb-scale">Spacing: enhanced</button>' : "") +
    (ERAS_BODIES[this.name] ? '<button class="pdb-chip pdb-erasbtn">⧖ Eras</button>' : "") +
    "</div></div>" +
    '<div class="pdb-info"></div>' +
    '<div class="pdb-eras"></div>';
  document.body.appendChild(root);

  this.el = {
    root: root,
    spinner: root.querySelector(".pdb-spin"),
    close: root.querySelector(".pdb-close"),
    slider: root.querySelector("input"),
    tlabel: root.querySelector(".pdb-tlabel"),
    now: root.querySelector(".pdb-now"),
    infoBtn: root.querySelector(".pdb-i"),
    scaleBtn: root.querySelector(".pdb-scale"),
    info: root.querySelector(".pdb-info"),
    erasBtn: root.querySelector(".pdb-erasbtn"),
    eras: root.querySelector(".pdb-eras"),
    eraBadge: root.querySelector(".pdb-erabadge")
  };
  if (this.el.erasBtn) this.el.erasBtn.addEventListener("click", function () { self.toggleEras(); });

  this.el.close.addEventListener("click", function () { closeDashboard(); });
  // slider = relative nudge of the global SimClock (±7 d per drag; recenters
  // on release so repeated drags can walk any distance)
  this.sliderPrev = 0;
  this.el.slider.addEventListener("input", function () {
    var v = parseFloat(self.el.slider.value);
    if (window.SimClock) window.SimClock.step((v - self.sliderPrev) * 86400000);
    self.sliderPrev = v;
    self.updateEphemeris(); self.updateStats();
  });
  function endDashScrub() { self.el.slider.value = "0"; self.sliderPrev = 0; }
  this.el.slider.addEventListener("change", endDashScrub);
  this.el.slider.addEventListener("pointerup", endDashScrub);
  this.el.now.addEventListener("click", function () {
    if (window.SimClock) window.SimClock.goLive();
    endDashScrub();
    self.updateEphemeris(); self.updateStats();
  });
  this.el.infoBtn.addEventListener("click", function () {
    var show = self.el.info.style.display !== "block";
    self.el.info.style.display = show ? "block" : "none";
    self.el.infoBtn.classList.toggle("on", show);
    if (show) { self.updateStats(); self.el.eras.style.display = "none"; }
  });
  if (this.el.scaleBtn) this.el.scaleBtn.addEventListener("click", function () {
    self.scaleMode = self.scaleMode === "enhanced" ? "true" : "enhanced";
    self.el.scaleBtn.textContent = "Spacing: " + (self.scaleMode === "enhanced" ? "enhanced" : "true scale");
    self.updateEphemeris();
  });
};

/* ---------- renderer / camera / controls ---------- */

Dashboard.prototype.buildRenderer = function () {
  var self = this;
  this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // perf cap (handoff §7)
  this.renderer.setSize(window.innerWidth, window.innerHeight);
  this.el.root.insertBefore(this.renderer.domElement, this.el.root.firstChild);

  this.camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 500);
  this.baseDist = this.cfg.camDist || 4.2;
  this.dist = this.baseDist;
  this.yaw = 0; this.pitch = 0;
  this.velYaw = 0; this.velPitch = 0;

  this.onResize = function () {
    self.renderer.setSize(window.innerWidth, window.innerHeight);
    self.camera.aspect = window.innerWidth / window.innerHeight;
    self.camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", this.onResize);

  this.onCtxLost = function (e) {
    e.preventDefault();
    self.el.spinner.style.display = "flex";
    self.el.spinner.textContent = "Graphics context lost — tap ✕ and reopen.";
  };
  this.renderer.domElement.addEventListener("webglcontextlost", this.onCtxLost);

  // --- custom orbit controls (drag orbit + momentum, pinch/wheel zoom,
  //     double-tap reset). Tailored for touch; avoids vendoring addons.
  //     H15 adds a raw-pixel tap classifier on top: a short, near-still
  //     touch is a TAP and hit-tests the moons; a real drag orbits as
  //     before (orbit math unchanged). ---
  // [H15 tap wiring DASH start]
  var elc = this.renderer.domElement;
  var drag = null, pinch = null, lastTap = 0, movedPx = 0, downAt = 0, lastTouchEnd = 0;
  function pt(e, i) { return (e.touches && e.touches[i || 0]) || (e.changedTouches && e.changedTouches[i || 0]) || e; }
  this.onDown = function (e) {
    if (!e.changedTouches && !e.touches && Date.now() - lastTouchEnd < 700) return; // synthetic mouse
    if (e.touches && e.touches.length === 2) {
      pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      drag = null; return;
    }
    var p = pt(e);
    drag = { x: p.clientX, y: p.clientY };
    movedPx = 0; downAt = Date.now();
    self.velYaw = self.velPitch = 0;
    var now = Date.now();
    if (now - lastTap < 320) self.resetView();
    lastTap = now;
  };
  this.onMove = function (e) {
    if (e.cancelable) e.preventDefault();
    if (e.touches && e.touches.length === 2 && pinch != null) {
      var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      self.dist = THREE.MathUtils.clamp(self.dist * (pinch / d), 1.6, 60);
      pinch = d; return;
    }
    if (!drag) return;
    var p = pt(e);
    movedPx += Math.abs(p.clientX - drag.x) + Math.abs(p.clientY - drag.y);
    var dx = (p.clientX - drag.x) / window.innerHeight * 2.6;
    var dy = (p.clientY - drag.y) / window.innerHeight * 2.6;
    self.yaw -= dx; self.pitch = THREE.MathUtils.clamp(self.pitch - dy, -1.45, 1.45);
    self.velYaw = -dx; self.velPitch = -dy;
    drag = { x: p.clientX, y: p.clientY };
  };
  this.onUp = function (e) {
    if (e && e.changedTouches) lastTouchEnd = Date.now();
    else if (Date.now() - lastTouchEnd < 700) { drag = null; pinch = null; return; }
    var T = window.RE_TAP || { PX: 10, MS: 300 };
    if (drag && e && movedPx < T.PX && (Date.now() - downAt) < T.MS) {
      var p = pt(e);
      if (p && p.clientX != null) self.tapMoon(p.clientX, p.clientY);
    }
    drag = null; pinch = null;
  };
  this.onCancel = function () { drag = null; pinch = null; };
  this.onWheel = function (e) {
    e.preventDefault();
    self.dist = THREE.MathUtils.clamp(self.dist * (e.deltaY > 0 ? 1.1 : 0.9), 1.6, 60);
  };
  elc.addEventListener("mousedown", this.onDown); elc.addEventListener("touchstart", this.onDown, { passive: true });
  window.addEventListener("mousemove", this.onMove); elc.addEventListener("touchmove", this.onMove, { passive: false });
  window.addEventListener("mouseup", this.onUp); elc.addEventListener("touchend", this.onUp);
  elc.addEventListener("touchcancel", this.onCancel);
  elc.addEventListener("wheel", this.onWheel, { passive: false });
  // [H15 tap wiring DASH end]
};

Dashboard.prototype.resetView = function () { this.yaw = 0; this.pitch = 0; this.dist = this.baseDist; this.velYaw = this.velPitch = 0; };

/* Home camera: the planet as seen from Earth (north up); Earth itself is
   seen from above the observer's GPS point. yaw/pitch orbit around that. */
Dashboard.prototype.resetCamera = function () {
  var time = this.time();
  if (this.name === "Earth") {
    var o = this.opts.observer;
    var orient = bodyOrientation("Earth", time);
    this.homeDir = (o && isFinite(o.latitude)) ? geoDir(orient, o.latitude, o.longitude)
      : sunDirOf("Earth", time).clone();
  } else {
    this.homeDir = earthDirOf(this.name, time);
  }
  this.resetView();
};

Dashboard.prototype.applyCamera = function () {
  var pole = this.orient ? this.orient.pole : new THREE.Vector3(0, 1, 0);
  // base frame: forward = -homeDir (looking at planet), up ~ planet north
  var back = this.homeDir.clone();
  var right = new THREE.Vector3().crossVectors(pole, back).normalize();
  if (right.lengthSq() < 1e-9) right.set(1, 0, 0);
  var up = new THREE.Vector3().crossVectors(back, right).normalize();
  var dir = back.clone().applyAxisAngle(up, this.yaw).applyAxisAngle(right, this.pitch);
  this.camera.position.copy(dir.multiplyScalar(this.dist));
  this.camera.up.copy(up);
  this.camera.lookAt(0, 0, 0);
};

/* ---------- textures / scene ---------- */

Dashboard.prototype.loadTextures = function () {
  var cfg = this.cfg;
  var loader = new THREE.TextureLoader();
  var jobs = {};
  /* NOTE: textures are deliberately NOT tagged SRGBColorSpace. Our custom
     ShaderMaterials write raw fragment colors (no colorspace_fragment chunk),
     so an sRGB-tagged texture would be linearized on sample but never
     re-encoded on output -> dark, oversaturated render. Sampling the sRGB
     bytes as-is and lighting in gamma space gives the classic, correct-looking
     result for this all-custom-shader scene. */
  function load(key, file) {
    jobs[key] = new Promise(function (res, rej) {
      loader.load(TEX + file, function (t) {
        t.anisotropy = 4;
        res(t);
      }, undefined, rej);
    });
  }
  load("map", cfg.map);
  if (cfg.nightMap) load("night", cfg.nightMap);
  if (cfg.cloudMap) load("cloud", cfg.cloudMap);
  if (cfg.rings) load("ring", cfg.rings.map);
  var moonMaps = {};
  (cfg.moons || []).forEach(function (m) { if (m.map) moonMaps[m.name] = m.map; });
  Object.keys(moonMaps).forEach(function (k) { load("moon_" + k, moonMaps[k]); });
  // generic tinted rock texture for moons without their own map
  if ((cfg.moons || []).some(function (m) { return !m.map; })) load("moonGeneric", "1k_moon.jpg");

  var keys = Object.keys(jobs);
  return Promise.all(keys.map(function (k) { return jobs[k]; })).then(function (vals) {
    var out = {};
    keys.forEach(function (k, i) { out[k] = vals[i]; });
    return out;
  });
};

Dashboard.prototype.buildScene = function (tex) {
  var cfg = this.cfg, self = this;
  this.tex = tex;
  this.scene = new THREE.Scene();
  this.sunDirU = { value: new THREE.Vector3(1, 0, 0) };
  this.poleU = { value: new THREE.Vector3(0, 1, 0) };

  // faint starfield backdrop
  (function () {
    var n = 900, pos = new Float32Array(n * 3);
    var seed = 42;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var i = 0; i < n; i++) {
      var u = rnd() * 2 - 1, ph = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pos[i * 3] = 120 * s * Math.cos(ph); pos[i * 3 + 1] = 120 * u; pos[i * 3 + 2] = 120 * s * Math.sin(ph);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    var m = new THREE.PointsMaterial({ color: 0x9aa7cc, size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0.75 });
    self.scene.add(new THREE.Points(g, m));
  })();

  // planet globe (radius 1 = equatorial; flattened on local Y)
  var defines = {};
  if (cfg.nightMap) defines.HAS_NIGHT = 1;
  if (cfg.rings) defines.HAS_RINGSHADOW = 1;
  this.eraRingU = { value: 1 }; // shared by ring material + globe ring shadow (H14)
  var uniforms = {
    map: { value: tex.map }, sunDir: this.sunDirU,
    ambient: { value: cfg.unlit ? 1.0 : 0.045 }, // unlit = self-luminous (Sun)
    limbDarken: { value: cfg.limbDarken || 0.0 }, tint: { value: new THREE.Vector3(1, 1, 1) },
    // H14 era uniforms at their no-op defaults
    eraTintColor: { value: new THREE.Vector3(1, 1, 1) }, eraTintMix: { value: 0 },
    eraWhite: { value: 0 }, eraOcean: { value: 0 }, eraDesat: { value: 0 }
  };
  if (cfg.nightMap) { uniforms.nightMap = { value: tex.night }; uniforms.eraNightMul = { value: 1 }; }
  if (cfg.rings) {
    uniforms.ringMap = { value: tex.ring };
    uniforms.poleDir = this.poleU;
    uniforms.ringInner = { value: cfg.rings.innerKm / cfg.radiusKm };
    uniforms.ringOuter = { value: cfg.rings.outerKm / cfg.radiusKm };
    uniforms.eraRingMul = this.eraRingU;
  }
  this.globeMat = new THREE.ShaderMaterial({ vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG, uniforms: uniforms, defines: defines });
  this.globe = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.globeMat);
  this.globe.scale.set(1, cfg.flat, 1);
  this.scene.add(this.globe);

  // atmosphere rim
  if (cfg.atmosphere) {
    var am = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT, fragmentShader: ATMO_FRAG,
      uniforms: { sunDir: this.sunDirU, glowColor: { value: new THREE.Vector3().fromArray(cfg.atmosphere.color) }, strength: { value: cfg.atmosphere.strength } },
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    var atmo = new THREE.Mesh(new THREE.SphereGeometry(1.035, 64, 48), am);
    atmo.scale.copy(this.globe.scale);
    this.scene.add(atmo);
    this.atmo = atmo; this.atmoMat = am; // era morphs adjust these (H14)
  }
  // present-day parameter baseline the era morphs return to (H14)
  this.eraDefaults = {
    atmoR: cfg.atmosphere ? cfg.atmosphere.color[0] : 0,
    atmoG: cfg.atmosphere ? cfg.atmosphere.color[1] : 0,
    atmoB: cfg.atmosphere ? cfg.atmosphere.color[2] : 0,
    atmoStr: cfg.atmosphere ? cfg.atmosphere.strength : 0,
    ambient: cfg.unlit ? 1.0 : 0.045
  };

  // Earth clouds
  if (cfg.cloudMap) {
    var cm = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT, fragmentShader: CLOUD_FRAG,
      uniforms: { map: { value: tex.cloud }, sunDir: this.sunDirU, eraCloudMul: { value: 1 } },
      transparent: true, depthWrite: false
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.008, 96, 64), cm);
    this.clouds.scale.copy(this.globe.scale);
    this.scene.add(this.clouds);
  }

  // Saturn rings (annulus with radial UV.x, in the planet's equator plane)
  if (cfg.rings) {
    var inner = cfg.rings.innerKm / cfg.radiusKm, outer = cfg.rings.outerKm / cfg.radiusKm;
    var rg = new THREE.RingGeometry(inner, outer, 192, 1);
    var p = rg.attributes.position, u = rg.attributes.uv;
    for (var i = 0; i < p.count; i++) { // rewrite planar UVs -> radial
      var r = Math.hypot(p.getX(i), p.getY(i));
      u.setXY(i, (r - inner) / (outer - inner), 0.5);
    }
    var rm = new THREE.ShaderMaterial({
      vertexShader: RING_VERT, fragmentShader: RING_FRAG,
      uniforms: { map: { value: tex.ring }, sunDir: this.sunDirU, poleDir: this.poleU, eraRingMul: this.eraRingU },
      side: THREE.DoubleSide, transparent: true, depthWrite: false
    });
    this.rings = new THREE.Mesh(rg, rm);
    this.rings.rotation.x = -Math.PI / 2; // ring plane -> local equator (XZ)
    this.ringPivot = new THREE.Group();   // gets the planet's orientation quat
    this.ringPivot.add(this.rings);
    this.scene.add(this.ringPivot);
  }

  // moons
  (cfg.moons || []).forEach(function (m) {
    var mtex = m.map ? tex["moon_" + m.name] : tex.moonGeneric;
    var mat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG,
      uniforms: { map: { value: mtex }, sunDir: self.sunDirU, ambient: { value: 0.06 }, limbDarken: { value: 0 }, tint: { value: new THREE.Vector3().fromArray(m.tint || [1, 1, 1]) } },
      defines: {}
    });
    var mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), mat);
    self.scene.add(mesh);
    var label = document.createElement("div");
    label.className = "pdb-mlabel";
    label.textContent = m.name + (m.approx ? " ≈" : "");
    self.el.root.appendChild(label);
    self.moons.push({ cfg: m, mesh: mesh, label: label });
  });
};

/* ---------- ephemeris-driven state ---------- */

/* H08: the dashboard reads the GLOBAL SimClock — no local time. Its slider
   below nudges the global clock, so AR/Space/time-bar all stay in sync. */
Dashboard.prototype.time = function () {
  return A.MakeTime(window.SimClock ? window.SimClock.now() : new Date());
};

Dashboard.prototype.updateEphemeris = function () {
  if (!this.scene) return;
  this.lastSimMs = window.SimClock ? window.SimClock.ms() : Date.now();
  var time = this.time(), cfg = this.cfg, self = this;

  this.orient = bodyOrientation(this.name, time);
  this.globe.quaternion.copy(this.orient.quat);
  if (this.clouds) this.clouds.quaternion.copy(this.orient.quat);
  if (this.ringPivot) this.ringPivot.quaternion.copy(this.orient.quat);
  this.poleU.value.copy(this.orient.pole);
  this.sunDirU.value.copy(sunDirOf(this.name, time));

  // moons
  var radiusAU = cfg.radiusKm / AU_KM;
  var enhanced = this.scaleMode === "enhanced";
  function place(distUnits, dirVec, moon) {
    var d = enhanced ? Math.pow(distUnits, 0.6) * 1.9 : distUnits;
    moon.mesh.position.copy(dirVec.normalize().multiplyScalar(d));
    var rr = moon.cfg.radiusKm / cfg.radiusKm;
    var s = enhanced ? Math.max(rr * 2.2, 0.05) : Math.max(rr, 0.004);
    moon.mesh.scale.setScalar(s);
  }
  var jm = null;
  this.moons.forEach(function (moon) {
    var m = moon.cfg;
    if (m.jm) { // exact: Galilean moons, jovicentric EQJ state vectors
      if (!jm) jm = A.JupiterMoons(time);
      var sv = jm[m.jm];
      var v = toScene(sv);
      place(v.length() / radiusAU, v, moon);
    } else if (m.geoMoon) { // exact: Earth's Moon, geocentric EQJ
      var gm = A.GeoMoon(time);
      var mv = toScene(gm);
      place(mv.length() / radiusAU, mv, moon);
      moon.mesh.quaternion.copy(bodyOrientation("Moon", time).quat); // tidally-locked face
    } else { // approximate: JPL mean elements, circular orbit in equator plane
      var days = time.tt; // days since J2000 epoch (2000-01-01.5 TT)
      var theta = (m.lon0 + 360 * (days / m.periodDays % 1)) * D2R;
      var n = self.orient.Xpm, y = self.orient.Ypm;
      var dir = n.clone().multiplyScalar(Math.cos(theta)).add(y.clone().multiplyScalar(Math.sin(theta)));
      place(m.aKm / cfg.radiusKm, dir, moon);
    }
  });

  this.updateTimeLabel();
};

Dashboard.prototype.updateTimeLabel = function () {
  var d = window.SimClock ? window.SimClock.now() : new Date();
  var tag = (!window.SimClock || window.SimClock.isLive()) ? "LIVE" :
    (window.SimClock.isPlaying() ? "SIM" : "PAUSED");
  this.el.tlabel.textContent = tag + " · " +
    d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

Dashboard.prototype.updateStats = function () {
  if (this.el.info.style.display !== "block") return;
  var time = this.time(), name = this.name, cfg = this.cfg;
  var rows = [];
  Object.keys(cfg.stats).forEach(function (k) { rows.push([k, cfg.stats[k]]); });
  var dEKm = 0;
  if (name !== "Earth") {
    var gv = A.GeoVector(name, time, true);
    var dE = Math.hypot(gv.x, gv.y, gv.z);
    dEKm = dE * AU_KM;
    rows.push(["Distance from Earth", fmt(dEKm) + " km (" + dE.toFixed(3) + " AU)"]);
    var lightSec = dEKm / 299792.458;
    rows.push(["Light travel time", lightSec < 60 ? lightSec.toFixed(1) + " s" : (lightSec / 60).toFixed(1) + " min"]);
    rows.push(["Angular size", (2 * Math.atan(cfg.radiusKm / dEKm) * R2D * 60).toFixed(1) + "′"]);
  }
  if (name !== "Sun") {
    var hv = A.HelioVector(name, time);
    var dS = Math.hypot(hv.x, hv.y, hv.z);
    rows.push(["Distance from Sun", fmt(dS * AU_KM) + " km (" + dS.toFixed(3) + " AU)"]);
  }
  if (name === "Moon") {
    var ph = A.MoonPhase(time);
    rows.push(["Phase", moonPhaseName(ph) + " (" + ph.toFixed(0) + "°)"]);
    rows.push(["Illuminated", (A.Illumination("Moon", time).phase_fraction * 100).toFixed(1) + "%"]);
  } else if (name === "Earth") {
    var gm = A.GeoMoon(time);
    rows.push(["Moon distance", fmt(Math.hypot(gm.x, gm.y, gm.z) * AU_KM) + " km"]);
    rows.push(["Moon illuminated", (A.Illumination("Moon", time).phase_fraction * 100).toFixed(1) + "%"]);
  } else if (name !== "Sun") {
    rows.push(["Illuminated", (A.Illumination(name, time).phase_fraction * 100).toFixed(1) + "%"]);
  }
  var moonNote = "";
  if (this.moons.length) {
    var exact = this.moons.filter(function (m) { return !m.cfg.approx; }).map(function (m) { return m.cfg.name; });
    var approx = this.moons.filter(function (m) { return m.cfg.approx; }).map(function (m) { return m.cfg.name; });
    if (exact.length) moonNote += "Moon positions — exact ephemeris: " + exact.join(", ") + ". ";
    if (approx.length) moonNote += "Approximate (≈): " + approx.join(", ") + " — circular orbits from JPL mean elements. ";
    moonNote += "Generic-rock moon texture, tinted (real per-moon maps are a later handoff).";
  }
  this.el.info.innerHTML = "<h3>" + cfg.glyph + " " + name + "</h3><p>" + cfg.desc + "</p>" +
    "<table>" + rows.map(function (r) { return "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>"; }).join("") + "</table>" +
    (moonNote ? '<p class="pdb-credit">' + moonNote + "</p>" : "") +
    '<div class="pdb-credit">' + CREDIT + "</div>";
};

/* ---------- clickable moons (H15) ----------
   Facts from NASA planetary/moon fact sheets (diameter, orbital period,
   mean orbital distance) — nssdc.gsfc.nasa.gov planetary fact sheets and
   NASA moon pages. Earth's Moon opens its full dashboard instead. */
var MOON_FACTS = {
  Io:       { d: "3,643 km", p: "1.77 days",  a: "421,700 km",   fact: "The most volcanically active world in the Solar System — hundreds of volcanoes, some erupting dozens of km high, powered by Jupiter's relentless tidal squeezing." },
  Europa:   { d: "3,122 km", p: "3.55 days",  a: "671,100 km",   fact: "Beneath its cracked ice shell lies a global salt-water ocean likely holding more water than all of Earth's oceans — a prime target in the search for life and the destination of NASA's Europa Clipper." },
  Ganymede: { d: "5,268 km", p: "7.15 days",  a: "1,070,400 km", fact: "The largest moon in the Solar System — bigger than the planet Mercury — and the only moon known to generate its own magnetic field." },
  Callisto: { d: "4,821 km", p: "16.7 days",  a: "1,882,700 km", fact: "One of the most heavily cratered bodies known; its ancient icy surface has barely changed in about four billion years." },
  Titan:    { d: "5,150 km", p: "15.9 days",  a: "1,221,900 km", fact: "The only moon with a thick atmosphere: an orange nitrogen–methane haze over rivers, lakes and seas of liquid methane. Visited by Huygens (2005); NASA's Dragonfly rotorcraft is next." },
  Rhea:     { d: "1,528 km", p: "4.52 days",  a: "527,100 km",   fact: "Saturn's second-largest moon — a heavily cratered, dirty snowball made mostly of water ice." },
  Dione:    { d: "1,123 km", p: "2.74 days",  a: "377,400 km",   fact: "An icy moon streaked with bright 'wispy terrain' — the exposed faces of towering ice cliffs." },
  Tethys:   { d: "1,062 km", p: "1.89 days",  a: "294,700 km",   fact: "Almost pure water ice, scarred by the giant impact crater Odysseus — about two-fifths of the moon's own diameter." },
  Phobos:   { d: "~22 km",   p: "7.7 hours",  a: "9,376 km",     fact: "Orbits Mars faster than Mars rotates, and is spiraling slowly inward — in roughly 50 million years it will crash into Mars or be torn into a ring." },
  Deimos:   { d: "~12 km",   p: "30.3 hours", a: "23,460 km",    fact: "A tiny, smooth, dust-blanketed moon; from the Martian surface it would look like little more than a bright star." }
};

/* Hit-test the rendered moons at their CURRENT projected positions.
   Target radius = projected moon radius + margin, minimum 30 px. */
Dashboard.prototype.tapMoon = function (x, y) {
  if (window.RE_cardOpen && window.RE_cardOpen()) return; // card swallows taps
  if (!this.moons || !this.moons.length || !this.scene) return;
  var v = new THREE.Vector3(), w = window.innerWidth, h = window.innerHeight;
  var best = null, bd = 1e9;
  for (var i = 0; i < this.moons.length; i++) {
    var m = this.moons[i];
    v.copy(m.mesh.position).project(this.camera);
    if (v.z > 1) continue;
    var sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
    var dCam = this.camera.position.distanceTo(m.mesh.position);
    var rPx = dCam > 0 ? (m.mesh.scale.x / (Math.tan(this.camera.fov * D2R / 2) * dCam)) * (h / 2) : 0;
    var hitR = Math.max(30, rPx + 10);
    var d = Math.hypot(sx - x, sy - y);
    if (d < hitR && d < bd) { bd = d; best = m; }
  }
  if (best) this.showMoonCard(best);
};

Dashboard.prototype.showMoonCard = function (m) {
  var name = m.cfg.name;
  if (name === "Moon" && window.RE_openDashboard) { window.RE_openDashboard("Moon"); return; }
  var f = MOON_FACTS[name];
  if (!f || !window.RE_showCard) return;
  var tint = m.cfg.tint || [1, 1, 1];
  var rgb = "rgb(" + tint.map(function (x) { return Math.round(x * 230); }).join(",") + ")";
  window.RE_showCard({
    glyphColor: rgb,
    title: name,
    subtitle: "moon of " + this.name + (m.cfg.approx ? " · position approximate (mean elements)" : " · position exact (live ephemeris)"),
    rows: [
      ["Diameter", f.d],
      ["Orbital period", f.p],
      ["Mean distance from " + this.name, f.a]
    ],
    desc: f.fact,
    credit: "Facts: NASA planetary/moon fact sheets · Rendered with a generic tinted surface (real per-moon maps are a later handoff)"
  });
};

/* ---------- Deep Time / Eras (H14) ---------- */

Dashboard.prototype.toggleEras = function () {
  var self = this;
  var show = this.el.eras.style.display !== "block";
  this.el.eras.style.display = show ? "block" : "none";
  if (show) this.el.info.style.display = "none"; // one bottom panel at a time
  if (!show) return;
  loadDeepTime().then(function (dt) {
    if (self.disposed) return;
    self.eraList = dt.bodies[self.name] || [];
    self.eraDisclaimer = dt.meta.disclaimer;
    self.renderEras();
  }).catch(function (e) {
    self.el.eras.innerHTML = "<h3>Deep Time</h3><div class='disc'>failed to load era data: " + e + "</div>";
  });
};

Dashboard.prototype.renderEras = function () {
  var self = this;
  var active = this.activeEra;
  var h = "<h3>⧖ Deep Time — " + this.name + "</h3>" +
    '<div class="disc">Scientific reconstruction / projection — separate from the live ephemeris clock. Visuals are artist\'s impressions guided by the cited sources.</div>' +
    '<div class="pdb-erastops">' +
    this.eraList.map(function (ep, i) {
      var cls = "pdb-erastop" + (ep.now ? " now" : "") +
        ((active ? active.id === ep.id : ep.now) ? " active" : "");
      return '<button class="' + cls + '" data-era="' + i + '">' + (ep.now ? "⦿ " : "") + ep.name + "</button>";
    }).join("") +
    "</div><div class='pdb-erainfo'></div>";
  this.el.eras.innerHTML = h;
  Array.prototype.forEach.call(this.el.eras.querySelectorAll(".pdb-erastop"), function (btn) {
    btn.addEventListener("click", function () {
      self.applyEra(self.eraList[parseInt(btn.getAttribute("data-era"), 10)]);
      self.renderEras();
    });
  });
  var cur = active || this.eraList.filter(function (e) { return e.now; })[0];
  if (cur) {
    this.el.eras.querySelector(".pdb-erainfo").innerHTML =
      "<b>" + cur.name + "</b>" +
      '<span class="pdb-conf ' + cur.confidence.toLowerCase() + '">' + cur.confidence + "</span><br>" +
      '<span class="etime">' + cur.time + "</span><br>" + cur.desc +
      '<div class="pdb-erasrc">Source: ' + cur.source + "</div>";
  }
};

Dashboard.prototype.applyEra = function (ep) {
  var d = this.eraDefaults || { atmoR: 0, atmoG: 0, atmoB: 0, atmoStr: 0, ambient: 0.045 };
  var p = ep.params || {};
  this.eraTgt = {
    tintR: p.tintColor ? p.tintColor[0] : 1, tintG: p.tintColor ? p.tintColor[1] : 1, tintB: p.tintColor ? p.tintColor[2] : 1,
    tintMix: p.tintMix || 0, white: p.white || 0, ocean: p.ocean || 0, desat: p.desat || 0,
    night: p.night != null ? p.night : 1, ringMul: p.ringMul != null ? p.ringMul : 1,
    cloudMul: p.cloud != null ? p.cloud : 1, scale: p.scale || 1, camMul: p.camMul || 1,
    atmoR: p.atmoColor ? p.atmoColor[0] : d.atmoR, atmoG: p.atmoColor ? p.atmoColor[1] : d.atmoG,
    atmoB: p.atmoColor ? p.atmoColor[2] : d.atmoB,
    atmoStr: p.atmoStrength != null ? p.atmoStrength : d.atmoStr,
    ambient: p.ambient != null ? p.ambient : d.ambient
  };
  if (!this.eraCur) { // first use: start from present-day neutral
    this.eraCur = {
      tintR: 1, tintG: 1, tintB: 1, tintMix: 0, white: 0, ocean: 0, desat: 0,
      night: 1, ringMul: 1, cloudMul: 1, scale: 1, camMul: 1,
      atmoR: d.atmoR, atmoG: d.atmoG, atmoB: d.atmoB, atmoStr: d.atmoStr, ambient: d.ambient
    };
  }
  this.activeEra = ep;
  // wet-Mars clouds: build a cloud layer lazily from the vendored Earth cloud map
  if (this.eraTgt.cloudMul > 0.01 && !this.clouds && !this.cfg.cloudMap && !ep.now) this.buildEraClouds();
  var isNow = !!ep.now;
  this.el.eraBadge.style.display = isNow ? "none" : "inline-block";
  this.el.eraBadge.textContent = "⧖ " + ep.name.toUpperCase() + " · reconstruction";
  if (this.el.erasBtn) this.el.erasBtn.classList.toggle("on", !isNow);
};

Dashboard.prototype.buildEraClouds = function () {
  var self = this;
  if (this._eraCloudsLoading) return;
  this._eraCloudsLoading = true;
  new THREE.TextureLoader().load(TEX + "2k_earth_clouds.jpg", function (t) {
    if (self.disposed) { t.dispose(); return; }
    t.anisotropy = 4;
    var cm = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT, fragmentShader: CLOUD_FRAG,
      uniforms: { map: { value: t }, sunDir: self.sunDirU, eraCloudMul: { value: 0 } },
      transparent: true, depthWrite: false
    });
    self.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.008, 96, 64), cm);
    self.clouds.scale.copy(self.globe.scale);
    self.clouds.quaternion.copy(self.globe.quaternion);
    self.scene.add(self.clouds);
  });
};

/* Eased per-frame morph toward the selected era's parameters. Runs only
   after Eras has been used at least once — zero overhead otherwise. */
Dashboard.prototype.eraStep = function () {
  var c = this.eraCur, t = this.eraTgt, k;
  for (k in t) c[k] += (t[k] - c[k]) * 0.08;
  var u = this.globeMat.uniforms;
  u.eraTintColor.value.set(c.tintR, c.tintG, c.tintB);
  u.eraTintMix.value = c.tintMix;
  u.eraWhite.value = c.white;
  u.eraOcean.value = c.ocean;
  u.eraDesat.value = c.desat;
  u.ambient.value = c.ambient;
  if (u.eraNightMul) u.eraNightMul.value = c.night;
  this.eraRingU.value = c.ringMul;
  if (this.clouds && this.clouds.material.uniforms.eraCloudMul) {
    this.clouds.material.uniforms.eraCloudMul.value = c.cloudMul;
  }
  if (this.atmoMat) {
    this.atmoMat.uniforms.glowColor.value.set(c.atmoR, c.atmoG, c.atmoB);
    this.atmoMat.uniforms.strength.value = c.atmoStr;
  }
  var s = c.scale, flat = this.cfg.flat;
  this.globe.scale.set(s, flat * s, s);
  if (this.atmo) this.atmo.scale.set(s, flat * s, s);
  if (this.clouds) this.clouds.scale.set(s, flat * s, s);
  var newBase = (this.cfg.camDist || 4.2) * c.camMul;
  if (Math.abs(newBase - this.baseDist) > 1e-4) {
    this.dist *= newBase / this.baseDist; // preserve the user's zoom ratio
    this.baseDist = newBase;
  }
};

/* ---------- frame loop ---------- */

Dashboard.prototype.loop = function () {
  var self = this;
  function frame() {
    if (self.disposed) return;
    self.rafId = requestAnimationFrame(frame);
    if (document.hidden) return; // pause when tab hidden
    // H08: fast playback -> recompute rotation/lighting/moons per frame
    if (window.SimClock && Math.abs(window.SimClock.ms() - (self.lastSimMs || 0)) > 15000) {
      self.updateEphemeris();
    }
    // H14: eased Deep Time morph (only after Eras has been used)
    if (self.eraCur) self.eraStep();
    // drag momentum
    if (Math.abs(self.velYaw) > 1e-4 || Math.abs(self.velPitch) > 1e-4) {
      self.yaw += self.velYaw; self.pitch = THREE.MathUtils.clamp(self.pitch + self.velPitch, -1.45, 1.45);
      self.velYaw *= 0.93; self.velPitch *= 0.93;
    }
    if (self.clouds) self.clouds.rotation.y += 0.000045; // cosmetic slow drift
    self.applyCamera();
    // moon labels track their meshes
    var w = window.innerWidth, h = window.innerHeight;
    var v = new THREE.Vector3();
    self.moons.forEach(function (moon) {
      v.copy(moon.mesh.position).project(self.camera);
      var vis = v.z < 1 && v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.05;
      moon.label.style.display = vis ? "block" : "none";
      if (vis) {
        moon.label.style.left = ((v.x + 1) / 2 * w) + "px";
        moon.label.style.top = ((1 - v.y) / 2 * h) + "px";
      }
    });
    self.renderer.render(self.scene, self.camera);
  }
  frame();
};

/* ---------- teardown ---------- */

Dashboard.prototype.dispose = function () {
  var self = this;
  this.disposed = true;
  if (this.rafId) cancelAnimationFrame(this.rafId);
  if (this.timer) clearInterval(this.timer);
  window.removeEventListener("resize", this.onResize);
  window.removeEventListener("mousemove", this.onMove);
  window.removeEventListener("mouseup", this.onUp);
  if (this.scene) {
    this.scene.traverse(function (obj) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(function (mm) {
          Object.keys(mm.uniforms || {}).forEach(function (k) {
            var u = mm.uniforms[k];
            if (u.value && u.value.isTexture) u.value.dispose();
          });
          if (mm.map && mm.map.isTexture) mm.map.dispose();
          mm.dispose();
        });
      }
    });
  }
  if (this.tex) Object.keys(this.tex).forEach(function (k) { self.tex[k].dispose(); });
  if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss && this.renderer.forceContextLoss(); }
  if (this.el && this.el.root && this.el.root.parentNode) this.el.root.parentNode.removeChild(this.el.root);
  if (this.opts.onClose) try { this.opts.onClose(); } catch (e) {}
};

/* Debug hooks for headless verification (mirrors the AR page's RE.*) */
export var _debug = {
  session: function () { return session; },
  sunDir: function () { return session && session.sunDirU.value.toArray(); },
  pole: function () { return session && session.poleU.value.toArray(); },
  moonPositions: function () {
    return session && session.moons.map(function (m) { return { name: m.cfg.name, p: m.mesh.position.toArray() }; });
  },
  setOffset: function (d) { // now nudges the GLOBAL clock (H08)
    if (window.SimClock) window.SimClock.step(d * 86400000);
    if (session) session.updateEphemeris();
  },
  applyEraById: function (id) { // H14 test hook
    if (!session) return Promise.resolve(false);
    return loadDeepTime().then(function (dt) {
      var ep = (dt.bodies[session.name] || []).filter(function (e) { return e.id === id; })[0];
      if (ep) session.applyEra(ep);
      return !!ep;
    });
  },
  eraState: function () {
    if (!session || !session.eraCur) return null;
    return { active: session.activeEra && session.activeEra.id,
             cur: JSON.parse(JSON.stringify(session.eraCur)),
             tgt: JSON.parse(JSON.stringify(session.eraTgt)) };
  }
};
