/* A world that changes with the water.
 *
 * This is not a drawing of the Earth. It is a field: a handful of blobs stand
 * in for the continents, summed into one elevation surface, and a grid is
 * sampled from it. Whether a cell is land is decided by the scenario's sea
 * level — so raising the water by eighty metres genuinely redraws the
 * coastlines rather than pretending to, and a scenario that drains the shelves
 * gets its extra land for free.
 *
 * The result is deliberately coarse. At this resolution it reads as a printed
 * dot map in an archive, which is the most the fiction should claim: these
 * are invented seas, and the map should not look like it knows better.
 */

/* Continents as anisotropic blobs, in degrees. `h` is how high the blob piles
   up; overlapping blobs add, which is what gives coastlines their kinks. */
const LAND = [
  // North America
  {lon:-104, lat:52, rx:36, ry:21, h:1.00},
  {lon:-91,  lat:36, rx:21, ry:14, h:0.86},
  {lon:-141, lat:63, rx:17, ry:11, h:0.78},
  {lon:-84,  lat:16, rx:12, ry:8,  h:0.55},
  // Greenland
  {lon:-42,  lat:73, rx:15, ry:9,  h:0.82},
  // South America
  {lon:-59,  lat:-7, rx:21, ry:16, h:0.98},
  {lon:-63,  lat:-24,rx:16, ry:14, h:0.92},
  {lon:-68,  lat:-40,rx:10, ry:14, h:0.82},
  // Europe
  {lon:22,   lat:54, rx:26, ry:14, h:0.78},
  {lon:6,    lat:46, rx:14, ry:9,  h:0.66},
  // Africa
  {lon:16,   lat:14, rx:27, ry:19, h:0.92},
  {lon:26,   lat:-14,rx:17, ry:19, h:0.86},
  {lon:44,   lat:-19,rx:6,  ry:8,  h:0.6},   // Madagascar
  // Asia
  {lon:86,   lat:56, rx:48, ry:21, h:1.00},
  {lon:102,  lat:36, rx:29, ry:16, h:0.90},
  {lon:78,   lat:22, rx:13, ry:13, h:0.86},
  {lon:98,   lat:16, rx:12, ry:11, h:0.74},
  {lon:114,  lat:0,  rx:18, ry:9,  h:0.58},
  // Australia
  {lon:134,  lat:-25,rx:19, ry:11, h:0.84},
];

/* Antarctica is a band, not a blob: it wraps the pole at every longitude. Its
   edge wanders with longitude, or the foot of the map reads as a printer's
   rule instead of a continent. */
const POLAR_CAP = {lat:-70, falloff:15, h:0.95};

/* Today's waterline in field units, and how much of it a metre of sea level
   buys. Calibrated against the range the scenarios can physically reach:
   about +60 m if every ice sheet goes, about -120 m at a glacial maximum.
   At that scale a metre has to count for more than it did when the archive
   still used invented numbers, or the coastlines would barely move. */
const SEA_TODAY = 0.34;
const PER_METRE = 1 / 700;

const wrapLon = (d) => ((d + 180) % 360 + 360) % 360 - 180;

/* Elevation at a point, in field units. Zero is deep ocean. */
export function elevationAt(lon, lat){
  let h = 0;
  for(const b of LAND){
    const dx = wrapLon(lon - b.lon) / b.rx;
    const dy = (lat - b.lat) / b.ry;
    const d = dx * dx + dy * dy;
    if(d < 1) h += b.h * (1 - d);
  }
  const rad = wrapLon(lon) * Math.PI / 180;
  const edge = POLAR_CAP.lat + 6 * Math.sin(rad * 2.1) + 3.5 * Math.cos(rad * 3.4 + 1.2);
  const polar = (edge - lat) / POLAR_CAP.falloff;
  if(polar > 0) h += POLAR_CAP.h * Math.min(1, polar) * (0.82 + 0.18 * Math.sin(rad * 4.3));
  return h;
}

/* Build the map for one scenario.
 *
 *   sea    metres of sea level relative to today; positive drowns coastlines
 *   marks  [{lon, lat}] where this variety is recorded
 *   cols   grid resolution across the full 360°
 */
export function worldMapSVG({sea = 0, marks = [], cols = 76} = {}){
  // The viewBox is degrees, so a mark can be placed from its coordinates
  // alone. Latitude is cropped: above 84° and below -88° there is nothing but
  // water and the edge of the projection, and the continents want the room.
  const latTop = 84, latBottom = -88;
  const w = 360, h = latTop - latBottom;
  const cw = w / cols;
  const rows = Math.max(1, Math.round(h / cw));
  const ch = h / rows;
  const waterline = SEA_TODAY + sea * PER_METRE;

  const land = [];
  const shelf = [];
  for(let iy = 0; iy < rows; iy++){
    const lat = latTop - (iy + 0.5) * ch;
    for(let ix = 0; ix < cols; ix++){
      const lon = -180 + (ix + 0.5) * cw;
      const e = elevationAt(lon, lat);
      const above = e - waterline;
      if(above <= 0){
        // ground that lies just under the water: the coastline that would be,
        // drawn faint so the map shows what the sea is holding
        if(above > -0.055) shelf.push([ix, iy]);
        continue;
      }
      land.push([ix, iy, Math.min(1, above / 0.42)]);
    }
  }

  const cx = (ix) => (ix + 0.5) * cw;
  const cy = (iy) => (iy + 0.5) * ch;

  const shelfDots = shelf.map(([ix, iy]) =>
    `<circle cx="${cx(ix).toFixed(2)}" cy="${cy(iy).toFixed(2)}" r="${(cw * 0.16).toFixed(2)}"/>`
  ).join('');

  // dot size carries height, so mountain interiors read darker than coasts
  const landDots = land.map(([ix, iy, t]) => {
    const r = cw * (0.24 + t * 0.24);
    return `<circle cx="${cx(ix).toFixed(2)}" cy="${cy(iy).toFixed(2)}" r="${r.toFixed(2)}"/>`;
  }).join('');

  const pins = marks.map(m => {
    const x = wrapLon(m.lon) + 180, y = latTop - m.lat;
    return `<g class="wm-mark" transform="translate(${x.toFixed(2)},${y.toFixed(2)})">
      <circle class="wm-halo" r="9"/><circle class="wm-pin" r="2.6"/></g>`;
  }).join('');

  return `<svg class="worldmap" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet"
      role="img" aria-label="Fiktive Verbreitungskarte">
    <rect class="wm-sea" x="0" y="0" width="${w}" height="${h}"/>
    <g class="wm-shelf">${shelfDots}</g>
    <g class="wm-land">${landDots}</g>
    <g class="wm-grat">
      <line x1="0" y1="${latTop}" x2="${w}" y2="${latTop}"/>
      <line x1="180" y1="0" x2="180" y2="${h}"/>
    </g>
    ${pins}
  </svg>`;
}

/* How the sea level reads in a caption. The wording comes from the caller's
   string table so the map speaks whatever language the page is set to. */
export function seaLabel(sea, strings = {}){
  const fill = (s, n) => s.replaceAll('{n}', n);
  if(Math.abs(sea) < 3) return strings.seaSame || 'Meeresspiegel wie heute';
  const n = Math.abs(Math.round(sea));
  if(sea > 0) return fill(strings.seaHigher || `Meeresspiegel {n} m höher als heute`, n);
  return fill(strings.seaLower || `Meeresspiegel {n} m tiefer als heute`, n);
}
