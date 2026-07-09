# Vendored sky data

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
