# Vendored sky data

## constellation-art.json + ../textures/constellation-art/ (H12)
**Constellation art by Johan Meuris**, from Stellarium's modern (Western) sky
culture (repo tag v23.4: `skycultures/modern/`), licensed under the
**Free Art License 1.3** — <https://artlibre.org/licence/lal/en/>.
FAL is a **copyleft / share-alike** license: these images (kept separate from
the app code, which is unaffected) remain under FAL, and derived versions of
them must be shared under the same license with credit. The in-app Art toggle
shows the credit as well.
Curated subset of **25** figures (expandable to all 88 the same way): the 12
zodiac (Ari Tau Gem Cnc Leo Vir Lib Sco Sgr Cap Aqr Psc) + Ori, UMa, UMi, Cas,
Cyg, CMa, CMi, Lyr, Aql, Boo, Per, And, Peg. Each entry carries Stellarium's
3 anchor points (image pixel ↔ star), with HIP ids resolved to RA/Dec (J2000)
via HYG v4.1 at build time. Images are the original 256–512 px art re-encoded
as JPEG (~0.3 MB total).

## stars.json
Subset of the **HYG database v4.1** (`hyg/CURRENT/hygdata_v41.csv`) by David Nash /
Astronexus — <https://github.com/astronexus/HYG-Database>.
License: **CC BY-SA 4.0** (<https://creativecommons.org/licenses/by-sa/4.0/>).
Filtered to apparent magnitude ≤ 5.5 (2,865 stars, Sol excluded), keeping per star:
RA (J2000, hours), Dec (J2000, degrees), magnitude, proper name, Bayer designation,
constellation. Values rounded (RA/Dec 4 decimals, mag 2).

## constellations.json
Constellation stick-figure lines converted from **d3-celestial**
`data/constellations.lines.json` by Olaf Frohn — <https://github.com/ofrohn/d3-celestial>.
License: **BSD 3-Clause** (c) 2015 Olaf Frohn.
88 constellations, RA converted from degrees (−180..180) to hours; format:
`constellation id → array of polylines of [ra_hours, dec_deg]` (J2000).
