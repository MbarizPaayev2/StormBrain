"""Convert world-atlas countries-110m TopoJSON -> equirectangular SVG paths.

Output: storm-web/assets/js/worldmap-data.js
    window.WORLD_COUNTRIES = [{ id, name, d }, ...]

Projection (equirectangular, identical to stormmap.js):
    x = (lng + 180) / 360 * 1600      y = (90 - lat) / 180 * 800

Why this generator is written the way it is
-------------------------------------------
Rendering Natural Earth in equirectangular SVG has two classic artifacts.
Both of them were visible on the StormBrain map and are fixed here, at the
source, instead of being hidden with CSS:

1. Antimeridian wrap.  A ring that crosses the +/-180 meridian (Russia,
   Fiji, ...) is stored as a jump between +180 and -180.  Projected naively
   that jump becomes a line straight across the whole map (and a wrongly
   filled band).  Fix: UNWRAP each ring so its longitudes are continuous,
   then emit the +/-360 degree copies of the ring so the slice that falls
   off one edge reappears on the other edge.  stormmap.js clips the country
   layer to the map rectangle, so the copies never bleed outside the map.

2. Antarctica.  Its ring wraps the whole globe and is closed along the date
   line; that again draws a full-width line and leaves the continent as a
   thin cap.  Fix: close it down the bottom map edge instead, so it renders
   as one solid landmass.
"""
import json

EARTH_W, EARTH_H = 1600, 800
SRC = '_countries-110m.json'
OUT = 'storm-web/assets/js/worldmap-data.js'

topo = json.load(open(SRC, encoding='utf-8'))
sx, sy = topo['transform']['scale']
tx0, ty0 = topo['transform']['translate']


def decode_arc(arc):
    x = y = 0
    pts = []
    for dx, dy in arc:
        x += dx
        y += dy
        pts.append((x * sx + tx0, y * sy + ty0))
    return pts


ARCS = [decode_arc(a) for a in topo['arcs']]


def ring_points(indices):
    pts = []
    for idx in indices:
        arc = ARCS[~idx][::-1] if idx < 0 else ARCS[idx]
        pts.extend(arc[1:] if pts else arc)
    return pts


def unwrap(ring):
    """Ring -> same ring with continuous longitudes (no +/-180 jumps)."""
    out = [(ring[0][0], ring[0][1])]
    for lon, lat in ring[1:]:
        prev = out[-1][0]
        while lon - prev < -180.0:
            lon += 360.0
        while lon - prev > 180.0:
            lon -= 360.0
        out.append((lon, lat))
    return out


def project(lon, lat):
    return (lon + 180.0) / 360.0 * EARTH_W, (90.0 - lat) / 180.0 * EARTH_H


def dedup(pts):
    out = []
    for p in pts:
        c = (round(p[0], 1), round(p[1], 1))
        if not out or c != out[-1]:
            out.append(c)
    return out


def to_path(pts):
    pts = dedup(pts)
    if len(pts) < 3:
        return ''
    d = 'M' + 'L'.join('%g,%g' % p for p in pts) + 'Z'
    # a sub-path needs some real extent, otherwise it is a stray dot
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    if (max(xs) - min(xs)) < 0.35 and (max(ys) - min(ys)) < 0.35:
        return ''
    return d


def ring_paths(ring):
    """One source ring -> projected SVG path fragments."""
    r = unwrap(ring)
    lon_span = max(p[0] for p in r) - min(p[0] for p in r)

    if lon_span >= 359.0:
        # Wraps the whole globe (Antarctica): close it down the bottom edge.
        pts = [project(lon, lat) for lon, lat in r]
        pts.append((pts[-1][0], EARTH_H))
        pts.append((pts[0][0], EARTH_H))
        return [to_path(pts)]

    if r[0] != r[-1]:                      # make the ring explicitly closed
        r = r + [r[0]]
    base = [project(lon, lat) for lon, lat in r]
    xs = [p[0] for p in base]

    frags = []
    for k in (-1, 0, 1):                   # the world copy + its neighbours
        shift = k * EARTH_W
        if max(xs) + shift < 0 or min(xs) + shift > EARTH_W:
            continue
        frags.append(to_path([(x + shift, y) for x, y in base]))
    return [f for f in frags if f]


def rings_of(geo):
    if geo['type'] == 'Polygon':
        return geo['arcs']
    if geo['type'] == 'MultiPolygon':
        return [r for poly in geo['arcs'] for r in poly]
    return []


countries = []
globe_rings = []
for geo in topo['objects']['countries']['geometries']:
    name = (geo.get('properties') or {}).get('name') or geo.get('id') or 'Unknown'
    cid = str(geo.get('id') or '')
    d = ''
    for rl in rings_of(geo):
        ring = ring_points(rl)
        if len(ring) < 3:
            continue
        r = unwrap(ring)
        if max(p[0] for p in r) - min(p[0] for p in r) >= 359.0:
            globe_rings.append(name)
        d += ''.join(ring_paths(ring))
    if d:
        countries.append({'id': cid, 'name': name, 'd': d})

payload = json.dumps(countries, separators=(',', ':'), ensure_ascii=False)
js = ('/* Generated from world-atlas countries-110m (public domain Natural Earth).\n'
      ' * Equirectangular projection matching stormmap.js: 1600x800.\n'
      ' * Rings are unwrapped and copied across the antimeridian so no country\n'
      ' * is ever drawn straight through the date line; Antarctica is closed\n'
      ' * down the bottom edge. Regenerate with _gen_worldmap.py; do not hand-edit. */\n'
      'window.WORLD_COUNTRIES = ' + payload + ';\n')
open(OUT, 'w', encoding='utf-8').write(js)

print('countries:', len(countries), 'bytes:', len(js))
print('globe-spanning rings (closed along the map edge):', sorted(set(globe_rings)))

# --- sanity check: no full-width wrap line may survive ------------------
import re
worst = []
for c in countries:
    for sub in c['d'].split('M'):
        nums = re.findall(r'-?\d+\.?\d*', sub)
        pts = [(float(nums[i]), float(nums[i + 1])) for i in range(0, len(nums) - 1, 2)]
        mx = 0.0
        for i in range(1, len(pts)):
            mx = max(mx, abs(pts[i][0] - pts[i - 1][0]))
        if mx > 200:
            worst.append((c['name'], round(mx, 1)))
print('sub-paths with a horizontal jump > 200px:', worst)
