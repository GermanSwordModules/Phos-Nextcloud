/* Phos · shared figure renderer.
 *
 * One implementation of every Facts diagram, used by the desktop (CEF) and the Android app,
 * because both load this file. Input is a payload section (see README.md); output is an <svg>
 * string plus the table that says the same thing in words.
 *
 * Two rules the rest of the file follows:
 *
 *  - Nothing here reads the DOM or the document's CSS. Colours arrive as a palette object, so
 *    the same call can produce a themed figure for the page (`var(--fx-…)` strings) or a frozen
 *    one for a presentation slide (resolved literals). See `palette()` and `freeze()`.
 *  - Every figure ships its table twin. It is the accessible reading of the chart, the answer to
 *    "no diagrams" in the settings, and what a screen reader gets.
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  /* Theme tokens the figures use. The page defines them in facts.css; this is only the list. */
  var TOKENS = ['ink', 'ink2', 'ink3', 'rule', 'surface', 's1', 's2', 's3', 'neutral'];

  /** Palette of `var(--fx-*)` references — what the page itself passes. */
  function palette() {
    var p = {};
    TOKENS.forEach(function (t) { p[t] = 'var(--fx-' + t + ')'; });
    return p;
  }

  /** Palette of resolved literals, read off `el`. Needed when a figure leaves the page — a deck
   *  slide has its own stylesheet and would otherwise render every mark in the wrong colour. */
  function freeze(el) {
    var cs = global.getComputedStyle(el), p = {};
    TOKENS.forEach(function (t) { p[t] = (cs.getPropertyValue('--fx-' + t) || '').trim() || '#888'; });
    return p;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function n2(v) { return Math.round(v * 100) / 100; }

  function table(head, rows) {
    var h = head.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('');
    var b = rows.map(function (r) {
      return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<table class="fx-table"><thead><tr>' + h + '</tr></thead><tbody>' + b + '</tbody></table>';
  }

  /* ---------------------------------------------------------------- canon strip */
  /* section: { books: [{osis, name, weight}] } in canon order, otCount = how many are OT. */
  function canonStrip(s, o) {
    var P = o.palette, books = s.books || [], W = 980, L = 10, R = 48, GAP = 30;
    var base = 168, top = 96, H = 212;
    if (!books.length) return null;
    var slot = (W - L - R - GAP) / books.length, bw = slot - 3.6;
    var max = books.reduce(function (m, b) { return Math.max(m, b.weight || 0); }, 0) || 1;
    var sc = top / max;
    var ot = s.otCount == null ? 39 : s.otCount;
    var ranked = books.slice().sort(function (a, b) { return (b.weight || 0) - (a.weight || 0); });
    var tops = ranked.slice(0, 3).filter(function (b) { return b.weight > 0; }).map(function (b) { return b.osis; });
    var out = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="wide" role="img" aria-label="' + esc(s.title || '') + '">'];
    var placed = [];

    [Math.round(max / 2), max].forEach(function (g) {
      var y = base - g * sc;
      out.push('<line x1="' + L + '" y1="' + n2(y) + '" x2="' + (W - R + 4) + '" y2="' + n2(y) +
        '" stroke="' + P.rule + '" stroke-width="1"/>');
      out.push('<text x="' + (W - R + 8) + '" y="' + n2(y + 3.5) + '" class="fx-ax" fill="' + P.ink3 + '">' + g + '</text>');
    });
    out.push('<line x1="' + L + '" y1="' + base + '" x2="' + (W - R + 4) + '" y2="' + base +
      '" stroke="' + P.ink3 + '" stroke-width="1"/>');

    books.forEach(function (b, i) {
      var x = L + i * slot + (i >= ot ? GAP : 0), w = b.weight || 0;
      if (!w) {
        out.push('<rect x="' + n2(x) + '" y="' + (base - 2) + '" width="' + n2(bw) + '" height="2" fill="' + P.neutral + '">' +
          '<title>' + esc(b.name) + ' — 0</title></rect>');
        return;
      }
      var h = w * sc;
      out.push('<rect class="fx-bar" x="' + n2(x) + '" y="' + n2(base - h) + '" width="' + n2(bw) +
        '" height="' + n2(h) + '" rx="3" fill="' + P.s1 + '" data-osis="' + esc(b.osis) + '">' +
        '<title>' + esc(b.name) + ' — ' + w + '</title></rect>');
      if (tops.indexOf(b.osis) >= 0) {
        // Labels are placed against what is already on the page, not by rank: on a sparse topic
        // the three strongest books can be neighbours, and a fixed offset per rank collides.
        var cx = x + bw / 2, half = Math.max(30, (b.name.length * 3.4) / 2), off = 8;
        // Compared in absolute y, not in offset: two bars of different height with the same
        // offset still land at the same place on the page, which is what used to collide.
        var ly = base - h - off;
        // A lifted label is one line ("2. Samuel 226") rather than two, so a step costs 14px
        // instead of 28 — and it is clamped to the top of the box, because a label pushed off
        // the viewBox is worse than one sitting a little close to its neighbour.
        var lines = 2;
        while (placed.some(function (q) {
          return Math.abs(q.y - ly) < 16 && cx - half < q.x + q.half && cx + half > q.x - q.half;
        }) && off < 60) { off += 16; ly = base - h - off; lines = 1; }
        var minY = lines === 2 ? 21 : 10;
        if (ly < minY) { ly = minY; off = base - h - ly; }
        placed.push({ x: cx, half: half, y: ly });
        if (lines === 1) {
          var lx1 = cx + 14;
          out.push('<path d="M ' + n2(cx) + ' ' + n2(base - h - 3) + ' L ' + n2(cx) + ' ' + n2(ly + 3) +
            ' L ' + n2(lx1 - 4) + ' ' + n2(ly + 3) + '" fill="none" stroke="' + P.ink3 +
            '" stroke-width="1" opacity=".45"/>');
          out.push('<text x="' + n2(lx1) + '" y="' + n2(ly) + '" class="fx-val-n" fill="' + P.ink2 + '">' +
            esc(b.name) + ' <tspan class="fx-val" fill="' + P.ink + '">' + w + '</tspan></text>');
        } else {
          out.push('<text x="' + n2(cx) + '" y="' + n2(ly) + '" text-anchor="middle" class="fx-val" fill="' +
            P.ink + '">' + w + '</text>');
          out.push('<text x="' + n2(cx) + '" y="' + n2(ly - 13) + '" text-anchor="middle" class="fx-val-n" fill="' +
            P.ink2 + '">' + esc(b.name) + '</text>');
        }
      }
    });

    if (ot > 0 && ot < books.length) {
      // The number is what was FOUND, not how many books a testament has — the old label read
      // "Altes Testament · 39" and was taken for a hit count.
      var w = esc(s.hitsWord || '');
      var otN = s.otSum === undefined ? '' : ' · ' + s.otSum + (w ? ' ' + w : '');
      var ntN = s.ntSum === undefined ? '' : ' · ' + s.ntSum + (w ? ' ' + w : '');
      out.push('<text x="' + n2(L + ot * slot / 2) + '" y="' + (base + 22) + '" text-anchor="middle" class="fx-ax" fill="' +
        P.ink2 + '">' + esc(s.otLabel || '') + otN + '</text>');
      out.push('<text x="' + n2(L + ot * slot + GAP + (books.length - ot) * slot / 2) + '" y="' + (base + 22) +
        '" text-anchor="middle" class="fx-ax" fill="' + P.ink2 + '">' + esc(s.ntLabel || '') + ntN + '</text>');
    }
    out.push('</svg>');
    return {
      svg: out.join(''),
      table: table([s.bookHead || 'Buch', s.countHead || 'Stellen'],
        ranked.filter(function (b) { return b.weight; }).map(function (b) { return [b.name, b.weight]; }))
    };
  }

  /* ---------------------------------------------------------------- coverage bar */
  /* section: { groups: [{label, count, muted?}] } */
  function coverageBar(s, o) {
    var P = o.palette, g = s.groups || [], W = 980, H = 92, x0 = 10, x1 = 970;
    var total = g.reduce(function (t, x) { return t + (x.count || 0); }, 0);
    if (!total) return null;
    var hues = [P.s1, P.s2, P.s3], out = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="wide" role="img" aria-label="' +
      esc(s.title || '') + '">'], x = x0, hue = 0;
    g.forEach(function (seg) {
      var w = (x1 - x0) * (seg.count || 0) / total - 2;
      var fill = seg.muted ? P.neutral : hues[hue++ % hues.length];
      out.push('<rect x="' + n2(x) + '" y="10" width="' + n2(w) + '" height="34" rx="4" fill="' + fill + '">' +
        '<title>' + esc(seg.label) + ' — ' + seg.count + '</title></rect>');
      if (w > 70) {
        out.push('<text x="' + n2(x + w / 2) + '" y="32" text-anchor="middle" class="fx-seg" fill="' +
          (seg.muted ? P.ink2 : '#fff') + '">' + esc(seg.label) + ' ' + seg.count + '</text>');
      }
      x += w + 2;
    });
    x = x0; hue = 0;
    g.forEach(function (seg) {
      var fill = seg.muted ? P.neutral : hues[hue++ % hues.length];
      out.push('<rect x="' + n2(x) + '" y="62" width="10" height="10" rx="2" fill="' + fill + '"/>');
      out.push('<text x="' + n2(x + 16) + '" y="71" class="fx-ax" fill="' + P.ink2 + '">' + esc(seg.label) + '</text>');
      x += 150;
    });
    if (s.note) out.push('<text x="' + x1 + '" y="71" text-anchor="end" class="fx-ax" fill="' + P.ink3 + '">' + esc(s.note) + '</text>');
    out.push('</svg>');
    return {
      svg: out.join(''),
      table: table([s.groupHead || 'Kategorie', s.countHead || 'Treffer'],
        g.map(function (seg) { return [seg.label, seg.count]; }))
    };
  }

  /* ---------------------------------------------------------------- timeline */
  /* section: { epochs:[{label,type,person,from,to}], events:[{label,year,ref,age}] }, years BCE. */
  /* Cut for drawing only. The <title> keeps the whole thing, which is what the mouse-over shows
     and what the table twin lists — "bitte mindestens den Mouse-Over vervollständigen". */
  function fit(text, maxChars) {
    if (!text || text.length <= maxChars) return text;
    return text.slice(0, maxChars - 1).trim() + '…';
  }

  function timeline(s, o) {
    var P = o.palette, eps = s.epochs || [], evs = (s.events || []).slice();
    if (!eps.length && !evs.length) return null;
    var W = 980, L = 250, R = 44, row = 28, top = 46;
    var years = [];
    eps.forEach(function (e) { years.push(e.from, e.to); });
    evs.forEach(function (e) { years.push(e.year); });
    var hi = Math.max.apply(null, years), lo = Math.min.apply(null, years);
    var pad = Math.max(10, Math.round((hi - lo) * 0.08));
    var x0 = hi + pad, x1 = lo - pad, px0 = L, px1 = W - R;
    var H = top + eps.length * row + 16 + evs.length * 16 + 30;
    function X(y) { return px0 + (x0 - y) / (x0 - x1) * (px1 - px0); }
    var bandBottom = top + eps.length * row - 8;
    var persons = [], hues = [P.s1, P.s2, P.s3];
    function hue(p) { var i = persons.indexOf(p); if (i < 0) { persons.push(p); i = persons.length - 1; } return hues[i % hues.length]; }
    eps.forEach(function (e) { hue(e.person || ''); });

    var out = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="wide" role="img" aria-label="' + esc(s.title || '') + '">'];
    var step = Math.max(10, Math.round((x0 - x1) / 8 / 10) * 10);
    var eraX = W - 4 - String(s.eraLabel || 'v. Chr.').length * 6;
    for (var y = Math.ceil(x0 / step) * step; y >= x1; y -= step) {
      if (y > x0 || y < x1 || X(y) > eraX - 14) continue;
      out.push('<line x1="' + n2(X(y)) + '" y1="26" x2="' + n2(X(y)) + '" y2="' + n2(bandBottom) +
        '" stroke="' + P.rule + '" stroke-width="1"/>');
      out.push('<text x="' + n2(X(y)) + '" y="18" text-anchor="middle" class="fx-ax" fill="' + P.ink3 + '">' + y + '</text>');
    }
    out.push('<text x="' + (W - 4) + '" y="18" text-anchor="end" class="fx-ax" fill="' + P.ink3 + '">' +
      esc(s.eraLabel || 'v. Chr.') + '</text>');

    eps.forEach(function (e, i) {
      var y = top + i * row, c = hue(e.person || ''), reign = (e.type || '').toLowerCase() !== 'life';
      var w = Math.max(X(e.to) - X(e.from), 3);
      out.push('<rect x="' + n2(X(e.from)) + '" y="' + n2(y) + '" width="' + n2(w) + '" height="17" rx="4"' +
        (reign ? ' fill="' + c + '"' : ' fill="none" stroke="' + c + '" stroke-width="1.5"') +
        ' data-epoch="' + esc(e.id || '') + '"><title>' + esc(e.label) + ' — ' + e.from + '–' + e.to +
        ' ' + esc(s.eraLabel || '') + ' (' + (e.from - e.to) + ' ' + esc(s.yearsShort || '') +
        ')</title></rect>');
      // The label carries the full text too, so hovering the words answers as well as hovering
      // the band.
      out.push('<text x="' + (L - 12) + '" y="' + n2(y + 13) + '" text-anchor="end" class="fx-row" fill="' + P.ink + '">' +
        esc(fit(e.label, 30)) + '<title>' + esc(e.label) + '</title></text>');
      out.push('<text x="' + n2(X(e.to) + 7) + '" y="' + n2(y + 13) + '" class="fx-ax" fill="' + P.ink3 + '">' +
        (e.from - e.to) + ' ' + esc(s.yearsShort || 'J.') + '</text>');
    });

    var base = bandBottom + 8;
    out.push('<line x1="' + L + '" y1="' + n2(base) + '" x2="' + (W - R) + '" y2="' + n2(base) +
      '" stroke="' + P.ink3 + '" stroke-width="1"/>');
    // One lane per event: a staircase cannot collide, however close two dates are.
    evs.sort(function (a, b) { return b.year - a.year; }).forEach(function (e, i) {
      var x = X(e.year), ty = base + 16 + i * 16, right = x > (px0 + px1) * 0.62;
      out.push('<line x1="' + n2(x) + '" y1="' + n2(base + 3) + '" x2="' + n2(x) + '" y2="' + n2(ty - 4) +
        '" stroke="' + P.ink3 + '" stroke-width="1" opacity=".45"/>');
      out.push('<circle cx="' + n2(x) + '" cy="' + n2(base) + '" r="4" fill="' + P.ink + '" stroke="' + P.surface +
        '" stroke-width="2"><title>' + esc(e.label) + ' — ' + e.year + '</title></circle>');
      out.push('<text x="' + n2(x + (right ? -7 : 7)) + '" y="' + n2(ty) + '" text-anchor="' + (right ? 'end' : 'start') +
        '" class="fx-ev" fill="' + P.ink + '">' + esc(fit(e.label, 40)) +
        (e.ref ? ' <tspan class="fx-ev-ref" fill="' + P.ink3 + '">' + esc(e.ref) + ' · ' + e.year + '</tspan>' : '') +
        '<title>' + esc(e.label) + (e.ref ? ' — ' + esc(e.ref) : '') + '</title></text>');
    });
    if (s.legend) out.push('<text x="' + L + '" y="' + (H - 8) + '" class="fx-ax" fill="' + P.ink3 + '">' + esc(s.legend) + '</text>');
    out.push('</svg>');

    var rows = eps.map(function (e) { return [e.label, e.from + '–' + e.to, (e.from - e.to) + '', e.type || '']; })
      .concat(evs.map(function (e) { return [e.label, String(e.year), e.age == null ? '' : String(e.age), e.ref || '']; }));
    return { svg: out.join(''), table: table([s.whatHead || 'Was', s.whenHead || 'Wann', s.lenHead || 'Dauer/Alter', s.refHead || 'Beleg'], rows) };
  }

  /* ---------------------------------------------------------------- places */
  /* section: { items:[{name,lon,lat,mentions}], map:{file,top,bottom,left,right,credit}, imageData? } */
  function placeDots(s, o) {
    var P = o.palette, all = s.items || [], m = s.map;
    if (!all.length || !m) return null;
    // A point outside the chosen map would be drawn outside the image. The payload builder already
    // names those in the section's foot; here they are simply not plotted — but the table twin
    // still lists every one of them.
    var items = all.filter(function (p) {
      return p.lon >= m.left && p.lon <= m.right && p.lat >= m.bottom && p.lat <= m.top;
    });
    if (!items.length) return null;
    var MW = m.pxWidth || 760, MH = m.pxHeight || Math.round(MW * (m.top - m.bottom) / (m.right - m.left) * 1.16);
    function X(lon) { return (lon - m.left) / (m.right - m.left) * MW; }
    function Y(lat) { return (m.top - lat) / (m.top - m.bottom) * MH; }
    var xs = items.map(function (p) { return X(p.lon); }), ys = items.map(function (p) { return Y(p.lat); });
    var padx = MW * 0.16, pady = MH * 0.07;
    var vx = Math.max(0, Math.min.apply(null, xs) - padx), vy = Math.max(0, Math.min.apply(null, ys) - pady);
    var vw = Math.min(MW - vx, (Math.max.apply(null, xs) - Math.min.apply(null, xs)) + 2 * padx);
    var vh = Math.min(MH - vy, (Math.max.apply(null, ys) - Math.min.apply(null, ys)) + 2 * pady);
    // Selective direct labels: a dense topic (Paul's forty places) turns into a wall of text if
    // every dot is named. The strongest few carry a label, every dot carries its tooltip, and the
    // table twin names them all.
    // The page's own place (focus) is always named and comes first, so it claims its label slot.
    var named = items.slice().sort(function (a, b) {
      return (b.focus ? 1 : 0) - (a.focus ? 1 : 0) || (b.mentions || 0) - (a.mentions || 0);
    })
      .slice(0, s.labelTop || 12).reduce(function (set, p) { set[p.id || p.name] = 1; return set; }, {});
    var out = ['<svg viewBox="' + n2(vx) + ' ' + n2(vy) + ' ' + n2(vw) + ' ' + n2(vh) +
      '" role="img" aria-label="' + esc(s.title || '') + '">'];
    out.push('<g class="fx-mapbg"><image x="0" y="0" width="' + MW + '" height="' + MH +
      '" preserveAspectRatio="none" href="' + esc(s.imageData || m.file) + '"/></g>');
    /* The route: the same places in the order the text names them, joined. Drawn under the dots
       so a line never covers a place. Only when the payload says so — a topic's places have no
       order worth drawing. */
    // Off by default past a dozen stops — forty places joined in verse order is a scribble, not
    // a route. The page offers a toggle (facts.js), the same way the atlas view does.
    var routeOn = s.routeOn === undefined ? ((s.route || []).length <= 12) : !!s.routeOn;
    if (routeOn && s.route && s.route.length > 1) {
      var byId = {};
      items.forEach(function (p) { byId[p.id || p.name] = p; });
      var pts = s.route.map(function (id) { return byId[id]; }).filter(Boolean);
      if (pts.length > 1) {
        // An arrowhead per leg, sized to the map's own units — a route without a direction is
        // just a line. The marker is defined inline so a captured figure keeps it.
        // markerUnits="userSpaceOnUse": the default scales the arrow by the stroke width, which
        // in a viewBox measured in hundreds of map pixels made it invisible.
        var mid = 'rt' + Math.random().toString(36).slice(2, 7);
        var asz = Math.max(9, MW * 0.016);
        out.push('<defs><marker id="' + mid + '" viewBox="0 0 10 10" refX="9" refY="5" ' +
          'markerUnits="userSpaceOnUse" markerWidth="' + n2(asz) + '" markerHeight="' + n2(asz) +
          '" orient="auto-start-reverse">' +
          '<path d="M 0 0 L 10 5 L 0 10 z" fill="' + P.s1 + '"/></marker></defs>');
        for (var i = 1; i < pts.length; i++) {
          out.push('<path class="fx-route" d="M ' + n2(X(pts[i - 1].lon)) + ' ' + n2(Y(pts[i - 1].lat)) +
            ' L ' + n2(X(pts[i].lon)) + ' ' + n2(Y(pts[i].lat)) + '" fill="none" stroke="' + P.s1 +
            '" stroke-width="2" stroke-linejoin="round" stroke-dasharray="6 4" opacity=".75"' +
            ' marker-end="url(#' + mid + ')"/>');
        }
      }
    }

    var lab = [];
    // Drawn smallest first so a big dot never hides a small neighbour; the focus last, on top.
    var order = items.slice().sort(function (a, b) {
      return (a.focus ? 1 : 0) - (b.focus ? 1 : 0) || (b.mentions || 0) - (a.mentions || 0);
    });
    // The focus place is counted apart: its own verse count dwarfs every co-mention, and scaling
    // against it shrank every other dot to the minimum.
    // The viewBox is cropped to the points, so on a tight cluster one map pixel fills several
    // screen pixels and fixed sizes ballooned (Jerusalem: dots and names five times too big).
    // Everything below is scaled by z — 1 when the crop is about a full-width plate.
    // Displayed size: facts.css caps a map at the column width (~60em) and 46em of height, so
    // one viewBox unit is min(60/vw, 46/vh) em on screen; labels should come out at ~0.9em.
    var emPerUnit = Math.min(60 / vw, 46 / vh);
    var z = Math.max(0.1, Math.min(3, (0.9 / emPerUnit) / 9));
    var maxOther = items.reduce(function (t, p) { return p.focus ? t : Math.max(t, p.mentions || 1); }, 1);
    order.forEach(function (p) {
      var r = z * (p.focus ? 12 : 4 + 7 * Math.sqrt((p.mentions || 1) / maxOther)),
          left = p.lon < (vx + vw / 2);
      // Two places a few kilometres apart would print one label over the other; step the second
      // one clear rather than dropping it.
      // A label pushed several lines away reads as belonging to nothing ("Beschriftung ohne
      // Punkt"). Try beside the dot, one line lower, then the other side; else only the tooltip.
      var ly = Y(p.lat) + 4 * z, isNamed = !!named[p.id || p.name];
      function hits(y, l) {
        return lab.some(function (q) {
          return Math.abs(q.y - y) < 11 * z && Math.abs(q.x - X(p.lon)) < vw * 0.2 && q.left === l;
        });
      }
      if (isNamed) {
        if (!hits(ly, left)) { /* fine */ }
        else if (!hits(ly + 12 * z, left)) ly += 12 * z;
        else if (!hits(ly, !left)) left = !left;
        else if (!p.focus) isNamed = false;
        if (isNamed) lab.push({ x: X(p.lon), y: ly, left: left });
      }
      out.push('<circle class="fx-dot" cx="' + n2(X(p.lon)) + '" cy="' + n2(Y(p.lat)) + '" r="' + n2(r) +
        '" fill="' + (p.focus ? P.s2 : P.s1) + '" stroke="' + P.surface + '" stroke-width="' + n2(z * (p.focus ? 2.5 : 1.5)) + '" data-geo="' + esc(p.id || '') + '">' +
        '<title>' + esc(p.name) + (p.mentions ? ' — ' + p.mentions : '') + '</title></circle>');
      if (isNamed) {
        out.push('<text class="fx-dot-lab" font-size="' + n2(9 * z) + '" stroke-width="' + n2(2.2 * z) +
          '" x="' + n2(X(p.lon) + (left ? r + 5 * z : -(r + 5 * z))) + '" y="' + n2(ly) +
          '" text-anchor="' + (left ? 'start' : 'end') + '" fill="' + P.ink + '" stroke="' + P.surface + '"' +
          (p.focus ? ' font-weight="700"' : '') + '>' +
          esc(p.name) + '</text>');
      }
    });
    out.push('</svg>');
    return {
      svg: out.join(''),
      table: table([s.placeHead || 'Ort', s.countHead || 'Erwähnungen', s.coordHead || 'Koordinate'],
        all.map(function (p) { return [p.name, p.mentions == null ? '' : p.mentions, n2(p.lat) + ', ' + n2(p.lon)]; })),
      credit: m.credit
    };
  }

  /* ---------------------------------------------------------------- relationships */
  /* section: { center:{label,sub}, groups:[{label, side:'left'|'right'|'top', items:[{label,sub,id}], more}] } */
  function relationTree(s, o) {
    var P = o.palette, W = 980, cx = 470;
    var left = (s.groups || []).filter(function (g) { return g.side === 'left'; });
    var right = (s.groups || []).filter(function (g) { return g.side === 'right'; });
    var topG = (s.groups || []).filter(function (g) { return g.side === 'top'; });
    function count(gs) { return gs.reduce(function (t, g) { return t + g.items.length; }, 0); }
    var rows = Math.max(count(left), count(right), 1);
    var H = Math.max(240, 60 + rows * 38 + 50), cy = H / 2;
    var out = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="wide" role="img" aria-label="' + esc(s.title || '') + '">'];
    function node(x, y, label, sub, me, id) {
      var w = me ? 168 : 148;
      // Wrapped so the whole node — box and both lines — answers a click, not just the outline.
      if (id) out.push('<g data-person="' + esc(id) + '" class="fx-node-g">');
      out.push('<rect x="' + n2(x - w / 2) + '" y="' + n2(y - 19) + '" width="' + w + '" height="38" rx="6" fill="' +
        (me ? P.s1 : P.surface) + '" stroke="' + (me ? P.s1 : P.rule) + '" stroke-width="1.5"/>');
      out.push('<text x="' + n2(x) + '" y="' + n2(y - 2) + '" text-anchor="middle" class="fx-node" fill="' +
        (me ? '#fff' : P.ink) + '">' + esc(label) + '</text>');
      if (sub) out.push('<text x="' + n2(x) + '" y="' + n2(y + 12) + '" text-anchor="middle" class="fx-node-s" fill="' +
        (me ? '#dbe7f7' : P.ink3) + '">' + esc(sub) + '</text>');
      if (id) out.push('</g>');
    }
    // Parents sit side by side. They used to be drawn at the same x and y, so a mother landed
    // exactly under the father and looked missing — "Juda hat nur Jakob als Eltern".
    topG.forEach(function (g) {
      var k = g.items.length;
      g.items.forEach(function (it, idx) {
        var px = k === 1 ? cx : cx + (idx - (k - 1) / 2) * 164;
        out.push('<path d="M ' + n2(px) + ' 44 L ' + n2(px) + ' ' + n2(cy - 30) +
          ' L ' + cx + ' ' + n2(cy - 19) + '" fill="none" stroke="' + P.ink3 +
          '" stroke-width="1.5" opacity=".55"/>');
        node(px, 25, it.label, it.sub, false, it.id);
      });
    });
    [[left, 150, -84, true], [right, 800, 84, false]].forEach(function (spec) {
      var gs = spec[0], nx = spec[1], dx = spec[2], dashed = spec[3], i = 0;
      var total = count(gs), y0 = cy - (total - 1) * 19;
      gs.forEach(function (g) {
        g.items.forEach(function (it) {
          var y = y0 + i * 38; i++;
          out.push('<path d="M ' + n2(nx + (dx < 0 ? 74 : -74)) + ' ' + n2(y) + ' C ' + n2(cx + dx * 2.2) + ' ' + n2(y) +
            ', ' + n2(cx + dx * 1.6) + ' ' + n2(cy) + ', ' + n2(cx + dx) + ' ' + n2(cy) + '" fill="none" stroke="' +
            P.ink3 + '" stroke-width="1.5" opacity=".55"' + (dashed ? ' stroke-dasharray="4 3"' : '') + '/>');
          node(nx, y, it.label, it.sub || g.label, false, it.id);
        });
        if (g.more) out.push('<text x="' + nx + '" y="' + n2(y0 + i * 38 + 4) + '" text-anchor="middle" class="fx-ax" fill="' +
          P.ink3 + '">' + esc(g.more) + '</text>');
      });
    });
    node(cx, cy, s.center.label, s.center.sub, true);
    out.push('</svg>');
    var rows2 = [];
    (s.groups || []).forEach(function (g) {
      g.items.forEach(function (it) { rows2.push([g.label, it.label, it.sub || '']); });
    });
    return { svg: out.join(''), table: table([s.relHead || 'Beziehung', s.whoHead || 'Person', ''], rows2) };
  }

  var RENDERERS = {
    canonStrip: canonStrip, coverage: coverageBar, timeline: timeline,
    places: placeDots, people: relationTree
  };

  function render(section, opts) {
    var fn = RENDERERS[section.kind];
    if (!fn) return null;
    var o = opts || {};
    if (!o.palette) o.palette = palette();
    return fn(section, o);
  }

  global.PhosCharts = {
    render: render, palette: palette, freeze: freeze, kinds: Object.keys(RENDERERS), NS: NS
  };
}(typeof window !== 'undefined' ? window : globalThis));
