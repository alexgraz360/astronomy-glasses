# Vendored planet/moon textures

All surface textures are from the **Solar System Scope** texture library
(<https://www.solarsystemscope.com/textures/>), NASA-derived imagery,
licensed **CC BY 4.0** (<https://creativecommons.org/licenses/by/4.0/>).
Attribution also appears in-app (planet dashboard → Info panel).

| File | Size | Used for |
|------|------|----------|
| 2k_saturn.jpg | 2048×1024 | Saturn globe |
| 2k_saturn_ring_alpha.png | 2048×125 | Saturn rings (radial strip, RGBA) |
| 2k_jupiter.jpg | 2048×1024 | Jupiter globe (incl. Great Red Spot) |
| 2k_earth_daymap.jpg | 2048×1024 | Earth day side |
| 2k_earth_nightmap.jpg | 2048×1024 | Earth night city lights |
| 2k_earth_clouds.jpg | 2048×1024 | Earth cloud layer |
| 2k_mars.jpg | 2048×1024 | Mars globe (incl. polar caps) |
| 2k_mercury.jpg | 2048×1024 | Mercury globe (H09) |
| 2k_venus_atmosphere.jpg | 2048×1024 | Venus cloud tops (H09; solid surface hidden by design) |
| 2k_sun.jpg | 2048×1024 | Sun photosphere (H09, unlit/self-luminous shader) |
| 2k_moon.jpg | 2048×1024 | Moon dashboard globe (H09) |
| 1k_moon.jpg | 1024×512 | Earth's Moon in the Earth dashboard; also tinted as a generic rocky surface for Galilean/Saturnian/Martian moons (real per-moon maps are a later handoff) |

The 1K moon map was downscaled locally from Solar System Scope's 2K original
to meet the moon-texture resolution budget.

three.js r185 (`phase1/lib/three.module.js` + `three.core.js`) is MIT-licensed —
see `phase1/lib/THREE_LICENSE.txt`.
