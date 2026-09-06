/* Reality Engine · Phase 1 — Immersive Space Mode (Handoff 06)
 *
 * Camera-free mode: a rendered cosmos in the shared J2000 equatorial frame
 * (EQJ -> three mapping (x, z, -y), identical to the H04 dashboards).
 *
 * Layers, near to far:
 *   planets (r=1200, ephemeris sprites) < DSO photos (r=1500) <
 *   constellation lines (r=1800) < Milky Way sky sphere (r=2000).
 *   3D star positions use REAL parsec distances (1 pc = 1 unit, capped 700)
 *   so future free-flight gets genuine parallax; point sizes are screen-
 *   space from apparent magnitude, so the fixed-viewpoint view is correct.
 *
 * Sky texture: Solar System Scope "Milky Way starmap" (CC BY 4.0), 8K
 * source downscaled to 4K. The texture is in GALACTIC coordinates —
 * verified by pixel forensics: the bright bulge sits at image center
 * (l=0,b=0) with the band horizontal, and the LMC/SMC blobs match
 * u = 0.5 - l/360 (astronomical inside-view convention), v_img = (90-b)/180.
 * The sky sphere below is generated directly in that parameterization and
 * every vertex is rotated galactic->EQJ with Astronomy.Rotation_GAL_EQJ,
 * so the map, HYG stars, DSOs, lines, and planets share one frame.
 *
 * Star color: B-V -> RGB via the classic piecewise approximation
 * (bv2rgb, widely circulated; cf. stackoverflow #21977786). Bloom:
 * three.js UnrealBloomPass (vendored r185 addons), half-resolution,
 * auto-degrades to direct rendering if frame time exceeds budget.
 */

import * as THREE from "three";
import { EffectComposer } from "../lib/postprocessing/EffectComposer.js";
import { RenderPass } from "../lib/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../lib/postprocessing/UnrealBloomPass.js";

var A = window.Astronomy;
var D2R = Math.PI / 180, R2D = 180 / Math.PI;

var R_PLANET = 1200, R_DSO = 1500, R_LINES = 1800, R_SKY = 2000;
var STAR_DIST_CAP = 700;          // pc; unknown HYG distances land here too
var DSO_MIN_APPARENT_DEG = 1.6;   // visibility floor; real size kept in table
/* Tuned in-browser (H06 verification): threshold must sit ABOVE the sky
   map's diffuse band luminance or the wide mip blur accumulates the whole
   Milky Way into a global white haze (observed at threshold 0.12). At 0.45
   only star cores / planet glows / DSO highlights bloom. */
var BLOOM = { strength: 0.55, radius: 0.3, threshold: 0.45 };
var FRAME_BUDGET_MS = 24;         // avg frame above this -> drop bloom

/* Fly-to transition tuning (H07 Fix B). One cubic ease-in-out drives BOTH
   the orientation slerp and the FOV zoom, so motion starts and ends with
   zero velocity. The sprite->textured-globe swap at the dashboard seam is
   hidden behind a short fade to black (a glow sprite cannot visually morph
   into the H04 globe, so the seam is faded, not popped); the same fade runs
   in reverse when the dashboard closes back into Space Mode. */
var FLY = {
  durMs: 1250,      // main fly-to duration (handoff: keep ~1.0-1.4 s)
  fovPlanet: 12,    // end FOV when flying to a dashboard planet
  peekFov: 30,      // end FOV for the Sun/Moon/inner-planet peek
  peekHoldMs: 350,  // rest at the peek before easing back out
  returnMs: 700,    // eased FOV return leg of the peek
  fadeMs: 260       // fade through black at the dashboard seam
};
/* Free-flight tuning (H10). Scene units are PARSECS (star positions use real
   HYG distances), so flight is simply a translating camera. Speed slider is
   log-scale minLyS..maxLyS; effective speed eases down near stars (adaptive)
   so arrivals stay controllable. Fly-to-star is a single eased path segment
   ending arriveDistPc short of the star — no overshoot by construction. The
   close-up orb is STYLIZED (orbRadiusPc): true stellar radii aren't in the
   catalog, and the card says so. Position clamps at maxRangePc ("edge of
   charted stars" — HYG bubble is capped at 700 pc). DSO billboards dissolve
   between dsoFadeStart..dsoFadeEnd world units so you can never fly into a
   flat image; the Milky Way sphere + constellation lines follow the camera
   as directional backdrops (the galaxy dwarfs our 700 pc bubble). */
var FLIGHT = {
  minLyS: 0.01, maxLyS: 100,
  pcPerLy: 0.306601,
  arriveDistPc: 0.15,
  orbRadiusPc: 0.03,
  maxRangePc: 800,
  planetFadePc: 30,
  dsoFadeStart: 1000, dsoFadeEnd: 750,
  nearEasePc: 1.5, nearEaseFloor: 0.2
};

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
/* True spherical interpolation between unit direction vectors (constant
   angular velocity; Vector3.lerp+normalize speeds up mid-arc on long moves). */
function slerpDir(a, b, t) {
  var angle = a.angleTo(b);
  if (angle < 1e-5) return b.clone();
  var axis = new THREE.Vector3().crossVectors(a, b);
  if (axis.lengthSq() < 1e-10) axis.set(0, 1, 0); // antipodal: any axis works
  axis.normalize();
  return a.clone().applyAxisAngle(axis, angle * t).normalize();
}

/* Curated deep-sky set (H06: 16, H17: +20 = 36). ra (hours, J2000),
   dec (deg), sizeArcmin = real angular size (largest dimension). Files
   under textures/dso/, ≤1K, from Wikimedia Commons — licenses verified
   via the Commons API; credits recorded here and in textures/dso/README.md.
   Detail-card facts (type/con/distLy/mag/desc) sourced from the SEDS
   Messier database, NASA object pages, and Wikipedia infoboxes (src field);
   distances rounded to commonly cited values, not invented. mag: null =
   dark nebula (no meaningful integrated magnitude). */
var DSO_SRC = "NASA / SEDS Messier database / Wikipedia";
var DSOS = [
  { id: "m42",   name: "Orion Nebula (M42)",      ra: 5.5903,  dec: -5.45,   sizeArcmin: 65,  credit: "NASA/ESA/M. Robberto (STScI) — Public domain",
    type: "Emission nebula (H II region)", con: "Orion", distLy: "~1,300 ly", mag: 4.0, src: DSO_SRC,
    desc: "The nearest massive star-forming region to Earth, visible to the naked eye as the middle 'star' of Orion's Sword. The young Trapezium cluster at its heart lights up the surrounding gas." },
  { id: "m31",   name: "Andromeda Galaxy (M31)",  ra: 0.7123,  dec: 41.269,  sizeArcmin: 178, credit: "Adam Evans — CC BY 2.0",
    type: "Spiral galaxy", con: "Andromeda", distLy: "~2.5 million ly", mag: 3.4, src: DSO_SRC,
    desc: "The nearest large galaxy and the biggest member of our Local Group, holding roughly a trillion stars. It is approaching the Milky Way and the two will merge in about 4–5 billion years." },
  { id: "m45",   name: "Pleiades (M45)",          ra: 3.7833,  dec: 24.117,  sizeArcmin: 110, credit: "NASA/ESA/AURA/Caltech — Public domain",
    type: "Open star cluster", con: "Taurus", distLy: "~440 ly", mag: 1.6, src: DSO_SRC,
    desc: "The Seven Sisters: a young cluster of hot blue stars about 100 million years old, currently drifting through a dusty cloud that reflects their light. One of the closest clusters to Earth." },
  { id: "m51",   name: "Whirlpool Galaxy (M51)",  ra: 13.498,  dec: 47.195,  sizeArcmin: 11,  credit: "NASA/ESA — Public domain",
    type: "Spiral galaxy", con: "Canes Venatici", distLy: "~23 million ly", mag: 8.4, src: DSO_SRC,
    desc: "The first galaxy in which spiral structure was recognized (Lord Rosse, 1845). It is gravitationally interacting with its small yellow companion, NGC 5195, which distorts its arms." },
  { id: "m57",   name: "Ring Nebula (M57)",       ra: 18.8933, dec: 33.033,  sizeArcmin: 1.4, credit: "Hubble Heritage (AURA/STScI/NASA) — Public domain",
    type: "Planetary nebula", con: "Lyra", distLy: "~2,300 ly", mag: 8.8, src: DSO_SRC,
    desc: "A glowing shell of gas cast off by a dying Sun-like star. The faint white dwarf left behind sits at its center — a preview of our own Sun's fate in several billion years." },
  { id: "m16",   name: "Eagle Nebula (M16)",      ra: 18.3133, dec: -13.783, sizeArcmin: 30,  credit: "ESO — CC BY 4.0",
    type: "Emission nebula + open cluster", con: "Serpens", distLy: "~7,000 ly", mag: 6.0, src: DSO_SRC,
    desc: "A young star factory made famous by Hubble's 'Pillars of Creation' — towering columns of cold gas and dust being sculpted and evaporated by the radiation of newborn stars." },
  { id: "m104",  name: "Sombrero Galaxy (M104)",  ra: 12.6667, dec: -11.617, sizeArcmin: 9,   credit: "NASA/ESA/Hubble Heritage — Public domain",
    type: "Spiral galaxy (edge-on)", con: "Virgo", distLy: "~30 million ly", mag: 8.0, src: DSO_SRC,
    desc: "A nearly edge-on spiral with a brilliant bulge and a dramatic dust lane, resembling a wide-brimmed hat. A supermassive black hole of about a billion solar masses sits at its core." },
  { id: "m8",    name: "Lagoon Nebula (M8)",      ra: 18.0633, dec: -24.383, sizeArcmin: 90,  credit: "ESO/VPHAS+ team — CC BY 4.0",
    type: "Emission nebula", con: "Sagittarius", distLy: "~4,100 ly", mag: 6.0, src: DSO_SRC,
    desc: "A giant stellar nursery toward the galactic center, faintly visible to the naked eye from dark skies. Its bright core region is nicknamed the Hourglass Nebula." },
  { id: "m20",   name: "Trifid Nebula (M20)",     ra: 18.0383, dec: -23.033, sizeArcmin: 28,  credit: "Public domain (via Wikimedia Commons)",
    type: "Emission + reflection nebula", con: "Sagittarius", distLy: "~5,200 ly", mag: 6.3, src: DSO_SRC,
    desc: "A rare three-in-one: red glowing hydrogen, blue starlight-reflecting dust, and dark lanes that split it into the three lobes that give it its name." },
  { id: "m33",   name: "Triangulum Galaxy (M33)", ra: 1.5639,  dec: 30.66,   sizeArcmin: 71,  credit: "ESO — CC BY 4.0",
    type: "Spiral galaxy", con: "Triangulum", distLy: "~2.7 million ly", mag: 5.7, src: DSO_SRC,
    desc: "The third-largest galaxy of the Local Group after Andromeda and the Milky Way, seen nearly face-on. Under exceptionally dark skies it is one of the most distant objects visible to the naked eye." },
  { id: "helix", name: "Helix Nebula (NGC 7293)", ra: 22.4933, dec: -20.837, sizeArcmin: 25,  credit: "NASA/ESA/C.R. O'Dell (Vanderbilt) — Public domain",
    type: "Planetary nebula", con: "Aquarius", distLy: "~650 ly", mag: 7.6, src: DSO_SRC,
    desc: "One of the closest planetary nebulae to Earth, nicknamed the 'Eye of God' — the cast-off outer atmosphere of a Sun-like star, spanning about a light-year." },
  { id: "m1",    name: "Crab Nebula (M1)",        ra: 5.575,   dec: 22.017,  sizeArcmin: 7,   credit: "NASA/ESA/J. Hester & A. Loll (ASU) — Public domain",
    type: "Supernova remnant", con: "Taurus", distLy: "~6,500 ly", mag: 8.4, src: DSO_SRC,
    desc: "The wreckage of a supernova that Chinese astronomers recorded in 1054 AD, bright enough then to be seen in daylight. A pulsar spinning about 30 times per second powers its glow." },
  { id: "m13",   name: "Hercules Cluster (M13)",  ra: 16.695,  dec: 36.467,  sizeArcmin: 20,  credit: "Sid Leach/Adam Block/Mt. Lemmon SkyCenter — CC BY-SA 4.0",
    type: "Globular cluster", con: "Hercules", distLy: "~23,000 ly", mag: 5.8, src: DSO_SRC,
    desc: "A spherical swarm of several hundred thousand ancient stars orbiting the Milky Way's halo. In 1974 it was the target of the Arecibo radio message to hypothetical extraterrestrials." },
  { id: "m27",   name: "Dumbbell Nebula (M27)",   ra: 19.9933, dec: 22.717,  sizeArcmin: 8,   credit: "ESO — CC BY 4.0",
    type: "Planetary nebula", con: "Vulpecula", distLy: "~1,300 ly", mag: 7.5, src: DSO_SRC,
    desc: "The first planetary nebula ever discovered (Charles Messier, 1764) and one of the easiest to spot in small telescopes — an expanding double-lobed shell of gas from a dying star." },
  { id: "carina",name: "Carina Nebula",           ra: 10.7517, dec: -59.867, sizeArcmin: 120, credit: "ESO — CC BY 4.0",
    type: "Emission nebula", con: "Carina", distLy: "~7,500 ly", mag: 1.0, src: DSO_SRC,
    desc: "One of the largest star-forming regions in the galaxy — bigger and brighter than Orion, though only visible from southern skies. Home to Eta Carinae, an unstable supergiant that may go supernova." },
  { id: "m17",   name: "Omega Nebula (M17)",      ra: 18.3467, dec: -16.183, sizeArcmin: 11,  credit: "NASA/ESA/J. Hester (ASU) — Public domain",
    type: "Emission nebula", con: "Sagittarius", distLy: "~5,500 ly", mag: 6.0, src: DSO_SRC,
    desc: "Also called the Swan Nebula for its checkmark shape, this is one of the most massive and luminous star-forming regions in the Milky Way." },
  /* ---- H17 additions (20): images license-verified via the Commons API,
     credits also in textures/dso/README.md. Data entries only — rendered
     and hit-tested by the existing, unchanged systems. ---- */
  { id: "m44",   name: "Beehive Cluster (M44)",   ra: 8.6733,  dec: 19.98,   sizeArcmin: 95,  credit: "Chuck Ayoub — CC0",
    type: "Open star cluster", con: "Cancer", distLy: "~580 ly", mag: 3.7, src: DSO_SRC,
    desc: "Known since antiquity as Praesepe, the Manger — a naked-eye smudge that Galileo's first telescope resolved into stars. One of the nearest open clusters, about 600 million years old." },
  { id: "hyades", name: "Hyades",                 ra: 4.47,    dec: 15.87,   sizeArcmin: 330, credit: "NASA/ESA/STScI — CC BY-SA 4.0",
    type: "Open star cluster", con: "Taurus", distLy: "~150 ly", mag: 0.5, src: DSO_SRC,
    desc: "The nearest open cluster to Earth, forming the V-shaped face of Taurus the Bull. Bright orange Aldebaran appears to belong to it but is actually a foreground star at less than half the distance." },
  { id: "doublecl", name: "Double Cluster (NGC 869/884)", ra: 2.3367, dec: 57.13, sizeArcmin: 60, credit: "Genuson — CC BY-SA 3.0",
    type: "Open star clusters (pair)", con: "Perseus", distLy: "~7,500 ly", mag: 3.7, src: DSO_SRC,
    desc: "Two rich young clusters side by side, each with hundreds of hot blue supergiants — a showpiece of binocular astronomy known since Hipparchus catalogued it around 130 BC." },
  { id: "m81",   name: "Bode's Galaxy (M81)",     ra: 9.9267,  dec: 69.065,  sizeArcmin: 27,  credit: "NASA/ESA/Hubble Heritage — Public domain",
    type: "Spiral galaxy", con: "Ursa Major", distLy: "~12 million ly", mag: 6.9, src: DSO_SRC,
    desc: "A grand-design spiral and the heart of the nearest galaxy group beyond our own Local Group. It is locked in a gravitational tug-of-war with its neighbor, the Cigar Galaxy (M82)." },
  { id: "m82",   name: "Cigar Galaxy (M82)",      ra: 9.9317,  dec: 69.68,   sizeArcmin: 11,  credit: "NASA/ESA/Hubble Heritage — Public domain",
    type: "Starburst galaxy (edge-on)", con: "Ursa Major", distLy: "~12 million ly", mag: 8.4, src: DSO_SRC,
    desc: "A galaxy in overdrive: a close pass by M81 triggered a starburst forming stars ten times faster than the Milky Way, blasting towers of glowing hydrogen out of its disk." },
  { id: "m87",   name: "Messier 87",              ra: 12.5133, dec: 12.391,  sizeArcmin: 7.2, credit: "NASA/STScI/WikiSky — Public domain",
    type: "Giant elliptical galaxy", con: "Virgo", distLy: "~55 million ly", mag: 8.6, src: DSO_SRC,
    desc: "The monster at the heart of the Virgo Cluster, with several trillion stars and a jet of plasma launched at near light speed. Its central black hole, M87*, was the first ever photographed (Event Horizon Telescope, 2019)." },
  { id: "omegacen", name: "Omega Centauri",       ra: 13.4467, dec: -47.48,  sizeArcmin: 36,  credit: "Chuck Ayoub — CC0",
    type: "Globular cluster", con: "Centaurus", distLy: "~17,000 ly", mag: 3.9, src: DSO_SRC,
    desc: "The largest and brightest globular cluster of the Milky Way — roughly 10 million stars in a ball so massive it may actually be the stripped core of a dwarf galaxy our galaxy swallowed." },
  { id: "47tuc", name: "47 Tucanae",              ra: 0.4017,  dec: -72.081, sizeArcmin: 31,  credit: "NASA/ESA/Hubble Heritage — CC BY 4.0",
    type: "Globular cluster", con: "Tucana", distLy: "~15,000 ly", mag: 4.1, src: DSO_SRC,
    desc: "The southern sky's second-brightest globular cluster, so dense at its core that stars there sit thousands of times closer together than the stars near the Sun. It shares the field with the Small Magellanic Cloud." },
  { id: "tarantula", name: "Tarantula Nebula (NGC 2070)", ra: 5.6433, dec: -69.10, sizeArcmin: 40, credit: "NASA/ESA/CSA/STScI (JWST) — Public domain",
    type: "Emission nebula (in the LMC)", con: "Dorado", distLy: "~160,000 ly", mag: 8.0, src: DSO_SRC,
    desc: "The most violent star-forming region in the entire Local Group, inside the Large Magellanic Cloud. If it sat where the Orion Nebula is, it would cast shadows at night. Supernova 1987A exploded on its outskirts." },
  { id: "rosette", name: "Rosette Nebula",        ra: 6.55,    dec: 4.95,    sizeArcmin: 80,  credit: "A. Wilhelm — CC BY-SA 4.0",
    type: "Emission nebula", con: "Monoceros", distLy: "~5,200 ly", mag: 9.0, src: DSO_SRC,
    desc: "A cosmic rose: the young cluster NGC 2244 at its center has blown a hole in its own birth cloud, giving the nebula its wreath shape. The whole flower spans about 130 light-years." },
  { id: "ngc7000", name: "North America Nebula (NGC 7000)", ra: 20.9883, dec: 44.53, sizeArcmin: 120, credit: "Giuseppe Donatiello — CC0",
    type: "Emission nebula", con: "Cygnus", distLy: "~2,600 ly", mag: 4.0, src: DSO_SRC,
    desc: "A glowing continent beside bright Deneb, its 'Gulf of Mexico' carved by a foreground dust cloud, with the Pelican Nebula across the strait. Gaia finally pinned down its distance in 2020." },
  { id: "horsehead", name: "Horsehead Nebula (B33)", ra: 5.6833, dec: -2.458, sizeArcmin: 8, credit: "ESO/SPECULOOS — CC BY 4.0",
    type: "Dark nebula", con: "Orion", distLy: "~1,400 ly", mag: null, src: DSO_SRC,
    desc: "The sky's most famous silhouette: a chess-knight head of cold, opaque dust standing in front of the glowing curtain of IC 434, just south of Orion's Belt star Alnitak." },
  { id: "flame", name: "Flame Nebula (NGC 2024)", ra: 5.6983, dec: -1.85,   sizeArcmin: 30,  credit: "Chuck Ayoub — CC0",
    type: "Emission nebula", con: "Orion", distLy: "~1,400 ly", mag: null, src: DSO_SRC,
    desc: "Alnitak's radiation makes this cloud blaze while a dark lane of dust splits it into fiery filaments. Behind the veil hides a dense cluster of newborn stars, visible only in infrared." },
  { id: "california", name: "California Nebula (NGC 1499)", ra: 4.055, dec: 36.42, sizeArcmin: 145, credit: "A. Wilhelm — CC BY-SA 4.0",
    type: "Emission nebula", con: "Perseus", distLy: "~1,000 ly", mag: 6.0, src: DSO_SRC,
    desc: "A 100-light-year ribbon of hydrogen shaped uncannily like the US state, lit by the scorching runaway star Xi Persei. Famously hard to see visually despite its size — a photographic favorite." },
  { id: "veil",  name: "Veil Nebula (NGC 6960)",  ra: 20.7617, dec: 30.71,   sizeArcmin: 70,  credit: "Ken Crawford — CC BY-SA 3.0",
    type: "Supernova remnant", con: "Cygnus", distLy: "~2,400 ly", mag: 7.0, src: DSO_SRC,
    desc: "The western arc (the 'Witch's Broom') of the Cygnus Loop — wreckage of a star that exploded roughly 10–20 thousand years ago, now a lacework of shocked gas spanning six full Moons of sky." },
  { id: "lmc",   name: "Large Magellanic Cloud",  ra: 5.3933,  dec: -69.756, sizeArcmin: 650, credit: "Robert Gendler/ESO — CC BY 4.0",
    type: "Satellite galaxy (barred irregular)", con: "Dorado/Mensa", distLy: "~160,000 ly", mag: 0.9, src: DSO_SRC,
    desc: "The Milky Way's brightest satellite galaxy, a naked-eye cloud in far-southern skies carrying billions of stars and the Tarantula Nebula. Magellan's crews made it famous to Europeans in 1519." },
  { id: "smc",   name: "Small Magellanic Cloud",  ra: 0.8783,  dec: -72.83,  sizeArcmin: 320, credit: "ESA/Hubble & Digitized Sky Survey 2 — CC BY 4.0",
    type: "Satellite galaxy (dwarf irregular)", con: "Tucana", distLy: "~200,000 ly", mag: 2.7, src: DSO_SRC,
    desc: "The LMC's smaller companion, a few hundred million stars being slowly pulled apart by the Milky Way's tides. Henrietta Leavitt's study of its pulsating stars gave astronomy its cosmic distance ladder." },
  { id: "m22",   name: "Messier 22",              ra: 18.6067, dec: -23.905, sizeArcmin: 32,  credit: "ESA/Hubble & NASA — CC BY 4.0",
    type: "Globular cluster", con: "Sagittarius", distLy: "~10,600 ly", mag: 5.1, src: DSO_SRC,
    desc: "One of the first globular clusters ever discovered (1665) and among the brightest — it outshines M13 but rides low for northern observers, glowing in front of the Milky Way's central bulge." },
  { id: "m101",  name: "Pinwheel Galaxy (M101)",  ra: 14.0533, dec: 54.349,  sizeArcmin: 29,  credit: "ESA/NASA (Hubble) — CC BY 4.0",
    type: "Spiral galaxy (face-on)", con: "Ursa Major", distLy: "~21 million ly", mag: 7.9, src: DSO_SRC,
    desc: "A perfect face-on pinwheel nearly twice the Milky Way's diameter, its lopsided arms studded with giant star-forming regions. In 2023 it hosted SN 2023ixf, the closest supernova in a decade." },
  { id: "cena",  name: "Centaurus A (NGC 5128)",  ra: 13.425,  dec: -43.019, sizeArcmin: 26,  credit: "ESO/WFI; MPIfR/APEX; NASA/CXC — CC BY 4.0",
    type: "Radio galaxy (elliptical)", con: "Centaurus", distLy: "~12 million ly", mag: 6.8, src: DSO_SRC,
    desc: "The nearest active galaxy: an elliptical wrapped in the twisted dust lane of a spiral it recently devoured, while its central black hole fires radio jets across a million light-years." }
];

var PLANET_SPRITES = [
  { name: "Sun",     glyph: "☉", color: "#fff3c8", px: 46 },
  { name: "Moon",    glyph: "☾", color: "#e8ecf8", px: 40 },
  { name: "Mercury", glyph: "☿", color: "#c8c2b4", px: 14 },
  { name: "Venus",   glyph: "♀", color: "#f7ecd2", px: 22 },
  { name: "Mars",    glyph: "♂", color: "#ff9a70", px: 16, dash: true },
  { name: "Jupiter", glyph: "♃", color: "#ffd9a0", px: 22, dash: true },
  { name: "Saturn",  glyph: "♄", color: "#f0e0b0", px: 18, dash: true }
];

function toScene(v) { return new THREE.Vector3(v.x, v.z, -v.y); }
function raDecToScene(raHours, decDeg, r) {
  var ra = raHours * 15 * D2R, dec = decDeg * D2R, c = Math.cos(dec);
  return toScene({ x: c * Math.cos(ra) * r, y: c * Math.sin(ra) * r, z: Math.sin(dec) * r });
}

/* B-V color index -> linear-ish RGB (classic bv2rgb approximation) */
function bvColor(bv) {
  bv = Math.max(-0.4, Math.min(2.0, bv));
  var t, r, g, b;
  if (bv < 0.0) { t = (bv + 0.4) / 0.4; r = 0.61 + 0.11 * t + 0.1 * t * t; }
  else if (bv < 0.4) { t = bv / 0.4; r = 0.83 + 0.17 * t; }
  else r = 1.0;
  if (bv < 0.0) { t = (bv + 0.4) / 0.4; g = 0.70 + 0.07 * t + 0.1 * t * t; }
  else if (bv < 0.4) { t = bv / 0.4; g = 0.87 + 0.11 * t; }
  else if (bv < 1.6) { t = (bv - 0.4) / 1.2; g = 0.98 - 0.16 * t; }
  else { t = (bv - 1.6) / 0.4; g = 0.82 - 0.5 * t * t; }
  if (bv < 0.4) b = 1.0;
  else if (bv < 1.5) { t = (bv - 0.4) / 1.1; b = 1.0 - 0.47 * t + 0.1 * t * t; }
  else if (bv < 1.94) { t = (bv - 1.5) / 0.44; b = 0.63 - 0.6 * t * t; }
  else b = 0.0;
  return [r, g, b];
}

var session = null;

export function openSpaceMode(opts) {
  if (session) closeSpaceMode();
  session = new SpaceMode(opts || {});
  return session;
}
export function closeSpaceMode() {
  if (session) { session.dispose(); session = null; }
}
export function isOpen() { return !!session; }
export function resumeFromDashboard() { if (session) session.resume(); }

function SpaceMode(opts) {
  var self = this;
  this.opts = opts;
  this.disposed = false;
  this.suspended = false;
  this.lookMode = "drag";       // switched to "gyro" if orientation flows
  this.viewRa = 17.75 * 15;     // start facing the galactic center (deg)
  this.viewDec = -29;
  this.flags = { lines: true, names: true, planets: true, art: false }; // art default OFF (H12)
  this.planetPos = {};          // name -> Vector3
  this.fly = null;
  this.frameTimes = [];
  this.bloomOn = true;
  // H10 free-flight state
  this.flyMode = false;
  this.camPos = new THREE.Vector3();
  this.vel = new THREE.Vector3();
  this.thrust = 0;      // -1 back, 0 coast, +1 forward (hold buttons)
  this.speedT = 0.5;    // log-slider position -> speedLyS()
  this.autopilot = null;
  this.nearest = { name: null, namedPc: 1e9, anyPc: 1e9 };
  this._nearScanAt = 0;
  this._frameAt = performance.now();

  this.buildDom();
  this.buildRenderer();
  this.buildScene();
  this.loop();
  this.ephTimer = setInterval(function () { self.updatePlanets(); }, 1000);
  this.updatePlanets();
}

/* ------------------------------- DOM ------------------------------- */

SpaceMode.prototype.buildDom = function () {
  var self = this;
  if (!document.getElementById("spm-style")) {
    var st = document.createElement("style");
    st.id = "spm-style";
    st.textContent = [
      "#spm{position:fixed;inset:0;z-index:35;background:#000;touch-action:none;}",
      "#spm canvas.gl{position:absolute;inset:0;width:100%;height:100%;}",
      "#spm canvas.ov{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}",
      ".spm-top{position:absolute;top:env(safe-area-inset-top,0);left:0;right:0;display:flex;gap:6px;align-items:center;padding:8px 10px;z-index:3;flex-wrap:wrap;}",
      ".spm-btn{padding:6px 12px;border-radius:999px;border:1px solid #222c47;background:rgba(13,17,32,.85);color:#e6ebff;font-size:12px;font-weight:600;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}",
      ".spm-btn.on{border-color:#6ea8ff;color:#6ea8ff;}",
      ".spm-bot{position:absolute;bottom:calc(env(safe-area-inset-bottom,0px) + 44px);left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px 10px 8px;z-index:3;}",
      ".spm-chips{display:flex;gap:12px;}",
      ".spm-chip{width:44px;height:44px;border-radius:999px;border:1px solid #222c47;background:rgba(13,17,32,.85);color:#e6ebff;font-size:20px;line-height:1;}",
      ".spm-hint{color:#8a93b2;font-size:11px;font-family:'SF Mono',ui-monospace,Menlo,monospace;background:rgba(13,17,32,.7);padding:4px 12px;border-radius:999px;}",
      ".spm-fade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity 260ms ease;z-index:4;}"
    ].join("\n");
    document.head.appendChild(st);
  }
  var root = document.createElement("div");
  root.id = "spm";
  root.innerHTML =
    '<div class="spm-top">' +
    '<button class="spm-btn spm-back">← AR</button>' +
    '<button class="spm-btn spm-look">Look: drag</button>' +
    '<button class="spm-btn spm-lines on">Lines</button>' +
    '<button class="spm-btn spm-names on">Names</button>' +
    '<button class="spm-btn spm-planets on">Planets</button>' +
    '<button class="spm-btn spm-art">Art</button>' +
    "</div>" +
    '<div class="spm-bot">' +
    '<div class="spm-chips">' +
    '<button class="spm-chip" data-planet="Saturn">♄</button>' +
    '<button class="spm-chip" data-planet="Jupiter">♃</button>' +
    '<button class="spm-chip" data-planet="Earth">⊕</button>' +
    '<button class="spm-chip" data-planet="Mars">♂</button>' +
    "</div>" +
    '<span class="spm-hint">move the phone to look around · tap a planet to fly to it</span>' +
    "</div>" +
    '<div class="spm-fade"></div>';
  document.body.appendChild(root);
  this.root = root;
  this.fadeEl = root.querySelector(".spm-fade");

  root.querySelector(".spm-back").addEventListener("click", function () {
    closeSpaceMode();
  });
  this.lookBtn = root.querySelector(".spm-look");
  this.lookBtn.addEventListener("click", function () {
    self.lookMode = self.lookMode === "gyro" ? "drag" : "gyro";
    self.syncLookBtn();
  });
  [["lines", ".spm-lines"], ["names", ".spm-names"], ["planets", ".spm-planets"], ["art", ".spm-art"]].forEach(function (pair) {
    var btn = root.querySelector(pair[1]);
    btn.addEventListener("click", function () {
      self.flags[pair[0]] = !self.flags[pair[0]];
      btn.classList.toggle("on", self.flags[pair[0]]);
      if (self.lineMesh) self.lineMesh.visible = self.flags.lines;
      if (self.planetGroup) self.planetGroup.visible = self.flags.planets;
      if (pair[0] === "art") {
        if (self.flags.art) self.enableArt();
        else if (self.artGroup) self.artGroup.visible = false;
      }
    });
  });
  root.querySelectorAll(".spm-chip").forEach(function (btn) {
    btn.addEventListener("click", function () { self.selectPlanet(btn.getAttribute("data-planet")); });
  });
};

SpaceMode.prototype.syncLookBtn = function () {
  this.lookBtn.textContent = "Look: " + this.lookMode;
  this.lookBtn.classList.toggle("on", this.lookMode === "gyro");
};

/* --------------------------- renderer/camera --------------------------- */

SpaceMode.prototype.buildRenderer = function () {
  var self = this;
  this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  this.renderer.setSize(window.innerWidth, window.innerHeight);
  this.renderer.domElement.className = "gl";
  this.root.insertBefore(this.renderer.domElement, this.root.firstChild);

  this.overlay = document.createElement("canvas");
  this.overlay.className = "ov";
  this.root.insertBefore(this.overlay, this.root.children[1]);
  this.octx = this.overlay.getContext("2d");

  this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 5000);
  this.baseFov = 65;

  this.composer = new EffectComposer(this.renderer);
  this.composer.addPass(new RenderPass(this.scene = new THREE.Scene(), this.camera));
  this.bloomPass = new UnrealBloomPass(
    new THREE.Vector2(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2)),
    BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  this.composer.addPass(this.bloomPass);

  this.onResize = function () {
    var w = window.innerWidth, h = window.innerHeight;
    self.renderer.setSize(w, h);
    self.composer.setSize(w, h);
    self.camera.aspect = w / h;
    self.camera.updateProjectionMatrix();
    self.sizeOverlay();
  };
  window.addEventListener("resize", this.onResize);
  this.sizeOverlay();

  /* touch-drag look — FROZEN (H16). Pan code restored VERBATIM from the
     known-good commit 10cca53 (H13 state Alex confirmed on device), with
     two documented deviations only: (1) the old in-band tap gate
     (`moved < 6` degrees) is removed from onUp — taps are handled by the
     shared RE_attachTap layer below, which registers its OWN listeners
     and never touches this pan state; (2) touchcancel clears the drag.
     THE ONE RULE: this code moves the view only while input is active —
     no momentum, no snap, no proximity attraction. Do not modify. */
  // [H16 pan SPACE start]
  var el = this.renderer.domElement, drag = null, moved = 0;
  function pt(e) { return e.touches ? e.touches[0] : e; }
  this.onDown = function (e) { var p = pt(e); drag = { x: p.clientX, y: p.clientY }; moved = 0; };
  this.onMove = function (e) {
    if (!drag) return;
    if (e.cancelable) e.preventDefault();
    var p = pt(e);
    var scale = self.camera.fov / window.innerHeight; // deg per px
    var dx = (p.clientX - drag.x) * scale, dy = (p.clientY - drag.y) * scale;
    moved += Math.abs(dx) + Math.abs(dy);
    if (self.lookMode === "drag" && !self.fly) {
      self.viewRa = (self.viewRa + dx + 360) % 360; // drag right = look left (sky pans with finger)
      self.viewDec = Math.max(-89, Math.min(89, self.viewDec + dy));
    }
    drag = { x: p.clientX, y: p.clientY };
  };
  this.onUp = function () {
    drag = null;
  };
  this.onCancel = function () { drag = null; };
  el.addEventListener("mousedown", this.onDown); el.addEventListener("touchstart", this.onDown, { passive: true });
  window.addEventListener("mousemove", this.onMove); el.addEventListener("touchmove", this.onMove, { passive: false });
  window.addEventListener("mouseup", this.onUp); el.addEventListener("touchend", this.onUp);
  el.addEventListener("touchcancel", this.onCancel);
  // [H16 pan SPACE end]
  // Tap layer (frozen, shared with AR + dashboards): hit-test only.
  if (window.RE_attachTap) window.RE_attachTap(el, function (x, y) {
    if (self.fly) return null; // mid fly-to: ignore taps
    return self.tapSelect({ clientX: x, clientY: y });
  });
};

SpaceMode.prototype.sizeOverlay = function () {
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  this.overlay.width = Math.round(window.innerWidth * dpr);
  this.overlay.height = Math.round(window.innerHeight * dpr);
  this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

/* ------------------------------- scene ------------------------------- */

SpaceMode.prototype.buildScene = function () {
  var self = this;
  var scene = this.scene;
  var loader = new THREE.TextureLoader();

  // --- Milky Way sky sphere, generated in galactic (l,b) parameterization
  //     and rotated to EQJ per-vertex (see file header for the verified
  //     texture convention). Seam sits at the galactic anticenter. ---
  (function () {
    var rot = A.Rotation_GAL_EQJ();
    var SEG_U = 96, SEG_V = 48;
    var verts = [], uvs = [], idx = [];
    for (var j = 0; j <= SEG_V; j++) {
      var v = j / SEG_V;               // v=0 -> b=+90 (texture top)
      var b = (90 - v * 180) * D2R;
      for (var i = 0; i <= SEG_U; i++) {
        var u = i / SEG_U;             // u = 0.5 - l/360  =>  l = (0.5-u)*360
        var l = (0.5 - u) * 360 * D2R;
        var g = { x: Math.cos(b) * Math.cos(l), y: Math.cos(b) * Math.sin(l), z: Math.sin(b) };
        var eq = A.RotateVector(rot, new A.Vector(g.x, g.y, g.z, null));
        verts.push(eq.x * R_SKY, eq.z * R_SKY, -eq.y * R_SKY); // EQJ -> scene
        uvs.push(u, 1 - v);            // three: v=1 at texture top
      }
      if (j > 0) for (var k = 0; k < SEG_U; k++) {
        var a2 = (j - 1) * (SEG_U + 1) + k, b2 = j * (SEG_U + 1) + k;
        idx.push(a2, b2, a2 + 1, b2, b2 + 1, a2 + 1);
      }
    }
    var g2 = new THREE.BufferGeometry();
    g2.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g2.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g2.setIndex(idx);
    var mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, depthWrite: false, color: 0xffffff });
    loader.load("textures/sky/4k_milky_way.jpg", function (t) {
      t.anisotropy = 2; mat.map = t; mat.needsUpdate = true;
    });
    self.skyMesh = new THREE.Mesh(g2, mat);
    self.skyMesh.renderOrder = -3;
    scene.add(self.skyMesh);
  })();

  // --- 3D starfield from HYG (single buffer geometry, one draw call) ---
  fetch("data/stars.json").then(function (r) { return r.json(); }).then(function (sj) {
    if (self.disposed) return;
    var n = sj.stars.length;
    var pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    self.starLabels = [];
    for (var i = 0; i < n; i++) {
      var s = sj.stars[i];
      var dist = Math.min(s[6] || STAR_DIST_CAP, STAR_DIST_CAP);
      var p = raDecToScene(s[0], s[1], dist);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      var c = bvColor(typeof s[7] === "number" ? s[7] : 0.5);
      // brightness folded into color so additive blending sums naturally
      var lum = Math.min(1, Math.pow(10, -0.28 * s[2]) * 1.35);
      col[i * 3] = c[0] * (0.35 + 0.65 * lum);
      col[i * 3 + 1] = c[1] * (0.35 + 0.65 * lum);
      col[i * 3 + 2] = c[2] * (0.35 + 0.65 * lum);
      size[i] = Math.max(1.6, 8.5 - 1.15 * s[2]); // screen px from apparent mag
      if (s[3] && s[2] <= 2.5) self.starLabels.push({
        name: s[3], pos: p, mag: s[2], bayer: s[4] || "", con: s[5] || "",
        distPc: s[6], bv: typeof s[7] === "number" ? s[7] : 0.5, spect: s[8] || ""
      });
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("psize", new THREE.BufferAttribute(size, 1));
    var mat = new THREE.ShaderMaterial({
      vertexShader:
        "uniform float uScale;" + // custom uniforms must be declared in GLSL
        "attribute float psize; attribute vec3 color; varying vec3 vColor;" +
        "void main(){ vColor = color;" +
        " gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);" +
        " gl_PointSize = psize * uScale; }",
      fragmentShader:
        "varying vec3 vColor;" +
        "void main(){ vec2 d = gl_PointCoord - 0.5; float r2 = dot(d,d);" +
        " if (r2 > 0.25) discard;" +
        " float a = smoothstep(0.25, 0.02, r2);" +
        " gl_FragColor = vec4(vColor * a, 1.0); }",
      uniforms: { uScale: { value: Math.min(window.devicePixelRatio || 1, 1.75) } },
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    });
    self.starPoints = new THREE.Points(g, mat);
    self.starPoints.renderOrder = -1;
    scene.add(self.starPoints);
  });

  // --- constellation lines (H03 data), on the celestial sphere ---
  fetch("data/constellations.json").then(function (r) { return r.json(); }).then(function (cj) {
    if (self.disposed) return;
    var verts = [];
    self.conLabels = [];
    Object.keys(cj.lines).forEach(function (id) {
      var sum = new THREE.Vector3(); var cnt = 0;
      cj.lines[id].forEach(function (poly) {
        for (var i = 1; i < poly.length; i++) {
          var p0 = raDecToScene(poly[i - 1][0], poly[i - 1][1], R_LINES);
          var p1 = raDecToScene(poly[i][0], poly[i][1], R_LINES);
          verts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
          sum.add(p0); cnt++;
        }
      });
      if (cnt) self.conLabels.push({ name: id, pos: sum.multiplyScalar(1 / cnt).normalize().multiplyScalar(R_LINES) });
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    self.lineMesh = new THREE.LineSegments(g,
      new THREE.LineBasicMaterial({ color: 0x33477a, transparent: true, opacity: 0.55 }));
    self.lineMesh.renderOrder = -2;
    self.lineMesh.visible = self.flags.lines;
    scene.add(self.lineMesh);
  });

  // --- DSO photo billboards at real RA/Dec ---
  this.dsoMeshes = [];
  DSOS.forEach(function (d) {
    var pos = raDecToScene(d.ra, d.dec, R_DSO);
    var appDeg = Math.max(d.sizeArcmin / 60, DSO_MIN_APPARENT_DEG);
    var side = 2 * R_DSO * Math.tan(appDeg / 2 * D2R);
    var mat = new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending // black photo background disappears
    });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(side, side), mat);
    mesh.position.copy(pos);
    mesh.lookAt(0, 0, 0);
    mesh.visible = false;
    scene.add(mesh);
    loader.load("textures/dso/" + d.id + ".jpg", function (t) {
      t.anisotropy = 2;
      mat.map = t; mat.needsUpdate = true; mesh.visible = true;
    });
    self.dsoMeshes.push({ cfg: d, mesh: mesh, pos: pos });
  });

  // --- planet glow sprites (positions from the live ephemeris) ---
  this.planetGroup = new THREE.Group();
  scene.add(this.planetGroup);
  var glowTex = (function () {
    var c = document.createElement("canvas"); c.width = c.height = 64;
    var x = c.getContext("2d");
    var grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.35, "rgba(255,255,255,0.7)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = grd; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  this.planetSprites = [];
  PLANET_SPRITES.forEach(function (p) {
    var mat = new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(p.color),
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var spr = new THREE.Sprite(mat);
    var worldSize = p.px / window.innerHeight * 2 * R_PLANET * Math.tan(self.baseFov / 2 * D2R);
    spr.scale.set(worldSize, worldSize, 1);
    self.planetGroup.add(spr);
    self.planetSprites.push({ cfg: p, sprite: spr });
  });
};

SpaceMode.prototype.updatePlanets = function () {
  if (this.disposed) return;
  var self = this;
  this.lastPlanetSimMs = window.SimClock ? window.SimClock.ms() : Date.now();
  var time = A.MakeTime(window.SimClock ? window.SimClock.now() : new Date());
  this.planetSprites.forEach(function (ps) {
    var gv = A.GeoVector(ps.cfg.name, time, true);
    var dir = toScene(gv).normalize();
    ps.sprite.position.copy(dir.multiplyScalar(R_PLANET));
    self.planetPos[ps.cfg.name] = ps.sprite.position.clone();
  });
};

/* ----------------------------- look/camera ----------------------------- */

/* H13: the H12 quaternion look-around regressed the horizontal axis on
   device (left/right inverted — its east/west frame mapping carried a sign
   error — and the per-frame compass-offset filter amplified compass noise
   into visible jitter). Per the H13 handoff, the pre-H12 az/alt path below
   is restored BYTE-EXACTLY from commit cbfd423 (it was world-locked, 1:1,
   correct-direction, and smoothed via the AR handler's shared view state).
   The original vertical pole-flip is fixed at the shared source, in the AR
   orientation handler (see index.html onOrientation).

   H19 UPDATE: that fix used to be a ±89° clamp on altitude. It is now a proper
   quaternion/matrix derivation and THE CLAMP IS GONE, so view.alt can reach
   exactly ±90 where it previously could not. Nothing here needed to change —
   this path reads only view.az/view.alt and their meaning is unchanged — but
   note the consequence at the pole: at alt = ±90 the `dir` computed below is
   exactly parallel to `up`, so camera.lookAt() is degenerate in roll. Verified
   on three r185: it does NOT produce NaN (lookAt nudges by ~1e-4 internally),
   it just means the roll about the view axis is arbitrary for that instant.
   Left alone deliberately rather than reintroducing a clamp upstream. */
SpaceMode.prototype.applyCamera = function () {
  var dir, up;
  var view = this.opts.getView ? this.opts.getView() : null;
  var obs = this.opts.getObserver ? this.opts.getObserver() : null;
  if (this.lookMode === "gyro" && view && view.az != null && obs) {
    // horizon az/alt -> EQJ at SIM time (recomputed ~1/s, or immediately when
    // sim time moves fast, so time travel wheels the sky in gyro look too)
    var now = Date.now();
    var simMs = window.SimClock ? window.SimClock.ms() : now;
    if (!this._horRot || now - this._horRotAt > 1000 ||
        Math.abs(simMs - (this._horRotSimMs || 0)) > 15000) {
      this._horRot = A.Rotation_HOR_EQJ(A.MakeTime(window.SimClock ? window.SimClock.now() : new Date()), obs);
      this._horRotAt = now; this._horRotSimMs = simMs;
    }
    var az = view.az * D2R, alt = view.alt * D2R;
    // ENU -> astronomy HOR frame (x=N, y=W, z=Up)
    var hor = { x: Math.cos(alt) * Math.cos(az), y: -Math.cos(alt) * Math.sin(az), z: Math.sin(alt) };
    var eq = A.RotateVector(this._horRot, new A.Vector(hor.x, hor.y, hor.z, null));
    dir = toScene(eq).normalize();
    var zen = A.RotateVector(this._horRot, new A.Vector(0, 0, 1, null));
    up = toScene(zen).normalize();
  } else {
    dir = raDecToScene(this.viewRa / 15, this.viewDec, 1);
    up = new THREE.Vector3(0, 1, 0); // celestial north up (planetarium feel)
  }
  if (this.fly) {
    var f = this.fly, t = Math.min(1, (Date.now() - f.t0) / f.durMs);
    var e = easeInOutCubic(t);
    dir = slerpDir(f.from, f.to, e);
    this.camera.fov = f.fovFrom + (f.fovTo - f.fovFrom) * e;
    this.camera.updateProjectionMatrix();
    if (t >= 1 && !f.done) { f.done = true; this.flyArrived(f); }
    // note: t stays clamped at 1 afterwards, so the camera holds the exact
    // end pose every frame until the next state change -> no drift at rest
  }
  this.camera.position.set(0, 0, 0);
  this.camera.up.copy(up);
  this.camera.lookAt(dir);
};

/* ---------------- constellation art (H12, Space Mode) ----------------
   Johan Meuris / Stellarium modern figures, Free Art License 1.3. Each
   figure becomes ONE quad on the celestial shell at R_ART (between the
   lines at 1800 and the sky at 2000, renderOrder under the lines): the
   image plane P(x,y) = origin + x·U + y·V is solved exactly from the 3
   anchor pairs (image px <-> star direction·R_ART), so the anchors sit on
   their stars by construction. Textures lazy-load when a figure comes
   within ~95° of the view and are disposed after 30 s out of view. */
var R_ART = 1950;
var ART_SPACE_OPACITY = 0.35;

SpaceMode.prototype.enableArt = function () {
  var self = this;
  if (this.artGroup) { this.artGroup.visible = true; return; }
  this.artGroup = new THREE.Group();
  this.scene.add(this.artGroup);
  this.flashHint("Constellation art: Johan Meuris · Free Art License");
  fetch("data/constellation-art.json").then(function (r) { return r.json(); }).then(function (aj) {
    if (self.disposed) return;
    aj.art.forEach(function (en) {
      var P = en.anchors.map(function (a) { return raDecToScene(a.ra, a.dec, R_ART); });
      var x0 = en.anchors[0].x, y0 = en.anchors[0].y;
      var dx1 = en.anchors[1].x - x0, dy1 = en.anchors[1].y - y0;
      var dx2 = en.anchors[2].x - x0, dy2 = en.anchors[2].y - y0;
      var d = dx1 * dy2 - dx2 * dy1;
      if (Math.abs(d) < 1e-6) return;
      var e1 = P[1].clone().sub(P[0]), e2 = P[2].clone().sub(P[0]);
      var U = e1.clone().multiplyScalar(dy2 / d).add(e2.clone().multiplyScalar(-dy1 / d));
      var V = e1.clone().multiplyScalar(-dx2 / d).add(e2.clone().multiplyScalar(dx1 / d));
      var origin = P[0].clone().sub(U.clone().multiplyScalar(x0)).sub(V.clone().multiplyScalar(y0));
      var corners = [[0, 0], [en.w, 0], [en.w, en.h], [0, en.h]].map(function (c) {
        return origin.clone().add(U.clone().multiplyScalar(c[0])).add(V.clone().multiplyScalar(c[1]));
      });
      var g = new THREE.BufferGeometry();
      var pos = new Float32Array(12);
      corners.forEach(function (cn, ci) { pos[ci * 3] = cn.x; pos[ci * 3 + 1] = cn.y; pos[ci * 3 + 2] = cn.z; });
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2)); // flipY texture convention
      g.setIndex([0, 1, 2, 0, 2, 3]);
      var mat = new THREE.MeshBasicMaterial({
        transparent: true, opacity: ART_SPACE_OPACITY, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide
      });
      var mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = -2.5; // above the sky (-3), beneath the lines (-2)
      mesh.frustumCulled = false; // visibility is texture-managed in artSweep
      mesh.visible = false;
      var center = P[0].clone().add(P[1]).add(P[2]).normalize();
      mesh.userData = { img: en.img, con: en.con, centerDir: center, lastSeen: 0, loading: false };
      self.artGroup.add(mesh);
    });
    self.artSweep();
  }).catch(function (e) { console.error("art load failed", e); });
};

/* Lazy texture management: load figures near the view, drop far ones. */
SpaceMode.prototype.artSweep = function () {
  if (!this.artGroup || !this.artGroup.visible || this.disposed) return;
  var fwd = this.camera.getWorldDirection(new THREE.Vector3());
  var now = Date.now();
  this.artGroup.children.forEach(function (mesh) {
    var ang = mesh.userData.centerDir.angleTo(fwd) * R2D;
    if (ang < 95) {
      mesh.userData.lastSeen = now;
      if (!mesh.userData.loading && !mesh.material.map) {
        mesh.userData.loading = true;
        new THREE.TextureLoader().load("textures/constellation-art/" + mesh.userData.img, function (t) {
          t.anisotropy = 2;
          mesh.material.map = t; mesh.material.needsUpdate = true;
          mesh.visible = true; mesh.userData.loading = false;
        });
      } else if (mesh.material.map) mesh.visible = true;
    } else if (mesh.material.map && now - mesh.userData.lastSeen > 30000) {
      mesh.material.map.dispose();
      mesh.material.map = null; mesh.material.needsUpdate = true;
      mesh.visible = false;
    }
  });
};

SpaceMode.prototype.flashHint = function (text) {
  var el = this.root.querySelector(".spm-hint");
  if (!el) return;
  var orig = el.textContent;
  el.textContent = text;
  setTimeout(function () { el.textContent = orig; }, 4000);
};

/* ------------------------------ selection ------------------------------ */

/* H09 tap routing, strict priority so taps never collide:
   1) planet sprites (44 px) -> fly-to + 3D dashboard
   2) DSO billboards (projected apparent radius, min 34 px) -> detail card
   3) labeled bright stars (36 px) -> star info card
   Detail cards are view-only by design — no flying into nebulae/galaxies. */
/* Hit-test only (H16: classification handled by the shared tap layer).
   Returns the hit label for the debug readout, or null on no-hit. */
SpaceMode.prototype.tapSelect = function (e) {
  if (window.RE_cardOpen && window.RE_cardOpen()) return null; // a card has focus
  var p = e.changedTouches ? e.changedTouches[0] : e;
  var v = new THREE.Vector3(), w = window.innerWidth, h = window.innerHeight;
  var self = this;
  function screenOf(pos) {
    v.copy(pos).project(self.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h };
  }
  var name, sp, d;
  // 1) planets
  var best = null, bd = 44;
  for (name in this.planetPos) {
    sp = screenOf(this.planetPos[name]);
    if (!sp) continue;
    d = Math.hypot(sp.x - p.clientX, sp.y - p.clientY);
    if (d < bd) { bd = d; best = name; }
  }
  if (best) { this.selectPlanet(best); return best; }
  // 2) DSO billboards (hit radius follows their apparent size on screen)
  var bestDso = null; bd = 1e9;
  var pxPerDeg = h / this.camera.fov;
  for (var i = 0; i < this.dsoMeshes.length; i++) {
    var dm = this.dsoMeshes[i];
    if (!dm.mesh.visible) continue;
    sp = screenOf(dm.pos);
    if (!sp) continue;
    var appDeg = Math.max(dm.cfg.sizeArcmin / 60, 1.6);
    var hitR = Math.max(34, appDeg / 2 * pxPerDeg);
    d = Math.hypot(sp.x - p.clientX, sp.y - p.clientY);
    if (d < hitR && d < bd) { bd = d; bestDso = dm; }
  }
  if (bestDso) { this.showDsoCard(bestDso.cfg); return bestDso.cfg.name; }
  // 3) labeled bright stars
  if (this.starLabels) {
    var bestStar = null; bd = 36;
    for (var j = 0; j < this.starLabels.length; j++) {
      sp = screenOf(this.starLabels[j].pos);
      if (!sp) continue;
      d = Math.hypot(sp.x - p.clientX, sp.y - p.clientY);
      if (d < bd) { bd = d; bestStar = this.starLabels[j]; }
    }
    if (bestStar) { this.showStarCard(bestStar); return "★ " + bestStar.name; }
  }
  return null;
};

SpaceMode.prototype.showDsoCard = function (c) {
  if (!window.RE_showCard) return;
  window.RE_showCard({
    image: "textures/dso/" + c.id + ".jpg",
    title: c.name,
    subtitle: c.type + " · in " + c.con,
    rows: [
      ["Distance", c.distLy],
      ["Apparent magnitude", c.mag != null ? c.mag.toFixed(1) : "— (dark nebula)"],
      ["Apparent size", c.sizeArcmin >= 60 ? (c.sizeArcmin / 60).toFixed(1) + "°" : c.sizeArcmin + "′"],
      ["Position (J2000)", "RA " + c.ra.toFixed(2) + "h · Dec " + (c.dec > 0 ? "+" : "") + c.dec.toFixed(1) + "°"]
    ],
    desc: c.desc,
    credit: "Image: " + c.credit + " · Facts: " + c.src
  });
};

function starNote(s) {
  var sp = s.spect || "";
  var colorName = { O: "blazing blue", B: "hot blue-white", A: "blue-white",
                    F: "yellow-white", G: "yellow, Sun-like", K: "orange", M: "cool red" }[sp[0]];
  var lum = /III/.test(sp) ? "giant" : /IV/.test(sp) ? "subgiant" : /II/.test(sp) ? "bright giant" :
            /I/.test(sp) ? "supergiant" : /V/.test(sp) ? "main-sequence star" : "star";
  if (!colorName) return "Bright star from the HYG catalog.";
  var out = s.name + " is a " + colorName + " " + lum;
  if (s.distPc < 100000) out += ", about " + Math.round(s.distPc * 3.26156).toLocaleString("en-US") + " light-years away";
  return out + ".";
}

SpaceMode.prototype.showStarCard = function (s) {
  if (!window.RE_showCard) return;
  var c = bvColor(s.bv);
  var rgb = "rgb(" + c.map(function (x) { return Math.round(x * 255); }).join(",") + ")";
  window.RE_showCard({
    glyphColor: rgb,
    title: s.name,
    subtitle: (s.bayer ? s.bayer + " · " : "") + s.con,
    rows: [
      ["Spectral type", s.spect || "—"],
      ["Distance", s.distPc >= 100000 ? "unknown" : (s.distPc * 3.26156).toFixed(1) + " ly"],
      ["Apparent magnitude", s.mag.toFixed(2)],
      ["Color index (B−V)", s.bv.toFixed(2)]
    ],
    desc: starNote(s),
    credit: "Data: HYG database v4.1 (CC BY-SA 4.0)"
  });
};

SpaceMode.prototype.setDragViewTo = function (d) {
  this.viewDec = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) * R2D;
  this.viewRa = ((Math.atan2(-d.z, d.x) * R2D) + 360) % 360;
};

SpaceMode.prototype.selectPlanet = function (name) {
  if (this.fly) return; // let the current transition finish first
  // H09: every body opens a dashboard now (the peek path is kept as a
  // fallback for any future non-dashboard sprite)
  var dash = { Saturn: 1, Jupiter: 1, Mars: 1, Earth: 1, Mercury: 1, Venus: 1, Sun: 1, Moon: 1 }[name];
  if (name === "Earth") { this.openDash("Earth"); return; } // Earth is underfoot: no fly-to
  var target = this.planetPos[name];
  if (!target) return;
  var from = this.camera.getWorldDirection(new THREE.Vector3());
  var to = target.clone().normalize();
  this.fly = {
    kind: dash ? "dash" : "peek",
    from: from, to: to, t0: Date.now(), durMs: FLY.durMs,
    fovFrom: this.camera.fov, fovTo: dash ? FLY.fovPlanet : FLY.peekFov,
    name: name
  };
};

SpaceMode.prototype.flyArrived = function (f) {
  var self = this;
  if (f.kind === "peek") { // Sun/Moon/inner planets: rest, then ease back out
    setTimeout(function () {
      if (self.disposed || !self.fly) return;
      self.fly = { kind: "return", from: f.to, to: f.to, t0: Date.now(),
                   durMs: FLY.returnMs, fovFrom: FLY.peekFov, fovTo: self.baseFov, name: f.name };
    }, FLY.peekHoldMs);
    return;
  }
  if (f.kind === "return") {
    this.fly = null;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.setDragViewTo(f.to); // drag view now points at the body: no jump
    return;
  }
  // "dash": hold the end pose, fade to black, then hand off to the dashboard
  this.fadeEl.style.opacity = "1";
  setTimeout(function () {
    if (self.disposed) return;
    self.openDash(f.name);
  }, FLY.fadeMs + 40);
};

SpaceMode.prototype.openDash = function (name) {
  var d = this.fly ? this.fly.to : null;
  this.fly = null;
  this.camera.fov = this.baseFov;
  this.camera.updateProjectionMatrix();
  if (d) this.setDragViewTo(d); // resume looking where we flew
  this.suspend();
  if (this.opts.openDashboard) this.opts.openDashboard(name);
};

/* ------------------------------- loop ------------------------------- */

SpaceMode.prototype.suspend = function () { this.suspended = true; this.root.style.visibility = "hidden"; };
SpaceMode.prototype.resume = function () {
  this.suspended = false; this.root.style.visibility = "visible";
  // fade back in from black so the dashboard-close seam is as smooth as entry
  var fe = this.fadeEl;
  fe.style.opacity = "1";
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { fe.style.opacity = "0"; });
  });
};

SpaceMode.prototype.loop = function () {
  var self = this;
  // auto-pick gyro if orientation data flows
  var view = this.opts.getView ? this.opts.getView() : null;
  if (view && view.az != null) this.lookMode = "gyro";
  this.syncLookBtn();

  function frame() {
    if (self.disposed) return;
    self.rafId = requestAnimationFrame(frame);
    if (self.suspended || document.hidden) return;
    var t0 = performance.now();
    // H08: keep sprites current when sim time outruns the 1 Hz timer
    if (window.SimClock && Math.abs(window.SimClock.ms() - (self.lastPlanetSimMs || 0)) > 15000) {
      self.updatePlanets();
    }
    self.applyCamera();
    if (self.bloomOn) self.composer.render(); else self.renderer.render(self.scene, self.camera);
    self.drawOverlay();
    // art texture management, throttled (H12)
    var nowMs = Date.now();
    if (self.artGroup && nowMs - (self._artSweepAt || 0) > 1000) {
      self._artSweepAt = nowMs;
      self.artSweep();
    }
    // bloom degradation: sustained slow frames -> render direct
    var dt = performance.now() - t0;
    self.frameTimes.push(dt);
    if (self.frameTimes.length >= 90) {
      var avg = self.frameTimes.reduce(function (a, b) { return a + b; }, 0) / self.frameTimes.length;
      if (self.bloomOn && avg > FRAME_BUDGET_MS) { self.bloomOn = false; }
      self.frameTimes.length = 0;
    }
  }
  frame();
};

SpaceMode.prototype.drawOverlay = function () {
  var ctx = this.octx, w = window.innerWidth, h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);
  var v = new THREE.Vector3(), self = this;
  function screenOf(pos) {
    v.copy(pos).project(self.camera);
    if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return null;
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h };
  }

  // reticle
  ctx.strokeStyle = "rgba(110,168,255,0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(w / 2, h / 2, 12, 0, Math.PI * 2); ctx.stroke();

  ctx.textAlign = "left";
  if (this.flags.names) {
    // DSO labels
    ctx.font = "600 11px -apple-system, sans-serif";
    this.dsoMeshes.forEach(function (d) {
      if (!d.mesh.visible) return;
      var p = screenOf(d.pos);
      if (!p) return;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.fillStyle = "#ffd9a8";
      ctx.strokeText(d.cfg.name, p.x + 10, p.y - 8);
      ctx.fillText(d.cfg.name, p.x + 10, p.y - 8);
    });
    // bright star names
    if (this.starLabels) {
      ctx.font = "600 10px -apple-system, sans-serif";
      this.starLabels.forEach(function (s) {
        var p = screenOf(s.pos);
        if (!p) return;
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.fillStyle = "#cfe0ff";
        ctx.strokeText(s.name, p.x + 7, p.y - 5);
        ctx.fillText(s.name, p.x + 7, p.y - 5);
      });
    }
    // constellation names (dim, small)
    if (this.flags.lines && this.conLabels) {
      ctx.font = "700 10px -apple-system, sans-serif";
      this.conLabels.forEach(function (c) {
        var p = screenOf(c.pos);
        if (!p) return;
        ctx.fillStyle = "rgba(110,140,200,0.55)";
        ctx.fillText(c.name, p.x, p.y);
      });
    }
  }
  if (this.flags.planets) {
    ctx.font = "600 13px -apple-system, sans-serif";
    this.planetSprites.forEach(function (ps) {
      var p = screenOf(ps.sprite.position);
      if (!p) return;
      var label = ps.cfg.glyph + " " + ps.cfg.name;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.75)"; ctx.fillStyle = ps.cfg.color;
      ctx.strokeText(label, p.x + 12, p.y + 4);
      ctx.fillText(label, p.x + 12, p.y + 4);
    });
  }
};

/* ------------------------------ teardown ------------------------------ */

SpaceMode.prototype.dispose = function () {
  this.disposed = true;
  if (this.rafId) cancelAnimationFrame(this.rafId);
  if (this.ephTimer) clearInterval(this.ephTimer);
  window.removeEventListener("resize", this.onResize);
  window.removeEventListener("mousemove", this.onMove);
  window.removeEventListener("mouseup", this.onUp);
  var disposed = [];
  this.scene.traverse(function (obj) {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(function (m) { if (m.map) m.map.dispose(); m.dispose(); });
    }
  });
  if (this.bloomPass && this.bloomPass.dispose) this.bloomPass.dispose();
  if (this.composer && this.composer.dispose) this.composer.dispose();
  this.renderer.dispose();
  if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
  if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  if (this.opts.onExit) try { this.opts.onExit(); } catch (e) {}
};

/* ------------------------------- debug ------------------------------- */

export var _debug = {
  session: function () { return session; },
  three: function () { return THREE; },
  artInfo: function () {
    if (!session || !session.artGroup) return null;
    var loaded = 0;
    session.artGroup.children.forEach(function (m) { if (m.material.map) loaded++; });
    return { figures: session.artGroup.children.length, texturesLoaded: loaded, visible: session.artGroup.visible };
  },
  enableArt: function () { if (session) { session.flags.art = true; session.enableArt(); } },
  artSweep: function () { if (session) session.artSweep(); },
  gyroDir: function () { // current camera forward (scene coords) for continuity checks
    return session && session.camera.getWorldDirection(new THREE.Vector3()).toArray().map(function (x) { return +x.toFixed(5); });
  },
  aimAt: function (raH, decD) {
    if (!session) return;
    session.lookMode = "drag"; session.syncLookBtn();
    session.viewRa = raH * 15; session.viewDec = decD;
  },
  renderOnce: function () {
    if (!session) return;
    session.applyCamera();
    if (session.bloomOn) session.composer.render(); else session.renderer.render(session.scene, session.camera);
    session.drawOverlay();
  },
  centerLum: function (boxPx) {
    if (!session) return null;
    var gl = session.renderer.getContext();
    var W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    var r = boxPx || 40;
    var px = new Uint8Array(4 * (2 * r) * (2 * r));
    gl.readPixels(Math.round(W / 2 - r), Math.round(H / 2 - r), 2 * r, 2 * r, gl.RGBA, gl.UNSIGNED_BYTE, px);
    var sum = 0, max = 0;
    for (var i = 0; i < px.length; i += 4) {
      var l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      sum += l; if (l > max) max = l;
    }
    return { mean: Math.round(sum / (px.length / 4) * 100) / 100, max: Math.round(max) };
  },
  counts: function () {
    if (!session) return null;
    return {
      stars: session.starPoints ? session.starPoints.geometry.attributes.position.count : 0,
      dsosVisible: session.dsoMeshes.filter(function (d) { return d.mesh.visible; }).length,
      lines: !!session.lineMesh, bloom: session.bloomOn, lookMode: session.lookMode
    };
  },
  flyTo: function (name) { if (session) session.selectPlanet(name); },
  openDso: function (id) {
    if (!session) return false;
    var m = session.dsoMeshes.filter(function (d) { return d.cfg.id === id; })[0];
    if (m) session.showDsoCard(m.cfg);
    return !!m;
  },
  openStar: function (name) {
    if (!session || !session.starLabels) return false;
    var s = session.starLabels.filter(function (x) { return x.name === name; })[0];
    if (s) session.showStarCard(s);
    return !!s;
  },
  tapAt: function (x, y) { if (session) session.tapSelect({ clientX: x, clientY: y }); },
  planetPos: function () {
    if (!session) return null;
    var out = {};
    for (var k in session.planetPos) out[k] = session.planetPos[k].toArray().map(function (x) { return +x.toFixed(1); });
    return out;
  }
};
