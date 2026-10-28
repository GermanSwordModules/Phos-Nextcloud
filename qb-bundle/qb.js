/* Phos query builder — docs/konzept-erweiterte-suche.md
 *
 * A linear sequence of word blocks joined by connectors (UND, ODER, NAHE n, FOLGT n), plus scope
 * and output. Every change regenerates the PQL text and sends it to the host:
 *   window.bvcMsg("qb.pql", text) — or window.SwordBridge.onQbMessage on Android, same dual-bridge
 *   shim as web/syntax/syntax.js (see sendMsg() below).
 * The host loads a model with PhosQB.load(model) (see TQueryBuilderFrame.ModelJson):
 *   { items: [{neg, conds: [{f, v}]}], links: [{op, d}], scope, from,
 *     out: {kind: "hits"|"count"|"colloc"|"infer", by, win, mod}, labels: {...}, complex,
 *     caps: {fields, ops, out, scope} }
 * Precedence in PQL is NEAR > AND > OR, so a linear sequence needs no parentheses.
 *
 * `caps` (all optional, default = full desktop capability) lets a host that only runs a simpler
 * search backend restrict the palette to what it can actually execute, per
 * docs/shareable-tool-bundles.md, instead of emitting PQL the host would silently fail on:
 *   caps.fields: array of allowed field ids (default: all of FIELDS below)
 *   caps.ops:    array of allowed link ops (default: all of OPS below)
 *   caps.out:    array of allowed output kinds, "hits"|"count"|"colloc"|"infer" (default: all)
 *   caps.scope:  false hides the scope ("Bereich") and source ("Text"/FROM) inputs — for hosts
 *                whose search takes book-scope as a separate request param, not inline PQL text
 *   Compound per-item conditions ("+ Bedingung", e.g. word+morph on one block) stay desktop-only
 *   (no caps.fields restriction) — the simplified hosts don't parse that bracket syntax either. */
(function () {
  "use strict";
  var M = null, L = {}, CAPS = {};
  var FIELDS = [["word", "Wort"], ["prefix", "Wortanfang"], ["lemma", "Lemma"], ["strong", "Strong"],
                ["morph", "Morph"], ["phrase", "Phrase"], ["person", "Person"], ["place", "Ort"],
                ["topic", "Thema"], ["event", "Ereignis"], ["genre", "Gattung"], ["role", "Satzrolle"]];
  var ENTITY = { person: "person:", place: "ort:", topic: "thema:", event: "ereignis:", genre: "gattung:" };
  var OPS = [["AND", "UND"], ["OR", "ODER"], ["NEAR", "NAHE"], ["FOLLOWED", "FOLGT"]];
  var BYS = ["book", "chapter", "word", "strong", "morph", "lemma"];

  function allowed(list, cap) {
    return cap ? list.filter(function (x) { return cap.indexOf(x[0] || x) >= 0; }) : list;
  }
  function fields() { return allowed(FIELDS, CAPS.fields); }
  function ops() { return allowed(OPS, CAPS.ops); }

  function t(k, d) { return (L && L[k]) || d; }
  /* Desktop/web: window.bvcMsg(channel, payload). Android: window.SwordBridge.onQbMessage (see
   * web/syntax/syntax.js's identical msg() shim, SwordJsBridge.kt on the mobile side). */
  function sendMsg(ch, p) {
    try {
      if (window.SwordBridge && window.SwordBridge.onQbMessage) { window.SwordBridge.onQbMessage(ch, p); return; }
    } catch (e) {}
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
  function opt(sel, v, label, cur) {
    var o = el("option", null, label); o.value = v; if (v === cur) o.selected = true; sel.appendChild(o);
  }

  /* ---------- PQL text ---------- */
  function condText(c) {
    var v = (c.v || "").trim();
    if (!v) return "";
    switch (c.f) {
      case "prefix": return v.replace(/\*$/, "") + "*";
      case "strong": return "strong:" + v;
      case "morph": return "morph:" + v;
      case "lemma": return "lemma:" + v;
      case "role": return "role:" + v.toLowerCase();
      case "phrase": return '"' + v.replace(/"/g, "") + '"';
      case "person": case "place": case "topic": case "event": case "genre":
        return ENTITY[c.f] + (v.indexOf(" ") >= 0 ? '"' + v.replace(/"/g, "") + '"' : v);
      default: return v.indexOf(" ") >= 0 ? '"' + v + '"' : v;
    }
  }
  function itemText(it) {
    var parts = it.conds.map(condText).filter(function (s) { return s; });
    if (!parts.length) return "";
    /* an entity names verses, not a word: several conditions on one block become an AND */
    var ent = it.conds.some(function (c) { return !!ENTITY[c.f]; });
    var s = parts.length > 1 ? (ent ? "(" + parts.join(" ") + ")" : "[" + parts.join(" ") + "]") : parts[0];
    return (it.neg ? "-" : "") + s;
  }
  function pql() {
    var body = "", i, s;
    for (i = 0; i < M.items.length; i++) {
      s = itemText(M.items[i]);
      if (!s) continue;
      if (body) {
        var l = M.links[i - 1] || { op: "AND" };
        if (l.op === "OR") body += " OR ";
        else if (l.op === "NEAR" || l.op === "FOLLOWED") body += " " + l.op + "/" + (l.d || 5) + " ";
        else body += " ";
      }
      body += s;
    }
    if (!body) return "";
    var scope = (M.scope || "").trim() ? " IN " + M.scope.trim() : "";
    var o = M.out || { kind: "hits" }, q;
    if (o.kind === "count") q = "COUNT(" + body + scope + ") BY " + (o.by || "book");
    else if (o.kind === "colloc") q = "COLLOC(" + body + scope + ", " + (o.win || 5) + ")";
    else if (o.kind === "infer") q = "INFER(" + body + scope + ", " + (o.mod || "") + ")";
    else q = body + scope;
    if ((M.from || "").trim()) q += " FROM " + M.from.trim();
    return q;
  }
  function problems() {
    var msgs = [], i, l, a, b;
    for (i = 0; i < M.links.length; i++) {
      l = M.links[i];
      if (l.op !== "NEAR" && l.op !== "FOLLOWED") continue;
      a = M.items[i]; b = M.items[i + 1];
      [a, b].forEach(function (it) {
        if (!it) return;
        if (it.neg || it.conds.some(function (c) { return c.f === "phrase"; })) {
          it._bad = true;
          msgs.push(t("qb.err.prox", "NAHE/FOLGT verbinden einzelne Wörter — keine Phrase, kein Ausschluss."));
        }
      });
    }
    if (M.items.length && M.items.every(function (it) { return it.neg; }))
      msgs.push(t("qb.err.neg", "Mindestens ein Block darf kein Ausschluss sein."));
    if (M.out && M.out.kind === "infer" && !(M.out.mod || "").trim())
      msgs.push(t("qb.err.infer", "INFER braucht ein Vergleichsmodul."));
    return msgs.filter(function (m, i, a) { return a.indexOf(m) === i; });
  }
  function emit() {
    M.items.forEach(function (it) { it._bad = false; });
    var msgs = problems();
    var q = pql();
    var msg = document.getElementById("msg");
    if (msg) msg.textContent = msgs.join(" ");
    document.querySelectorAll(".block").forEach(function (b, i) {
      b.classList.toggle("bad", !!(M.items[i] && M.items[i]._bad));
    });
    sendMsg("qb.pql", q);
  }

  /* ---------- morphology helper (Robinson codes, Greek NT) ---------- */
  var MORPH = {
    pos: [["V", "Verb"], ["N", "Nomen"], ["A", "Adjektiv"], ["T", "Artikel"], ["P", "Pronomen"],
          ["ADV", "Adverb"], ["CONJ", "Konjunktion"], ["PREP", "Präposition"]],
    tense: [["?", "egal"], ["P", "Präsens"], ["I", "Imperfekt"], ["F", "Futur"], ["A", "Aorist"],
            ["R", "Perfekt"], ["L", "Plusquamperfekt"]],
    voice: [["?", "egal"], ["A", "aktiv"], ["M", "medium"], ["P", "passiv"], ["E", "med./pass."], ["D", "deponens"]],
    mood: [["?", "egal"], ["I", "Indikativ"], ["S", "Konjunktiv"], ["O", "Optativ"], ["M", "Imperativ"],
           ["N", "Infinitiv"], ["P", "Partizip"]],
    pers: [["?", "egal"], ["1", "1."], ["2", "2."], ["3", "3."]],
    num: [["?", "egal"], ["S", "Singular"], ["P", "Plural"]],
    kase: [["?", "egal"], ["N", "Nominativ"], ["G", "Genitiv"], ["D", "Dativ"], ["A", "Akkusativ"], ["V", "Vokativ"]],
    gen: [["?", "egal"], ["M", "maskulin"], ["F", "feminin"], ["N", "neutrum"]]
  };
  function morphHelper(input, anchor) {
    var box = document.getElementById("morph");
    box.innerHTML = "";
    var sels = {};
    function row(key, label, list) {
      var r = el("div", "row"); r.appendChild(el("span", null, label));
      var s = el("select"); list.forEach(function (p) { opt(s, p[0], p[1], "?"); });
      s.onchange = refresh; sels[key] = s; r.appendChild(s); box.appendChild(r); return r;
    }
    var rows = {
      pos: row("pos", t("qb.m.pos", "Wortart"), MORPH.pos),
      tense: row("tense", t("qb.m.tense", "Tempus"), MORPH.tense),
      voice: row("voice", t("qb.m.voice", "Genus verbi"), MORPH.voice),
      mood: row("mood", t("qb.m.mood", "Modus"), MORPH.mood),
      pers: row("pers", t("qb.m.pers", "Person"), MORPH.pers),
      kase: row("kase", t("qb.m.case", "Kasus"), MORPH.kase),
      num: row("num", t("qb.m.num", "Numerus"), MORPH.num),
      gen: row("gen", t("qb.m.gen", "Genus"), MORPH.gen)
    };
    var out = el("div", "row"); var code = el("b"); out.appendChild(el("span", null, "Code")); out.appendChild(code);
    box.appendChild(out);
    var ok = el("button", "ok", t("qb.take", "Übernehmen"));
    box.appendChild(ok);
    function val(k) { return sels[k].value; }
    function build() {
      var p = val("pos");
      if (p === "V") {
        var c = "V-" + val("tense") + val("voice") + val("mood");
        if (val("mood") === "P") c += "-" + val("kase") + val("num") + val("gen");
        else if (val("mood") !== "N") c += "-" + val("pers") + val("num");
        return c.replace(/\?+$/, "*");
      }
      if (p === "N" || p === "A" || p === "T" || p === "P") return (p + "-" + val("kase") + val("num") + val("gen")).replace(/\?+$/, "*");
      return p;
    }
    function refresh() {
      var p = val("pos"), verb = p === "V", mood = val("mood");
      rows.tense.style.display = rows.voice.style.display = rows.mood.style.display = verb ? "" : "none";
      rows.pers.style.display = verb && mood !== "P" && mood !== "N" ? "" : "none";
      rows.kase.style.display = rows.gen.style.display = (!verb && "NATP".indexOf(p) >= 0) || (verb && mood === "P") ? "" : "none";
      rows.num.style.display = (verb && mood !== "N") || "NATP".indexOf(p) >= 0 ? "" : "none";
      code.textContent = build();
    }
    ok.onclick = function () { input.value = build(); input.dispatchEvent(new Event("input")); box.style.display = "none"; };
    refresh();
    var r = anchor.getBoundingClientRect();
    box.style.left = Math.min(r.left, window.innerWidth - 260) + "px";
    box.style.top = Math.min(r.bottom + 4, window.innerHeight - 330) + "px";
    box.style.display = "block";
  }
  document.addEventListener("mousedown", function (e) {
    var box = document.getElementById("morph");
    if (box && box.style.display === "block" && !box.contains(e.target) && !e.target.classList.contains("mh"))
      box.style.display = "none";
  });

  /* ---------- rendering ---------- */
  var dragFrom = -1;
  function newItem(f) { return { neg: false, conds: [{ f: f || "word", v: "" }] }; }
  function insertAt(idx, item) {
    M.items.splice(idx, 0, item);
    if (M.items.length > 1) M.links.splice(idx === 0 ? 0 : idx - 1, 0, { op: "AND", d: 5 });
  }
  function removeAt(idx) {
    M.items.splice(idx, 1);
    if (M.links.length) M.links.splice(idx === 0 ? 0 : idx - 1, 1);
  }
  function move(from, to) {
    if (from === to || from < 0) return;
    var it = M.items.splice(from, 1)[0];
    if (to > from) to--;
    M.items.splice(to, 0, it);
  }

  function dropZone(idx) {
    var z = el("div", "drop");
    z.addEventListener("dragover", function (e) { e.preventDefault(); z.classList.add("over"); });
    z.addEventListener("dragleave", function () { z.classList.remove("over"); });
    z.addEventListener("drop", function (e) {
      e.preventDefault(); e.stopPropagation();
      var f = e.dataTransfer.getData("text/phos-field");
      if (f) insertAt(idx, newItem(f)); else move(dragFrom, idx);
      dragFrom = -1; render(); emit();
    });
    return z;
  }

  function condRow(it, c, ci) {
    var r = el("div", "cond");
    var s = el("select");
    fields().forEach(function (f) { opt(s, f[0], t("qb.f." + f[0], f[1]), c.f); });
    s.onchange = function () { c.f = s.value; render(); emit(); };
    var inp = el("input");
    inp.value = c.v || "";
    inp.placeholder = { word: "Liebe", prefix: "lieb", lemma: "ἀγάπη", strong: "G26", morph: "V-AAI-3S",
      phrase: "Sohn Gottes", person: "Paulus", place: "Ephesus", topic: "Vergebung", event: "Taufe Jesu",
      genre: "Gleichnis", role: "s v o io adv" }[c.f] || "";
    inp.oninput = function () { c.v = inp.value; emit(); };
    r.appendChild(s); r.appendChild(inp);
    if (c.f === "morph") {
      var mh = el("button", "mh", "…");
      mh.title = t("qb.morphhelp", "Morphologie zusammenstellen");
      mh.onclick = function () { morphHelper(inp, mh); };
      r.appendChild(mh);
    }
    if (it.conds.length > 1) {
      var x = el("button", "addc", "−");
      x.title = t("qb.delcond", "Bedingung entfernen");
      x.onclick = function () { it.conds.splice(ci, 1); render(); emit(); };
      r.appendChild(x);
    }
    return r;
  }

  function block(it, i) {
    var b = el("div", "block" + (it.neg ? " neg" : ""));
    b.draggable = true;
    b.addEventListener("dragstart", function (e) { dragFrom = i; b.classList.add("dragging"); e.dataTransfer.setData("text/plain", "move"); });
    b.addEventListener("dragend", function () { b.classList.remove("dragging"); });
    var h = el("div", "bhead");
    h.appendChild(el("span", null, it.neg ? t("qb.notword", "nicht:") : t("qb.word", "Wort " + (i + 1))));
    h.appendChild(el("span", "sp"));
    var ng = el("button", null, "¬"); ng.title = t("qb.neg", "Ausschließen (nicht)");
    ng.onclick = function () { it.neg = !it.neg; render(); emit(); };
    var del = el("button", null, "×"); del.title = t("qb.del", "Block entfernen");
    del.onclick = function () { removeAt(i); render(); emit(); };
    h.appendChild(ng); h.appendChild(del);
    b.appendChild(h);
    it.conds.forEach(function (c, ci) { b.appendChild(condRow(it, c, ci)); });
    if (!CAPS.fields) {
      var add = el("button", "addc", "+ " + t("qb.addcond", "Bedingung (gleiches Wort)"));
      add.onclick = function () { it.conds.push({ f: "morph", v: "" }); render(); emit(); };
      b.appendChild(add);
    }
    return b;
  }

  function linkUi(l) {
    var w = el("div", "link");
    var s = el("select");
    ops().forEach(function (o) { opt(s, o[0], t("qb.op." + o[0], o[1]), l.op); });
    s.onchange = function () { l.op = s.value; render(); emit(); };
    w.appendChild(s);
    if (l.op === "NEAR" || l.op === "FOLLOWED") {
      var d = el("input"); d.type = "number"; d.min = 1; d.max = 50; d.value = l.d || 5;
      d.title = t("qb.dist", "höchstens so viele Wörter Abstand");
      d.oninput = function () { l.d = Math.max(1, Math.min(50, parseInt(d.value, 10) || 5)); emit(); };
      w.appendChild(d);
      w.appendChild(el("span", "arrow", l.op === "FOLLOWED" ? "→" : "↔"));
    }
    return w;
  }

  function render() {
    var cv = document.getElementById("canvas");
    cv.innerHTML = "";
    if (!M.items.length) {
      cv.appendChild(el("div", "empty", t("qb.empty", "Bausteine aus der Palette hierher ziehen (oder anklicken).")));
    }
    for (var i = 0; i < M.items.length; i++) {
      cv.appendChild(dropZone(i));
      if (i > 0) cv.appendChild(linkUi(M.links[i - 1] || (M.links[i - 1] = { op: "AND", d: 5 })));
      cv.appendChild(block(M.items[i], i));
    }
    cv.appendChild(dropZone(M.items.length));
    renderFoot();
  }

  function renderFoot() {
    var f = document.getElementById("foot");
    f.innerHTML = "";
    var showScope = CAPS.scope !== false;
    if (showScope) {
      var sl = el("label", null, t("qb.scope", "Bereich") + " ");
      var si = el("input", "scope"); si.value = M.scope || ""; si.placeholder = "Röm-Gal; @Evangelien";
      si.oninput = function () { M.scope = si.value; emit(); };
      sl.appendChild(si); f.appendChild(sl);
    }
    var outKinds = allowed(
      [["hits", t("qb.out.hits", "Stellen")], ["count", "COUNT"], ["colloc", "COLLOC"], ["infer", "INFER"]],
      CAPS.out);
    if (outKinds.length > 1) {
      var ol = el("label", null, t("qb.out", "Ausgabe") + " ");
      var os = el("select");
      outKinds.forEach(function (o) { opt(os, o[0], o[1], (M.out || {}).kind || "hits"); });
      os.onchange = function () { M.out = M.out || {}; M.out.kind = os.value; renderFoot(); emit(); };
      ol.appendChild(os); f.appendChild(ol);
    }
    var o = M.out || { kind: "hits" };
    if (o.kind === "count") {
      var by = el("select");
      BYS.forEach(function (b) { opt(by, b, t("qb.by." + b, b), o.by || "book"); });
      by.onchange = function () { o.by = by.value; emit(); };
      var bl = el("label", null, t("qb.by", "nach") + " "); bl.appendChild(by); f.appendChild(bl);
    } else if (o.kind === "colloc") {
      var wn = el("input"); wn.type = "number"; wn.min = 1; wn.max = 20; wn.value = o.win || 5; wn.style.width = "50px";
      wn.oninput = function () { o.win = parseInt(wn.value, 10) || 5; emit(); };
      var wl = el("label", null, "± "); wl.appendChild(wn); f.appendChild(wl);
    } else if (o.kind === "infer") {
      var mi = el("input"); mi.value = o.mod || ""; mi.placeholder = "ELB-CSV";
      mi.oninput = function () { o.mod = mi.value; emit(); };
      var ml = el("label", null, t("qb.mod", "gegen Modul") + " "); ml.appendChild(mi); f.appendChild(ml);
    }
    if (showScope) {
      var fl = el("label", null, t("qb.from", "Text") + " ");
      var fi = el("input"); fi.value = M.from || ""; fi.placeholder = t("qb.from.ph", "automatisch"); fi.style.width = "110px";
      fi.oninput = function () { M.from = fi.value; emit(); };
      fl.appendChild(fi); f.appendChild(fl);
    }
    f.appendChild(el("div", null)).id = "msg";
  }

  function palette() {
    var p = document.getElementById("palette");
    p.innerHTML = "";
    p.appendChild(el("h4", null, t("qb.palette", "Bausteine")));
    fields().forEach(function (f) {
      var c = el("div", "chip", t("qb.f." + f[0], f[1]));
      c.draggable = true;
      c.addEventListener("dragstart", function (e) { e.dataTransfer.setData("text/phos-field", f[0]); dragFrom = -1; });
      c.onclick = function () { insertAt(M.items.length, newItem(f[0])); render(); emit(); };
      p.appendChild(c);
    });
  }

  window.PhosQB = {
    load: function (model) {
      M = model || {};
      M.items = M.items || []; M.links = M.links || []; M.out = M.out || { kind: "hits" };
      L = M.labels || {};
      CAPS = M.caps || {};
      palette(); render();
      var cv = document.getElementById("canvas");
      cv.addEventListener("dragover", function (e) { e.preventDefault(); cv.classList.add("over"); });
      cv.addEventListener("dragleave", function () { cv.classList.remove("over"); });
      cv.addEventListener("drop", function (e) {
        cv.classList.remove("over");
        var f = e.dataTransfer.getData("text/phos-field");
        if (f) { e.preventDefault(); insertAt(M.items.length, newItem(f)); render(); emit(); }
      });
      if (M.complex) document.getElementById("msg").textContent =
        t("qb.complex", "Diese Abfrage hat Klammern — der Baukasten zeigt eine flache Fassung.");
      emit();
    },
    pql: function () { return pql(); }
  };
})();
