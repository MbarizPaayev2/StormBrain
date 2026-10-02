/* =====================================================================
 * stormmap.js -- StormBrain offline map engine
 * ---------------------------------------------------------------------
 * Dependency-free, API-free map renderer for the operator console.
 *
 * The engine draws a bundled equirectangular basemap
 * (/assets/img/worldmap.jpg, 1600x800 = 2:1) on a canvas, projects
 * latitude/longitude pairs with the standard equirectangular formula
 *
 *     x = (lng + 180) / 360 * W        y = (90 - lat) / 180 * H
 *
 * and renders interactive markers (GPS intel, IP geolocation) on top of
 * it. There is no tile server, no API key and no outbound network
 * request, so the map section of the panel keeps working on an
 * air-gapped host.
 *
 * Public API (window.StormMap):
 *   StormMap.create(containerOrId, { basemap, countries }) -> instance
 *   instance: addMarker / clearMarkers / fitBounds / flyTo / setView
 *             zoomBy / reset / resize / center / on / destroy
 * =================================================================== */
(function (window, document) {
    'use strict';

    var EARTH_W = 1600;      /* basemap width  in pixels */
    var EARTH_H = 800;       /* basemap height in pixels (2:1 equirectangular) */
    var CLIP_SEQ = 0;        /* unique id source for the country-layer clip */
    var MAX_SCALE = 10;      /* deepest zoom: screen px per basemap px */
    var PAD = 56;            /* padding used by fitBounds() */
    var MIN_SPAN = 4;        /* never zoom closer than this many degrees */

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function isNum(v) { return typeof v === 'number' && isFinite(v); }
    function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

    function StormMap(container, opts) {
        opts = opts || {};
        this.el = typeof container === 'string' ? document.getElementById(container) : container;
        if (!this.el) throw new Error('StormMap: container not found');

        /* basemap: string URL, or null for the plain black vector world map */
        this.basemap = (opts.basemap === null) ? null : (opts.basemap || '/assets/img/worldmap.jpg');
        /* decor: stars / neon arcs / ticker strips (off for the clean B/W map) */
        this.decor = opts.decor !== false;
        /* countries: SVG country layer (hover + IP highlighting) */
        this.countries = opts.countries !== false;

        this.markers = [];          /* {lat,lng,type,title,lines,time,el} */
        this.places = [];           /* highlighted cities {lat,lng,label,el} */
        this._hovered = null;       /* country path currently hovered (never moved) */
        this.scale = 1;
        this.tx = 0;
        this.ty = 0;
        this.minScale = 1;
        this.dpr = window.devicePixelRatio || 1;
        this.img = null;
        this.ready = false;

        this._events = {};
        this._raf = null;
        this._rafCyber = null;
        this._popup = null;
        this._anim = null;
        this._drag = null;
        this._world = null;       /* <g> holding the country paths */
        this._countryByNorm = {}; /* normalised name -> <path> */
        this._countryByCanon = {}; /* punctuation-free name -> <path> */
        this._litCountries = {};  /* normalised name -> true (persistent) */

        this._build();
        this._bindStage();
        if (this.basemap) this._loadImage();
        else { this.ready = true; this.resize(); this.emit('ready'); }

        var self = this;
        if (window.ResizeObserver) {
            this._ro = new window.ResizeObserver(function () { self.resize(); });
            this._ro.observe(this.el);
        }
        this._onWinResize = function () { self.resize(); };
        window.addEventListener('resize', this._onWinResize);
    }

    /* ------------------------------------------------------------------ */
    /* DOM construction                                                    */
    /* ------------------------------------------------------------------ */
    StormMap.prototype._build = function () {
        var el = this.el;
        el.classList.add('sbm');
        el.innerHTML = '';

        var stage = document.createElement('div');
        stage.className = 'sbm-stage';
        stage.setAttribute('tabindex', '0');
        stage.setAttribute('role', 'application');
        stage.setAttribute('aria-label', 'Offline target map');

        var canvas = document.createElement('canvas');
        canvas.className = 'sbm-canvas';

        /* SVG vector world map (countries with borders) sits over the
           black canvas backdrop, under the marker/popup layer. */
        var world = null;
        var svg = null;
        if (this.countries && window.WORLD_COUNTRIES) {
            var NS = 'http://www.w3.org/2000/svg';
            svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('class', 'sbm-svg');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.setAttribute('aria-hidden', 'true');

            /* Clip the country layer to the map rectangle. The data stores an
               extra +/-360 degree copy of every antimeridian-crossing country,
               so without this clip the neighbouring copy would show up past
               the left/right map edge. */
            this._clipId = 'sbm-clip-' + (++CLIP_SEQ);
            var defs = document.createElementNS(NS, 'defs');
            var clip = document.createElementNS(NS, 'clipPath');
            clip.setAttribute('id', this._clipId);
            this._clipRect = document.createElementNS(NS, 'rect');
            this._clipRect.setAttribute('x', '0');
            this._clipRect.setAttribute('y', '0');
            this._clipRect.setAttribute('width', String(EARTH_W));
            this._clipRect.setAttribute('height', String(EARTH_H));
            clip.appendChild(this._clipRect);
            defs.appendChild(clip);
            svg.appendChild(defs);

            var clipped = document.createElementNS(NS, 'g');
            clipped.setAttribute('clip-path', 'url(#' + this._clipId + ')');
            world = document.createElementNS(NS, 'g');
            world.setAttribute('class', 'sbm-world');
            clipped.appendChild(world);
            svg.appendChild(clipped);
            this._world = world;
        }

        var layer = document.createElement('div');
        layer.className = 'sbm-layer';

        stage.appendChild(canvas);
        /* Append the <svg> itself (world.parentNode is the inner clip <g> now,
           not the <svg>, so it must not be used here). */
        if (svg) stage.appendChild(svg);
        stage.appendChild(layer);

        var bar = document.createElement('div');
        bar.className = 'sbm-toolbar';
        bar.innerHTML =
            '<button type="button" class="sbm-btn" data-act="in" title="Zoom in" aria-label="Zoom in">+</button>' +
            '<button type="button" class="sbm-btn" data-act="out" title="Zoom out" aria-label="Zoom out">&minus;</button>' +
            '<button type="button" class="sbm-btn" data-act="fit" title="Fit all markers" aria-label="Fit all markers">&#9635;</button>' +
            '<button type="button" class="sbm-btn" data-act="reset" title="Reset view" aria-label="Reset view">&#8635;</button>' +
            '<button type="button" class="sbm-btn is-link" data-act="gmaps" title="Open this view in Google Maps" aria-label="Open this view in Google Maps">&#127760;</button>';

        var readout = document.createElement('div');
        readout.className = 'sbm-readout';
        readout.innerHTML =
            '<span class="sbm-readout-coords">Move the cursor over the map</span>' +
            '<span class="sbm-readout-zoom">1.0&times;</span>';

        var badge = document.createElement('div');
        badge.className = 'sbm-badge';
        badge.innerHTML = '<span class="sbm-badge-dot"></span>OFFLINE BASEMAP &middot; EQUIRECTANGULAR 2:1';

        el.appendChild(stage);
        el.appendChild(bar);
        el.appendChild(readout);
        el.appendChild(badge);

        this.stage = stage;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.layer = layer;
        this.readoutCoords = readout.querySelector('.sbm-readout-coords');
        this.readoutZoom = readout.querySelector('.sbm-readout-zoom');
        this.bar = bar;

        if (this._world) this._buildCountries();
    };

    /* ---- country paths (hover / IP highlight) ---------------------- */
    function normCountry(name) {
        var n = String(name == null ? '' : name).toLowerCase().trim()
            .replace(/\./g, '')
            .replace(/\s+/g, ' ');
        var aliases = {
            'united states of america': 'united states',
            'usa': 'united states', 'us': 'united states',
            'united kingdom': 'united kingdom', 'uk': 'united kingdom',
            'great britain': 'united kingdom', 'england': 'united kingdom',
            'russian federation': 'russia',
            'republic of korea': 'south korea', 'korea, south': 'south korea',
            'democratic people\'s republic of korea': 'north korea',
            'korea, north': 'north korea',
            'czech republic': 'czechia',
            'viet nam': 'vietnam',
            'turkiye': 'turkey',
            'ivory coast': "côte d'ivoire", "cote d'ivoire": "côte d'ivoire",
            'united republic of tanzania': 'tanzania',
            'republic of the congo': 'congo', 'dem rep congo': 'dr congo',
            'democratic republic of the congo': 'dr congo',
            'bosnia and herzegovina': 'bosnia and herz',
            'north macedonia': 'macedonia',
            'syrian arab republic': 'syria',
            'iran (islamic republic of)': 'iran',
            'bolivia (plurinational state of)': 'bolivia',
            'venezuela (bolivarian republic of)': 'venezuela',
            'brunei darussalam': 'brunei',
            'dominican republic': 'dominican rep',
            'central african republic': 'central african rep',
            'south sudan': 's sudan',
            'lao people\'s democratic republic': 'laos'
        };
        return aliases[n] || n;
    }

    /* Punctuation-insensitive key: "Dem. Rep. Congo" -> "dem rep congo".
       ipwho.is and the Natural Earth dataset name countries differently (dots,
       commas, parentheses). Normalising the dots away before the alias lookup
       used to make dotted aliases unreachable, so IP countries silently
       failed to light up. */
    function canonName(name) {
        return String(name == null ? '' : name).toLowerCase()
            .replace(/[^a-z\u00c0-\u024f]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    StormMap.prototype._buildCountries = function () {
        var NS = 'http://www.w3.org/2000/svg';
        var g = this._world, i, c, path, nn, cn;
        for (i = 0; i < window.WORLD_COUNTRIES.length; i++) {
            c = window.WORLD_COUNTRIES[i];
            path = document.createElementNS(NS, 'path');
            path.setAttribute('d', c.d);
            path.setAttribute('class', 'sbm-country');
            path.setAttribute('data-name', c.name);
            if (c.id) path.setAttribute('data-id', c.id);
            nn = normCountry(c.name);
            cn = canonName(nn) || canonName(c.name);
            this._countryByNorm[nn] = path;
            this._countryByCanon[cn] = path;
            /* also index the raw lower-case name for exact matching */
            if (!this._countryByNorm[String(c.name).toLowerCase()]) {
                this._countryByNorm[String(c.name).toLowerCase()] = path;
            }
            if (!this._countryByCanon[canonName(c.name)]) {
                this._countryByCanon[canonName(c.name)] = path;
            }
            g.appendChild(path);
        }

        /* Single painted-above clone used to show the enlargement. */
        this._hoverLayer = document.createElementNS(NS, 'path');
        this._hoverLayer.setAttribute('class', 'sbm-country-hoverlayer');
        g.appendChild(this._hoverLayer);

        this._bindCountryHover(g);
    };

    /* Mirror the hovered country into the always-on-top clone (pointer-events:
       none), so its enlargement is visible over neighbours without ever
       re-inserting the hovered node (which would break :hover). */
    StormMap.prototype._syncHoverLayer = function (path) {
        var layer = this._hoverLayer;
        if (!layer) return;
        if (!path) {
            layer.classList.remove('is-active', 'is-lit-layer');
            return;
        }
        layer.setAttribute('d', path.getAttribute('d') || '');
        layer.classList.toggle('is-lit-layer', path.classList.contains('is-lit'));
        layer.classList.add('is-active');
    };

    /* Hover: style the country through a class instead of moving it.
       Re-appending the path under the cursor (the old implementation) drops
       the :hover state in Chromium, so the country never visibly enlarged and
       the DOM churned on every mouse move. */
    StormMap.prototype._bindCountryHover = function (g) {
        var self = this;

        g.addEventListener('pointerover', function (ev) {
            var t = ev.target;
            if (!t || !t.classList || !t.classList.contains('sbm-country')) return;
            if (self._hovered === t) return;
            if (self._hovered) self._hovered.classList.remove('is-hover');
            self._hovered = t;
            t.classList.add('is-hover');
            self._syncHoverLayer(t);
            self.emit('countryhover', {
                name: t.getAttribute('data-name'),
                id: t.getAttribute('data-id'),
                state: 'over'
            });
        });

        g.addEventListener('pointerout', function (ev) {
            var t = ev.target;
            if (!t || !t.classList || !t.classList.contains('sbm-country')) return;
            /* Still inside the same country: keep the enlargement. */
            var to = ev.relatedTarget;
            if (to === t) return;
            if (to && t.contains && t.contains(to)) return;
            t.classList.remove('is-hover');
            if (self._hovered === t) self._hovered = null;
            self._syncHoverLayer(self._hovered);
            self.emit('countryhover', {
                name: t.getAttribute('data-name'),
                id: t.getAttribute('data-id'),
                state: 'out'
            });
        });

        g.addEventListener('pointerleave', function () {
            if (self._hovered) {
                self._hovered.classList.remove('is-hover');
                self._hovered = null;
            }
            self._syncHoverLayer(null);
        });
    };

    /* Resolve an arbitrary country label ("Azerbaijan", "Bosnia and Herz.",
       "United States of America") to a path: exact -> alias -> canonical ->
       unambiguous word fallback. */
    StormMap.prototype._findCountryPath = function (name) {
        if (!this._world) return null;
        var raw = String(name == null ? '' : name).toLowerCase().trim();
        if (!raw) return null;

        var nn = normCountry(name);
        var path = this._countryByNorm[nn]
            || this._countryByNorm[nn.replace(/ \(.*\)$/, '')]
            || this._countryByNorm[raw];
        if (path) return path;

        path = this._countryByCanon[canonName(nn)]
            || this._countryByCanon[canonName(raw)];
        if (path) return path;

        var words = canonName(nn).split(' ').filter(function (w) { return w.length > 3; });
        if (!words.length) return null;
        var keys = Object.keys(this._countryByCanon), hit = null, ambiguous = false;
        for (var k = 0; k < keys.length; k++) {
            var key = keys[k], all = true;
            for (var w = 0; w < words.length; w++) {
                if (key.indexOf(words[w]) === -1) { all = false; break; }
            }
            if (all) {
                if (hit && hit !== key) { ambiguous = true; break; }
                hit = key;
            }
        }
        return ambiguous ? null : (hit ? this._countryByCanon[hit] : null);
    };

    /* Keep the vector layer locked to the canvas pan/zoom transform, and keep
       the clip rectangle sitting exactly over the map (so nothing is drawn
       outside the map, in any viewport size or zoom level). */
    StormMap.prototype._syncWorld = function () {
        if (!this._world) return;
        this._world.setAttribute('transform',
            'translate(' + this.tx + ',' + this.ty + ') scale(' + this.scale + ')');
        if (this._clipRect) {
            this._clipRect.setAttribute('x', this.tx);
            this._clipRect.setAttribute('y', this.ty);
            this._clipRect.setAttribute('width', String(EARTH_W * this.scale));
            this._clipRect.setAttribute('height', String(EARTH_H * this.scale));
        }
    };

    /* Light a country up (IP -> country). Returns true when found. */
    StormMap.prototype.highlightCountry = function (name) {
        var path = this._findCountryPath(name);
        if (!path) return false;
        path.classList.add('is-lit');
        this._litCountries[canonName(name)] = true;
        this.emit('countrylit', {
            name: name,
            path: path,
            canonical: path.getAttribute('data-name')
        });
        return true;
    };

    StormMap.prototype.clearCountryHighlights = function () {
        var k, list = this._world ? this._world.querySelectorAll('.sbm-country.is-lit') : [];
        for (k = 0; k < list.length; k++) list[k].classList.remove('is-lit');
        this._litCountries = {};
    };

    StormMap.prototype.litCountryCount = function () {
        return this._world ? this._world.querySelectorAll('.sbm-country.is-lit').length : 0;
    };

    /* ---- city / place highlights (country + city from IP logs) -------- */
    StormMap.prototype.addPlace = function (place) {
        place = place || {};
        var lat = Number(place.lat), lng = Number(place.lng || place.lon);
        if (!isNum(lat) || !isNum(lng)) return null;

        var el = document.createElement('div');
        el.className = 'sbm-place' + (place.kind === 'gps' ? ' sbm-place-gps' : '');
        var label = String(place.city || place.label || place.country || '');
        el.innerHTML = '<span class="sbm-place-ring"></span>' +
            '<span class="sbm-place-dot"></span>' +
            (label ? '<span class="sbm-place-label"></span>' : '');
        if (label) {
            var lbl = el.querySelector('.sbm-place-label');
            lbl.textContent = label;
            el.setAttribute('title', place.title || label);
        }

        var entry = {
            lat: lat, lng: lng,
            city: place.city || label,
            country: place.country || '',
            ip: place.ip || '',
            kind: place.kind || 'ip',
            el: el
        };

        var self = this;
        el.addEventListener('click', function (ev) {
            ev.stopPropagation();
            self.emit('placeclick', entry);
        });

        this.layer.appendChild(el);
        this.places.push(entry);
        this.layoutPlaces();
        return entry;
    };

    StormMap.prototype.layoutPlaces = function () {
        var s = this.size(), i, p, el, pt, inside;
        for (i = 0; i < this.places.length; i++) {
            p = this.places[i];
            el = p.el;
            if (!el) continue;
            pt = this.toScreen(p.lat, p.lng);
            inside = pt.x > -80 && pt.x < s.w + 80 && pt.y > -60 && pt.y < s.h + 60;
            el.style.display = inside ? '' : 'none';
            if (inside) {
                el.style.transform = 'translate3d(' + pt.x + 'px,' + pt.y + 'px,0)';
            }
        }
    };

    StormMap.prototype.clearPlaces = function () {
        for (var i = 0; i < this.places.length; i++) {
            var el = this.places[i].el;
            if (el && el.parentNode) el.parentNode.removeChild(el);
        }
        this.places = [];
    };

    StormMap.prototype.placeCount = function () {
        return this.places.length;
    };

    StormMap.prototype._loadImage = function () {
        var self = this;
        var img = new Image();
        img.onload = function () {
            self.img = img;
            self.ready = true;
            self.resize();
            self.emit('ready');
        };
        img.onerror = function () {
            self.img = null;
            self.ready = true;
            self.el.classList.add('sbm-nobase');
            self.resize();
            self.emit('ready');
        };
        img.src = this.basemap;
    };

    /* ------------------------------------------------------------------ */
    /* Geometry                                                            */
    /* ------------------------------------------------------------------ */
    StormMap.prototype.project = function (lat, lng) {
        return {
            x: (clamp(Number(lng) || 0, -180, 180) + 180) / 360 * EARTH_W,
            y: (90 - clamp(Number(lat) || 0, -90, 90)) / 180 * EARTH_H
        };
    };

    StormMap.prototype.unproject = function (x, y) {
        return { lat: 90 - (y / EARTH_H) * 180, lng: (x / EARTH_W) * 360 - 180 };
    };

    StormMap.prototype.toScreen = function (lat, lng) {
        var p = this.project(lat, lng);
        return { x: this.tx + p.x * this.scale, y: this.ty + p.y * this.scale };
    };

    StormMap.prototype.size = function () {
        return { w: this.stage.clientWidth || 720, h: this.stage.clientHeight || 420 };
    };

    /* Geographic coordinates under the middle of the viewport. Used by the
       "Open in Google Maps" action so the operator can jump from the offline
       vector map to the real one without searching by hand. */
    StormMap.prototype.center = function () {
        var s = this.size();
        var ll = this._cursorLatLng(s.w / 2, s.h / 2);
        return {
            lat: ll ? ll.lat : 0,
            lng: ll ? ll.lng : 0,
            zoom: this.zoomLabel()
        };
    };

    StormMap.prototype.zoomLabel = function () {
        var s = this.size();
        var fit = Math.min(s.w / EARTH_W, s.h / EARTH_H) || 1;
        return (this.scale / fit).toFixed(1) + '\u00d7';
    };

    /* Keep the basemap covering the viewport; only letterbox when the
       container is wider/taller than a true 2:1 map ratio. */
    StormMap.prototype._clampView = function () {
        var s = this.size();
        var w = EARTH_W * this.scale, h = EARTH_H * this.scale;

        if (w <= s.w) this.tx = (s.w - w) / 2;
        else this.tx = clamp(this.tx, s.w - w, 0);

        if (h <= s.h) this.ty = (s.h - h) / 2;
        else this.ty = clamp(this.ty, s.h - h, 0);
    };

    StormMap.prototype._computeMinScale = function () {
        var s = this.size();
        this.minScale = Math.min(s.w / EARTH_W, s.h / EARTH_H) || 0.2;
    };

    StormMap.prototype.resize = function () {
        var s = this.size();
        var dpr = this.dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.max(1, Math.round(s.w * dpr));
        this.canvas.height = Math.max(1, Math.round(s.h * dpr));
        this.canvas.style.width = s.w + 'px';
        this.canvas.style.height = s.h + 'px';
        this._computeMinScale();
        if (this.scale < this.minScale) this.scale = this.minScale;
        this._clampView();
        this.requestDraw();
        this.layoutMarkers();
    };

    /* ------------------------------------------------------------------ */
    /* Rendering                                                           */
    /* ------------------------------------------------------------------ */
    StormMap.prototype.requestDraw = function () {
        var self = this;
        if (this._raf) return;
        this._raf = window.requestAnimationFrame(function () {
            self._raf = null;
            self.draw();
        });
        /* Ambient loop keeps neon arcs + ticker alive (~12fps). */
        if (this.decor && !this._rafCyber) {
            this._rafCyber = 1;
            var loop = function () {
                if (!self.el || !self.el.isConnected) { self._rafCyber = null; return; }
                self.draw();
                self._rafCyber = window.setTimeout(function () {
                    window.requestAnimationFrame(loop);
                }, 80);
            };
            window.setTimeout(function () { window.requestAnimationFrame(loop); }, 150);
        }
    };

    StormMap.prototype.draw = function () {
        var ctx = this.ctx;
        if (!ctx) return;
        var s = this.size();
        var dpr = this.dpr;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        /* Keep the vector country layer locked to the current view. */
        this._syncWorld();

        /* Ocean backdrop: black in the dark theme, light slate in the light
           theme (the canvas is theme-aware; CSS alone cannot repaint it). */
        var light = (document.documentElement.getAttribute('data-theme') === 'light');
        var bg = ctx.createLinearGradient(0, 0, 0, s.h * dpr);
        if (light) {
            bg.addColorStop(0, '#dfe7ef');
            bg.addColorStop(1, '#cbd6e2');
        } else {
            bg.addColorStop(0, '#000000');
            bg.addColorStop(1, '#060606');
        }
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.decor) this._drawStars(ctx, s);

        if (this.img) {
            ctx.setTransform(this.scale * dpr, 0, 0, this.scale * dpr,
                this.tx * dpr, this.ty * dpr);
            ctx.imageSmoothingEnabled = true;
            /* Force monochrome in the dark theme; keep natural tones in the
               light theme so the basemap does not sit on a black rectangle. */
            try { ctx.filter = light ? 'contrast(1.05) brightness(1.05)' : 'grayscale(1) contrast(1.25) brightness(0.82)'; }
            catch (e) { /* basemap filter unsupported */ }
            ctx.drawImage(this.img, 0, 0, EARTH_W, EARTH_H);
            try { ctx.filter = 'none'; } catch (e2) {}
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        }

        if (this.decor && !light) {
            /* Neon attack arcs over the B/W basemap (cyber-map look). */
            this._drawCyberLinks(ctx, s);

            /* Vignette keeps the basemap edges from competing with the UI. */
            var vg = ctx.createRadialGradient(
                s.w * dpr / 2, s.h * dpr / 2, Math.min(s.w, s.h) * dpr * 0.25,
                s.w * dpr / 2, s.h * dpr / 2, Math.max(s.w, s.h) * dpr * 0.78);
            vg.addColorStop(0, 'rgba(0,0,0,0)');
            vg.addColorStop(1, 'rgba(0,0,0,0.42)');
            ctx.fillStyle = vg;
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        if (!this.img && this.basemap) {
            ctx.fillStyle = 'rgba(230,237,243,0.72)';
            ctx.font = (12 * dpr) + 'px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('Basemap asset unavailable - coordinate grid only',
                s.w * dpr / 2, s.h * dpr / 2);
        }

        if (this.decor) this._drawTicker(ctx, s);

        this.readoutZoom.textContent = this.zoomLabel();
    };

    /* Starfield + ambient cyber traffic (monochrome-safe helpers). */
    StormMap.prototype._ensureStars = function (s) {
        var w = Math.round(s.w), h = Math.round(s.h);
        if (this._stars && this._starsW === w && this._starsH === h) return;
        var arr = [], i;
        for (i = 0; i < 140; i++) {
            arr.push({ x: Math.random(), y: Math.random(),
                r: 0.4 + Math.random() * 1.1, a: 0.12 + Math.random() * 0.4 });
        }
        this._stars = arr; this._starsW = w; this._starsH = h;
    };

    StormMap.prototype._drawStars = function (ctx, s) {
        this._ensureStars(s);
        var dpr = this.dpr, i, st;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        for (i = 0; i < this._stars.length; i++) {
            st = this._stars[i];
            ctx.globalAlpha = st.a;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(st.x * s.w * dpr, st.y * s.h * dpr, st.r * dpr, 0, 6.2832);
            ctx.fill();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    };

    StormMap.prototype._cyberPairs = function () {
        var pairs = [], i;
        if (this.markers.length >= 2) {
            for (i = 1; i < this.markers.length && i < 8; i++) {
                pairs.push({ a: this.markers[i - 1], b: this.markers[i],
                    hue: i % 2 ? '255,43,214' : '0,212,255' });
            }
            return pairs;
        }
        var ambient = [
            [51.5, -0.1, 40.7, -74.0], [48.8, 2.3, 35.6, 139.6],
            [55.7, 37.6, 25.2, 55.2], [1.3, 103.8, -33.8, 151.2],
            [52.5, 13.4, 41.0, 28.9], [19.0, 72.8, 51.5, -0.1]
        ];
        var t = ((Date.now() / 4000) | 0) % ambient.length, k;
        for (k = 0; k < 5; k++) {
            var p = ambient[(t + k) % ambient.length];
            pairs.push({ a: { lat: p[0], lng: p[1] }, b: { lat: p[2], lng: p[3] },
                hue: k % 2 ? '255,43,214' : '0,212,255' });
        }
        return pairs;
    };

    StormMap.prototype._drawCyberLinks = function (ctx, s) {
        var pairs = this._cyberPairs();
        if (!pairs.length) return;
        var dpr = this.dpr, i, A, B, mx, my;
        var t = (Date.now() % 3000) / 3000;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.lineWidth = Math.max(1, 1.4 * dpr);
        ctx.shadowBlur = 8 * dpr;
        for (i = 0; i < pairs.length; i++) {
            A = this.toScreen(pairs[i].a.lat, pairs[i].a.lng);
            B = this.toScreen(pairs[i].b.lat, pairs[i].b.lng);
            mx = (A.x + B.x) / 2;
            my = Math.min(A.y, B.y) - Math.hypot(B.x - A.x, B.y - A.y) * 0.28 - 30;
            ctx.shadowColor = 'rgba(' + pairs[i].hue + ',0.9)';
            ctx.strokeStyle = 'rgba(' + pairs[i].hue + ',0.85)';
            ctx.setLineDash([6 * dpr, 5 * dpr]);
            ctx.beginPath();
            ctx.moveTo(A.x * dpr, A.y * dpr);
            ctx.quadraticCurveTo(mx * dpr, my * dpr, B.x * dpr, B.y * dpr);
            ctx.stroke();
            var px = (1 - t) * (1 - t) * A.x + 2 * (1 - t) * t * mx + t * t * B.x;
            var py = (1 - t) * (1 - t) * A.y + 2 * (1 - t) * t * my + t * t * B.y;
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.beginPath();
            ctx.arc(px * dpr, py * dpr, 2.2 * dpr, 0, 6.2832);
            ctx.fill();
        }
        ctx.restore();
    };

    StormMap.prototype._drawTicker = function (ctx, s) {
        var dpr = this.dpr, h = 22 * dpr, y0 = s.h * dpr - h, i, v;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.fillRect(0, y0, s.w * dpr, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.beginPath();
        ctx.moveTo(0, y0 + 0.5);
        ctx.lineTo(s.w * dpr, y0 + 0.5);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = (10 * dpr) + 'px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        var n = Math.max(3, Math.floor(s.w / 130));
        for (i = 0; i < n; i++) {
            v = String(100000 + (((Date.now() / 900 + i * 7919) | 0) % 9000000));
            ctx.fillText(v, (14 + i * 130) * dpr, y0 + 14.5 * dpr);
        }
        ctx.restore();
    };

    /* ------------------------------------------------------------------ */
    /* Markers                                                             */
    /* ------------------------------------------------------------------ */
    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    StormMap.prototype.addMarker = function (m) {
        m = m || {};
        var lat = Number(m.lat), lng = Number(m.lng);
        if (!isNum(lat) || !isNum(lng)) return null;

        var type = m.type === 'ip' ? 'ip' : 'gps';
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'sbm-marker sbm-marker-' + type;
        el.innerHTML = '<span class="sbm-marker-halo"></span><span class="sbm-marker-pin"></span>' +
            (m.label ? '<span class="sbm-marker-label">' + escapeHtml(m.label) + '</span>' : '');

        var marker = {
            lat: lat,
            lng: lng,
            type: type,
            title: m.title || (type === 'ip' ? 'IP geolocation' : 'GPS intel'),
            lines: m.lines || [],
            time: m.time || new Date().toLocaleString(),
            label: m.label || '',
            el: el
        };

        var self = this;
        el.addEventListener('click', function (ev) {
            ev.stopPropagation();
            self.openPopup(marker);
            self.emit('markerclick', marker);
        });
        el.addEventListener('mouseenter', function () {
            el.classList.add('sbm-marker-hover');
        });
        el.addEventListener('mouseleave', function () {
            el.classList.remove('sbm-marker-hover');
        });

        this.layer.appendChild(el);
        this.markers.push(marker);
        this.layoutMarkers();
        return marker;
    };

    StormMap.prototype.layoutMarkers = function () {
        var s = this.size();
        for (var i = 0; i < this.markers.length; i++) {
            var mk = this.markers[i];
            var p = this.toScreen(mk.lat, mk.lng);
            var inside = p.x > -60 && p.x < s.w + 60 && p.y > -60 && p.y < s.h + 60;
            mk.el.style.display = inside ? '' : 'none';
            if (inside) {
                mk.el.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0)';
                mk.el.style.zIndex = String(100 + Math.round(p.y));
            }
        }
        if (this._popup && this._popup.dataset.for) {
            var open = this._markerById(this._popup.dataset.for);
            if (open) this._placePopup(open);
        }
        /* City highlights live in the same screen space: keep them glued to
           the basemap while panning/zooming/flying. */
        this.layoutPlaces();
    };

    StormMap.prototype._markerById = function (id) {
        for (var i = 0; i < this.markers.length; i++) {
            if (String(i) === String(id)) return this.markers[i];
        }
        return null;
    };

    StormMap.prototype._ensurePopup = function () {
        if (this._popup) return this._popup;
        var el = document.createElement('div');
        el.className = 'sbm-popup';
        el.hidden = true;
        el.innerHTML = '<button type="button" class="sbm-popup-close" aria-label="Close">&times;</button>' +
            '<div class="sbm-popup-body"></div>';
        var self = this;
        el.querySelector('.sbm-popup-close').addEventListener('click', function (ev) {
            ev.stopPropagation();
            self.closePopup();
        });
        this.stage.appendChild(el);
        this._popup = el;
        return el;
    };

    StormMap.prototype.openPopup = function (marker) {
        var pop = this._ensurePopup();
        var idx = this.markers.indexOf(marker);
        var rows = '';
        if (marker.lines && marker.lines.length) {
            rows = '<dl class="sbm-popup-rows">';
            for (var i = 0; i < marker.lines.length; i++) {
                var ln = marker.lines[i] || {};
                rows += '<dt>' + escapeHtml(ln.label || '') + '</dt><dd>' + escapeHtml(ln.value || '') + '</dd>';
            }
            rows += '</dl>';
        }
        pop.querySelector('.sbm-popup-body').innerHTML =
            '<div class="sbm-popup-head"><span class="sbm-popup-type">' + escapeHtml(marker.title) + '</span>' +
            '<span class="sbm-popup-kind sbm-kind-' + marker.type + '">' + marker.type.toUpperCase() + '</span></div>' +
            '<div class="sbm-popup-coords">' + marker.lat.toFixed(4) + ', ' + marker.lng.toFixed(4) + '</div>' +
            rows +
            '<div class="sbm-popup-time">' + escapeHtml(marker.time) + '</div>' +
            '<a class="sbm-popup-maps" target="_blank" rel="noopener" ' +
            'href="https://www.google.com/maps?q=' + marker.lat + ',' + marker.lng + '">Open in Google Maps &#8599;</a>';
        pop.dataset.for = String(idx);
        pop.hidden = false;
        this._placePopup(marker);
    };

    StormMap.prototype._placePopup = function (marker) {
        var pop = this._popup;
        if (!pop || pop.hidden) return;
        var s = this.size();
        var p = this.toScreen(marker.lat, marker.lng);
        var w = pop.offsetWidth || 240;
        var h = pop.offsetHeight || 150;
        var x = clamp(p.x - w / 2, 8, Math.max(8, s.w - w - 8));
        var y = p.y - h - 18;
        if (y < 8) y = p.y + 20;
        pop.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0)';
    };

    StormMap.prototype.closePopup = function () {
        if (this._popup) {
            this._popup.hidden = true;
            this._popup.dataset.for = '';
        }
    };

    StormMap.prototype.clearMarkers = function () {
        this.closePopup();
        for (var i = 0; i < this.markers.length; i++) {
            if (this.markers[i].el.parentNode) this.markers[i].el.parentNode.removeChild(this.markers[i].el);
        }
        this.markers = [];
    };

    StormMap.prototype.markerCount = function () { return this.markers.length; };

    /* ------------------------------------------------------------------ */
    /* View control                                                        */
    /* ------------------------------------------------------------------ */
    StormMap.prototype.setView = function (lat, lng, scale, animateMs) {
        var s = this.size();
        var target = clamp(scale || this.scale, this.minScale, MAX_SCALE);
        var p = this.project(isNum(lat) ? lat : 0, isNum(lng) ? lng : 0);
        var tx = s.w / 2 - p.x * target;
        var ty = s.h / 2 - p.y * target;

        if (!animateMs) {
            this.scale = target;
            this.tx = tx;
            this.ty = ty;
            this._clampView();
            this.requestDraw();
            this.layoutMarkers();
            this.emit('move');
            return;
        }

        var from = { scale: this.scale, tx: this.tx, ty: this.ty };
        var to = { scale: target, tx: tx, ty: ty };
        this._animateTo(from, to, animateMs);
    };

    StormMap.prototype._animateTo = function (from, to, ms) {
        var self = this;
        var start = window.performance && performance.now ? performance.now() : Date.now();
        if (this._anim) window.cancelAnimationFrame(this._anim);

        function step(now) {
            var t = clamp(((now || Date.now()) - start) / ms, 0, 1);
            var k = ease(t);
            self.scale = from.scale + (to.scale - from.scale) * k;
            self.tx = from.tx + (to.tx - from.tx) * k;
            self.ty = from.ty + (to.ty - from.ty) * k;
            self._clampView();
            self.draw();
            self.layoutMarkers();
            if (t < 1) self._anim = window.requestAnimationFrame(step);
            else { self._anim = null; self.emit('move'); }
        }
        this._anim = window.requestAnimationFrame(step);
    };

    StormMap.prototype.zoomBy = function (factor, cx, cy) {
        var s = this.size();
        cx = isNum(cx) ? cx : s.w / 2;
        cy = isNum(cy) ? cy : s.h / 2;
        var next = clamp(this.scale * factor, this.minScale, MAX_SCALE);
        if (next === this.scale) return;
        this.tx = cx - (cx - this.tx) * (next / this.scale);
        this.ty = cy - (cy - this.ty) * (next / this.scale);
        this.scale = next;
        this._clampView();
        this.requestDraw();
        this.layoutMarkers();
        this.emit('zoom', this.scale);
    };

    StormMap.prototype.reset = function () {
        this.scale = this.minScale;
        this.ty = this.size().h / 2 - (EARTH_H * this.scale) / 2 + 0;
        this.tx = this.size().w / 2 - (EARTH_W * this.scale) / 2;
        this._clampView();
        this.closePopup();
        this.requestDraw();
        this.layoutMarkers();
    };

    /* Fit every marker (or an explicit list) into the viewport. */
    StormMap.prototype.fitBounds = function (list, animateMs, maxScale) {
        var pts = list && list.length ? list : this.markers;
        if (!pts.length) return false;

        var minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        for (var i = 0; i < pts.length; i++) {
            minLat = Math.min(minLat, pts[i].lat);
            maxLat = Math.max(maxLat, pts[i].lat);
            minLng = Math.min(minLng, pts[i].lng);
            maxLng = Math.max(maxLng, pts[i].lng);
        }

        var s = this.size();
        var spanLat = Math.max(maxLat - minLat, MIN_SPAN);
        var spanLng = Math.max(maxLng - minLng, MIN_SPAN);
        var scaleX = (s.w - PAD * 2) / (spanLng / 360 * EARTH_W);
        var scaleY = (s.h - PAD * 2) / (spanLat / 180 * EARTH_H);
        var target = clamp(Math.min(scaleX, scaleY), this.minScale,
            clamp(maxScale || MAX_SCALE, this.minScale, MAX_SCALE));

        this.setView((minLat + maxLat) / 2, (minLng + maxLng) / 2, target, animateMs || 0);
        return true;
    };

    StormMap.prototype.flyTo = function (lat, lng, scale, ms) {
        this.pingAt(lat, lng);
        this.setView(lat, lng, scale || Math.max(this.minScale * 4, this.scale), ms || 900);
    };

    /* Transient radar ping used by flyTo()/new intel. */
    StormMap.prototype.pingAt = function (lat, lng) {
        var p = this.toScreen(lat, lng);
        var el = document.createElement('span');
        el.className = 'sbm-ping';
        el.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0)';
        this.stage.appendChild(el);
        window.setTimeout(function () {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 1600);
    };

    /* ------------------------------------------------------------------ */
    /* Interaction                                                         */
    /* ------------------------------------------------------------------ */
    StormMap.prototype._cursorLatLng = function (cx, cy) {
        var wx = (cx - this.tx) / this.scale;
        var wy = (cy - this.ty) / this.scale;
        if (wx < 0 || wx > EARTH_W || wy < 0 || wy > EARTH_H) return null;
        return this.unproject(wx, wy);
    };

    StormMap.prototype._bindStage = function () {
        var self = this;
        var stage = this.stage;
        var pointers = {};
        var drag = null;
        var pinch = null;

        this.bar.addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
            if (!btn) return;
            var act = btn.getAttribute('data-act');
            if (act === 'in') self.zoomBy(1.7);
            else if (act === 'out') self.zoomBy(1 / 1.7);
            else if (act === 'fit') self.fitBounds(null, 700);
            else if (act === 'reset') self.reset();
            else if (act === 'gmaps') self.emit('gmaps', self.center());
        });

        /* Zoom/scroll is bound to the stage, not the canvas: the SVG country
           layer sits on top of the canvas and its paths use pointer-events:auto,
           so a wheel/dblclick over LAND went to the <path> and never reached the
           canvas - scrolling only ever zoomed when the cursor was over ocean. */
        stage.addEventListener('wheel', function (ev) {
            ev.preventDefault();
            var rect = stage.getBoundingClientRect();
            self.zoomBy(Math.exp(-ev.deltaY * 0.0015), ev.clientX - rect.left, ev.clientY - rect.top);
        }, { passive: false });

        stage.addEventListener('dblclick', function (ev) {
            var rect = stage.getBoundingClientRect();
            self.zoomBy(1.9, ev.clientX - rect.left, ev.clientY - rect.top);
        });

        stage.addEventListener('pointerdown', function (ev) {
            if (stage.setPointerCapture) {
                try { stage.setPointerCapture(ev.pointerId); } catch (e) {}
            }
            pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
            var ids = Object.keys(pointers);
            if (ids.length === 1) {
                drag = { x: ev.clientX, y: ev.clientY, tx: self.tx, ty: self.ty, moved: 0 };
                stage.classList.add('is-dragging');
            } else if (ids.length === 2) {
                drag = null;
                var pts = ids.map(function (id) { return pointers[id]; });
                pinch = {
                    dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
                    scale: self.scale
                };
            }
        });

        stage.addEventListener('pointermove', function (ev) {
            var rect = stage.getBoundingClientRect();
            var cx = ev.clientX - rect.left;
            var cy = ev.clientY - rect.top;

            if (pointers[ev.pointerId]) {
                pointers[ev.pointerId].x = ev.clientX;
                pointers[ev.pointerId].y = ev.clientY;
            }

            var ids = Object.keys(pointers);
            if (ids.length >= 2 && pinch) {
                var pts = ids.slice(0, 2).map(function (id) { return pointers[id]; });
                var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                var mid = {
                    x: (pts[0].x + pts[1].x) / 2 - rect.left,
                    y: (pts[0].y + pts[1].y) / 2 - rect.top
                };
                if (dist > 8 && pinch.dist > 8) {
                    self.zoomBy((pinch.scale * (dist / pinch.dist)) / self.scale, mid.x, mid.y);
                    pinch.dist = dist;
                    pinch.scale = self.scale;
                }
                return;
            }

            if (drag) {
                var dx = ev.clientX - drag.x;
                var dy = ev.clientY - drag.y;
                drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
                self.tx = drag.tx + dx;
                self.ty = drag.ty + dy;
                self._clampView();
                self.requestDraw();
                self.layoutMarkers();
                self.emit('move');
            }

            var ll = self._cursorLatLng(cx, cy);
            /* Show the hovered country's name next to the coordinates, so
               hovering is informative as well as visual. */
            var hoverName = self._hovered ? self._hovered.getAttribute('data-name') : null;
            if (hoverName) {
                self.readoutCoords.textContent = hoverName + (ll
                    ? '   ' + ll.lat.toFixed(2) + '\u00b0, ' + ll.lng.toFixed(2) + '\u00b0'
                    : '');
            } else {
                self.readoutCoords.textContent = ll
                    ? ll.lat.toFixed(2) + '\u00b0, ' + ll.lng.toFixed(2) + '\u00b0'
                    : 'Outside basemap bounds';
            }
            self.emit('cursor', ll);
        });

        function releasePointer(ev) {
            if (pointers[ev.pointerId]) delete pointers[ev.pointerId];
            if (Object.keys(pointers).length === 0) {
                if (drag && drag.moved < 5) {
                    var rect = stage.getBoundingClientRect();
                    var ll = self._cursorLatLng(ev.clientX - rect.left, ev.clientY - rect.top);
                    if (ll) {
                        self.closePopup();
                        self.emit('click', ll);
                    }
                }
                drag = null;
                pinch = null;
                stage.classList.remove('is-dragging');
            }
        }

        stage.addEventListener('pointerup', releasePointer);
        stage.addEventListener('pointercancel', releasePointer);

        stage.addEventListener('keydown', function (ev) {
            if (ev.key === '+' || ev.key === '=') { self.zoomBy(1.7); ev.preventDefault(); }
            else if (ev.key === '-' || ev.key === '_') { self.zoomBy(1 / 1.7); ev.preventDefault(); }
            else if (ev.key === '0') { self.reset(); ev.preventDefault(); }
        });
    };

    /* ------------------------------------------------------------------ */
    /* Events + lifecycle                                                  */
    /* ------------------------------------------------------------------ */
    StormMap.prototype.on = function (name, fn) {
        (this._events[name] = this._events[name] || []).push(fn);
        return this;
    };

    StormMap.prototype.off = function (name, fn) {
        var list = this._events[name] || [];
        var i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
        return this;
    };

    StormMap.prototype.emit = function (name, payload) {
        var list = this._events[name] || [];
        for (var i = 0; i < list.length; i++) {
            try { list[i].call(this, payload); } catch (e) {
                if (window.console && console.warn) console.warn('[StormMap]', name, e);
            }
        }
    };

    StormMap.prototype.destroy = function () {
        if (this._ro) this._ro.disconnect();
        window.removeEventListener('resize', this._onWinResize);
        if (this._anim) window.cancelAnimationFrame(this._anim);
        if (this._raf) window.cancelAnimationFrame(this._raf);
        if (this._rafCyber) window.clearTimeout(this._rafCyber);
        this._raf = null; this._rafCyber = null;
        this.clearPlaces();
        this.markers = [];
        this._events = {};
        this.el.innerHTML = '';
        this.el.classList.remove('sbm', 'sbm-nobase');
    };

    /* ------------------------------------------------------------------ */
    /* Public entry point                                                  */
    /* ------------------------------------------------------------------ */
    window.StormMap = {
        version: '1.0.0',
        width: EARTH_W,
        height: EARTH_H,
        project: function (lat, lng) {
            return {
                x: (clamp(Number(lng) || 0, -180, 180) + 180) / 360 * EARTH_W,
                y: (90 - clamp(Number(lat) || 0, -90, 90)) / 180 * EARTH_H
            };
        },
        create: function (container, opts) {
            try {
                return new StormMap(container, opts);
            } catch (e) {
                if (window.console && console.warn) console.warn('[StormMap] create failed:', e);
                return null;
            }
        }
    };
})(window, document);
