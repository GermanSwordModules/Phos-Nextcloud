/* Phos · Facts page controller.
 *
 * Renders one payload (see README.md) into the page, and routes every click back to whichever
 * host is underneath. The page knows no strings and no data of its own: labels arrive localized
 * in `payload.strings`, sections arrive in the order they are to appear, and a section kind this
 * file does not know is skipped — that is what lets the desktop send an AI summary, sermons and
 * media while the app sends none, with no branching on either side.
 */
(function (global) {
  'use strict';

  /* ---- the host bridge -------------------------------------------------- */
  /* Desktop: window.bvcMsg(channel, payload) — see unit_htmlview_cef.pas BRIDGE_JS.
     Android: window.SwordBridge.* — see SwordJsBridge.kt.
     Everything the page can ask for goes through one of these two, and nowhere else. */
  var Host = {
    send: function (channel, payload) {
      try {
        if (global.SwordBridge && channel === 'nav' && global.SwordBridge.onNavLinkTap) {
          return global.SwordBridge.onNavLinkTap(payload);
        }
        if (global.SwordBridge && global.SwordBridge.onFactsMessage) {
          return global.SwordBridge.onFactsMessage(channel, payload);
        }
        if (global.bvcMsg) return global.bvcMsg(channel, payload);
      } catch (e) { /* a host that cannot hear us must not break the page */ }
    },
    nav: function (url) { this.send('nav', url); }
  };

  var state = { payload: null, tables: {} };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function t(key, fallback) {
    var s = state.payload && state.payload.strings;
    return (s && s[key]) || fallback || key;
  }
  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild;
  }

  /* ---- section renderers ------------------------------------------------ */
  var SECTIONS = {
    prose: function (s) {
      return (s.html ? '<div class="prose">' + s.html + '</div>' : '') +
        (s.chips && s.chips.length ? '<div class="chips">' + s.chips.map(function (c) {
          return '<a class="chip" href="' + esc(c.href) + '"><b>' + esc(c.source) + '</b> ' + esc(c.label) + '</a>';
        }).join('') + '</div>' : '');
    },

    passages: function (s) {
      var items = s.items || [], max = items.reduce(function (m, p) { return Math.max(m, p.score || 0); }, 0) || 1;
      var shown = items.slice(0, s.limit || items.length);
      var html = '<div class="plist">' + shown.map(function (p) {
        return '<a class="prow" href="phos:bible/' + esc(p.osis) + '" style="--w:' +
          (100 * (p.score || 0) / max).toFixed(1) + '%">' +
          '<span class="pref">' + esc(p.display || p.osis) + '</span>' +
          '<span class="ptext">' + esc(p.text || '') + '</span>' +
          '<span class="pscore">' + (p.score == null ? '' : p.score) + '</span>' +
          // Desktop only: the host owns study projects and says so with canProject.
          (state.payload.canProject ? '<span class="padd" role="button" data-proj-osis="' + esc(p.osis) +
            '" title="' + esc(t('toProjectPericope', 'Als Perikope ins Studienprojekt')) + '">＋</span>' : '') +
          '</a>';
      }).join('') + '</div>';
      if (shown.length < items.length) {
        html += '<p class="foot"><button type="button" data-more="' + esc(s.id) + '">' +
          t('more', 'weitere zeigen') + ' (' + (items.length - shown.length) + ')</button></p>';
      }
      return html;
    },

    entries: function (s) {
      var all = s.items || [];
      var items = s.limit ? all.slice(0, s.limit) : all;
      var html = '<div class="dgrid">' + items.map(function (e) {
        return '<a class="dcard" href="phos:entry/' + esc(e.module) + '/' + encodeURIComponent(e.key) + '">' +
          '<span class="dhead">' + esc(e.title) + '</span>' +
          '<span class="dmod">' + esc(e.moduleLabel || e.module) + '</span>' +
          '<span class="dbody">' + esc(e.snippet || '') + '</span></a>';
      }).join('') + '</div>';
      // The direct hits are the answer; everything else that merely contains the word folds away.
      if (items.length < all.length) {
        html += '<p class="foot"><button type="button" data-more="' + esc(s.id) + '">' +
          t('more', 'weitere zeigen') + ' (' + (all.length - items.length) + ')</button></p>';
      }
      return html;
    },

    /* One <details> per source, its own count in the summary — the shape the exegesis view's
       Fundorte already use, so books and lexicon articles read the same way there and here. */
    grouped: function (s) {
      return (s.groups || []).map(function (g, i) {
        var open = (s.openFirst && i === 0) ? ' open' : '';
        return '<details class="grp"' + open + '><summary>' +
          (g.thumb ? '<img class="grp-img" src="' + esc(g.thumb) + '" alt="" loading="lazy">' : '') +
          '<span class="grp-n">' + esc(g.label) + '</span>' +
          (g.sub ? '<span class="grp-s">' + esc(g.sub) + '</span>' : '') +
          '<span class="grp-c">' + g.items.length + '</span></summary>' +
          '<div class="grp-i">' + g.items.map(function (it) {
            return '<a class="grow" href="' + esc(it.href) + '">' +
              '<span class="grow-t">' + esc(it.title) + '</span>' +
              (it.sub ? '<span class="grow-s">' + esc(it.sub) + '</span>' : '') +
              (it.snippet ? '<span class="grow-x">' + it.snippet + '</span>' : '') +
              '</a>';
          }).join('') + '</div></details>';
      }).join('');
    },

    /* Pictures want a grid that follows the column, not a strip that runs off the edge. */
    tiles: function (s) {
      return '<div class="tgrid">' + (s.items || []).map(function (m) {
        return '<a class="tile" href="' + esc(m.href) + '">' +
          (m.thumb ? '<img src="' + esc(m.thumb) + '" alt="' + esc(m.title) + '" loading="lazy">'
                   : '<span class="tile-x"></span>') +
          '<span class="tile-t">' + esc(m.title) + '</span>' +
          (m.sub ? '<span class="tile-s">' + esc(m.sub) + '</span>' : '') +
          '</a>';
      }).join('') + '</div>';
    },

    media: function (s) {
      return '<div class="mstrip">' + (s.items || []).map(function (m) {
        return '<a class="mtile" href="' + esc(m.href || '#') + '"><img src="' + esc(m.thumb) +
          '" alt="' + esc(m.title) + '" loading="lazy">' + esc(m.title) + '</a>';
      }).join('') + '</div>';
    },

    hits: function (s) {
      return '<ul class="hits">' + (s.items || []).map(function (h) {
        return '<li><a href="phos:entry/' + esc(h.module) + '/' + encodeURIComponent(h.key || '') + '">' +
          esc(h.moduleLabel || h.module) + '</a> <span>' + esc(h.snippet || h.title || '') + '</span></li>';
      }).join('') + '</ul>';
    }
  };

  /* ---- figures ---------------------------------------------------------- */
  /* The verses behind one bar of a canon strip, as a list under the figure. The payload carries
     them per book (SetCanonVerses); without that a bar is a number you cannot get into, which is
     what "ich sehe die detaillierten Hits nie" was about. */
  function showBookVerses(sectionId, osisBook) {
    var sec = (state.payload.sections || []).filter(function (x) { return x.id === sectionId; })[0];
    if (!sec || !sec.versesByBook) return;
    var refs = sec.versesByBook[osisBook] || [];
    var host = document.getElementById('fig-' + sectionId).parentNode;
    var old = host.querySelector('.bookhits');
    if (old) old.parentNode.removeChild(old);
    if (!refs.length) return;

    var names = {};
    (sec.bookNames || []).forEach(function (row) {
      var p = row.split('\t');
      names[p[0]] = p[1] || p[0];
    });
    var label = names[osisBook] || osisBook;
    var box = document.createElement('div');
    box.className = 'bookhits';
    box.innerHTML = '<div class="bookhits-h">' + esc(label) + ' · ' + refs.length + ' ' +
      t('hits', 'Stellen') + '<button type="button" class="bookhits-x" aria-label="' +
      t('close', 'schließen') + '">×</button></div>' +
      '<div class="bookhits-l">' + refs.map(function (r) {
        var p = r.split('.');
        return '<a href="phos:bible/' + esc(r) + '">' + esc(label + ' ' + p[1] + ',' + p[2]) + '</a>';
      }).join('') + '</div>';
    host.appendChild(box);
    box.scrollIntoView({ block: 'nearest' });
  }

  function figure(s) {
    var fig = global.PhosCharts.render(s, {});
    if (!fig) return null;
    state.tables[s.id] = fig;
    var acts = '<div class="figacts">' +
      '<button type="button" data-table="' + esc(s.id) + '">' + t('asTable', 'als Tabelle') + '</button>';
    // Presentations are a desktop tool; the host says whether it has one rather than the page guessing.
    if (state.payload.canPresent) {
      acts += '<button type="button" data-slide="' + esc(s.id) + '">' + t('toSlide', 'auf eine Folie') + '</button>';
    }
    // A map belongs in the tool that owns routes; one click, same places, same order.
    if (s.kind === 'places' && (s.items || []).length) {
      if ((s.route || []).length > 1) {
        var on = s.routeOn === undefined ? s.route.length <= 12 : s.routeOn;
        acts += '<button type="button" data-route="' + esc(s.id) + '">' +
          (on ? t('routeOff', 'Route ausblenden') : t('routeOn', 'Route einblenden')) + '</button>';
      }
      acts += '<button type="button" data-places="' + esc(s.id) + '">' +
        t('inAtlas', 'in Akteure & Orte öffnen') + '</button>';
    }
    if (fig.credit) acts += '<span class="credit">' + esc(fig.credit) + '</span>';
    acts += '</div>';
    return '<div class="fig" id="fig-' + esc(s.id) + '"><div class="plot">' + fig.svg + '</div>' +
      fig.table + '</div>' + acts;
  }

  /* ---- page ------------------------------------------------------------- */
  function render(payload) {
    state.payload = payload;
    state.tables = {};
    if (payload.theme) document.documentElement.setAttribute('data-theme', payload.theme);
    if (payload.fontSizePx) document.documentElement.style.setProperty('--reader-font-size', payload.fontSizePx + 'px');

    var root = document.getElementById('facts'), out = [];
    var topic = payload.topic || {};
    out.push('<header class="thead"><div><h1>' + esc(topic.label) + '</h1>' +
      '<p class="tsub">' + (topic.key && topic.key !== topic.label ? '<code>' + esc(topic.key) + '</code> · ' : '') +
      esc(payload.subtitle || '') + '</p></div>' +
      (payload.canProject ? '<button type="button" class="tproj" data-proj-topic="1">＋ ' +
        esc(t('toProject', 'Ins Studienprojekt')) + '</button>' : '') +
      '</header>');

    var sections = (payload.sections || []).filter(function (s) {
      return SECTIONS[s.kind] || global.PhosCharts.kinds.indexOf(s.kind) >= 0;
    });
    out.push('<nav class="secnav">' + sections.map(function (s, i) {
      return '<a class="' + (i === 0 ? 'on' : '') + '" href="#sec-' + esc(s.id) + '">' + esc(s.title) + '</a>';
    }).join('') + '</nav>');

    sections.forEach(function (s) {
      var body = SECTIONS[s.kind] ? SECTIONS[s.kind](s) : figure(s);
      if (body == null) return;
      out.push('<section class="sec" id="sec-' + esc(s.id) + '"><h2>' + esc(s.title) +
        (s.count ? ' <span class="count">' + s.count + '</span>' : '') + '</h2>' +
        (s.lede ? '<p class="lede">' + esc(s.lede) + '</p>' : '') + body +
        (s.foot ? '<p class="foot">' + esc(s.foot) + '</p>' : '') + '</section>');
    });

    if (payload.empty && payload.empty.length) {
      out.push('<p class="foot" style="padding:0 24px 18px">' + t('noHits', 'Ohne Treffer') + ': ' +
        payload.empty.map(esc).join(', ') + '</p>');
    }
    root.innerHTML = out.join('');
    wire(root);
    wirePreview(root);
  }

  function wire(root) {
    /* "Ich will was markieren, lasse die Maus los — schwupp, bin ich in dem Lexikon."
       A row IS a link, so releasing the mouse after a drag counted as a click. Two guards: the
       pointer must not have travelled, and there must be no selection left behind. */
    var downAt = null;
    root.addEventListener('pointerdown', function (ev) { downAt = { x: ev.clientX, y: ev.clientY }; });
    function wasDrag(ev) {
      if (downAt && (Math.abs(ev.clientX - downAt.x) > 6 || Math.abs(ev.clientY - downAt.y) > 6)) return true;
      var sel = window.getSelection();
      return !!(sel && String(sel).trim().length);
    }

    root.addEventListener('click', function (ev) {
      var node = ev.target.closest('[data-person]');
      if (node && !wasDrag(ev)) {
        Host.nav('facts:person/' + node.getAttribute('data-person'));
        return;
      }
      var bar = ev.target.closest('.fx-bar[data-osis]');
      if (bar) {
        var fig = bar.closest('.fig');
        if (fig) showBookVerses(fig.id.replace(/^fig-/, ''), bar.getAttribute('data-osis'));
        return;
      }
      var add = ev.target.closest('[data-proj-osis]');
      if (add) {
        ev.preventDefault();
        Host.send('project', JSON.stringify({ kind: 'pericope', osis: add.getAttribute('data-proj-osis') }));
        return;
      }
      var a = ev.target.closest('a[href^="phos:"], a[href^="facts:"]');
      if (a) {
        ev.preventDefault();
        if (wasDrag(ev)) return;      // a selection, not a click
        Host.nav(a.getAttribute('href'));
        return;
      }

      var b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.projTopic) {
        var tp = state.payload.topic || {};
        Host.send('project', JSON.stringify({ kind: 'topic', label: tp.label || '', key: tp.key || '' }));
        return;
      }
      if (b.dataset.table) {
        document.getElementById('fig-' + b.dataset.table).classList.toggle('as-table');
        return;
      }
      if (b.classList.contains('bookhits-x')) {
        var box = b.closest('.bookhits');
        box.parentNode.removeChild(box);
        return;
      }
      if (b.dataset.route) {
        var rs = (state.payload.sections || []).filter(function (x) { return x.id === b.dataset.route; })[0];
        if (rs) {
          var cur = rs.routeOn === undefined ? (rs.route || []).length <= 12 : rs.routeOn;
          rs.routeOn = !cur;
          var fw = document.getElementById('fig-' + rs.id);
          var body = figure(rs);
          fw.parentNode.querySelector('.figacts').outerHTML = '';
          fw.outerHTML = body;
        }
        return;
      }
      if (b.dataset.places) {
        var ps = (state.payload.sections || []).filter(function (x) { return x.id === b.dataset.places; })[0];
        if (ps) {
          var order = ps.route && ps.route.length ? ps.route
                    : (ps.items || []).map(function (p) { return p.id || p.name; });
          Host.send('places', order.join(','));
        }
        return;
      }
      if (b.dataset.slide) { toSlide(b.dataset.slide); return; }
      if (b.dataset.more) {
        // Revealed here, not asked of the host: the rest of the list is already in the payload.
        var sec = (state.payload.sections || []).filter(function (x) { return x.id === b.dataset.more; })[0];
        if (sec) {
          delete sec.limit;
          var host = document.getElementById('sec-' + sec.id);
          var body = SECTIONS[sec.kind] ? SECTIONS[sec.kind](sec) : '';
          var old = host.querySelector('.plist') || host.querySelector('.dgrid');
          if (old) old.outerHTML = body;
          b.parentNode.removeChild(b);
        }
        return;
      }
      if (b.dataset.act) { Host.send(b.dataset.act, (state.payload.topic || {}).key || ''); }
    });

    // Hover/tap read-out. The same handler serves both: a tap fires pointerenter on touch too,
    // and the tooltip clears on the next scroll.
    var tip = document.getElementById('tip');
    root.querySelectorAll('.fx-bar, .fx-dot, [data-epoch]').forEach(function (m) {
      var title = m.querySelector('title');
      if (!title) return;
      var text = title.textContent;
      function show(e) {
        tip.textContent = text;
        tip.style.left = e.clientX + 'px';
        tip.style.top = e.clientY + 'px';
        tip.style.opacity = '1';
      }
      m.addEventListener('pointerenter', show);
      m.addEventListener('pointermove', show);
      m.addEventListener('pointerleave', function () { tip.style.opacity = '0'; });
    });
    document.addEventListener('scroll', function () { tip.style.opacity = '0'; }, { passive: true });

    // Queried on every scroll, not once: late sections replace their placeholders, and a list
    // captured here would point at elements that are gone.
    document.addEventListener('scroll', function () {
      var links = [].slice.call(root.querySelectorAll('.secnav a'));
      var secs = [].slice.call(root.querySelectorAll('.sec'));
      var y = 60, cur = 0;
      secs.forEach(function (s, i) { if (s.getBoundingClientRect().top <= y) cur = i; });
      links.forEach(function (l, i) { l.classList.toggle('on', i === cur); });
    }, { passive: true });
  }

  /** A figure leaving the page for a deck: re-rendered with resolved colours, because the slide
   *  has its own stylesheet and `var(--fx-…)` would resolve to nothing there. */
  function toSlide(id) {
    var s = (state.payload.sections || []).filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var frozen = global.PhosCharts.render(s, { palette: global.PhosCharts.freeze(document.documentElement) });
    if (!frozen) return;
    Host.send('slide', JSON.stringify({
      id: id, title: s.title, svg: frozen.svg, table: frozen.table,
      topic: (state.payload.topic || {}).label || ''
    }));
  }

  /* The host answers a hover asynchronously (it has to read the verse), so it calls back in
     here. One box, reused. */
  var previewBox = null;
  function showPreview(html, x, y) {
    if (!previewBox) {
      previewBox = document.createElement('div');
      previewBox.className = 'vpreview';
      document.body.appendChild(previewBox);
      previewBox.addEventListener('pointerleave', function () { previewBox.style.opacity = '0'; });
    }
    previewBox.innerHTML = html;
    previewBox.style.left = Math.min(x, window.innerWidth - 380) + 'px';
    previewBox.style.top = (y + 14) + 'px';
    previewBox.style.opacity = '1';
  }

  function wirePreview(root) {
    var timer = null, lastRef = '';
    root.addEventListener('pointerover', function (ev) {
      var a = ev.target.closest('a[href^="phos:bible/"]');
      if (!a) return;
      var ref = a.getAttribute('href').slice(11);
      var x = ev.clientX, y = ev.clientY;
      clearTimeout(timer);
      timer = setTimeout(function () {
        lastRef = ref;
        Host.send('preview', ref + '|' + x + '|' + y);
      }, 220);
    });
    root.addEventListener('pointerout', function (ev) {
      if (!ev.target.closest('a[href^="phos:bible/"]')) return;
      clearTimeout(timer);
      if (previewBox) previewBox.style.opacity = '0';
    });
  }

  /* A section that arrives late — the overview waits on a local service and can take ten
     seconds. Re-loading the whole document for it would throw away the scroll position and every
     group the reader has opened, so it is inserted instead. */
  function addSectionFirst(section) {
    if (!section || !section.id) return;
    var secs = state.payload.sections || (state.payload.sections = []);
    var at = secs.findIndex(function (x) { return x.id === section.id; });
    if (at >= 0) secs.splice(at, 1);
    secs.unshift(section);

    // A placeholder of the same id ("wird erstellt …") is replaced where it stands.
    var old = document.getElementById('sec-' + section.id);
    var oldLink = document.querySelector('.secnav a[href="#sec-' + section.id + '"]');

    var body = SECTIONS[section.kind] ? SECTIONS[section.kind](section) : figure(section);
    if (body == null) return;
    var html = '<section class="sec" id="sec-' + esc(section.id) + '"><h2>' + esc(section.title) +
      (section.count ? ' <span class="count">' + section.count + '</span>' : '') + '</h2>' +
      (section.lede ? '<p class="lede">' + esc(section.lede) + '</p>' : '') + body +
      (section.foot ? '<p class="foot">' + esc(section.foot) + '</p>' : '') + '</section>';
    if (old) {
      old.outerHTML = html;
      if (oldLink) oldLink.textContent = section.title;
      return;
    }
    var root = document.getElementById('facts');
    var nav = root.querySelector('.secnav');
    nav.insertAdjacentHTML('afterend', html);
    // and into the section bar, as the first entry
    nav.insertAdjacentHTML('afterbegin',
      '<a href="#sec-' + esc(section.id) + '">' + esc(section.title) + '</a>');
  }

  /* A placeholder ("wird geladen …") replaced where it stands — sermons and picture modules come
     from a background search on the desktop. Unknown id: appended at the end. */
  function sectionHtml(section) {
    var body = SECTIONS[section.kind] ? SECTIONS[section.kind](section) : figure(section);
    if (body == null) return '';
    return '<section class="sec" id="sec-' + esc(section.id) + '"><h2>' + esc(section.title) +
      (section.count ? ' <span class="count">' + section.count + '</span>' : '') + '</h2>' +
      (section.lede ? '<p class="lede">' + esc(section.lede) + '</p>' : '') + body +
      (section.foot ? '<p class="foot">' + esc(section.foot) + '</p>' : '') + '</section>';
  }

  function replaceSection(section) {
    if (!section || !section.id) return;
    var secs = state.payload.sections || (state.payload.sections = []);
    var at = secs.findIndex(function (x) { return x.id === section.id; });
    if (at >= 0) secs[at] = section; else secs.push(section);
    var html = sectionHtml(section);
    var old = document.getElementById('sec-' + section.id);
    var root = document.getElementById('facts');
    if (old) old.outerHTML = html;
    else if (html) root.insertAdjacentHTML('beforeend', html);
    var link = root.querySelector('.secnav a[href="#sec-' + section.id + '"]');
    if (link) link.textContent = section.title;
    else root.querySelector('.secnav').insertAdjacentHTML('beforeend',
      '<a href="#sec-' + esc(section.id) + '">' + esc(section.title) + '</a>');
  }

  /* Nothing found after all: the placeholder and its entry in the section bar go. */
  function removeSection(id) {
    var secs = state.payload.sections || [];
    var at = secs.findIndex(function (x) { return x.id === id; });
    if (at >= 0) secs.splice(at, 1);
    var el = document.getElementById('sec-' + id);
    if (el) el.parentNode.removeChild(el);
    var link = document.querySelector('.secnav a[href="#sec-' + id + '"]');
    if (link) link.parentNode.removeChild(link);
  }

  global.PhosFacts = {
    showPreview: showPreview,
    addSectionFirst: addSectionFirst,
    replaceSection: replaceSection,
    removeSection: removeSection,
    render: render,
    /** The host calls this to pull one figure back out (presentation capture, PDF export). */
    figureHtml: function (id) {
      var f = document.getElementById('fig-' + id);
      return f ? f.outerHTML : '';
    },
    toSlide: toSlide
  };
}(window));
