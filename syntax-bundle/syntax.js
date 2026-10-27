/* Syntax view — Macula lowfat trees as constituent tree, clause blocks, Reed-Kellogg diagram and a
 * free, editable diagram (unit_syntaxview, docs/konzept-syntax.md).
 *
 *   PhosSyntax.load(payload) — one JSON object, per docs/shareable-tool-bundles.md:
 *     payload.data  : unit_syntaxdb.SyntaxVerseJson — {osis, lang, sentences:[{sid, first, last, tree, words}]}
 *             tree nodes {c: class, r: role, u: rule, k: [kids]}, a leaf is an index into words
 *     payload.labels: role/mode/hint names, localized
 *     payload.mode  : "tree" | "blocks" | "rk" | "free"
 *     payload.saved : the free diagram stored for this verse, or null
 *     payload.opts  : {embed, maxH, toolLink, readOnly}, all optional
 *             readOnly: free mode draws the saved diagram as a static svg, no toolbar/editing
 *             (used by hosts that only sync the saved diagram, not the Macula tree data)
 *   PhosSyntax.mode(m), PhosSyntax.exportSvg(), PhosSyntax.exportPng()
 *
 *   to native (window.bvcMsg): syntax.word {s, m, t, l} · syntax.save <diagram json> ·
 *                              syntax.svg <svg text> · syntax.png <base64> · syntax.mode <m>
 */
var PhosSyntax = (function () {
  "use strict";
  var D = null, L = {}, MODE = "tree", SAVED = null, collapsed = {}, expanded = {}, FREE = null, OPTS = {};
  var WFONT = '18px "Gentium Plus", "SBL BibLit", "Noto Serif", serif';
  var SVGNS = "http://www.w3.org/2000/svg";
  var measureCtx = document.createElement("canvas").getContext("2d");

  function t(k, d) { return (L && L[k]) || d; }
  function msg(ch, p) {
    var f = window.bvcMsg;
    try { if (!f && window.parent && window.parent !== window) f = window.parent.bvcMsg; } catch (e) {}
    if (f) f(ch, p);
  }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function sv(tag, attrs, txt) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (txt != null) e.textContent = txt;
    return e;
  }
  function textW(s, font) { measureCtx.font = font || WFONT; return measureCtx.measureText(s || "").width; }
  function rtl() { return D && D.lang === "hbo"; }

  var ROLES = { s: "Subjekt", v: "Prädikat", o: "Objekt", io: "Dativobjekt", o2: "2. Objekt", adv: "Adverbiale",
    p: "Prädikativ", vc: "Kopula", pp: "Präpositionalgruppe", aux: "Partikel/Anrede" };
  var CLASSES = { cl: "Satz", np: "Nominalgruppe", pp: "Präpositionalgruppe", vp: "Verbalgruppe",
    adjp: "Adjektivgruppe", advp: "Adverbgruppe", nump: "Zahlgruppe", sentence: "Satzgefüge" };
  function roleName(r) { return t("role." + r, ROLES[r] || r); }
  var ABBR = { s: "S", v: "V", o: "O", io: "IO", o2: "O2", adv: "ADV", p: "PRÄD", vc: "KOP", pp: "PP", aux: "PART" };
  function roleAbbr(r) { return t("abbr." + r, ABBR[r] || (r || "").toUpperCase()); }
  function className(c) { return t("class." + c, CLASSES[c] || c || "—"); }

  /* verse order of a word: chapter*1000+verse, then the word number */
  function wkey(w) {
    var p = (w.o || "").split(".");
    return (parseInt(p[1] || "0", 10) * 1000 + parseInt(p[2] || "0", 10)) * 1000 + (w.p || 0);
  }
  function wordText(w) { return w.t; }
  function inVerse(w) { return w.o === D.osis; }
  function wordClick(w, node) {
    msg("syntax.word", JSON.stringify({ s: w.s, m: w.m, t: w.t, l: w.l }));
    var hs = document.querySelectorAll(".hl");
    for (var i = 0; i < hs.length; i++) hs[i].classList.remove("hl");
    if (node) node.classList.add("hl");
  }
  function leaves(n, out) {
    out = out || [];
    if (typeof n === "number") out.push(n);
    else if (n && n.k) n.k.forEach(function (k) { leaves(k, out); });
    return out;
  }
  function sorted(ws, idx) {
    return idx.slice().sort(function (a, b) { return wkey(ws[a]) - wkey(ws[b]) || a - b; });
  }
  function phraseText(ws, idx) {
    return sorted(ws, idx).map(function (i) { return ws[i].t; }).join(" ");
  }

  /* ---------------------------------------------------------------- header */
  function header() {
    var h = document.getElementById("head");
    h.innerHTML = "";
    var tx = el("div", rtl() ? "rtl" : "");
    tx.id = "text";
    D.sentences.forEach(function (s, si) {
      var ws = s.words, order = sorted(ws, ws.map(function (_, i) { return i; }));
      order.forEach(function (i) {
        var w = ws[i], sp = el("span", "w" + (inVerse(w) ? "" : " other"), w.t);
        sp.title = [w.l, w.m, gloss(w), w.s].filter(Boolean).join(" · ");
        sp.onclick = function () { wordClick(w, sp); };
        tx.appendChild(sp);
        /* Greek "after" may be bare punctuation ("," "·"); Hebrew joins prefixes and maqqef without one */
        var after = w.a || "";
        if (!rtl() && !/\s$/.test(after)) after += " ";
        tx.appendChild(document.createTextNode(after));
      });
      if (si < D.sentences.length - 1) tx.appendChild(document.createTextNode(" ‖ "));
    });
    h.appendChild(tx);
    var multi = D.sentences.length > 1 || D.sentences.some(function (s) { return s.first !== s.last; });
    var note = el("div", null, multi && !OPTS.embed ? t("note.span", "Grau: Wörter der Nachbarverse, die zum selben Satz gehören.") + " " : "");
    note.id = "note";
    note.appendChild(document.createTextNode(D.glossMod
      ? t("note.gloss", "Glossen: {0} (über Strong-Nummern, sonst englisch).").replace("{0}", D.glossMod)
      : t("note.glossen", "Glossen: englisch (Macula).")));
    if (MODE === "rk" || MODE === "free") {
      var b = el("span", "badge", t("note.rk", "Vorschlag aus den Macula-Daten – bearbeitbar unter „Frei“"));
      note.appendChild(b);
    }
    h.appendChild(note);
  }

  /* ---------------------------------------------------------------- tree */
  /* The tree shows the sentence down to its clause parts: every phrase is ONE box with its
     words and their glosses side by side; a click on a box opens its inner structure, a click
     on a clause folds it. Unlabelled wrapper nodes and single-child chains are left out. A
     sentence too wide for the window is drawn top-down as an indented tree instead. */
  var GFONT = 'italic 11px "Noto Sans", sans-serif';
  function hasClause(n) {
    return n && typeof n === "object" && (n.c === "cl" || (n.k || []).some(hasClause));
  }
  function gloss(w) { var g = w.tg || w.g || ""; return g === "-" ? "" : g; }

  /* raw tree → display tree; keys are pre-order numbers over the raw tree, so the open/closed
     state survives a redraw */
  function displayTree(s) {
    var ws = s.words, counter = 0;
    function walk(n, parentIsClause, inheritedRole) {
      var id = ++counter;
      if (typeof n === "number")
        return { kind: "box", idx: [n], role: parentIsClause ? (ws[n].r || "") : "", c: "w", key: s.sid + ":" + id };
      var key = s.sid + ":" + id, isCl = n.c === "cl";
      var kids = [];
      (n.k || []).forEach(function (k) {
        var d = walk(k, isCl || (!n.c && !n.r && parentIsClause), isCl ? "" : (n.r || inheritedRole));
        if (d.kind === "wrap") kids = kids.concat(d.kids); else kids.push(d);
      });
      /* an unlabelled grouping (coordination, "c":"") — its parts belong to the parent */
      if (!isCl && !n.r && (!n.c || kids.length === 1)) return { kind: "wrap", kids: kids };
      var role = n.r || "";
      if (!isCl && !hasClause(n) && !expanded[key])
        return { kind: "box", idx: leaves(n), role: role, c: n.c, key: key, expandable: (n.k || []).length > 1 };
      /* a clause wholly in a neighbouring verse starts folded */
      var fold = collapsed[key];
      if (fold === undefined && isCl && D.osis) fold = leaves(n).every(function (i) { return !inVerse(ws[i]); });
      if (isCl && fold)
        return { kind: "box", idx: leaves(n), role: role, c: "cl", key: key, folded: true };
      return { kind: "node", role: role, c: n.c, u: n.u, key: key, kids: kids };
    }
    var d = walk(s.tree, true, "");
    if (d.kind === "wrap") d = { kind: "node", role: "", c: "sentence", key: s.sid + ":0", kids: d.kids };
    return d;
  }

  /* a phrase box: role tab, then word over gloss for each word in reading order */
  function measureBox(b, ws) {
    var order = sorted(ws, b.idx), cols = [], w = 8;
    /* a folded clause shows its beginning only */
    if (b.folded && order.length > 6) { order = order.slice(0, 5); b.more = true; }
    order.forEach(function (i) {
      var cw = Math.max(textW(ws[i].t), textW(gloss(ws[i]), GFONT)) + 10;
      cols.push({ i: i, x: w, w: cw });
      w += cw;
    });
    if (b.more) { cols.push({ i: -1, x: w, w: 24 }); w += 24; }
    b.cols = cols;
    b.w = Math.max(w + 6, 36);
    b.h = 56;
  }
  function drawBox(svg, b, x, y, ws, mx) {
    var g = sv("g", { "class": "pbox" + (b.folded ? " folded" : "") + (b.expandable || b.folded ? " exp" : "") });
    var rx = rtl() ? mx(x + b.w) : x;
    g.appendChild(sv("rect", { x: rx, y: y, width: b.w, height: b.h, rx: 6 }));
    if (b.role) {
      var lab = roleAbbr(b.role), lw = textW(lab, "bold 10px sans-serif") + 10;
      var lx = rtl() ? rx + b.w - lw - 6 : rx + 6;
      g.appendChild(sv("rect", { "class": "tab r-" + b.role, x: lx, y: y - 7, width: lw, height: 14, rx: 7 }));
      var tt = sv("text", { "class": "tabt", x: lx + lw / 2, y: y + 3, "text-anchor": "middle" }, lab);
      tt.appendChild(sv("title", {}, roleName(b.role) + (b.c && b.c !== "w" ? " · " + className(b.c) : "")));
      g.appendChild(tt);
    }
    b.cols.forEach(function (c) {
      if (c.i < 0) {
        g.appendChild(sv("text", { "class": "wd other", x: mx(x + c.x + c.w / 2), y: y + 27, "text-anchor": "middle" }, "…"));
        return;
      }
      var w = ws[c.i], cx = mx(x + c.x + c.w / 2);
      var t1 = sv("text", { "class": "wd" + (inVerse(w) ? "" : " other"), x: cx, y: y + 27, "text-anchor": "middle" }, w.t);
      t1.appendChild(sv("title", {}, [w.l, w.m, w.s, w.tg && w.g ? "engl. " + w.g : ""].filter(Boolean).join(" · ")));
      t1.onclick = function (ev) { ev.stopPropagation(); wordClick(w, t1); };
      g.appendChild(t1);
      g.appendChild(sv("text", { "class": "gl", x: cx, y: y + 45, "text-anchor": "middle" }, gloss(w)));
    });
    if (b.expandable || b.folded) {
      g.appendChild(sv("title", {}, b.folded ? t("tree.unfold", "Klick: Satz aufklappen") : t("tree.expand", "Klick: Aufbau zeigen")));
      g.onclick = function () {
        if (b.folded) collapsed[b.key] = false; else expanded[b.key] = true;
        render();
      };
    }
    svg.appendChild(g);
  }
  function nodeLabel(o) {
    if (o.c === "cl" || o.c === "sentence") return (o.role ? roleAbbr(o.role) + " · " : "") + className("cl");
    return (o.role ? roleAbbr(o.role) + " · " : "") + (o.c || "");
  }
  function drawNode(svg, o, x, y, mx, w) {
    var g = sv("g", { "class": "node" + (o.c === "cl" ? " cl" : "") });
    var lab = nodeLabel(o);
    g.appendChild(sv("rect", { x: rtl() ? mx(x + w) : x, y: y, width: w, height: 20, rx: 10 }));
    g.appendChild(sv("text", { "class": "nl2" + (o.role ? " r-" + o.role : ""), x: mx(x + w / 2), y: y + 14, "text-anchor": "middle" }, lab));
    g.appendChild(sv("title", {}, (o.role ? roleName(o.role) + " · " : "") + className(o.c) + (o.u ? " · " + o.u : "") + "\n" +
      (o.c === "cl" ? t("tree.fold", "Klick: Satz zuklappen") : t("tree.collapse", "Klick: zusammenfassen"))));
    g.onclick = function () {
      if (o.c === "cl") collapsed[o.key] = true; else expanded[o.key] = false;
      render();
    };
    svg.appendChild(g);
  }

  function renderTree(s, host) {
    var ws = s.words, root = displayTree(s);
    var avail = Math.max(320, (host.clientWidth || document.body.clientWidth || 900) - 20);
    function prep(o) {
      if (o.kind === "box") { measureBox(o, ws); return; }
      o.lw = textW(nodeLabel(o), "bold 11px sans-serif") + 18;
      o.kids.forEach(prep);
    }
    prep(root);

    /* horizontal: boxes side by side, nodes centred over their children */
    var HG = 14, LEVEL = 40, IND = 22;
    function layH(o, y0, x0) {
      o.vert = false;
      o.y = y0;
      if (o.kind === "box") { o.x = x0; o.y += 12; return x0 + o.w + HG; }
      var x = x0;
      o.kids.forEach(function (k) { x = layH(k, y0 + LEVEL, x); });
      var first = o.kids[0], last = o.kids[o.kids.length - 1];
      var c = ((first.x + (first.w || first.lw) / 2) + (last.x + (last.w || last.lw) / 2)) / 2;
      o.x = Math.max(x0, c - o.lw / 2);
      return Math.max(x, o.x + o.lw + HG);
    }
    function bottom(o) {
      var b = o.y + (o.kind === "box" ? o.h : 20);
      if (o.kids) o.kids.forEach(function (k) { b = Math.max(b, bottom(k)); });
      return b;
    }
    /* hybrid: a subtree that fits the width left is drawn as a small horizontal tree; one that
       does not gets its node on a row of its own, its boxes flowing and wrapping beneath it and
       its sub-clauses indented — so a long sentence keeps the window's width */
    function place(o, x, y, room) {
      if (o.kind === "box") { o.x = x; o.y = y + 8; o.rowFirst = true; return o.y + o.h; }
      if (layH(o, y, x) - x <= room) return bottom(o);
      o.vert = true;
      o.x = x; o.y = y;
      var cy = y + 30, x0 = x + IND, cx = x0, rowH = 0, rowStart = true;
      o.kids.forEach(function (k) {
        if (k.kind === "box") {
          if (!rowStart && cx + k.w > x0 + room - IND) { cy += rowH + 16; cx = x0; rowH = 0; rowStart = true; }
          k.vert = false; k.x = cx; k.y = cy + 8; k.rowFirst = rowStart;
          cx += k.w + 10; rowH = Math.max(rowH, k.h + 8); rowStart = false;
        } else {
          if (!rowStart) { cy += rowH + 16; cx = x0; rowH = 0; rowStart = true; }
          cy = place(k, x0, cy, room - IND) + 16;
        }
      });
      if (!rowStart) cy += rowH + 8;
      return cy;
    }
    var H = place(root, 10, 10, avail - 10) + 14, W = 0;
    (function maxw(o) {
      W = Math.max(W, o.x + (o.kind === "box" ? o.w : o.lw) + 10);
      if (o.kids) o.kids.forEach(maxw);
    })(root);
    H = Math.max(H, bottom(root) + 14);
    var mx = function (x) { return rtl() ? W - x : x; };
    var svg = sv("svg", { "class": "tree", width: W, height: H, viewBox: "0 0 " + W + " " + H });
    /* connectors first, under the boxes */
    (function edges(o) {
      if (o.kind !== "node") return;
      o.kids.forEach(function (k) {
        if (o.vert) {
          /* one tick per row: the boxes of a row sit together */
          if (k.kind === "box" && !k.rowFirst) { edges(k); return; }
          var px = o.x + 10, ky = k.y + (k.kind === "box" ? k.h / 2 : 10);
          svg.appendChild(sv("path", { "class": "edge", d: "M" + mx(px) + " " + (o.y + 20) + " V" + ky + " H" + mx(k.x) }));
        } else {
          var cx = o.x + o.lw / 2, kx = k.x + (k.kind === "box" ? k.w : k.lw) / 2, my = o.y + 20 + (k.y - o.y - 20) / 2;
          svg.appendChild(sv("path", { "class": "edge", d: "M" + mx(cx) + " " + (o.y + 20) + " V" + my + " H" + mx(kx) + " V" + (k.y - (k.kind === "box" ? 7 : 0)) }));
        }
        edges(k);
      });
    })(root);
    (function draw(o) {
      if (o.kind === "box") drawBox(svg, o, o.x, o.y, ws, mx);
      else { drawNode(svg, o, o.x, o.y, mx, o.lw); o.kids.forEach(draw); }
    })(root);
    host.appendChild(svg);
  }

  /* ---------------------------------------------------------------- blocks */
  function renderBlocks(s, host) {
    var ws = s.words;
    function wordSpan(i, con) {
      var w = ws[i], box = el("span", "wg"), sp = el("span", "w" + (inVerse(w) ? "" : " other"), w.t);
      sp.title = [w.l, w.m, w.s].filter(Boolean).join(" · ");
      sp.onclick = function () { wordClick(w, sp); };
      box.appendChild(sp);
      box.appendChild(el("span", "g", gloss(w) || "\u00a0"));
      con.appendChild(box);
    }
    /* the content of one constituent: words inline, clauses nested */
    function content(n, con) {
      if (typeof n === "number") { wordSpan(n, con); return; }
      if (n.c === "cl") { con.appendChild(clause(n)); return; }
      (n.k || []).forEach(function (k) { content(k, con); });
    }
    function row(role, sub, n, box) {
      var r = el("div", "row"), lab = el("div", "lab" + (role ? " r-" + role : ""));
      lab.textContent = role ? roleName(role) : (sub || "");
      if (role && sub) lab.appendChild(el("small", null, sub));
      var con = el("div", "con");
      content(n, con);
      r.appendChild(lab); r.appendChild(con);
      box.appendChild(r);
    }
    function clause(n) {
      var box = el("div", "cl");
      box.title = className("cl") + (n.u ? " · " + n.u : "");
      (n.k || []).forEach(function (k) {
        if (typeof k === "number") {
          var w = ws[k];
          row(w.r && !/^(conj|det)$/.test(w.r) ? w.r : "", w.r ? "" : t("blocks.conj", "Bindewort"), k, box);
        } else if (k.c === "cl" && !k.r) {
          box.appendChild(clause(k));       /* coordinated clause */
        } else if (!k.r && k.c !== "cl") {
          /* an unlabelled wrapper (coordination group): its parts as rows of this clause */
          var inner = clause(k);
          inner.className = "";
          while (inner.firstChild) box.appendChild(inner.firstChild);
        } else {
          row(k.r, k.c === "cl" ? className("cl") : "", k, box);
        }
      });
      return box;
    }
    var root = s.tree.c === "cl" ? s.tree : { c: "cl", k: [s.tree] };
    var wrap = el("div", rtl() ? "rtl" : "");
    wrap.appendChild(clause(root));
    host.appendChild(wrap);
  }

  /* ---------------------------------------------------------------- Reed-Kellogg */
  /* morphology → word kind; Greek Robinson codes, Hebrew Macula codes with the H prefix */
  function kind(w) {
    var m = w.m || "";
    if (/^H/.test(m)) {
      m = m.slice(1);
      if (/^R/.test(m)) return "prep";
      if (/^C/.test(m)) return "conj";
      if (/^Td/.test(m)) return "det";
      if (/^To/.test(m)) return "mark";
      if (/^A/.test(m)) return "adj";
      if (/^D/.test(m)) return "adv";
      if (/^V/.test(m)) return "verb";
      return "head";
    }
    if (/^T-/.test(m)) return "det";
    if (/^PREP/.test(m)) return "prep";
    if (/^CONJ|^COND/.test(m)) return "conj";
    if (/^PRT/.test(m)) return "adv";
    if (/^ADV/.test(m)) return "adv";
    if (/^A-|^NUM/.test(m)) return "adj";
    if (/^V-/.test(m)) return "verb";
    return "head";
  }

  /* head words + modifiers of a constituent */
  function phrase(n, ws) {
    var ph = { head: [], mods: [], clause: null };
    if (typeof n === "number") { ph.head.push(n); return ph; }
    if (n.c === "cl") { ph.clause = n; return ph; }
    if (n.c === "pp") {
      var prep = [], rest = [];
      (n.k || []).forEach(function (k) {
        if (typeof k === "number" && kind(ws[k]) === "prep" && !rest.length) prep.push(k); else rest.push(k);
      });
      var obj = phrase({ c: "np", k: rest }, ws);
      ph.mods.push({ kind: "pp", prep: prep, obj: obj });
      return ph;
    }
    var headDone = false;
    (n.k || []).forEach(function (k) {
      if (typeof k === "number") {
        var kd = kind(ws[k]);
        if (kd === "det" || kd === "adj" || kd === "adv" || kd === "mark") ph.mods.push({ kind: "word", w: k });
        else if (kd === "conj" && ph.head.length) ph.head.push(k);
        else if (kd === "prep") ph.mods.push({ kind: "word", w: k });
        else ph.head.push(k);
        if (kd === "head" || kd === "verb") headDone = true;
      } else if (k.c === "cl") {
        ph.mods.push({ kind: "cl", node: k });
      } else if (k.c === "pp") {
        ph.mods = ph.mods.concat(phrase(k, ws).mods);
      } else {
        var sub = phrase(k, ws);
        if (!headDone || /aNp|CL|Coord/i.test(n.u || "") && hasConj(n, ws)) {
          ph.head = ph.head.concat(sub.head);
          ph.mods = ph.mods.concat(sub.mods);
          if (sub.clause) ph.mods.push({ kind: "cl", node: sub.clause });
          if (sub.head.length) headDone = true;
        } else {
          ph.mods.push({ kind: "pp", prep: [], obj: sub });     /* genitive / apposition */
        }
      }
    });
    if (!ph.head.length && ph.mods.length) {
      /* only modifiers (e.g. an adjective used as a noun): the last word carries the line */
      for (var i = ph.mods.length - 1; i >= 0; i--)
        if (ph.mods[i].kind === "word") { ph.head.push(ph.mods[i].w); ph.mods.splice(i, 1); break; }
    }
    return ph;
  }
  function hasConj(n, ws) {
    return (n.k || []).some(function (k) { return typeof k === "number" && kind(ws[k]) === "conj"; });
  }

  /* the parts of one clause: role buckets, conjunctions, coordinated and subordinate clauses */
  function classify(n, ws) {
    var p = { s: [], v: [], o: [], io: [], o2: [], p: [], vc: [], adv: [], conj: [], coord: [], other: [] };
    function add(k) {
      if (typeof k === "number") {
        var w = ws[k], r = w.r;
        if (r === "aux") r = "v";
        if (r && p[r]) p[r].push(k);
        else if (kind(w) === "conj") p.conj.push(k);
        else if (kind(w) === "verb") p.v.push(k);
        else p.other.push(k);
        return;
      }
      if (k.c === "cl" && !k.r) { p.coord.push(k); return; }
      var r2 = k.r === "aux" ? "v" : k.r;
      if (r2 === "pp") r2 = "adv";
      if (r2 && p[r2]) { p[r2].push(k); return; }
      if (!k.r) { (k.k || []).forEach(add); return; }
      p.other.push(k);
    }
    (n.k || []).forEach(add);
    return p;
  }

  function rkModel(s) {
    var ws = s.words, els = [];
    var SL = 56, ANG = 55 * Math.PI / 180;
    var right = 0, bottom = 0;
    function T(x, y, txt, cls, rot, w) {
      els.push({ k: "t", x: x, y: y, t: txt, c: cls || "wd", r: rot || 0, w: w == null ? -1 : w });
      right = Math.max(right, x + textW(txt));
      bottom = Math.max(bottom, y + 10);
    }
    function Ln(x1, y1, x2, y2, cls) {
      els.push({ k: "l", x1: x1, y1: y1, x2: x2, y2: y2, c: cls || "base" });
      right = Math.max(right, x1, x2);
      bottom = Math.max(bottom, y1, y2);
    }
    /* words on a line, left to right in text order; returns the width used */
    function words(idx, x, y) {
      var cx = x, order = sorted(ws, idx);
      if (rtl()) order.reverse();      /* Hebrew reads right to left along the line too */
      order.forEach(function (i) {
        T(cx, y, ws[i].t, "wd" + (inVerse(ws[i]) ? "" : " other"), 0, i);
        cx += textW(ws[i].t) + 6;
      });
      return cx - x;
    }
    /* a slanted modifier line from (x, y); returns {bottom, right} */
    function mod(m, x, y, subs) {
      if (m.kind === "cl") {
        subs.push({ node: m.node, ax: x, ay: y });
        return { bottom: y, right: x + 10 };
      }
      var txt = m.kind === "word" ? ws[m.w].t : phraseText(ws, m.prep);
      var len = Math.max(SL, textW(txt) + 26);
      var x2 = x + len * Math.cos(ANG), y2 = y + len * Math.sin(ANG);
      Ln(x, y, x2, y2, "base");
      if (txt) {
        /* along the slant, a little off the baseline it hangs from */
        var wi = m.kind === "word" ? m.w : (m.prep.length ? m.prep[0] : -1);
        var tx0 = x + 14 * Math.cos(ANG) + 3 * Math.sin(ANG), ty0 = y + 14 * Math.sin(ANG) - 3 * Math.cos(ANG);
        T(tx0, ty0, txt, "wd" + (wi >= 0 && !inVerse(ws[wi]) ? " other" : ""), 55, wi);
      }
      if (m.kind === "word") return { bottom: y2, right: x2 };
      /* prepositional / genitive object on its own line, with its own modifiers */
      var r = segment(m.obj, x2, y2, subs);
      Ln(x2, y2, x2 + r.w, y2, "base");
      return { bottom: r.bottom, right: x2 + r.w };
    }
    /* head words above the line at (x, y), modifiers hanging below */
    function segment(ph, x, y, subs) {
      if (ph.clause) {
        subs.push({ node: ph.clause, ax: x + 20, ay: y });
        T(x + 8, y - 8, "( … )", "nl");
        return { w: 70, bottom: y };
      }
      var tw = ph.head.length ? words(ph.head, x + 10, y - 7) : 0;
      if (!ph.head.length && !ph.mods.length) T(x + 8, y - 8, "( )", "nl");
      var mx = x + 14, bot = y, last = x, far = x;
      ph.mods.forEach(function (m) {
        var r = mod(m, mx, y, subs);
        bot = Math.max(bot, r.bottom);
        last = mx;
        far = Math.max(far, r.right);
        mx = Math.max(mx + 46, r.right - 24);
      });
      /* wide enough that the next segment's slants start right of everything hanging here */
      return { w: Math.max(tw + 22, last - x + 30, far - x - 30, 60), bottom: bot };
    }
    function merge(list) {
      var ph = { head: [], mods: [], clause: null };
      list.forEach(function (k) {
        var p = phrase(k, ws);
        ph.head = ph.head.concat(p.head);
        ph.mods = ph.mods.concat(p.mods);
        if (p.clause) ph.clause = ph.clause || p.clause;
      });
      return ph;
    }
    /* one clause with its baseline at (x0, y0); returns the lowest y used */
    function clause(n, x0, y0, label) {
      var p = classify(n, ws), subs = [], x = x0, bot = y0 + 20;
      if (label) T(x0, y0 - 40, label, "nl");
      var hasCore = p.s.length || p.v.length || p.o.length || p.p.length || p.vc.length || p.io.length || p.adv.length;
      if (!hasCore && p.coord.length) {
        /* coordination only: the clauses one below the other, joined by a dashed line that carries
           the conjunction standing before each of them */
        var y = y0, conj = sorted(ws, p.conj), ci = 0;
        p.coord.forEach(function (c, i) {
          var first = sorted(ws, leaves(c))[0], cx = x0 - 6;
          if (i > 0) Ln(x0 - 12, y - 70, x0 - 12, y, "dash");
          while (ci < conj.length && (i === p.coord.length - 1 || wkey(ws[conj[ci]]) < wkey(ws[first]))) {
            T(cx, i > 0 ? y - 36 : y - 30, ws[conj[ci]].t, "wd", 0, conj[ci]);
            cx += textW(ws[conj[ci]].t) + 8;
            ci++;
          }
          y = clause(c, x0, y, "") + 80;
        });
        return y - 80;
      }
      if (p.conj.length) T(x0, y0 - 26, phraseText(ws, p.conj), "nl", 0, p.conj[0]);
      /* subject | predicate | object / \ predicative */
      var sP = merge(p.s), segS = segment(sP, x, y0, subs);
      Ln(x, y0, x + segS.w, y0, "base");
      x += segS.w;
      Ln(x, y0 - 18, x, y0 + 12, "base");
      bot = Math.max(bot, segS.bottom);
      var vP = merge(p.v.concat(p.vc));
      var advMods = [];
      p.adv.concat(p.other).forEach(function (k) {
        var ph = phrase(k, ws);
        if (ph.clause) advMods.push({ kind: "cl", node: ph.clause });
        else if (typeof k !== "number" && k.c === "pp") advMods = advMods.concat(ph.mods);
        else if (ph.head.length) advMods.push({ kind: "pp", prep: [], obj: ph });
        else advMods = advMods.concat(ph.mods);
      });
      p.io.forEach(function (k) { advMods.push({ kind: "pp", prep: [], obj: phrase(k, ws) }); });
      vP.mods = vP.mods.concat(advMods);
      var segV = segment(vP, x, y0, subs);
      Ln(x, y0, x + segV.w, y0, "base");
      x += segV.w;
      bot = Math.max(bot, segV.bottom);
      [["o", "|"], ["o2", "|"], ["p", "\\"]].forEach(function (pair) {
        if (!p[pair[0]].length) return;
        if (pair[1] === "|") Ln(x, y0 - 18, x, y0, "base");
        else Ln(x, y0, x - 14, y0 - 18, "base");
        var seg = segment(merge(p[pair[0]]), x, y0, subs);
        Ln(x, y0, x + seg.w, y0, "base");
        x += seg.w;
        bot = Math.max(bot, seg.bottom);
      });
      /* subordinate clauses below, joined to the word they belong to */
      var y2 = Math.max(bot, bottom) + 70;
      subs.forEach(function (sb) {
        var first = leaves(sb.node).length ? sorted(ws, leaves(sb.node))[0] : -1;
        var conj = first >= 0 && kind(ws[first]) === "conj" ? ws[first].t : "";
        var sx = Math.max(x0, sb.ax - 30);
        Ln(sb.ax, sb.ay, sb.ax, y2 - 22, "dash");
        Ln(sb.ax, y2 - 22, sx + 10, y2, "dash");
        if (sb.node.r) T(sb.ax + 8, y2 - 44, roleName(sb.node.r), "nl");
        if (conj) T(sb.ax + 8, y2 - 28, conj, "wd", 0, first);
        y2 = clause(sb.node, sx, y2, "") + 80;
      });
      return Math.max(bot, y2 - 80);
    }
    var root = s.tree.c === "cl" ? s.tree : { c: "cl", k: [s.tree] };
    clause(root, 24, 56, "");
    return { els: els, w: right + 40, h: bottom + 50 };
  }

  function drawModel(model, svg, editable, ws) {
    model.els.forEach(function (e, idx) {
      var node;
      if (e.k === "l") {
        node = sv("line", { "class": e.c, x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 });
      } else {
        node = sv("text", { "class": e.c, x: e.x, y: e.y,
          transform: e.r ? "rotate(" + e.r + " " + e.x + " " + e.y + ")" : null }, e.t);
        if (!editable && ws && e.w >= 0 && ws[e.w]) {
          var w = ws[e.w];
          node.appendChild(sv("title", {}, [w.l, w.m, gloss(w), w.s].filter(Boolean).join(" · ")));
          node.onclick = function () { wordClick(w, node); };
        }
      }
      node.dataset.i = idx;
      svg.appendChild(node);
    });
  }

  function renderRk(s, host) {
    var m = rkModel(s);
    var svg = sv("svg", { width: m.w, height: m.h, viewBox: "0 0 " + m.w + " " + m.h });
    drawModel(m, svg, false, s.words);
    host.appendChild(svg);
  }

  /* ---------------------------------------------------------------- free diagram */
  function renderFree(host) {
    if (!FREE) FREE = SAVED ? JSON.parse(JSON.stringify(SAVED)) : { osis: (D && D.osis) || "", els: [], w: 900, h: 500 };
    if (OPTS.readOnly) {
      var ro = sv("svg", { width: FREE.w, height: FREE.h, viewBox: "0 0 " + FREE.w + " " + FREE.h });
      drawModel(FREE, ro, false, null);
      host.appendChild(ro);
      return;
    }
    var tool = "select", selIdx = -1, drag = null, dirty = false;
    var tb = el("div");
    tb.id = "tools";
    function btn(id, label, title, fn) {
      var b = el("button", null, label);
      b.title = title || "";
      b.dataset.id = id;
      b.onclick = fn;
      tb.appendChild(b);
      return b;
    }
    var bSel = btn("select", t("free.select", "Auswählen/Verschieben"), "", function () { setTool("select"); });
    var bBase = btn("base", t("free.base", "— Linie"), t("free.base.hint", "Ziehen: Grund- oder Schräglinie"), function () { setTool("base"); });
    var bDash = btn("dash", t("free.dash", "┄ gestrichelt"), "", function () { setTool("dash"); });
    btn("rk", t("free.fromrk", "Aus Reed-Kellogg übernehmen"), t("free.fromrk.hint", "Ersetzt die Zeichnung durch den automatischen Vorschlag"), function () {
      var all = { els: [], w: 0, h: 0 }, y = 0;
      D.sentences.forEach(function (s) {
        var m = rkModel(s);
        m.els.forEach(function (e) {
          var c = JSON.parse(JSON.stringify(e));
          if (c.k === "l") { c.y1 += y; c.y2 += y; } else c.y += y;
          c.w = -1;
          all.els.push(c);
        });
        all.w = Math.max(all.w, m.w);
        y += m.h;
      });
      FREE.els = all.els; FREE.w = Math.max(900, all.w); FREE.h = Math.max(500, y);
      dirty = true; redraw();
    });
    btn("del", t("free.delete", "Löschen"), "Entf", function () { del(); });
    btn("clear", t("free.clear", "Leeren"), "", function () { FREE.els = []; dirty = true; redraw(); });
    var bSave = btn("save", t("free.save", "Speichern"), t("free.save.hint", "Diagramm zu diesem Vers speichern"), function () {
      msg("syntax.save", JSON.stringify(FREE));
      dirty = false; bSave.classList.remove("on");
    });
    tb.appendChild(el("span", "hint", t("free.hint", "Wörter unten anklicken, um sie einzufügen · Doppelklick auf Text: bearbeiten")));
    host.appendChild(tb);

    var chips = el("div", rtl() ? "rtl" : "");
    chips.id = "chips";
    D.sentences.forEach(function (s) {
      sorted(s.words, s.words.map(function (_, i) { return i; })).forEach(function (i) {
        var w = s.words[i];
        if (!inVerse(w)) return;
        var c = el("span", null, w.t);
        c.title = gloss(w);
        c.onclick = function () {
          var n = FREE.els.filter(function (e) { return e.k === "t"; }).length;
          FREE.els.push({ k: "t", x: 40 + (n % 6) * 120, y: 40 + Math.floor(n / 6) * 40, t: w.t, c: "wd", r: 0, w: -1 });
          dirty = true; redraw();
        };
        chips.appendChild(c);
      });
    });
    host.appendChild(chips);

    var svg = sv("svg", {});
    svg.id = "canvas";
    host.appendChild(svg);

    function setTool(tl) {
      tool = tl;
      [bSel, bBase, bDash].forEach(function (b) { b.classList.toggle("on", b.dataset.id === tl); });
    }
    function snap(v) { return Math.round(v / 5) * 5; }
    function pt(ev) {
      var r = svg.getBoundingClientRect();
      return { x: snap(ev.clientX - r.left), y: snap(ev.clientY - r.top) };
    }
    function redraw() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      svg.setAttribute("width", FREE.w);
      svg.setAttribute("height", FREE.h);
      drawModel(FREE, svg, true, null);
      if (selIdx >= 0) {
        var n = svg.querySelector('[data-i="' + selIdx + '"]');
        if (n) n.classList.add("sel");
      }
      if (dirty) bSave.classList.add("on");
    }
    function del() {
      if (selIdx < 0) return;
      FREE.els.splice(selIdx, 1);
      selIdx = -1; dirty = true; redraw();
    }
    svg.addEventListener("mousedown", function (ev) {
      var p = pt(ev), i = ev.target.dataset ? parseInt(ev.target.dataset.i, 10) : NaN;
      if (tool !== "select") {
        FREE.els.push({ k: "l", x1: p.x, y1: p.y, x2: p.x, y2: p.y, c: tool === "dash" ? "dash" : "base" });
        selIdx = FREE.els.length - 1;
        drag = { kind: "end", i: selIdx };
        dirty = true; redraw();
        return;
      }
      if (isNaN(i)) { selIdx = -1; redraw(); return; }
      selIdx = i;
      var e = FREE.els[i];
      if (e.k === "t") drag = { kind: "move", i: i, dx: p.x - e.x, dy: p.y - e.y };
      else {
        /* the nearer end moves; the middle third moves the whole line */
        var d1 = Math.hypot(p.x - e.x1, p.y - e.y1), d2 = Math.hypot(p.x - e.x2, p.y - e.y2),
            len = Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
        if (Math.min(d1, d2) > len / 3) drag = { kind: "line", i: i, px: p.x, py: p.y };
        else drag = { kind: d1 < d2 ? "start" : "end", i: i };
      }
      redraw();
      ev.preventDefault();
    });
    svg.addEventListener("mousemove", function (ev) {
      if (!drag) return;
      var p = pt(ev), e = FREE.els[drag.i];
      if (drag.kind === "move") { e.x = p.x - drag.dx; e.y = p.y - drag.dy; }
      else if (drag.kind === "start") { e.x1 = p.x; e.y1 = p.y; }
      else if (drag.kind === "end") { e.x2 = p.x; e.y2 = p.y; }
      else { var dx = p.x - drag.px, dy = p.y - drag.py; e.x1 += dx; e.x2 += dx; e.y1 += dy; e.y2 += dy; drag.px = p.x; drag.py = p.y; }
      FREE.w = Math.max(FREE.w, p.x + 120); FREE.h = Math.max(FREE.h, p.y + 80);
      dirty = true; redraw();
    });
    window.addEventListener("mouseup", function () {
      if (drag && drag.kind === "end") {
        var e = FREE.els[drag.i];
        if (e && e.k === "l" && Math.hypot(e.x2 - e.x1, e.y2 - e.y1) < 6) { FREE.els.splice(drag.i, 1); selIdx = -1; redraw(); }
      }
      drag = null;
    });
    svg.addEventListener("dblclick", function (ev) {
      var i = parseInt(ev.target.dataset ? ev.target.dataset.i : "", 10);
      if (isNaN(i) || FREE.els[i].k !== "t") return;
      var v = prompt(t("free.edit", "Text:"), FREE.els[i].t);
      if (v === null) return;
      if (v === "") FREE.els.splice(i, 1); else FREE.els[i].t = v;
      selIdx = -1; dirty = true; redraw();
    });
    document.onkeydown = function (ev) {
      if (MODE !== "free") return;
      if (ev.key === "Delete" || ev.key === "Backspace") { del(); ev.preventDefault(); }
      if (ev.key === "r" && selIdx >= 0 && FREE.els[selIdx].k === "t") {
        /* r: rotate a word onto a slanted line */
        FREE.els[selIdx].r = FREE.els[selIdx].r ? 0 : 55; dirty = true; redraw();
      }
    };
    setTool("select");
    redraw();
  }

  /* ---------------------------------------------------------------- frame */
  /* embedded (Bible text, Interlinear): a small mode switch in the page, no free drawing */
  function modeBar() {
    var bar = document.getElementById("modes");
    if (!bar) return;
    bar.innerHTML = "";
    [["tree", t("mode.tree", "Baum")], ["blocks", t("mode.blocks", "Blöcke")], ["rk", t("mode.rk", "Reed-Kellogg")]].forEach(function (m) {
      var b = el("button", MODE === m[0] ? "on" : "", m[1]);
      b.onclick = function () { MODE = m[0]; render(); msg("syntax.mode", m[0]); };
      bar.appendChild(b);
    });
    if (OPTS.toolLink) {
      var a = el("button", "tool", t("embed.tool", "Im Syntax-Werkzeug öffnen ›"));
      a.onclick = function () { msg("syntax.open", D.osis); };
      bar.appendChild(a);
    }
  }
  function fitFrame() {
    try {
      var fe = window.frameElement;
      if (fe) fe.style.height = Math.min(OPTS.maxH || 480, document.documentElement.scrollHeight + 4) + "px";
    } catch (e) {}
  }
  function render() {
    var v = document.getElementById("view");
    if (OPTS.embed) { document.body.classList.add("embed"); if (MODE === "free") MODE = "tree"; modeBar(); }
    v.innerHTML = "";
    var hasData = D && D.sentences && D.sentences.length;
    /* free mode draws from the saved diagram, not the Macula tree, so it has something to
     * show even with no tree data (e.g. hosts like web/mobile that only sync the free diagram) */
    if (MODE === "free") {
      if (hasData) header(); else document.getElementById("head").innerHTML = "";
      renderFree(v);
      return;
    }
    if (!hasData) {
      document.getElementById("head").innerHTML = "";
      v.appendChild(el("div", "empty", t("empty", "Für diese Stelle gibt es keine Syntaxdaten (Macula: NT nach SBLGNT, AT nach WLC).")));
      return;
    }
    header();
    D.sentences.forEach(function (s) {
      var box = el("div", "sent");
      if (D.sentences.length > 1 || s.first !== s.last)
        box.appendChild(el("div", "sref", s.first === s.last ? s.first : s.first + " – " + s.last));
      if (MODE === "blocks") renderBlocks(s, box);
      else if (MODE === "rk") renderRk(s, box);
      else renderTree(s, box);
      v.appendChild(box);
    });
    fitFrame();
  }

  /* one standalone svg of what is shown, with the computed colours inlined */
  function standaloneSvg() {
    var svgs = document.querySelectorAll("#view svg");
    if (!svgs.length) return "";
    var W = 0, H = 0, parts = [];
    for (var i = 0; i < svgs.length; i++) {
      var s = svgs[i], w = parseFloat(s.getAttribute("width")) || s.clientWidth, h = parseFloat(s.getAttribute("height")) || s.clientHeight;
      var clone = s.cloneNode(true), src = s.querySelectorAll("*"), dst = clone.querySelectorAll("*");
      for (var k = 0; k < src.length; k++) {
        var cs = getComputedStyle(src[k]);
        if (src[k].tagName === "text") {
          dst[k].setAttribute("fill", cs.fill);
          dst[k].setAttribute("font-family", cs.fontFamily);
          dst[k].setAttribute("font-size", cs.fontSize);
          if (cs.fontWeight !== "400") dst[k].setAttribute("font-weight", cs.fontWeight);
          if (cs.fontStyle !== "normal") dst[k].setAttribute("font-style", cs.fontStyle);
        } else if (src[k].tagName === "line" || src[k].tagName === "rect") {
          dst[k].setAttribute("stroke", cs.stroke);
          dst[k].setAttribute("stroke-width", cs.strokeWidth);
          if (cs.strokeDasharray && cs.strokeDasharray !== "none") dst[k].setAttribute("stroke-dasharray", cs.strokeDasharray);
          dst[k].setAttribute("fill", cs.fill);
        }
        dst[k].removeAttribute("class");
      }
      parts.push('<g transform="translate(0,' + H + ')">' + clone.innerHTML + "</g>");
      W = Math.max(W, w); H += h + 20;
    }
    var bg = getComputedStyle(document.body).backgroundColor;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H +
      '"><rect width="100%" height="100%" fill="' + bg + '"/>' + parts.join("") + "</svg>";
  }

  return {
    load: function (payload) {
      payload = payload || {};
      D = payload.data; L = payload.labels || {}; SAVED = payload.saved || null;
      FREE = null; collapsed = {}; expanded = {}; OPTS = payload.opts || {};
      if (payload.mode) MODE = payload.mode;
      render();
    },
    mode: function (m) { MODE = m; render(); },
    exportSvg: function () { msg("syntax.svg", standaloneSvg()); },
    exportPng: function () {
      var s = standaloneSvg();
      if (!s) { msg("syntax.png", ""); return; }
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas"), sc = 2;
        c.width = img.width * sc; c.height = img.height * sc;
        var g = c.getContext("2d");
        g.scale(sc, sc);
        g.drawImage(img, 0, 0);
        msg("syntax.png", c.toDataURL("image/png").replace(/^data:image\/png;base64,/, ""));
      };
      img.onerror = function () { msg("syntax.png", ""); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
    }
  };
})();
