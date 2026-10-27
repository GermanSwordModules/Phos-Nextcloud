# Map backgrounds

Every file here is an **equirectangular** blank whose four corner coordinates are known exactly,
which is what makes longitude/latitude → pixel a straight line. The corners live in `../maps.json`,
not in the file name, and the list there is ordered narrowest first because that is how the payload
builder picks one (first box that holds every point wins).

All three are **purely geographic** — shaded relief, no borders, no labels, nothing that dates a
map of the ancient world to the present.

| File | Covers | Source | Author | Licence |
|---|---|---|---|---|
| `israel-relief-blank.jpg` (+`@sm`) | 33.7–36.3 E, 29.3–33.5 N | [Israel relief location map-blank](https://commons.wikimedia.org/wiki/File:Israel_relief_location_map-blank.jpg) | Eric Gaba (User:Sting) | CC BY-SA 3.0 |
| `neareast-relief.jpg` (+`@sm`) | 24.9–62.1 E, 22.4–43.4 N | [Near East non political](https://commons.wikimedia.org/wiki/File:Near_East_non_political.png) | DEMIS Mapserver (PD source), Commons | CC BY-SA 3.0 |
| `mediterranean-relief.jpg` (+`@sm`) | −7.0–42.5 E, 29.0–48.0 N | [Relief Map of Mediterranean Sea](https://commons.wikimedia.org/wiki/File:Relief_Map_of_Mediterranean_Sea.png) | Nzeemin | CC BY-SA 3.0 |

Corner coordinates from `Module:Location map/data/{Israel, Near East, Mediterranean}` on
en.wikipedia. Every image listed inside one such entry shares that entry's corners — which is why
a political blank and a relief blank of the same area are interchangeable without re-projecting,
and why swapping one is a `maps.json` edit rather than code.

Each file was downscaled from the Commons original and re-encoded as progressive JPEG (quality
80); no other change. The `@sm` variants (≈ 25–40 KB) are what the phone ships. CC BY-SA 3.0
covers the images and adaptations of them: the credit is rendered in the figure's caption at
runtime, and repeated in `THIRD_PARTY.md`.
