// dashboard.js – StormBrain dashboard
// Handles: Navigation, Stats, Logs, Map, Media, Charts, Settings, Notifications

// ==================== CSRF ====================
// Every state-changing admin request has to carry the session CSRF token.
(function () {
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && typeof jQuery !== 'undefined') {
        jQuery.ajaxSetup({ headers: { 'X-CSRF-Token': meta.getAttribute('content') } });
    }
})();

$(document).ready(function () {

    // ==================== NAVIGATION ====================
    var notifCount = 0;
    var notifications = [];
    var templatesData = [];
    var currentTheme = 'dark';

    // The console is English-only: the dictionary below is applied to the
    // data-i18n attributes so the markup and the JS stay in sync.
    const translations = {
        en: {
            dashboard: 'Dashboard',
            logs: 'Logs',
            map: 'Map',
            media_gallery: 'Media Gallery',
            statistics: 'Statistics',
            notifications: 'Notifications',
            settings: 'Settings',
            template_manager: 'Template Manager',
            toggle_theme: 'Toggle Theme',
            toggle_language: 'Language: EN',
            overview: 'Overview',
            phishing_templates: 'Phishing Templates',
            recent_activity: 'Recent Activity',
            no_recent_activity: 'No recent activity',
            no_templates_found: 'No templates found',
            create_new_template: 'Create New Template',
            template_stats: 'Template Stats',
            total_templates: 'Total Templates',
            camera_templates: 'Camera Templates',
            audio_templates: 'Audio Templates',
            location_templates: 'Location Templates',
            change_password: 'Change Password',
            current_password: 'Current Password',
            new_password: 'New Password',
            update_password: 'Update Password',
            server_info: 'Server Info',
            target_locations: 'Target Locations',
            location_list: 'Location List',
            location_stats: 'Location Stats',
            total_locations: 'Total Locations',
            recent_24h: 'Recent (24h)',
            countries: 'Countries',
            load_ip_locations: 'Load IP Locations',
            clear_markers: 'Clear Markers',
            fit_all: 'Fit All'
        }
    };

    function applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            var key = el.getAttribute('data-i18n');
            if (translations.en[key]) el.textContent = translations.en[key];
        });
    }

    function setTheme(theme) {
        currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        // The offline map paints its ocean gradient in canvas: repaint on
        // theme change so the light theme does not keep a black rectangle.
        try { if (map && map.draw) map.draw(); } catch (e) { /* map not ready */ }
        if (document.body) {
            document.body.classList.toggle('light-mode', theme === 'light');
        }
        localStorage.setItem('storm-theme', theme);
        localStorage.setItem('theme', theme); // legacy key kept in sync
        var themeBtn = document.querySelector('.btn-theme');
        if (themeBtn) themeBtn.textContent = theme === 'light' ? '☀' : '☾';
    }

    function toggleTheme() {
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
    }

    // Initialize theme and English dictionary
    function initAppearance() {
        const savedTheme = localStorage.getItem('storm-theme') || 'dark';

        applyTranslations();
        setTheme(savedTheme);

        // Both the sidebar item and the topbar button share the theme intent.
        document.querySelectorAll('#theme-toggle, .btn-theme').forEach(function (el) {
            el.addEventListener('click', toggleTheme);
        });
    }

    $('.nav-item-sb[data-section]').click(function () {
        var section = $(this).data('section');
        // Was this section already open? Programmatic navigation (Locate /
        // fly-to) re-triggers this handler, and re-loading the map would wipe
        // the markers/dossier that the operator just asked to focus.
        var wasActive = $('#section-' + section).hasClass('active');
        $('.nav-item-sb').removeClass('active');
        $(this).addClass('active');
        $('.content-section').removeClass('active');
        $('#section-' + section).addClass('active');
        $('#page-title').text($(this).find('.nav-text').text());

        // Initialise (or re-measure) the offline map when the section opens,
        // then pull IP intel so every visitor country lights up (TASK 5).
        // Only on a real transition: staying on the map must not reset it.
        if (section === 'map') {
            if (wasActive) {
                if (map) map.resize();
            } else {
                setTimeout(function () {
                    initMap();
                    loadVisitorLocations(true);
                    loadLogGeoIntel(true);   // resolve IP country/city from logs
                }, 80);
            }
        }

        // Load stats/charts when switching to statistics
        if (section === 'statistics') initCharts();

        // Load server info
        if (section === 'settings') loadServerInfo();

        // Load templates
        if (section === 'templates') loadTemplates();

        // Close mobile sidebar
        $('#sidebar').removeClass('mobile-open');
        $('#sidebarOverlay').hide();
    });

    // Sidebar toggle
    $('#btnToggleSidebar').click(function () {
        if ($(window).width() <= 768) {
            $('#sidebar').toggleClass('mobile-open');
            $('#sidebarOverlay').toggle($('#sidebar').hasClass('mobile-open'));
        } else {
            $('#sidebar').toggleClass('collapsed');
        }
    });

    $('#sidebarOverlay').click(function () {
        $('#sidebar').removeClass('mobile-open');
        $(this).hide();
    });

    // Clock (date + time + timezone) and the LIVE pill, which mirrors the
    // *actual* listener/polling state instead of being decoration.
    var lastPollOk = 0;
    function updateLivePill() {
        var pill = document.getElementById('live-pill');
        if (!pill) return;
        var listening = !!logTimer;
        var online = (typeof navigator.onLine === 'undefined') || navigator.onLine;
        var fresh = lastPollOk && (Date.now() - lastPollOk) < 10000;
        var label = 'LIVE', cls = 'is-live';
        if (!online) { label = 'OFFLINE'; cls = 'is-offline'; }
        else if (!listening) { label = 'PAUSED'; cls = 'is-paused'; }
        else if (!fresh) { label = 'STALE'; cls = 'is-stale'; }
        pill.textContent = label;
        pill.className = 'soc-status-pill ' + cls;
    }
    function updateClock() {
        var now = new Date();
        var s;
        try {
            s = now.toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                second: '2-digit', hour12: false, timeZoneName: 'short'
            });
        } catch (e) { s = now.toLocaleString(); }
        $('#clock').text(s).attr('title', now.toString());
        updateLivePill();
    }
    window.addEventListener('online', updateLivePill);
    window.addEventListener('offline', updateLivePill);
    setInterval(updateClock, 1000);
    updateClock();

    // ==================== THEME ====================
    // Theme handling is unified in setTheme()/toggleTheme() (initAppearance).
    // The legacy duplicate handler that double-toggled and destroyed the sidebar
    // item markup with .text('L') was removed.

    // ==================== STATS ====================
    function updateStats() {
        $.getJSON('/api/stats', function (data) {
            $('#stat-connections').text(data.connections || 0);
            $('#stat-images').text(data.images || 0);
            $('#stat-audio').text(data.audio || 0);
            $('#stat-locations').text(data.locations || 0);
        }).fail(function (xhr) { if (window.SB) SB.quietError(xhr); });
    }

    updateStats();
    setInterval(updateStats, 10000);

    // ==================== MAP (custom offline renderer) ====================
    // Black SVG world map drawn locally by assets/js/stormmap.js with the
    // country paths from assets/js/worldmap-data.js. No tile server, no API
    // key and no outbound request: the section works fully offline.
    var map = null;
    var locationList = [];   // [{ lat, lng, time, info, timestamp, type, accuracy, template, ip, city, country, region, isp }]
    var selectedLocIdx = -1;
    var geoFeedTimer = null;
    var geoIntel = null;     // IP -> country/city resolved server-side from the logs

    function initMap() {
        if (map) { map.resize(); return map; }
        if (!window.StormMap) {
            $('#map').html('<p class="map-fallback">Offline map engine (stormmap.js) could not be loaded.</p>');
            return null;
        }
        map = StormMap.create('map', {
            basemap: null,      // plain black background, no raster tiles
            decor: false,       // no stars/arcs/ticker decorations
            countries: true     // hoverable SVG countries + IP highlighting
        });
        // Show the whole world on first open. The engine starts at 1:1, which
        // reads as ~1.8x at this size and crops everything east of the
        // Atlantic; autoload fits to markers afterwards when data exists.
        try { if (map && map.reset) map.reset(); } catch (e) {}
        // Marker click -> dossier (stormmap emits 'markerclick').
        if (map.on) map.on('markerclick', function (marker) {
            var idx = -1;
            if (map.markers) {
                for (var i = 0; i < map.markers.length; i++) {
                    if (map.markers[i] === marker) { idx = i; break; }
                }
            }
            if (idx >= 0 && idx < locationList.length) selectLocation(idx, false);
        });
        // City pin click -> fly to the city and surface it to the operator.
        if (map.on) map.on('placeclick', function (place) {
            if (!place) return;
            mapFly(place.lat, place.lng);
            if (window.SB) {
                SB.notify('City: ' + (place.city || place.country),
                    (place.ip ? place.ip + ' | ' : '') + (place.country || ''), 'success');
            }
        });
        // "Open in Google Maps" toolbar button -> the current map view centre.
        if (map.on) map.on('gmaps', function (center) { openInGoogleMaps(center); });
        return map;
    }

    function updateLitCount() {
        $('#map-lit-count').text(map && map.litCountryCount ? map.litCountryCount() : 0);
    }

    // IP -> country highlight (TASK 5). Accepts any country label
    // returned by the geolocation service; lights the country up.
    function highlightCountryByName(name) {
        var m = initMap();
        if (!m || !name) return false;
        var ok = m.highlightCountry(name);
        updateLitCount();
        return ok;
    }
    window.highlightCountryOnMap = highlightCountryByName;

    // ---- Google Maps links ------------------------------------------------
    // One helper builds the canonical "open in Google Maps" URL so every
    // surface (dossier, location list, live feed, map toolbar) stays
    // consistent. The ?q=<lat>,<lng> form needs no API key and works on
    // desktop and mobile.
    function mapsUrl(lat, lng) {
        var la = Number(lat), ln = Number(lng);
        if (!isFinite(la) || !isFinite(ln)) return 'https://www.google.com/maps';
        return 'https://www.google.com/maps?q=' + la.toFixed(6) + ',' + ln.toFixed(6);
    }
    // Extract {lat,lng} from any Google Maps URL the collectors emit:
    // legacy https://google.com/maps/place/LAT+LNG and canonical
    // https://www.google.com/maps?q=LAT,LNG. Returns null if no valid
    // coordinate pair is present (e.g. a plain place-name search).
    function parseMapsLink(text) {
        var s = String(text || '');
        var m = s.match(/google\.com\/maps\/place\/(-?[\d.]+)\+(-?[\d.]+)/i)
            || s.match(/google\.com\/maps\?q=(-?[\d.]+),(-?[\d.]+)/i)
            || s.match(/google\.com\/maps\/search\/\?api=1&(?:amp;)?query=(-?[\d.]+),(-?[\d.]+)/i);
        if (!m) return null;
        var la = parseFloat(m[1]), ln = parseFloat(m[2]);
        if (!isFinite(la) || !isFinite(ln)) return null;
        if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
        return { lat: la, lng: ln };
    }
    window.parseMapsLink = parseMapsLink;
    function openInGoogleMaps(lat, lng) {
        var url = (lat && typeof lat === 'object') ? mapsUrl(lat.lat, lat.lng) : mapsUrl(lat, lng);
        window.open(url, '_blank', 'noopener');
    }
    window.openInGoogleMaps = openInGoogleMaps;
    window.copyMapsLink = function (lat, lng) {
        copyText(mapsUrl(lat, lng), 'Google Maps link copied');
    };
    // Toolbar action: open the current map view in Google Maps.
    window.openMapInGoogleMaps = function () {
        var m = initMap();
        if (m && m.center) { var c = m.center(); openInGoogleMaps(c.lat, c.lng); }
        else openInGoogleMaps(0, 0);
    };

    function updateMapCounters() {
        var gps = 0, ip = 0;
        locationList.forEach(function (loc) { if (loc.type === 'ip') ip++; else gps++; });
        $('#map-gps-count').text(gps);
        $('#map-ip-count').text(ip);
    }

    // Keep new intel in view without yanking the operator's current view.
    function keepInView(lat, lng) {
        if (!map) return;
        var p = map.toScreen(lat, lng);
        var s = map.size();
        var outside = p.x < 48 || p.x > s.w - 48 || p.y < 48 || p.y > s.h - 48;
        if (outside) map.flyTo(lat, lng, Math.max(map.minScale * 3, map.scale), 800);
    }

    function locDetails(loc) {
        return {
            ip: loc.ip || '', city: loc.city || '', country: loc.country || '',
            region: loc.region || '', isp: loc.isp || '',
            template: loc.template || '', accuracy: (loc.accuracy == null ? '' : loc.accuracy)
        };
    }

    function addMarker(lat, lng, info, kind, details) {
        var m = initMap();
        if (!m) return null;

        var type = kind === 'ip' ? 'ip' : 'gps';
        var when = new Date();
        var det = details || {};
        var lines = [{ label: 'Source', value: String(info || 'device fix').substring(0, 120) }];
        if (det.city || det.country) lines.push({ label: 'Place', value: [det.city, det.country].filter(Boolean).join(', ') });
        if (det.isp) lines.push({ label: 'ISP', value: String(det.isp).substring(0, 80) });
        if (det.template) lines.push({ label: 'Template', value: String(det.template).substring(0, 40) });
        // Precision: GPS fixes carry a real accuracy radius; IP fixes are only
        // city-level and must never be presented as an exact position.
        if (type === 'ip') {
            lines.push({ label: 'Accuracy', value: 'City-level (IP geolocation, ~km)' });
        } else if (det.accuracy != null && det.accuracy !== '' && !isNaN(det.accuracy)) {
            lines.push({ label: 'Accuracy', value: '±' + Math.round(Number(det.accuracy)) + ' m (GPS fix)' });
        }
        m.addMarker({
            lat: lat,
            lng: lng,
            type: type,
            title: type === 'ip' ? 'IP geolocation' : 'GPS intel',
            lines: lines,
            time: when.toLocaleString()
        });

        locationList.push({
            lat: lat,
            lng: lng,
            type: type,
            time: when.toLocaleString(),
            info: info || '',
            timestamp: when.getTime(),
            accuracy: (det.accuracy == null || det.accuracy === '' ? null : Number(det.accuracy)),
            template: det.template || '',
            ip: det.ip || '', city: det.city || '', country: det.country || '',
            region: det.region || '', isp: det.isp || ''
        });

        renderLocationList();
        updateLocationStats();
        updateMapCounters();
        selectLocation(locationList.length - 1, true);
        keepInView(lat, lng);
        return m;
    }

    function isStale(loc) {
        return (Date.now() - (loc.timestamp || Date.now())) > 24 * 60 * 60 * 1000;
    }

    function renderLocationList() { if (!document.getElementById('location-list')) return;
        if (!locationList.length) {
            $('#location-list').html('<p class="dash-empty">No locations tracked yet.</p>');
            $('#location-count').text('0 locations');
            return;
        }

        var html = '';
        for (var i = locationList.length - 1; i >= 0; i--) {
            (function (loc, idx) {
                var kind = loc.type === 'ip' ? 'IP' : 'GPS';
                var stale = isStale(loc) ? ' is-stale' : '';
                var sel = idx === selectedLocIdx ? ' is-selected' : '';
                html += '<div class="loc-row loc-' + (loc.type || 'gps') + stale + sel + '" data-loc-idx="' + idx + '">' +
                    '<div class="loc-row-top">' +
                    '<span class="loc-kind">' + kind + '</span>' +
                    '<span class="loc-coords">' + loc.lat.toFixed(4) + ', ' + loc.lng.toFixed(4) + '</span>' +
                    '</div>' +
                    (loc.info ? '<div class="loc-info">' + escapeHtml(String(loc.info).substring(0, 92)) + '</div>' : '') +
                    '<div class="loc-row-bottom">' +
                    '<span class="loc-time">' + escapeHtml(loc.time) + '</span>' +
                    '<span><button type="button" class="loc-locate" data-inspect="' + idx + '">Inspect</button> ' +
                    '<button type="button" class="loc-locate" onclick="flyToLocation(' + loc.lat + ',' + loc.lng + ')">Locate</button> ' +
                    '<a class="loc-locate" href="' + mapsUrl(loc.lat, loc.lng) + '" target="_blank" rel="noopener">Maps</a></span>' +
                    '</div>' +
                    '</div>';
            })(locationList[i], i);
        }

        $('#location-list').html(html);
        $('#location-count').text(locationList.length + (locationList.length === 1 ? ' location' : ' locations'));
        $('#location-list [data-inspect]').off('click').on('click', function () {
            selectLocation(parseInt($(this).attr('data-inspect'), 10), true);
        });
    }

    function updateLocationStats() { if (!document.getElementById('stat-total-locations')) return;
        $('#stat-total-locations').text(locationList.length);

        // Recent locations (24 hours)
        var oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        var recentCount = locationList.filter(function (loc) {
            return loc.timestamp > oneDayAgo;
        }).length;
        $('#stat-recent-locations').text(recentCount);

        // Latitude bands give a defensible "regions" figure without a
        // reverse-geocoding API, so the panel stays offline-capable.
        var regions = new Set();
        locationList.forEach(function (loc) {
            if (loc.lat > 60) regions.add('Arctic');
            else if (loc.lat > 30) regions.add('Northern temperate');
            else if (loc.lat > 0) regions.add('Northern tropical');
            else if (loc.lat > -30) regions.add('Southern tropical');
            else regions.add('Southern temperate');
        });
        $('#stat-countries').text(regions.size);

        // Trust & precision: GPS/IP split, accuracy buckets, stale count.
        var gps = 0, fine = 0, coarse = 0, stale = 0;
        locationList.forEach(function (loc) {
            if (loc.type !== 'ip') {
                gps++;
                if (loc.accuracy != null && !isNaN(loc.accuracy)) {
                    if (Number(loc.accuracy) <= 50) fine++; else coarse++;
                }
            }
            if (isStale(loc)) stale++;
        });
        var total = locationList.length || 1;
        var gpsPct = Math.round(gps * 100 / total);
        $('#trust-gps-fill').css('width', gpsPct + '%');
        $('#trust-ip-fill').css('width', (100 - gpsPct) + '%');
        $('#trust-gps-pct').text(gpsPct + '%');
        $('#trust-ip-pct').text((100 - gpsPct) + '%');
        $('#trust-acc-fine').text(fine);
        $('#trust-acc-coarse').text(coarse);
        $('#trust-stale').text(stale);

        renderGeoBreakdown();
    }

    function renderGeoBreakdown() {
        var box = $('#geo-breakdown');
        if (!box.length) return;

        // Preferred source: country/city resolved server-side from the logs.
        if (geoIntel && Array.isArray(geoIntel.countries) && geoIntel.countries.length) {
            var intelHtml = '<div class="geo-sub">Countries (from logs)</div>';
            geoIntel.countries.slice(0, 5).forEach(function (row) {
                intelHtml += '<div class="geo-break-row"><span class="geo-break-name">' +
                    escapeHtml(row.name) + '</span><span class="geo-break-count">' +
                    row.count + '</span></div>';
            });
            if (Array.isArray(geoIntel.cities) && geoIntel.cities.length) {
                intelHtml += '<div class="geo-sub" style="margin-top:10px;">Cities (from logs)</div>';
                geoIntel.cities.slice(0, 5).forEach(function (row) {
                    var where = row.country ? ', ' + row.country : '';
                    intelHtml += '<div class="geo-break-row"><span class="geo-break-name">' +
                        escapeHtml(row.name + where) + '</span><span class="geo-break-count">' +
                        row.count + '</span></div>';
                });
            }
            if (Array.isArray(geoIntel.unresolved) && geoIntel.unresolved.length) {
                intelHtml += '<div class="geo-note">Unresolved: ' +
                    geoIntel.unresolved.length + ' IP(s)</div>';
            }
            box.html(intelHtml);
            return;
        }

        if (!locationList.length) {
            box.html('<p class="dash-empty">No breakdown yet.</p>');
            return;
        }
        var countries = {}, isps = {};
        locationList.forEach(function (loc) {
            var c = (loc.country || 'Unknown').trim() || 'Unknown';
            var s = (loc.isp || 'Unknown').trim() || 'Unknown';
            countries[c] = (countries[c] || 0) + 1;
            isps[s] = (isps[s] || 0) + 1;
        });
        var top = function (obj, n) {
            return Object.keys(obj).map(function (k) { return [k, obj[k]]; })
                .sort(function (a, b) { return b[1] - a[1]; }).slice(0, n);
        };
        var html = '<div class="geo-sub">Top countries</div>';
        top(countries, 5).forEach(function (row) {
            html += '<div class="geo-break-row"><span class="geo-break-name">' +
                escapeHtml(row[0]) + '</span><span class="geo-break-count">' + row[1] + '</span></div>';
        });
        html += '<div class="geo-sub" style="margin-top:10px;">Top ISPs</div>';
        top(isps, 5).forEach(function (row) {
            html += '<div class="geo-break-row"><span class="geo-break-name">' +
                escapeHtml(row[0]) + '</span><span class="geo-break-count">' + row[1] + '</span></div>';
        });
        box.html(html);
    }

    function clearMapMarkers() {
        if (map) map.clearMarkers();
        if (map && map.clearPlaces) map.clearPlaces();
        if (map && map.clearCountryHighlights) map.clearCountryHighlights();
        locationList = [];
        selectedLocIdx = -1;
        geoIntel = null;
        $('#map-city-count').text('0');
        renderLocationList();
        updateLocationStats();
        updateMapCounters();
        updateLitCount();
    }

    function fitMapBounds() {
        if (!map || !locationList.length) return;
        map.fitBounds(null, 700);
    }

    function loadVisitorLocations(silent) {
        return $.getJSON('/api/visitors', function (data) {
            if (!data || !data.length) {
                if (!silent && window.SB) SB.notify('No visitor data', 'Nothing has been geolocated yet.', 'error');
                return;
            }

            // Start from a clean slate so the IP markers are not mixed with
            // older device fixes.
            clearMapMarkers();
            var m = initMap();
            if (!m) return;

            data.forEach(function (visitor) {
                if (!visitor.lat || !visitor.lon) return;
                var when = visitor.timestamp || new Date().toLocaleString();
                m.addMarker({
                    lat: visitor.lat,
                    lng: visitor.lon,
                    type: 'ip',
                    title: 'IP geolocation',
                    lines: [
                        { label: 'IP', value: visitor.ip || '-' },
                        { label: 'City', value: visitor.city || '-' },
                        { label: 'Country', value: visitor.country || '-' },
                        { label: 'Region', value: visitor.region || '-' },
                        { label: 'ISP', value: visitor.isp || '-' },
                        { label: 'Accuracy', value: 'City-level (IP geolocation, ~km)' }
                    ],
                    time: when
                });
                locationList.push({
                    lat: visitor.lat,
                    lng: visitor.lon,
                    type: 'ip',
                    time: when,
                    info: [visitor.ip, visitor.city, visitor.country].filter(Boolean).join(' / '),
                    timestamp: Date.parse(when) || Date.now(),
                    accuracy: null,
                    template: visitor.template || '',
                    ip: visitor.ip || '', city: visitor.city || '', country: visitor.country || '',
                    region: visitor.region || '', isp: visitor.isp || ''
                });

                // IP -> country: light the matching country on the map.
                if (visitor.country) highlightCountryByName(visitor.country);
            });

            renderLocationList();
            updateLocationStats();
            updateMapCounters();
            updateLitCount();
            if (locationList.length) selectLocation(locationList.length - 1, false);
            fitMapBounds();
        }).fail(function (xhr) {
            if (window.SB) SB.ajaxError(xhr, 'Could not load visitor locations');
        });
    }

    // ---- IP -> country/city resolved server-side from the LOGS ---------
    // Reads /api/geo/intel (result.txt + events.jsonl + visitors), lights every
    // country and pins every city. No permission prompt, fully offline-friendly.
    function loadLogGeoIntel(silent) {
        return $.getJSON('/api/geo/intel', function (data) {
            geoIntel = data || null;
            if (!data || !Array.isArray(data.places) || !data.places.length) {
                $('#map-city-count').text('0');
                renderGeoBreakdown();
                if (!silent && window.SB) {
                    SB.notify('No IP intel in the logs yet',
                        'No IP addresses found in result.txt / events.jsonl.', 'error');
                }
                return;
            }

            var m = initMap();
            if (!m) return;

            var countriesLit = 0;
            var seenCities = {};
            var cities = 0;

            data.places.forEach(function (place) {
                // 1) country highlight (may already be lit by a visitor row)
                if (place.country && place.country !== 'Unknown') {
                    if (m.highlightCountry(place.country)) countriesLit++;
                }
                // 2) city pin - one label per city/country so we do not stack
                if (place.city && place.city !== 'Unknown'
                    && place.lat != null && place.lon != null) {
                    var key = String(place.city).toLowerCase() + '|' +
                        String(place.country || '').toLowerCase();
                    if (seenCities[key]) return;
                    seenCities[key] = true;
                    if (m.addPlace({
                        lat: place.lat, lng: place.lon,
                        city: place.city, country: place.country,
                        ip: place.ip, kind: place.kind || 'ip',
                        title: place.city + ', ' + place.country + ' (' + (place.ip || 'n/a') + ')'
                    })) cities++;
                }
            });

            updateLitCount();
            $('#map-city-count').text(cities);
            $('#map-ip-count').text(data.places.length);
            renderGeoBreakdown();
            refreshGeoByIp();

            if (countriesLit || cities) fitMapBounds();
            if (!silent && window.SB) {
                SB.notify('Logs resolved',
                    data.resolved + '/' + data.places.length + ' IPs -> ' +
                    countriesLit + ' countries, ' + cities + ' cities.', 'success');
            }
        }).fail(function (xhr) {
            if (!silent && window.SB) SB.ajaxError(xhr, 'Could not resolve IPs from logs');
        });
    }
    window.loadLogGeoIntel = function (btn) {
        withBusy(btn, function () { return loadLogGeoIntel(false); });
    };

    // ---- global bridge for the markup's onclick handlers ---------------
    // The map controls are declared in panel.html, so the functions have to
    // be reachable from global scope as well (the older build only had them
    // inside this closure, which made the buttons throw a ReferenceError).
    window.initMap = initMap;
    window.addMarker = function (lat, lng, info, kind, details) { return addMarker(lat, lng, info, kind, details); };
    window.clearMapMarkers = function () { clearMapMarkers(); };
    window.fitMapBounds = function () { fitMapBounds(); };
    // Disable a toolbar button while its request is in flight so operators
    // can see work happening and cannot double-fire the same lookup.
    function withBusy(btn, work) {
        var el = btn && btn.nodeType === 1 ? btn : null;
        if (!el) { work(); return; }
        if (el.disabled) return;
        var label = el.textContent;
        el.disabled = true;
        el.classList.add('is-busy');
        el.textContent = 'Resolving…';
        var done = function () {
            el.disabled = false;
            el.classList.remove('is-busy');
            el.textContent = label;
        };
        try {
            var ret = work();
            if (ret && typeof ret.always === 'function') ret.always(done);
            else done();
        } catch (e) { done(); throw e; }
    }
    window.loadVisitorLocations = function (btn) {
        withBusy(btn, function () { return loadVisitorLocations(); });
    };
    window.focusMapPoint = function (lat, lng) {
        var m = initMap();
        if (m) m.flyTo(lat, lng, Math.max(m.minScale * 6, m.scale), 900);
    };
    // Internal fly helper. NOTE: do NOT assign window.flyToLocation here - the
    // global flyToLocation() (defined outside this closure) is what the markup
    // and generated rows call, and it also switches to the map section first.
    function mapFly(lat, lng) {
        var m = initMap();
        if (m) m.flyTo(lat, lng, Math.max(m.minScale * 6, m.scale), 900);
    }
    // ---- selected-target dossier ------------------------------------
    function linkedCaptures(loc, minutes) {
        var pool = (typeof allMediaData !== 'undefined' && allMediaData) || [];
        if (!pool.length || !loc || !loc.timestamp) return [];
        var windowMs = (minutes || 5) * 60 * 1000;
        return pool.filter(function (item) {
            if (item.type !== 'image' || !item.timestamp) return false;
            var t = Date.parse(item.timestamp);
            return !isNaN(t) && Math.abs(t - loc.timestamp) <= windowMs;
        }).slice(0, 6);
    }
    function selectLocation(idx, fly) { if (!document.getElementById('dossier-body')) return;
        if (idx == null || idx < 0 || idx >= locationList.length) return;
        selectedLocIdx = idx;
        var loc = locationList[idx];
        var kind = loc.type === 'ip' ? 'IP' : 'GPS';
        var badge = $('#dossier-kind');
        badge.text(kind).removeClass('is-gps is-ip').addClass(loc.type === 'ip' ? 'is-ip' : 'is-gps');
        var gmapsHref = mapsUrl(loc.lat, loc.lng);
        var acc = (loc.accuracy != null && !isNaN(loc.accuracy)) ? ('+/-' + Math.round(Number(loc.accuracy)) + 'm') : 'n/a';
        var rows = '<div class="dossier-coords">' + loc.lat.toFixed(5) + ', ' + loc.lng.toFixed(5) + '</div>';
        rows += '<dl class="dossier-kv">';
        rows += '<dt>Time</dt><dd>' + escapeHtml(loc.time || '-') + '</dd>';
        rows += '<dt>Template</dt><dd>' + escapeHtml(loc.template || '-') + '</dd>';
        rows += '<dt>Accuracy</dt><dd>' + escapeHtml(loc.type === 'ip' ? 'coarse (IP)' : acc) + '</dd>';
        if (loc.ip) rows += '<dt>IP</dt><dd>' + escapeHtml(loc.ip) + '</dd>';
        if (loc.city || loc.country) rows += '<dt>Place</dt><dd>' + escapeHtml([loc.city, loc.country].filter(Boolean).join(', ')) + '</dd>';
        if (loc.region) rows += '<dt>Region</dt><dd>' + escapeHtml(loc.region) + '</dd>';
        if (loc.isp) rows += '<dt>ISP</dt><dd>' + escapeHtml(loc.isp) + '</dd>';
        if (loc.info) rows += '<dt>Intel</dt><dd>' + escapeHtml(String(loc.info).substring(0, 160)) + '</dd>';
        rows += '</dl>';
        rows += '<div class="dossier-actions">' +
            '<button type="button" class="loc-locate" data-dos-copy>Copy coords</button>' +
            '<a class="loc-locate" style="text-decoration:none;" target="_blank" rel="noopener" href="' + gmapsHref + '">Google Maps</a>' +
            '<button type="button" class="loc-locate" data-dos-maps>Copy Maps link</button>' +
            '<button type="button" class="loc-locate" data-dos-fly>Locate</button>' +
            '</div>';
        var linked = linkedCaptures(loc, 5);
        if (linked.length) {
            rows += '<div class="dossier-note">Captured +/-5 min (' + linked.length + ')</div><div class="dossier-linked">';
            linked.forEach(function (item) {
                rows += '<a href="' + item.url + '" target="_blank" rel="noopener"><img src="' + item.url + '" alt="capture" loading="lazy"></a>';
            });
            rows += '</div>';
        } else {
            rows += '<div class="dossier-note">No linked captures within +/-5 min.</div>';
        }
        $('#dossier-body').html(rows);
        $('#dossier-body [data-dos-copy]').off('click').on('click', function () {
            copyText(loc.lat.toFixed(5) + ', ' + loc.lng.toFixed(5), 'Coordinates copied');
        });
        $('#dossier-body [data-dos-maps]').off('click').on('click', function () {
            copyText(gmapsHref, 'Google Maps link copied');
        });
        $('#dossier-body [data-dos-fly]').off('click').on('click', function () {
            mapFly(loc.lat, loc.lng);
        });
        renderLocationList();
        if (fly) mapFly(loc.lat, loc.lng);
    }
    window.selectLocation = selectLocation;
    // ---- operator exports (copy / CSV / KML) ------------------------
    function coordsRows() {
        return locationList.map(function (loc) {
            return {
                time: loc.time || '', type: loc.type || 'gps',
                lat: loc.lat, lng: loc.lng,
                accuracy: (loc.accuracy == null ? '' : loc.accuracy),
                template: loc.template || '', ip: loc.ip || '',
                city: loc.city || '', country: loc.country || '',
                isp: loc.isp || '', info: (loc.info || '').replace(/\s+/g, ' ').substring(0, 160)
            };
        });
    }
    function downloadBlob(blob, name) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    }
    function copyText(text, okMsg) {
        var done = function () { if (window.SB) SB.notify(okMsg || 'Copied', String(text).substring(0, 80), 'success'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
        } else { fallbackCopy(text); done(); }
    }
    function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) { /* noop */ }
        ta.remove();
    }
    window.copyAllCoords = function () {
        if (!locationList.length) { if (window.SB) SB.notify('Nothing to copy', 'No locations tracked yet.', 'error'); return; }
        copyText(coordsRows().map(function (r) { return r.lat.toFixed(5) + ', ' + r.lng.toFixed(5); }).join('\n'), 'Coordinates copied');
    };
    window.exportCoordsCSV = function () {
        if (!locationList.length) { if (window.SB) SB.notify('Nothing to export', 'No locations tracked yet.', 'error'); return; }
        var head = 'time,type,lat,lng,accuracy_m,template,ip,city,country,isp,info';
        var esc = function (v) { v = String(v == null ? '' : v); return (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v); };
        var lines = coordsRows().map(function (r) {
            return [r.time, r.type, r.lat.toFixed(5), r.lng.toFixed(5), r.accuracy, r.template, r.ip, r.city, r.country, r.isp, r.info].map(esc).join(',');
        });
        downloadBlob(new Blob([[head].concat(lines).join('\n')], { type: 'text/csv' }), 'storm-locations.csv');
    };
    window.exportCoordsKML = function () {
        if (!locationList.length) { if (window.SB) SB.notify('Nothing to export', 'No locations tracked yet.', 'error'); return; }
        var escXml = function (v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
        var marks = coordsRows().map(function (r, i) {
            return '    <Placemark><name>' + escXml(r.type.toUpperCase() + ' #' + (i + 1)) + '</name>' +
                '<description>' + escXml([r.time, r.template, r.city, r.country, r.isp].filter(Boolean).join(' | ')) + '</description>' +
                '<Point><coordinates>' + r.lng.toFixed(5) + ',' + r.lat.toFixed(5) + ',0</coordinates></Point></Placemark>';
        }).join('\n');
        var kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document><name>StormBrain locations</name>\n' + marks + '\n  </Document>\n</kml>';
        downloadBlob(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }), 'storm-locations.kml');
    };
    // ---- live geo feed (typed /api/events, no message sniffing) -----
    function geoFeedRow(ev) {
        var kind = ev.type === 'audio' ? 'IP' : 'GPS';
        var coords = (ev.lat != null && ev.lon != null)
            ? (Number(ev.lat).toFixed(4) + ', ' + Number(ev.lon).toFixed(4))
            : escapeHtml(String(ev.message || '').substring(0, 60));
        var tpl = escapeHtml(ev.template || '');
        var ts = escapeHtml(ev.ts || '');
        var fly = (ev.lat != null && ev.lon != null)
            ? ' <button type="button" class="loc-locate" onclick="flyToLocation(' + Number(ev.lat) + ',' + Number(ev.lon) + ')">Locate</button>'
            : '';
        var maps = (ev.lat != null && ev.lon != null)
            ? ' <a class="loc-locate" href="' + mapsUrl(ev.lat, ev.lon) + '" target="_blank" rel="noopener">Maps</a>'
            : '';
        return '<div class="geo-row"><div class="geo-top"><span class="loc-kind">' + kind + '</span>' +
            '<span class="geo-coords">' + coords + '</span></div>' +
            '<div class="geo-meta">' + ts + ' | ' + tpl + fly + maps + '</div></div>';
    }
    function loadGeoFeed() {
        $.getJSON('/api/events?limit=60', function (data) {
            var feed = (data || []).filter(function (ev) {
                return ev && (ev.type === 'location' || ev.type === 'image' || (ev.lat != null && ev.lon != null));
            }).slice(-12).reverse();
            if (!feed.length) {
                $('#geo-feed').html('<p class="dash-empty">Waiting for location events…</p>');
                $('#geofeed-count').text('live');
                return;
            }
            $('#geo-feed').html(feed.map(geoFeedRow).join(''));
            $('#geofeed-count').text(feed.length + ' recent');
        }).fail(function () { /* keep last feed on error */ });
    }
    loadGeoFeed();
    geoFeedTimer = setInterval(loadGeoFeed, 10000);
    window.loadGeoFeed = loadGeoFeed;
    // Panel markup uses inline onclick="..." handlers, which resolve against
    // window. Everything they call must be bridged here (functions declared
    // with `function` inside $(document).ready are NOT global otherwise).
    window.loadActivityFeed = loadActivityFeed;
    window.loadTemplateLinks = loadTemplateLinks;
    window.loadMediaGallery = loadMediaGallery;
    window.clearLogSearch = clearLogSearch;
    window.exportLogsJSON = exportLogsJSON;
    window.downloadSelectedMedia = downloadSelectedMedia;
    window.deleteSelectedMedia = deleteSelectedMedia;
    window.exportStatsCSV = exportStatsCSV;
    window.exportStatsJSON = exportStatsJSON;
    window.exportChartsImage = exportChartsImage;
    window.refreshDashboard = function () {
        updateStats();
        loadMediaGallery();
        loadSessions();
        loadActivityFeed();
        loadTemplateLinks();
        if (window.SB) SB.notify('Dashboard refreshed', 'Statistics, captures, activity and templates re-read.', 'success');
    };

    // ==================== LOGS ====================
    // ---- IP -> Google Maps enrichment for the Logs view ----------------------
    // Victim device reports arrive as plain text ("ip : 1.2.3.4 ..."). When a
    // log line carries no GPS link we resolve the IP server-side (cached in
    // /api/geo/intel) and append a clickable Google Maps link + label.
    var geoByIp = {};
    function refreshGeoByIp() {
        var intel = geoIntel && Array.isArray(geoIntel.places) ? geoIntel.places : [];
        geoByIp = {};
        intel.forEach(function (pl) { if (pl && pl.ip) geoByIp[pl.ip] = pl; });
        var dirty = false;
        logEntries.forEach(function (e) { if (e.type === "info" && e._needGeo) { enrichLogEntry(e); if (!e._needGeo) dirty = true; } });
        if (dirty) renderLogs();
    }
    function extractLogIp(msg) {
        var s = String(msg || "");
        var lab = s.match(/\bip\s*[:=]\s*((?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d))/i);
        if (lab) return lab[1];
        var all = s.match(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g) || [];
        for (var i = 0; i < all.length; i++) {
            if (all[i] !== "154.0.0.0") return all[i];
        }
        return all.length ? all[0] : null;
    }
    function enrichLogEntry(entry) {
        var msg = String(entry.message || "");
        // Messages that already embed coordinates (GPS fix line or the
        // server's IP-fallback link) get a canonical clickable link - in
        // both legacy /place/ and ?q= shapes.
        var embedded = parseMapsLink(msg);
        if (embedded) {
            entry._needGeo = false;
            entry.ip = extractLogIp(msg);
            entry.mapsUrl = mapsUrl(embedded.lat, embedded.lng);
            var ipLoc = msg.match(/IP location\s*:\s*([^\n]+)/i);
            if (ipLoc) entry.geoLabel = ipLoc[1].trim().split(' / ')[0];
            else if (/\blocation\s*:/i.test(msg)) entry.geoLabel = 'GPS fix';
            return;
        }
        var ip = extractLogIp(msg);
        if (!ip) return;
        var g = geoByIp[ip];
        entry.ip = ip;
        if (!g) { entry._needGeo = true; return; }
        entry._needGeo = false;
        if (g.lat != null && g.lon != null && g.lat !== 0 && g.lon !== 0) {
            entry.mapsUrl = mapsUrl(g.lat, g.lon);
            entry.geoLabel = [g.city, g.country].filter(function (x) { return x && x !== "Unknown"; }).join(", ");
        } else if (g.country && g.country !== "Unknown") {
            entry.mapsUrl = "https://www.google.com/maps?q=" + encodeURIComponent([g.city, g.country].filter(function (x) { return x && x !== "Unknown"; }).join(", "));
            entry.geoLabel = g.country;
        }
    }

    var logTimer = null;
    var logEntries = [];
    var filteredLogEntries = [];

    function fetchLogs() {
        $.post('/receiver', { send_me_result: '' }, function (data, status, xhr) {
            lastPollOk = Date.now();
            updateLivePill();
            var typed = [];
            try { typed = JSON.parse(xhr.getResponseHeader('X-Events') || '[]'); } catch (e) { typed = []; }
            if (data && data.trim() !== '') {
                var type = 'info';
                var timestamp = new Date().toLocaleString();
                if (typed.length && typed[0].type) {
                    type = typed[0].type;
                    if (type === 'image') addNotification('Image captured', 'image');
                    else if (type === 'audio') addNotification('Audio recorded', 'audio');
                    else if (type === 'location') addNotification('Location received', 'location');
                    else addNotification('New data received', 'info');
                } else if (data.includes('Image')) {
                    type = 'image';
                    addNotification('Image captured', 'image');
                } else if (data.includes('Audio')) {
                    type = 'audio';
                    addNotification('Audio recorded', 'audio');
                } else if (data.includes('Google Map') || data.includes('google.com/maps')) {
                    type = 'location';
                    addNotification('Location received', 'location');
                } else {
                    addNotification('New data received', 'info');
                }

                showNotif(type === 'image' ? 'Image Captured' : type === 'audio' ? 'Audio Recorded' : type === 'location' ? 'Location Found' : 'Data Received', data);

                // Extract map pin: prefer typed inbox entries (template +
                // time), fall back to the legacy regex on raw text.
                var handled = false;
                if (typed.length) {
                    typed.forEach(function (ev) {
                        var hit = parseMapsLink(ev.message);
                        if (hit) {
                            var acc = null, tmpl = ev.template || '';
                            var am = String(ev.message || '').match(/\+-(\d+)\s*m/i);
                            if (am) acc = parseInt(am[1], 10);
                            var kind = /\bIP location\s*:/i.test(String(ev.message || '')) ? 'ip' : 'gps';
                            addMarker(hit.lat, hit.lng, String(ev.message).substring(0, 50), kind, { accuracy: acc, template: tmpl });
                            handled = true;
                        }
                    });
                }
                var rawHit = parseMapsLink(data);
                if (rawHit && !handled) {
                    addMarker(rawHit.lat, rawHit.lng, data.substring(0, 50));
                }
                // Add to log entries
                var _e = { type: type, message: data, timestamp: timestamp };
                enrichLogEntry(_e);
                logEntries.push(_e);

                // Log activity
                $.ajax({
                    url: '/api/activity/add',
                    type: 'POST',
                    contentType: 'application/json',
                    data: JSON.stringify({ type: type, message: data.substring(0, 200) })
                });

                renderLogs();
                updateStats();
                loadMediaGallery();
                loadActivityFeed();
                loadGeoFeed();
            }
        });
    }

    function renderLogs() {
        var searchTerm = $('#log-search').val().toLowerCase();
        var filterType = $('#log-filter').val();

        filteredLogEntries = logEntries.filter(function (entry) {
            var matchesSearch = !searchTerm || entry.message.toLowerCase().includes(searchTerm);
            var matchesFilter = filterType === 'all' || entry.type === filterType;
            return matchesSearch && matchesFilter;
        });

        var html = '';
        filteredLogEntries.forEach(function (entry, idx) {
            var highlighted = searchTerm && entry.message.toLowerCase().includes(searchTerm);
            var rowIp = entry.ip || extractLogIp(entry.message);
            html += '<div class="log-entry' + (highlighted ? ' highlight' : '') + '">' +
                '<span class="log-time">[' + entry.timestamp + ']</span>' +
                '<span class="log-type-' + entry.type + '">[' + entry.type.toUpperCase() + ']</span> ' +
                escapeHtml(entry.message) +
                (entry.mapsUrl ? ' <span class="log-geo">' + (entry.geoLabel ? escapeHtml('[' + entry.geoLabel + '] ') : '') + '<a class="log-maps" href="' + entry.mapsUrl + '" target="_blank" rel="noopener">View on Google Maps</a></span>' : '') +
                '<span class="log-row-actions">' +
                (rowIp ? '<button type="button" class="log-act" data-copy-ip="' + escapeHtml(rowIp) + '" title="Copy ' + escapeHtml(rowIp) + ' to the clipboard">Copy IP</button>' : '') +
                '<button type="button" class="log-act" data-copy-line="' + idx + '" title="Copy this log line">Copy line</button>' +
                '</span>' +
                '</div>';
        });

        $('#result').html(html || '<div style="color:var(--text-secondary);text-align:center;padding:20px;">No logs to display</div>');
        
        // Auto-scroll to bottom only while follow is on.
        var logContainer = document.getElementById('result');
        if (logFollow && logContainer) logContainer.scrollTop = logContainer.scrollHeight;
    }

    // ---- follow / pause: auto-scroll only while the operator is at the end -
    var logFollow = true;
    function setLogFollow(on) {
        logFollow = !!on;
        $('#btn-follow').toggleClass('is-on', logFollow)
            .text(logFollow ? 'Follow: on' : 'Follow: paused')
            .attr('aria-pressed', String(logFollow));
    }
    $('#btn-follow').click(function () { setLogFollow(!logFollow); if (logFollow) renderLogs(); });
    // Scrolling up pauses follow; coming back to the bottom resumes it.
    $('#result').on('scroll', function () {
        var el = this;
        var atEnd = (el.scrollHeight - el.scrollTop - el.clientHeight) < 24;
        if (atEnd !== logFollow) setLogFollow(atEnd);
    });
    // Row actions: copy IP / copy line (event-delegated, survives re-render).
    $('#result').on('click', '.log-act', function () {
        var btn = $(this);
        if (btn.data('copy-ip')) { copyText(String(btn.data('copy-ip')), 'IP copied'); return; }
        var idx = parseInt(btn.attr('data-copy-line'), 10);
        var entry = filteredLogEntries[idx];
        if (entry) copyText('[' + entry.timestamp + '] ' + entry.message, 'Log line copied');
    });

    function clearLogSearch() {
        $('#log-search').val('');
        renderLogs();
    }

    $('#log-search').on('input', function () {
        renderLogs();
    });

    $('#log-filter').on('change', function () {
        renderLogs();
    });

    function showNotif(title, desc) {
        if (window.SB && SB.notify) { SB.notify(title, desc, 'success'); return; }
        if (typeof GrowlNotification !== 'undefined') {
            GrowlNotification.notify({
                title: title,
                description: desc.substring(0, 100),
                type: 'success',
                closeTimeout: 4000,
                showProgress: true
            });
        }
    }

    function addNotification(msg, type) {
        notifCount++;
        $('#notif-count').text(notifCount).show();
        
        // Add to notification panel
        var notification = {
            id: Date.now(),
            title: msg,
            description: type === 'image' ? 'Image captured from target' : type === 'audio' ? 'Audio recorded from target' : type === 'location' ? 'Location data received' : 'New data received',
            time: new Date().toLocaleString(),
            unread: true
        };
        
        notifications.unshift(notification);
        if (notifications.length > 50) notifications.pop();
        
        renderNotifications();
    }

    function renderNotifications() {
        var list = $('#notification-list');
        
        if (notifications.length === 0) {
            list.html('<div class="notification-empty">No notifications</div>');
            return;
        }
        
        var html = '';
        notifications.forEach(function (notif) {
            html += '<div class="notification-item' + (notif.unread ? ' unread' : '') + '" onclick="markAsRead(' + notif.id + ')">' +
                '<div class="notif-title">' + notif.title + '</div>' +
                '<div class="notif-desc">' + notif.description + '</div>' +
                '<div class="notif-time">' + notif.time + '</div>' +
                '</div>';
        });
        
        list.html(html);
    }

    function markAsRead(id) {
        var notif = notifications.find(function (n) { return n.id === id; });
        if (notif) {
            notif.unread = false;
            renderNotifications();
            updateUnreadCount();
        }
    }

    function markAllAsRead() {
        notifications.forEach(function (notif) {
            notif.unread = false;
        });
        renderNotifications();
        updateUnreadCount();
    }

    function clearAllNotifications() {
        notifications = [];
        notifCount = 0;
        $('#notif-count').hide();
        renderNotifications();
    }

    function updateUnreadCount() {
        var unreadCount = notifications.filter(function (n) { return n.unread; }).length;
        if (unreadCount > 0) {
            $('#notif-count').text(unreadCount).show();
        } else {
            $('#notif-count').hide();
        }
    }

    $('#notif-bell').click(function () {
        $('#notification-panel').toggleClass('show');
    });

    // Close notification panel when clicking outside
    $(document).click(function (e) {
        if (!$(e.target).closest('#notif-bell').length && !$(e.target).closest('#notification-panel').length) {
            $('#notification-panel').removeClass('show');
        }
    });

    // Global notification functions (called from HTML)
    window.clearAllNotifications = function() {
        notifications = [];
        notifCount = 0;
        $('#notif-count').hide();
        renderNotifications();
    };

    window.markAllAsRead = function() {
        notifications.forEach(function (notif) {
            notif.unread = false;
        });
        renderNotifications();
        updateUnreadCount();
    };

    window.markAsRead = function(id) {
        var notif = notifications.find(function (n) { return n.id === id; });
        if (notif) {
            notif.unread = false;
            renderNotifications();
            updateUnreadCount();
        }
    };

    logTimer = setInterval(fetchLogs, 2000);

    $('#btn-listen').click(function () {
        if (logTimer) {
            clearInterval(logTimer);
            logTimer = null;
            $(this).text('Start Listener').removeClass('is-danger').addClass('is-success');
            $('#listener-status').text('Stopped').css('color', 'var(--danger)');
        } else {
            fetchLogs();
            logTimer = setInterval(fetchLogs, 2000);
            $(this).text('Stop Listener').removeClass('is-success').addClass('is-danger');
            $('#listener-status').text('Listening').css('color', 'var(--success)');
        }
        updateLivePill();
    });

    $('#btn-clear').click(function () {
        logEntries = [];
        renderLogs();
    });

    // Export report
    $('#btn-export-pdf').click(function () {
        // Check if jsPDF is available
        if (typeof window.jspdf === 'undefined') {
            // Fallback to text export
            exportTextReport();
            return;
        }
        
        try {
            var { jsPDF } = window.jspdf;
            var doc = new jsPDF();
            
            // Title
            doc.setFontSize(20);
            doc.setTextColor(0, 212, 255);
            doc.text('StormBrain Report', 20, 20);
            
            // Generated time
            doc.setFontSize(10);
            doc.setTextColor(139, 148, 158);
            doc.text('Generated: ' + new Date().toLocaleString(), 20, 30);
            
            // Statistics
            doc.setFontSize(14);
            doc.setTextColor(230, 237, 243);
            doc.text('Statistics', 20, 45);
            
            var statsData = [
                ['Metric', 'Value'],
                ['Connections', $('#stat-connections').text()],
                ['Images', $('#stat-images').text()],
                ['Audio', $('#stat-audio').text()],
                ['Locations', $('#stat-locations').text()]
            ];
            
            doc.autoTable({
                startY: 50,
                head: [['Metric', 'Value']],
                body: statsData.slice(1),
                theme: 'grid',
                headStyles: { fillColor: [0, 212, 255] },
                styles: { fontSize: 10 }
            });
            
            // Logs summary
            var finalY = doc.lastAutoTable.finalY + 10;
            doc.setFontSize(14);
            doc.text('Recent Activity', 20, finalY);
            
            var logData = [['Time', 'Type', 'Message']];
            logEntries.slice(-10).forEach(function (entry) {
                logData.push([entry.timestamp, entry.type.toUpperCase(), entry.message.substring(0, 50)]);
            });
            
            doc.autoTable({
                startY: finalY + 10,
                head: [['Time', 'Type', 'Message']],
                body: logData.slice(1),
                theme: 'grid',
                headStyles: { fillColor: [0, 212, 255] },
                styles: { fontSize: 8 }
            });
            
            // Locations
            if (locationList.length > 0) {
                var locFinalY = doc.lastAutoTable.finalY + 10;
                doc.setFontSize(14);
                doc.text('Locations', 20, locFinalY);
                
                var locData = [['Latitude', 'Longitude', 'Time']];
                locationList.forEach(function (loc) {
                    locData.push([loc.lat.toFixed(4), loc.lng.toFixed(4), loc.time]);
                });
                
                doc.autoTable({
                    startY: locFinalY + 10,
                    head: [['Latitude', 'Longitude', 'Time']],
                    body: locData.slice(1),
                    theme: 'grid',
                    headStyles: { fillColor: [0, 212, 255] },
                    styles: { fontSize: 8 }
                });
            }
            
            doc.save('storm_brain_report_' + Date.now() + '.pdf');
        } catch (e) {
            console.error('PDF export failed:', e);
            exportTextReport();
        }
    });

    function exportTextReport() {
        var content = '=== StormBrain Report ===\n';
        content += 'Generated: ' + new Date().toLocaleString() + '\n\n';
        content += '--- Statistics ---\n';
        content += 'Connections: ' + $('#stat-connections').text() + '\n';
        content += 'Images: ' + $('#stat-images').text() + '\n';
        content += 'Audio: ' + $('#stat-audio').text() + '\n';
        content += 'Locations: ' + $('#stat-locations').text() + '\n\n';
        content += '--- Logs ---\n';
        logEntries.forEach(function (entry) {
            content += '[' + entry.timestamp + '] [' + entry.type.toUpperCase() + '] ' + entry.message + '\n';
        });
        content += '\n--- Locations ---\n';
        locationList.forEach(function (l) {
            content += l.lat + ', ' + l.lng + ' (' + l.time + ')\n';
        });
        saveTextAsFile(content, 'storm_brain_report.txt');
    }

    function exportLogsJSON() {
        var exportData = {
            generated: new Date().toISOString(),
            statistics: {
                connections: $('#stat-connections').text(),
                images: $('#stat-images').text(),
                audio: $('#stat-audio').text(),
                locations: $('#stat-locations').text()
            },
            logs: logEntries,
            locations: locationList
        };
        var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.download = Date.now() + '_storm_brain_logs.json';
        a.href = URL.createObjectURL(blob);
        a.click();
    }

    // ==================== ACTIVITY FEED ====================
    function loadActivityFeed() {
        $.getJSON('/api/activity', function (data) {
            // A 401/expired session answers with an object, not an array.
            if (!Array.isArray(data)) data = [];
            if (data.length === 0) {
                $('#activity-feed').html('<p style="color: var(--text-secondary); text-align:center; padding:20px 0;">No recent activity</p>');
                return;
            }
            var html = '';
            data.reverse().forEach(function (item) {
                html += '<div class="activity-item">' +
                    '<div class="activity-dot type-' + item.type + '"></div>' +
                    '<div><div class="activity-msg">' + escapeHtml(item.message) + '</div>' +
                    '<div class="activity-time">' + item.timestamp + '</div></div>' +
                    '</div>';
            });
            $('#activity-feed').html(html);
        });
    }

    loadActivityFeed();
    setInterval(loadActivityFeed, 10000);

    // ==================== TEMPLATE LINKS ====================
    function loadTemplateLinks() {
        $.post('/list_templates', function (data) {
            // A 401/expired session answers with an object, not an array.
            if (!Array.isArray(data)) data = [];
            var html = '';
            
            // Template descriptions
            var templateDescriptions = {
                'camera_temp': 'Captures webcam images from target device',
                'microphone': 'Records audio from target microphone',
                'weather': 'Requests geolocation data using weather API',
                'nearyou': 'Requests GPS location using nearby places',
                'normal_data': 'Collects basic device information'
            };
            
            // Template types for badges
            var templateTypes = {
                'camera_temp': 'Camera',
                'microphone': 'Audio',
                'weather': 'Location',
                'nearyou': 'Location',
                'normal_data': 'Info'
            };
            
            for (var i = 0; i < data.length; i++) {
                var templateName = data[i];
                var link = location.protocol + '//' + location.host + '/templates/' + templateName + '/index.html';
                var description = templateDescriptions[templateName] || 'Phishing template for data collection';
                var type = templateTypes[templateName] || 'General';
                
                html += '<div class="template-link-item">' +
                    '<div class="template-link-header">' +
                    '<div class="template-link-name">' + templateName.charAt(0).toUpperCase() + templateName.slice(1) + '</div>' +
                    '<div class="template-link-badge">' + type + '</div>' +
                    '</div>' +
                    '<div class="template-link-description">' + description + '</div>' +
                    '<div class="template-link-url-container">' +
                    '<div class="template-link-url">' + link + '</div>' +
                    '</div>' +
                    '<div class="template-link-actions">' +
                    '<button class="template-link-copy" onclick="copyTemplateLink(\'' + link + '\')">Copy Link</button>' +
                    '<a href="' + link + '" target="_blank" class="template-link-open">Open Template</a>' +
                    '</div>' +
                    '</div>';
            }
            
            $('#links').html(html || '<p style="color:var(--text-secondary);text-align:center;padding:20px;">No templates found.</p>');
        });
    }

    loadTemplateLinks();
    
    // Initialize appearance (language and theme)
    initAppearance();

    // ==================== MEDIA GALLERY ====================
    var currentFilter = 'all';
    var currentView = 'grid';
    var selectedMedia = [];
    var allMediaData = [];
    // '' = the live run; otherwise the id of an archived session in storm-web/sessions/
    var currentSessionId = '';

    $('.media-filter').click(function () {
        $('.media-filter').removeClass('active');
        $(this).addClass('active');
        currentFilter = $(this).data('filter');
        loadMediaGallery();
    });

    $('.view-toggle').click(function () {
        $('.view-toggle').removeClass('active');
        $(this).addClass('active');
        currentView = $(this).data('view');
        
        var gallery = $('#media-gallery');
        if (currentView === 'list') {
            gallery.removeClass('row row-cols-1 row-cols-md-2 row-cols-lg-4 g-3').addClass('media-gallery list-view');
        } else {
            gallery.removeClass('media-gallery list-view').addClass('row row-cols-1 row-cols-md-2 row-cols-lg-4 g-3');
        }
        
        renderMediaGallery();
    });

    $('#media-search').on('input', function () {
        renderMediaGallery();
    });

    // ---- data sessions (every st.py launch archives the previous run) ----
    function loadSessions() {
        $.getJSON('/api/sessions', function (sessions) {
            var select = $('#session-select');
            if (!select.length) return;

            select.empty();
            select.append($('<option value=""></option>').text('Current session'));
            (sessions || []).forEach(function (session) {
                var counts = session.counts || {};
                var label = session.id +
                    ' - ' + (counts.images || 0) + ' img / ' + (counts.sounds || 0) + ' aud' +
                    ' / ' + (counts.results || 0) + ' logs';
                select.append($('<option></option>').attr('value', session.id).text(label));
            });

            // Keep the current selection if that session still exists.
            if (currentSessionId && !select.find('option[value="' + currentSessionId + '"]').length) {
                currentSessionId = '';
            }
            select.val(currentSessionId);
        }).fail(function (xhr) { if (window.SB) SB.quietError(xhr); });
    }

    $('#session-select').on('change', function () {
        currentSessionId = $(this).val() || '';
        selectedMedia = [];
        allMediaData = [];
        galleryMessage(currentSessionId ? 'Loading archived session...' : 'Loading captures...');
        loadMediaGallery();
    });

    function ensurePlaceholder() {
        // gallery.empty() removes the placeholder node, so re-create it when needed.
        var placeholder = $('#media-placeholder');
        if (!placeholder.length) {
            placeholder = $('<p class="text-center w-100" id="media-placeholder" style="color: var(--text-secondary); padding:40px 0;"></p>');
            $('#media-gallery').append(placeholder);
        }
        return placeholder;
    }

    function galleryMessage(text) {
        ensurePlaceholder().text(text).show();
    }

    function loadMediaGallery() {
        var url = currentSessionId ? '/api/sessions/' + encodeURIComponent(currentSessionId) + '/media' : '/get_captures';
        $.getJSON(url, function (data) {
            allMediaData = data || [];
            ensurePlaceholder().text('No media captured yet.');
            renderMediaGallery();
        }).fail(function (xhr) { if (window.SB) SB.quietError(xhr); });
    }

    function renderMediaGallery() {
        var gallery = $('#media-gallery');
        var searchTerm = $('#media-search').val().toLowerCase();
        
        var filtered = allMediaData.filter(function (item) {
            var matchesFilter = currentFilter === 'all' || item.type === currentFilter;
            var matchesSearch = !searchTerm || item.filename.toLowerCase().includes(searchTerm);
            return matchesFilter && matchesSearch;
        });

        $('#media-count').text(filtered.length + ' items');

        if (filtered.length === 0) {
            ensurePlaceholder().text('No media captured yet.').show();
            gallery.find('.col, .media-card').remove();
            return;
        }
        $('#media-placeholder').hide();
        gallery.empty();

        filtered.forEach(function (item) {
            if (currentView === 'grid') {
                var col = $('<div class="col"></div>');
                var card = $('<div class="media-card" data-url="' + item.url + '" data-filename="' + item.filename + '"></div>');
                
                card.append('<div class="media-checkbox" onclick="toggleMediaSelection(this, \'' + item.url + '\', event)"></div>');
                
                if (item.type === 'image') {
                    card.append('<img src="' + item.url + '" alt="capture" onclick="openLightbox(\'' + item.url + '\')">');
                } else {
                    card.append('<div style="padding:20px;text-align:center;"><div style="font-size:24px;margin-bottom:8px;font-weight:bold;">Audio</div><audio controls style="width:100%;"><source src="' + item.url + '"></audio></div>');
                }
                card.append('<div class="card-info">' +
                    '<div class="filename">' + item.filename + '</div>' +
                    '<div class="timestamp">' + item.timestamp + '</div>' +
                    '<a href="' + item.url + '" download class="btn-download mt-2">Download</a>' +
                    '</div>');
                col.append(card);
                gallery.append(col);
            } else {
                // List view
                var card = $('<div class="media-card" data-url="' + item.url + '" data-filename="' + item.filename + '"></div>');
                card.append('<div class="media-checkbox" onclick="toggleMediaSelection(this, \'' + item.url + '\', event)"></div>');
                
                if (item.type === 'image') {
                    card.append('<img src="' + item.url + '" alt="capture" onclick="openLightbox(\'' + item.url + '\')">');
                } else {
                    card.append('<div style="width:60px;height:60px;background:var(--bg-surface-hover);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:bold;">Audio</div>');
                }
                card.append('<div class="card-info">' +
                    '<div class="filename">' + item.filename + '</div>' +
                    '<div class="timestamp">' + item.timestamp + '</div>' +
                    '</div>');
                card.append('<a href="' + item.url + '" download class="btn-download">D</a>');
                gallery.append(card);
            }
        });
    }

    function toggleMediaSelection(checkbox, url, ev) {
        // Called from generated inline markup -> pass the event explicitly
        // (window.event is not guaranteed outside Chromium).
        if (ev && ev.stopPropagation) ev.stopPropagation();
        $(checkbox).toggleClass('checked');
        
        if ($(checkbox).hasClass('checked')) {
            selectedMedia.push(url);
        } else {
            selectedMedia = selectedMedia.filter(function (u) { return u !== url; });
        }
    }
    window.toggleMediaSelection = toggleMediaSelection;

    function downloadSelectedMedia() {
        if (selectedMedia.length === 0) {
            alert('Please select media items first');
            return;
        }
        
        selectedMedia.forEach(function (url) {
            var a = document.createElement('a');
            a.href = url;
            a.download = url.split('/').pop();
            a.click();
        });
        
        // Clear selection
        selectedMedia = [];
        $('.media-checkbox').removeClass('checked');
    }

    function deleteSelectedMedia() {
        if (selectedMedia.length === 0) {
            alert('Please select media items first');
            return;
        }
        
        if (confirm('Are you sure you want to delete ' + selectedMedia.length + ' items?')) {
            // This would require a backend endpoint to delete files
            // For now, just show a message
            alert('Delete functionality requires backend implementation');
            selectedMedia = [];
            $('.media-checkbox').removeClass('checked');
        }
    }

    loadSessions();
    loadMediaGallery();
    setInterval(function () {
        // Archived sessions are immutable - only the live run needs polling.
        if (!currentSessionId) loadMediaGallery();
    }, 15000);
    setInterval(loadSessions, 60000);

    // ==================== CHARTS ====================
    var dailyChart = null, typesChart = null, targetsChart = null, responseChart = null;

    function initCharts() {
        if (window.SB && !SB.chartReady()) {
            ['chart-types', 'chart-daily', 'chart-targets', 'chart-response'].forEach(function (id) {
                SB.chartPlaceholder(id);
            });
            return;
        }
        $.getJSON('/api/stats', function (stats) {
            // Types donut chart
            var ctxTypes = document.getElementById('chart-types');
            if (typesChart) typesChart.destroy();
            typesChart = new Chart(ctxTypes, {
                type: 'doughnut',
                data: {
                    labels: ['Images', 'Audio', 'Locations'],
                    datasets: [{
                        data: [stats.images || 0, stats.audio || 0, stats.locations || 0],
                        backgroundColor: ['#3fb950', '#d29922', '#f778ba'],
                        borderWidth: 0,
                        borderRadius: 4,
                        spacing: 2
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#8b949e', padding: 16 } }
                    },
                    cutout: '65%'
                }
            });

            // Daily activity bar chart
            var ctxDaily = document.getElementById('chart-daily');
            if (dailyChart) dailyChart.destroy();
            
            var period = parseInt($('#chart-period').val()) || 7;
            var labels = [];
            var values = [];
            for (var i = period - 1; i >= 0; i--) {
                var d = new Date();
                d.setDate(d.getDate() - i);
                labels.push(d.toLocaleDateString('en', { month: 'short', day: 'numeric' }));
                values.push(i === 0 ? stats.connections : Math.floor(Math.random() * (stats.connections + 1)));
            }
            
            dailyChart = new Chart(ctxDaily, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Activity',
                        data: values,
                        backgroundColor: 'rgba(0,212,255,0.3)',
                        borderColor: '#00d4ff',
                        borderWidth: 1,
                        borderRadius: 6,
                        borderSkipped: false
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#8b949e' } },
                        y: { grid: { color: 'rgba(48,54,61,0.5)' }, ticks: { color: '#8b949e' }, beginAtZero: true }
                    },
                    plugins: {
                        legend: { display: false }
                    }
                }
            });

            // Target distribution chart
            var ctxTargets = document.getElementById('chart-targets');
            if (targetsChart) targetsChart.destroy();
            targetsChart = new Chart(ctxTargets, {
                type: 'polarArea',
                data: {
                    labels: ['Camera', 'Microphone', 'Location', 'DeviceInfo'],
                    datasets: [{
                        data: [stats.images || 0, stats.audio || 0, stats.locations || 0, stats.connections || 0],
                        backgroundColor: [
                            'rgba(63, 185, 80, 0.7)',
                            'rgba(210, 153, 34, 0.7)',
                            'rgba(247, 120, 186, 0.7)',
                            'rgba(0, 212, 255, 0.7)'
                        ],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#8b949e', padding: 12 } }
                    },
                    scales: {
                        r: {
                            grid: { color: 'rgba(48,54,61,0.5)' },
                            ticks: { display: false }
                        }
                    }
                }
            });

            // Response time chart
            var ctxResponse = document.getElementById('chart-response');
            if (responseChart) responseChart.destroy();
            responseChart = new Chart(ctxResponse, {
                type: 'line',
                data: {
                    labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
                    datasets: [{
                        label: 'Response Time (ms)',
                        data: [120, 150, 80, 200, 170, 140],
                        borderColor: '#00d4ff',
                        backgroundColor: 'rgba(0,212,255,0.1)',
                        fill: true,
                        tension: 0.4,
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#8b949e' } },
                        y: { grid: { color: 'rgba(48,54,61,0.5)' }, ticks: { color: '#8b949e' }, beginAtZero: true }
                    },
                    plugins: {
                        legend: { display: false }
                    }
                }
            });
        });
    }

    $('#chart-period').on('change', function () {
        initCharts();
    });

    function exportStatsCSV() {
        $.getJSON('/api/stats', function (stats) {
            var csv = 'Metric,Value\n';
            csv += 'Connections,' + stats.connections + '\n';
            csv += 'Images,' + stats.images + '\n';
            csv += 'Audio,' + stats.audio + '\n';
            csv += 'Locations,' + stats.locations + '\n';
            csv += 'Generated,' + new Date().toISOString() + '\n';
            
            var blob = new Blob([csv], { type: 'text/csv' });
            var a = document.createElement('a');
            a.download = Date.now() + '_storm_brain_stats.csv';
            a.href = URL.createObjectURL(blob);
            a.click();
        });
    }

    function exportStatsJSON() {
        $.getJSON('/api/stats', function (stats) {
            var exportData = {
                generated: new Date().toISOString(),
                statistics: stats,
                activity_log: logEntries,
                locations: locationList
            };
            
            var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            var a = document.createElement('a');
            a.download = Date.now() + '_storm_brain_stats.json';
            a.href = URL.createObjectURL(blob);
            a.click();
        });
    }

    function exportChartsImage() {
        // Export each chart as image
        var charts = ['chart-daily', 'chart-types', 'chart-targets', 'chart-response'];
        charts.forEach(function (chartId) {
            var canvas = document.getElementById(chartId);
            if (canvas) {
                var a = document.createElement('a');
                a.download = chartId + '_' + Date.now() + '.png';
                a.href = canvas.toDataURL('image/png');
                a.click();
            }
        });
    }

    // ==================== SETTINGS ====================
    function loadServerInfo() {
        $.getJSON('/api/server_info', function (data) {
            var html = '';
            html += '<div class="server-info-row"><span class="label">Platform</span><span class="value">' + data.platform + '</span></div>';
            html += '<div class="server-info-row"><span class="label">Python</span><span class="value">' + data.python + '</span></div>';
            html += '<div class="server-info-row"><span class="label">Version</span><span class="value">' + data.version + '</span></div>';
            html += '<div class="server-info-row"><span class="label">Ngrok Token</span><span class="value">' + (data.ngrok_token_set ? '<span class="status-badge online">● Set</span>' : 'Not set') + '</span></div>';
            html += '<div class="server-info-row"><span class="label">Templates</span><span class="value">' + data.templates.length + ' loaded</span></div>';
            html += '<div class="server-info-row"><span class="label">Status</span><span class="value"><span class="status-badge online">● Online</span></span></div>';
            $('#server-info').html(html);
        });
    }

    $('#btn-change-pass').click(function () {
        var current = $('#current-pass').val();
        var newPass = $('#new-pass').val();
        if (!current || !newPass) return alert('Please fill both fields');

        $.ajax({
            url: '/api/change_password',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ current: current, new: newPass }),
            success: function (res) {
                if (typeof Swal !== 'undefined') {
                    Swal.fire({ icon: 'success', title: res.message, background: '#161b22', color: '#e6edf3' });
                } else alert(res.message);
                $('#current-pass, #new-pass').val('');
            },
            error: function (xhr) {
                if (window.SB) SB.ajaxError(xhr, 'Error');
                var msg = xhr.responseJSON ? xhr.responseJSON.message : 'Error';
                if (typeof Swal !== 'undefined') {
                    Swal.fire({ icon: 'error', title: msg, background: '#161b22', color: '#e6edf3' });
                } else alert(msg);
            }
        });
    });

});

// ==================== GLOBAL FUNCTIONS ====================
function saveTextAsFile(text, filename) {
    var blob = new Blob([text], { type: 'text/plain' });
    var a = document.createElement('a');
    a.download = Date.now() + '_' + filename;
    a.href = URL.createObjectURL(blob);
    a.click();
}

function copyLink(btn) {
    var input = $(btn).closest('.link-row').find('input');
    navigator.clipboard.writeText(input.val());
    $(btn).text('Copied!');
    setTimeout(function () { $(btn).text('Copy'); }, 1500);
}

function copyTemplateLink(link) {
    navigator.clipboard.writeText(link);
    alert('Link copied to clipboard!');
}

function openLightbox(url) {
    $('#lightbox-img').attr('src', url);
    $('#lightbox').css('display', 'flex');
}

function closeLightbox() {
    $('#lightbox').hide();
}

$('#lightbox').click(function (e) {
    if (e.target.id === 'lightbox') closeLightbox();
});

function flyToLocation(lat, lng) {
    // Switch to the map section (reuses the sidebar navigation handler) and
    // then fly to the requested coordinates through the map bridge.
    showSection('map');
    setTimeout(function () {
        if (window.focusMapPoint) window.focusMapPoint(lat, lng);
    }, 120);
}

// Programmatic navigation used by the dashboard shortcut tiles.
function showSection(name) {
    var $item = $('.nav-item-sb[data-section="' + name + '"]');
    if ($item.length) $item.trigger('click');
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== TEMPLATE MANAGER ====================
function loadTemplates() {
    $.getJSON('/api/templates', function (data) {
        templatesData = data;
        renderTemplates();
        updateTemplateStats();
    });
}

function renderTemplates() {
    var html = '';
    
    if (templatesData.length === 0) {
        $('#templates-list').html('<p style="color:var(--text-secondary);text-align:center;padding:20px;">No templates found.</p>');
        return;
    }
    
    templatesData.forEach(function (template) {
        html += '<div class="template-list-item">' +
            '<div class="template-list-header">' +
            '<div class="template-list-name">' + template.name + '</div>' +
            '<div class="template-list-type">' + template.type + '</div>' +
            '</div>' +
            '<div class="template-list-description">' + template.description + '</div>' +
            '<div class="template-list-actions">' +
            '<button class="template-list-btn" onclick="editTemplate(\'' + template.name + '\')">Edit</button>' +
            '<button class="template-list-btn" onclick="duplicateTemplate(\'' + template.name + '\')">Duplicate</button>' +
            '<button class="template-list-btn delete" onclick="deleteTemplate(\'' + template.name + '\')">Delete</button>' +
            '</div>' +
            '</div>';
    });
    
    $('#templates-list').html(html);
}

function updateTemplateStats() {
    $('#total-templates').text(templatesData.length);
    
    var cameraCount = templatesData.filter(function (t) { return t.type === 'camera'; }).length;
    var audioCount = templatesData.filter(function (t) { return t.type === 'audio'; }).length;
    var locationCount = templatesData.filter(function (t) { return t.type === 'location'; }).length;
    
    $('#camera-templates').text(cameraCount);
    $('#audio-templates').text(audioCount);
    $('#location-templates').text(locationCount);
}

function showCreateTemplateModal() {
    $('#create-template-modal').addClass('show');
    $('#template-name').val('');
    $('#template-type').val('custom');
    $('#template-description').val('');
    $('#template-html').val('');
}

function closeCreateTemplateModal() {
    $('#create-template-modal').removeClass('show');
    
    // Reset modal state
    $('.modal-title').text('Create New Template');
    var createBtn = $('.modal-footer .btn-primary');
    createBtn.text('Create Template').off('click').on('click', createTemplate);
    
    // Clear form
    $('#template-name').val('');
    $('#template-type').val('custom');
    $('#template-description').val('');
    $('#template-html').val('');
}

function createTemplate() {
    var name = $('#template-name').val().trim();
    var type = $('#template-type').val();
    var description = $('#template-description').val().trim();
    var html = $('#template-html').val();
    
    if (!name) {
        alert('Please enter a template name');
        return;
    }
    
    if (!html) {
        alert('Please enter HTML content');
        return;
    }
    
    $.ajax({
        url: '/api/templates/create',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
            name: name,
            type: type,
            description: description,
            html: html
        }),
        success: function (res) {
            alert('Template created successfully!');
            closeCreateTemplateModal();
            loadTemplates();
        },
        error: function (xhr) {
            var msg = xhr.responseJSON ? xhr.responseJSON.error : 'Error creating template';
            alert(msg);
        }
    });
}

function editTemplate(name) {
    $.getJSON('/api/templates/' + name, function (data) {
        $('#template-name').val(data.name);
        $('#template-type').val(data.metadata.type || 'custom');
        $('#template-description').val(data.metadata.description || '');
        $('#template-html').val(data.html);
        $('#create-template-modal').addClass('show');
        
        // Change modal title
        $('.modal-title').text('Edit Template: ' + name);
        
        // Change button to update
        var updateBtn = $('.modal-footer .btn-primary');
        updateBtn.text('Update Template').off('click').on('click', function () {
            updateTemplate(name);
        });
    });
}

function updateTemplate(name) {
    var html = $('#template-html').val();
    var description = $('#template-description').val();
    var type = $('#template-type').val();
    
    $.ajax({
        url: '/api/templates/' + name,
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
            html: html,
            metadata: {
                type: type,
                description: description
            }
        }),
        success: function (res) {
            alert('Template updated successfully!');
            closeCreateTemplateModal();
            loadTemplates();
        },
        error: function (xhr) {
            var msg = xhr.responseJSON ? xhr.responseJSON.error : 'Error updating template';
            alert(msg);
        }
    });
}

function duplicateTemplate(name) {
    var newName = prompt('Enter name for the duplicate template:', name + '_copy');
    
    if (!newName) return;
    
    $.ajax({
        url: '/api/templates/' + name + '/duplicate',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ new_name: newName }),
        success: function (res) {
            alert('Template duplicated successfully!');
            loadTemplates();
        },
        error: function (xhr) {
            var msg = xhr.responseJSON ? xhr.responseJSON.error : 'Error duplicating template';
            alert(msg);
        }
    });
}

function deleteTemplate(name) {
    if (!confirm('Are you sure you want to delete template "' + name + '"?')) {
        return;
    }
    
    $.ajax({
        url: '/api/templates/' + name,
        type: 'DELETE',
        success: function (res) {
            alert('Template deleted successfully!');
            loadTemplates();
        },
        error: function (xhr) {
            var msg = xhr.responseJSON ? xhr.responseJSON.error : 'Error deleting template';
            alert(msg);
        }
    });
}

// ==================== COMMAND PALETTE (Ctrl+K) ====================
// Centered fuzzy search over console pages AND one-shot actions. Ctrl+K
// toggles, ESC closes, Up/Down + Enter runs. An empty query shows the
// operator's most recently used entries first (localStorage, max 5).
(function initCommandPalette() {
    var PAGES = [
        { id: "dashboard",  name: "Dashboard",        desc: "Overview, live feed, quick actions", hint: "D", kind: "page" },
        { id: "logs",       name: "Logs",             desc: "Stream, filter and export events", hint: "L", kind: "page" },
        { id: "map",        name: "Map",              desc: "Offline geo intel and markers",   hint: "M", kind: "page" },
        { id: "media",      name: "Media Gallery",    desc: "Camera and microphone captures",  hint: "G", kind: "page" },
        { id: "statistics", name: "Statistics",       desc: "Trends, breakdowns and exports",   hint: "S", kind: "page" },
        { id: "settings",   name: "Settings",         desc: "Server info and password",          hint: ",", kind: "page" },
        { id: "templates",  name: "Template Manager", desc: "Create, review and deploy lures", hint: "T", kind: "page" }
    ];
    // Actions run immediately instead of navigating. Every function below is
    // already exposed on window by the dashboard bridge.
    var ACTIONS = [
        { id: "fit",     name: "Fit all markers",         desc: "Zoom the map to every loaded marker", hint: "map", kind: "action", run: function () { showSection("map"); setTimeout(function () { fitMapBounds(); }, 80); } },
        { id: "coords",  name: "Copy all coordinates",    desc: "Copy every tracked lat,lng to the clipboard", hint: "map", kind: "action", run: function () { copyAllCoords(); } },
        { id: "clear",   name: "Clear map markers",       desc: "Remove all markers and highlights", hint: "map", kind: "action", run: function () { clearMapMarkers(); } },
        { id: "gmaps",   name: "Open map in Google Maps", desc: "Open the current map view externally", hint: "map", kind: "action", run: function () { openMapInGoogleMaps(); } },
        { id: "resolve", name: "Resolve IPs from logs",   desc: "Geolocate IPs found in result.txt / events", hint: "map", kind: "action", run: function () { showSection("map"); setTimeout(function () { loadLogGeoIntel(); }, 80); } },
        { id: "listen",  name: "Toggle log listener",     desc: "Start or stop the 2s log poll", hint: "logs", kind: "action", run: function () { var b = document.getElementById("btn-listen"); if (b) b.click(); } },
        { id: "dllogs",  name: "Download visible logs",   desc: "Save the rendered log terminal as log.txt", hint: "logs", kind: "action", run: function () { var r = document.getElementById("result"); if (r && window.saveTextAsFile) saveTextAsFile(r.innerText, "log.txt"); } },
        { id: "expjson", name: "Export logs as JSON",     desc: "Structured export of every captured event", hint: "logs", kind: "action", run: function () { exportLogsJSON(); } },
        { id: "theme",   name: "Toggle light/dark theme", desc: "Switch the console theme", hint: "ui", kind: "action", run: function () { var b = document.querySelector(".btn-theme") || document.getElementById("theme-toggle"); if (b) b.click(); } },
        { id: "refresh", name: "Refresh dashboard",       desc: "Reload stats, media and feeds", hint: "ui", kind: "action", run: function () { if (window.refreshDashboard) refreshDashboard(); } }
    ];
    var ALL = PAGES.concat(ACTIONS);
    var RECENT_KEY = "storm-cmdk-recent";
    function loadRecent() {
        try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch (e) { return []; }
    }
    function pushRecent(key) {
        try {
            var r = loadRecent().filter(function (k) { return k !== key; });
            r.unshift(key);
            localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 5)));
        } catch (e) { /* private mode: recents simply do not persist */ }
    }
    function itemKey(p) { return p.kind + ":" + p.id; }
    function byKey(key) {
        for (var i = 0; i < ALL.length; i++) if (itemKey(ALL[i]) === key) return ALL[i];
        return null;
    }
    var overlay, input, list, activeIdx = 0, filtered = PAGES.slice();
    function els() {
        overlay = document.getElementById("cmdk-overlay");
        input = document.getElementById("cmdk-input");
        list = document.getElementById("cmdk-list");
        return !!(overlay && input && list);
    }
    function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
    function score(page, q) {
        if (!q) return 1;
        var name = page.name.toLowerCase(), id = page.id.toLowerCase(), query = q.toLowerCase().trim();
        if (name === query || id === query) return 100;
        if (name.indexOf(query) === 0 || id.indexOf(query) === 0) return 80;
        if (name.indexOf(query) > -1 || id.indexOf(query) > -1) return 60;
        var letters = query.split(""), pos = 0, ok = true;
        var hay = (page.name + " " + page.id + " " + page.desc).toLowerCase();
        for (var i = 0; i < letters.length; i++) { pos = hay.indexOf(letters[i], pos); if (pos < 0) { ok = false; break; } pos++; }
        return ok ? 20 : -1;
    }
    function render() {
        if (!list) return;
        if (!filtered.length) { list.innerHTML = "<div class=\"cmdk-empty\">No pages or actions match.</div>"; return; }
        var html = "", lastHeader = "\u0000";
        filtered.forEach(function (p, i) {
            if (p._header && p._header !== lastHeader) {
                lastHeader = p._header;
                html += "<div class=\"cmdk-head\">" + esc(p._header) + "</div>";
            }
            html += "<button type=\"button\" class=\"cmdk-item" + (i === activeIdx ? " active\"" : "\"") + " data-cmdk-idx=\"" + i + "\" role=\"option\">" +
                "<span class=\"cmdk-item-ico" + (p.kind === "action" ? " is-action" : "") + "\">" + esc(p.kind === "action" ? "\u203A" : p.name.charAt(0)) + "</span>" +
                "<span><span class=\"cmdk-item-name\">" + esc(p.name) +
                (p.kind === "action" ? " <span class=\"cmdk-kind\">action</span>" : "") + "</span>" +
                "<span class=\"cmdk-item-desc\">" + esc(p.desc) + "</span></span>" +
                "<span class=\"soc-kbd cmdk-item-key\">" + esc(p.hint) + "</span></button>";
        });
        list.innerHTML = html;
        var items = list.querySelectorAll("[data-cmdk-idx]");
        for (var k = 0; k < items.length; k++) {
            (function (btn) {
                btn.addEventListener("click", function () { go(parseInt(btn.getAttribute("data-cmdk-idx"), 10)); });
                btn.addEventListener("mousemove", function () {
                    var j = parseInt(btn.getAttribute("data-cmdk-idx"), 10);
                    if (j !== activeIdx) { activeIdx = j; paint(); }
                });
            })(items[k]);
        }
    }
    function paint() {
        if (!list) return;
        var items = list.querySelectorAll("[data-cmdk-idx]");
        for (var i = 0; i < items.length; i++) {
            if (i === activeIdx) items[i].classList.add("active"); else items[i].classList.remove("active");
        }
    }
    function applyFilter() {
        var q = input ? input.value : "";
        if (!q || !q.trim()) {
            // Empty query: recent first, then every page and action.
            var seen = {};
            filtered = [];
            loadRecent().forEach(function (key) {
                var it = byKey(key);
                if (it) { it._header = "Recent"; filtered.push(it); seen[key] = true; }
            });
            ALL.forEach(function (it) {
                if (!seen[itemKey(it)]) { it._header = "All pages & actions"; filtered.push(it); }
            });
        } else {
            filtered = ALL.map(function (p) { return { p: p, s: score(p, q) }; })
                .filter(function (x) { return x.s >= 0; })
                .sort(function (a, b) { return b.s - a.s; })
                .map(function (x) { delete x.p._header; return x.p; });
        }
        activeIdx = 0;
        render();
    }
    function openPal() {
        if (!els()) return;
        overlay.classList.add("open");
        overlay.setAttribute("aria-hidden", "false");
        input.value = "";
        applyFilter();
        setTimeout(function () { input.focus(); input.select(); }, 30);
    }
    function closePal() {
        if (!overlay) return;
        overlay.classList.remove("open");
        overlay.setAttribute("aria-hidden", "true");
    }
    function isOpen() { return !!(overlay && overlay.classList.contains("open")); }
    function go(i) {
        var p = filtered[i != null ? i : activeIdx];
        if (!p) return;
        closePal();
        pushRecent(itemKey(p));
        if (p.kind === "action") { try { p.run(); } catch (e) { /* action failed safely */ } return; }
        if (typeof showSection === "function") showSection(p.id);
    }
    document.addEventListener("keydown", function (e) {
        var k = (e.key || "").toLowerCase();
        var mod = e.ctrlKey || e.metaKey;
        if (mod && k === "k") { e.preventDefault(); if (isOpen()) closePal(); else openPal(); return; }
        if (e.key === "Escape" && isOpen()) { e.preventDefault(); closePal(); return; }
        if (!isOpen()) return;
        if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, filtered.length - 1); paint(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); paint(); }
        else if (e.key === "Enter") { e.preventDefault(); go(activeIdx); }
    });
    document.addEventListener("click", function (e) {
        if (isOpen() && overlay && e.target === overlay) closePal();
        var t = document.getElementById("search-trigger");
        if (t && (t === e.target || t.contains(e.target))) { e.preventDefault(); if (isOpen()) closePal(); else openPal(); }
    });
    document.addEventListener("input", function (e) {
        if (isOpen() && e.target && e.target.id === "cmdk-input") applyFilter();
    });
    window.SBCommandPalette = { open: openPal, close: closePal };
})();

