/**
 * The viewer, inlined into archive.html.
 *
 * Constraints this code is written against, all of them load-bearing:
 *   - It runs from a double-clicked file:// URL with no network.
 *   - There are no fetch calls, no imports, no CDN, no web fonts.
 *   - It must stay usable by someone who has never seen this application and
 *     has been given no instructions.
 *   - It must hold 5,000+ entries: the star view culls to the viewport and
 *     the lists render in slices.
 *
 * Written without template literals on purpose: this whole file is embedded
 * in a TypeScript String.raw block.
 */
export const VIEWER_JS = String.raw`
(function () {
  'use strict';

  var node = document.getElementById('archive-data');
  var DATA;
  try {
    DATA = JSON.parse(node.textContent);
  } catch (err) {
    document.body.innerHTML = '<div class="wrap"><h1>This archive could not be read</h1>' +
      '<p>The data inside this file appears to be damaged. Open <b>archive.txt</b> instead - ' +
      'it is the same archive as plain text and needs no software beyond a text editor.</p></div>';
    return;
  }

  var ENTRIES = DATA.entries || [];
  var CLUSTERS = DATA.clusters || [];
  var ARCHIVE = DATA.archive || { title: '', opening: '' };
  var REGIONS = DATA.regions || [];

  var byId = {};
  var i;
  for (i = 0; i < ENTRIES.length; i++) byId[ENTRIES[i]._id] = ENTRIES[i];
  var clusterById = {};
  for (i = 0; i < CLUSTERS.length; i++) clusterById[CLUSTERS[i]._id] = CLUSTERS[i];

  var KIND_LABELS = {
    thought: 'Thought', story: 'Story', feeling: 'Feeling', loved: 'Something loved',
    person: 'Person', place: 'Place', song: 'Song', quote: 'Quote', lesson: 'Lesson'
  };
  var BASIS_LABELS = {
    author: 'Connected by the author',
    vector: 'Similar wording and subject',
    lexical: 'Shares words with'
  };

  // --- small helpers ------------------------------------------------------

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    if (kids) {
      if (!Array.isArray(kids)) kids = [kids];
      for (var j = 0; j < kids.length; j++) {
        var kid = kids[j];
        if (kid === null || kid === undefined || kid === false) continue;
        n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
      }
    }
    return n;
  }

  function collapse(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  function excerpt(body, length) {
    var flat = collapse(body);
    if (flat.length <= length) return flat;
    var window_ = flat.slice(0, length);
    var lastSpace = window_.lastIndexOf(' ');
    var cut = lastSpace > length * 0.6 ? window_.slice(0, lastSpace) : window_;
    return cut.replace(/\s+$/, '') + '…';
  }

  /* An untitled entry shows its own opening words, in italics. Never a
     fabricated placeholder, and never "Untitled" unless the body is empty. */
  function titleOf(e) {
    var t = collapse(e.title);
    if (t) return { text: t, excerpt: false, suggested: e.titleSource === 'suggested' };
    var body = collapse(e.body);
    if (!body) return { text: 'Untitled', excerpt: false, suggested: false };
    return { text: excerpt(body, 58), excerpt: true, suggested: false };
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (err) {
      return d.toISOString().slice(0, 10);
    }
  }

  function writtenYear(e) {
    var d = new Date(e.whenWritten);
    return isNaN(d.getTime()) ? 0 : d.getFullYear();
  }

  function yearFor(e) { return e.whenHappened || writtenYear(e); }

  function sortedEntries(list, newestFirst) {
    var copy = list.slice();
    copy.sort(function (a, b) {
      var ya = yearFor(a), yb = yearFor(b);
      if (ya !== yb) return newestFirst ? yb - ya : ya - yb;
      var wa = new Date(a.whenWritten).getTime() || 0;
      var wb = new Date(b.whenWritten).getTime() || 0;
      return newestFirst ? wb - wa : wa - wb;
    });
    return copy;
  }

  function suggestedBadge(what) {
    return el('span', { class: 'badge suggested', title: 'Suggested by software, kept by the author. The words of the entry itself are untouched.' }, 'suggested ' + what);
  }

  function clusterChip(e) {
    var c = e.clusterId ? clusterById[e.clusterId] : null;
    if (!c) return el('span', { class: 'meta-item', text: 'Unfiled' });
    var wrap = el('span', {}, [
      el('span', { class: 'dot', style: 'background:' + c.color }),
      ' ' + c.name
    ]);
    if (e.clusterSource === 'suggested') wrap.appendChild(document.createTextNode(' (suggested)'));
    return wrap;
  }

  // --- routing ------------------------------------------------------------

  var state = { view: 'timeline', id: null, q: '', cluster: null, year: null, newestFirst: false };

  function parseHash() {
    var raw = location.hash.replace(/^#\/?/, '');
    var parts = raw.split('?');
    var path = parts[0].split('/').filter(Boolean);
    var params = {};
    if (parts[1]) {
      parts[1].split('&').forEach(function (pair) {
        var kv = pair.split('=');
        params[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
      });
    }
    state.id = null;
    state.view = path[0] || 'timeline';
    if (state.view === 'entry') state.id = path[1] || null;
    state.q = params.q || '';
    state.cluster = params.cluster || null;
    state.year = params.year ? parseInt(params.year, 10) : null;
  }

  function go(hash) { location.hash = hash; }

  // --- shell --------------------------------------------------------------

  var root = document.getElementById('app');

  function tabs() {
    var items = [
      ['timeline', 'Timeline'],
      ['collections', 'Collections'],
      ['search', 'Search'],
      ['sky', 'Constellation'],
      ['about', 'About this archive']
    ];
    return el('nav', { class: 'tabs' }, items.map(function (it) {
      return el('a', {
        href: '#/' + it[0],
        'aria-current': state.view === it[0] ? 'true' : null
      }, it[1]);
    }));
  }

  function shell(content) {
    root.textContent = '';
    root.appendChild(el('header', { class: 'bar' }, el('div', { class: 'bar-inner' }, [
      el('a', { class: 'bar-title', href: '#/timeline', style: 'text-decoration:none;color:inherit' },
        ARCHIVE.title || 'An archive'),
      tabs()
    ])));
    var wrap = el('div', { class: 'wrap' });
    wrap.appendChild(content);
    wrap.appendChild(el('footer', { class: 'foot' }, [
      el('div', {}, ENTRIES.length + ' entries. ' +
        (DATA.edition === 'inheritance'
          ? 'This is the inheritance edition: entries the author marked private are not included.'
          : 'This is the author’s working copy: it includes private entries.')),
      el('div', {}, 'Built ' + fmtDate(DATA.builtAt) + '. If this page ever stops working, open archive.txt - the same archive as plain text.')
    ]));
    root.appendChild(wrap);
  }

  // --- entry list ---------------------------------------------------------

  function entryLink(e, snippet, terms) {
    var t = titleOf(e);
    /* The category marker is shown on the entry itself, not on every row in a
       list: an archive of thousands of entries would repeat the word
       "suggested" next to nearly all of them, which teaches a reader to skip
       past it - and the marker that has to survive is the one on a title. */
    var meta = el('div', { class: 'meta' }, [
      el('span', {}, KIND_LABELS[e.kind] || e.kind),
      el('span', {}, clusterChip(e)),
      el('span', {}, e.whenHappened ? 'About ' + e.whenHappened : 'Year not recorded'),
      el('span', {}, 'Written ' + fmtDate(e.whenWritten)),
      e.reflections && e.reflections.length
        ? el('span', {}, e.reflections.length + (e.reflections.length === 1 ? ' later note' : ' later notes'))
        : null,
      e.private ? el('span', { class: 'badge' }, 'private') : null
    ]);
    var titleNode = el('div', { class: 't' + (t.excerpt ? ' excerpt' : '') }, [t.text]);
    if (t.suggested) {
      titleNode.appendChild(document.createTextNode(' '));
      titleNode.appendChild(suggestedBadge('title'));
    }
    var kids = [titleNode, meta];
    if (snippet) kids.splice(1, 0, highlight(snippet, terms));
    return el('li', {}, el('a', { class: 'entry-link', href: '#/entry/' + e._id }, kids));
  }

  function highlight(text, terms) {
    var wrap = el('div', { class: 'snippet' });
    if (!terms || !terms.length) { wrap.textContent = text; return wrap; }
    var pattern = terms.map(function (t) { return t.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&'); }).join('|');
    var re = new RegExp('(' + pattern + ')', 'ig');
    var last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) wrap.appendChild(document.createTextNode(text.slice(last, m.index)));
      wrap.appendChild(el('mark', { text: m[0] }));
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < text.length) wrap.appendChild(document.createTextNode(text.slice(last)));
    return wrap;
  }

  /* Lists render in slices so a 5,000-entry archive opens instantly. */
  function renderList(container, list, opts) {
    opts = opts || {};
    var ul = el('ul', { class: 'entries' });
    container.appendChild(ul);
    var shown = 0;
    var step = opts.step || 120;
    var more = el('div', { style: 'margin-top:1.4rem' });
    container.appendChild(more);

    function draw() {
      var end = Math.min(list.length, shown + step);
      var lastYear = shown > 0 ? yearFor(list[shown - 1]) : null;
      for (var k = shown; k < end; k++) {
        var e = list[k];
        if (opts.groupByYear) {
          var y = yearFor(e);
          if (y !== lastYear) {
            var known = ENTRIES.length && list.filter(function (x) { return yearFor(x) === y; }).length;
            ul.appendChild(el('li', { style: 'border:0' }, el('div', { class: 'year-head' }, [
              String(y || 'Year not recorded'),
              el('span', {}, known + (known === 1 ? ' entry' : ' entries'))
            ])));
            lastYear = y;
          }
        }
        ul.appendChild(entryLink(e, opts.snippets ? opts.snippets[e._id] : null, opts.terms));
      }
      shown = end;
      more.textContent = '';
      if (shown < list.length) {
        more.appendChild(el('button', { onclick: draw }, 'Show ' + Math.min(step, list.length - shown) + ' more (' + (list.length - shown) + ' remaining)'));
      }
    }
    draw();
  }

  // --- views --------------------------------------------------------------

  function viewTimeline() {
    var box = el('div');
    box.appendChild(el('h2', { class: 'section' }, 'Everything, in order'));
    box.appendChild(el('p', { class: 'note' }, 'Grouped by the year each entry is about. Where no year was recorded, the year it was written is used instead. ' + ENTRIES.length + ' entries in total.'));
    box.appendChild(el('div', { class: 'chips' }, [
      el('button', {
        class: 'chip', 'aria-pressed': String(!state.newestFirst),
        onclick: function () { state.newestFirst = false; render(); }
      }, 'Oldest first'),
      el('button', {
        class: 'chip', 'aria-pressed': String(state.newestFirst),
        onclick: function () { state.newestFirst = true; render(); }
      }, 'Newest first')
    ]));
    var list = sortedEntries(ENTRIES, state.newestFirst);
    if (!list.length) box.appendChild(el('p', { class: 'empty' }, 'This archive has no entries.'));
    else renderList(box, list, { groupByYear: true });
    return box;
  }

  function viewCollections() {
    var box = el('div');
    box.appendChild(el('h2', { class: 'section' }, 'Collections'));
    box.appendChild(el('p', { class: 'note' }, 'The author grouped some entries and left others unfiled. Unfiled is not a backlog - it is simply where most writing lives.'));

    var counts = {};
    var unfiled = 0;
    for (var k = 0; k < ENTRIES.length; k++) {
      var cid = ENTRIES[k].clusterId;
      if (cid) counts[cid] = (counts[cid] || 0) + 1;
      else unfiled++;
    }

    var chips = el('div', { class: 'chips' });
    CLUSTERS.forEach(function (c) {
      chips.appendChild(el('button', {
        class: 'chip',
        'aria-pressed': String(state.cluster === c._id),
        onclick: function () { go('#/collections?cluster=' + encodeURIComponent(c._id)); }
      }, [el('span', { class: 'dot', style: 'background:' + c.color }), c.name + ' (' + (counts[c._id] || 0) + ')']));
    });
    if (unfiled) {
      chips.appendChild(el('button', {
        class: 'chip',
        'aria-pressed': String(state.cluster === 'unfiled'),
        onclick: function () { go('#/collections?cluster=unfiled'); }
      }, 'Unfiled (' + unfiled + ')'));
    }
    if (state.cluster) {
      chips.appendChild(el('button', { class: 'chip', onclick: function () { go('#/collections'); } }, 'Show all'));
    }
    box.appendChild(chips);

    box.appendChild(yearHistogram(box));

    var list = ENTRIES;
    if (state.cluster === 'unfiled') list = list.filter(function (e) { return !e.clusterId; });
    else if (state.cluster) list = list.filter(function (e) { return e.clusterId === state.cluster; });
    if (state.year) list = list.filter(function (e) { return yearFor(e) === state.year; });

    box.appendChild(el('p', { class: 'note' }, list.length + (list.length === 1 ? ' entry' : ' entries') + ' shown.'));
    if (!list.length) box.appendChild(el('p', { class: 'empty' }, 'Nothing here.'));
    else renderList(box, sortedEntries(list, state.newestFirst), { groupByYear: true });
    return box;
  }

  function yearHistogram() {
    var wrap = el('div', { class: 'hist-wrap' });
    var counts = {};
    for (var k = 0; k < ENTRIES.length; k++) {
      var y = writtenYear(ENTRIES[k]);
      if (y) counts[y] = (counts[y] || 0) + 1;
    }
    var years = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
    if (years.length < 2) return wrap;
    var max = 0;
    years.forEach(function (y) { if (counts[y] > max) max = counts[y]; });

    wrap.appendChild(el('h3', { style: 'font-size:1rem;margin:1.2rem 0 0.2rem' }, 'Entries written per year'));
    wrap.appendChild(el('p', { class: 'note', style: 'margin-bottom:0.4rem' },
      'This counts writing, not significance. A year with many entries was a year of writing; a quiet year may have been a happy one.'));
    var hist = el('div', { class: 'histogram' });
    years.forEach(function (y) {
      var h = Math.max(4, Math.round((counts[y] / max) * 84));
      hist.appendChild(el('button', {
        class: 'bar',
        style: 'height:' + h + 'px',
        'aria-pressed': String(state.year === y),
        title: counts[y] + ' written in ' + y,
        onclick: function () {
          var base = state.cluster ? '#/collections?cluster=' + encodeURIComponent(state.cluster) + '&' : '#/collections?';
          go(state.year === y ? base.replace(/[?&]$/, '') || '#/collections' : base + 'year=' + y);
        }
      }, el('span', {}, String(y).slice(2))));
    });
    wrap.appendChild(hist);
    return wrap;
  }

  var haystacks = null;
  function buildHaystacks() {
    if (haystacks) return haystacks;
    haystacks = ENTRIES.map(function (e) {
      return {
        e: e,
        body: (e.body || '').toLowerCase(),
        title: (e.title || '').toLowerCase(),
        attribution: (e.attribution || '').toLowerCase(),
        reflections: (e.reflections || []).map(function (r) { return r.text; }).join(' ').toLowerCase()
      };
    });
    return haystacks;
  }

  function countOf(hay, needle) {
    var n = 0, at = hay.indexOf(needle);
    while (at !== -1) { n++; at = hay.indexOf(needle, at + needle.length); }
    return n;
  }

  function viewSearch() {
    var box = el('div');
    box.appendChild(el('h2', { class: 'section' }, 'Search'));
    box.appendChild(el('p', { class: 'note' }, 'Searches the words of every entry, its later notes and any attribution. Nothing leaves this file.'));

    var input = el('input', { type: 'search', value: state.q, placeholder: 'A word, a name, a phrase…', autocomplete: 'off' });
    var form = el('form', { class: 'search-row', onsubmit: function (ev) { ev.preventDefault(); go('#/search?q=' + encodeURIComponent(input.value)); } }, [
      input,
      el('button', { type: 'submit' }, 'Search')
    ]);
    box.appendChild(form);
    setTimeout(function () { try { input.focus(); } catch (err) {} }, 0);

    var q = collapse(state.q);
    if (!q) {
      box.appendChild(el('p', { class: 'empty' }, 'Type something above. If you are not sure where to start, try a first name, or a place you know mattered.'));
      return box;
    }

    var terms = q.toLowerCase().split(/\s+/).filter(function (t) { return t.length > 1; });
    if (!terms.length) terms = [q.toLowerCase()];
    var hay = buildHaystacks();
    var results = [];
    var snippets = {};
    for (var k = 0; k < hay.length; k++) {
      var h = hay[k];
      var score = 0, matched = 0;
      for (var t = 0; t < terms.length; t++) {
        var inBody = countOf(h.body, terms[t]);
        var inTitle = countOf(h.title, terms[t]);
        var inAttr = countOf(h.attribution, terms[t]);
        var inRefl = countOf(h.reflections, terms[t]);
        if (inBody + inTitle + inAttr + inRefl > 0) matched++;
        score += Math.log(1 + inBody) + inTitle * 3 + inAttr * 2 + inRefl * 0.8;
      }
      if (!matched) continue;
      if (terms.length > 1 && h.body.indexOf(q.toLowerCase()) !== -1) score += 5;
      score *= 1 + matched / terms.length;
      results.push({ e: h.e, score: score });
      snippets[h.e._id] = snippetOf(h.e.body, terms);
    }
    results.sort(function (a, b) { return b.score - a.score; });

    box.appendChild(el('p', { class: 'note' }, results.length + (results.length === 1 ? ' entry mentions' : ' entries mention') + ' that.'));
    if (!results.length) {
      box.appendChild(el('p', { class: 'empty' }, 'Nothing matched. Try a shorter word, or a different spelling.'));
      return box;
    }
    renderList(box, results.map(function (r) { return r.e; }), { snippets: snippets, terms: terms, step: 60 });
    return box;
  }

  function snippetOf(body, terms) {
    var flat = collapse(body);
    var lower = flat.toLowerCase();
    var at = -1;
    for (var k = 0; k < terms.length; k++) {
      var i2 = lower.indexOf(terms[k]);
      if (i2 !== -1 && (at === -1 || i2 < at)) at = i2;
    }
    if (at === -1) return excerpt(flat, 180);
    var start = Math.max(0, at - 70);
    var end = Math.min(flat.length, at + 130);
    return (start > 0 ? '…' : '') + flat.slice(start, end).trim() + (end < flat.length ? '…' : '');
  }

  function viewEntry() {
    var e = byId[state.id];
    var box = el('div');
    if (!e) {
      box.appendChild(el('p', { class: 'empty' }, 'That entry is not in this archive.'));
      box.appendChild(el('button', { onclick: function () { go('#/timeline'); } }, 'Back to the timeline'));
      return box;
    }
    var t = titleOf(e);
    var article = el('article', { class: 'entry' });

    article.appendChild(el('div', { class: 'meta' }, [
      el('span', { class: 'badge' }, KIND_LABELS[e.kind] || e.kind),
      e.kindSource === 'suggested' ? suggestedBadge('category') : null,
      el('span', {}, clusterChip(e)),
      e.private ? el('span', { class: 'badge' }, 'private' ) : null
    ]));

    var h1 = el('h1', { class: t.excerpt ? 'excerpt' : null }, [t.text]);
    article.appendChild(h1);
    if (t.suggested) article.appendChild(el('div', {}, suggestedBadge('title')));
    if (t.excerpt) article.appendChild(el('p', { class: 'note', style: 'margin:0.3rem 0 0' }, 'This entry was never given a title. Those are its opening words.'));

    article.appendChild(el('div', { class: 'body' }, e.body));
    if (e.attribution) article.appendChild(el('div', { class: 'attribution' }, e.attribution));

    if (e.reflections && e.reflections.length) {
      var refl = el('div', { class: 'reflections' }, el('h3', {}, 'Later notes'));
      var ordered = e.reflections.slice().sort(function (a, b) {
        return (new Date(a.at).getTime() || 0) - (new Date(b.at).getTime() || 0);
      });
      ordered.forEach(function (r) {
        refl.appendChild(el('div', { class: 'reflection' }, [
          el('span', { class: 'when' }, fmtDate(r.at)),
          r.text
        ]));
      });
      refl.appendChild(el('p', { class: 'note', style: 'margin-top:0.8rem' }, 'Later notes were added after the entry was written. The entry itself was never changed.'));
      article.appendChild(refl);
    }

    var links = (e.related || []).filter(function (r) { return byId[r.entryId]; });
    if (links.length) {
      var conn = el('div', { class: 'connections' }, el('h3', {}, 'Nearby entries'));
      var ul = el('ul');
      links.forEach(function (r) {
        var other = byId[r.entryId];
        var ot = titleOf(other);
        ul.appendChild(el('li', {}, [
          el('a', { href: '#/entry/' + other._id, style: 'text-decoration:none' },
            el('span', { class: ot.excerpt ? 't excerpt' : 't' }, ot.text)),
          el('div', { class: 'basis' }, BASIS_LABELS[r.basis] || 'Shares words with')
        ]));
      });
      conn.appendChild(ul);
      conn.appendChild(el('p', { class: 'note', style: 'margin-top:0.8rem' },
        'Connections marked "similar wording" or "shares words" were found by software comparing words, not by anyone deciding these entries belong together. Two entries about the same person - one written in anger, one written afterwards - look alike to it.'));
      article.appendChild(conn);
    }

    var dates = el('div', { class: 'dates' }, el('h3', { style: 'font-size:1rem;margin:0 0 0.5rem' }, 'When'));
    var dl = el('dl', {}, [
      el('dt', {}, 'The year this is about'),
      el('dd', {}, e.whenHappened ? String(e.whenHappened) : 'Not recorded'),
      el('dt', {}, 'Written down'),
      el('dd', {}, fmtDate(e.whenWritten)),
      el('dt', {}, 'Last note added'),
      el('dd', {}, e.reflections && e.reflections.length
        ? fmtDate(e.reflections[e.reflections.length - 1].at)
        : 'None')
    ]);
    dates.appendChild(dl);
    article.appendChild(dates);

    box.appendChild(el('div', { style: 'margin-bottom:0.6rem' },
      el('button', { class: 'plain', onclick: function () { history.length > 1 ? history.back() : go('#/timeline'); } }, '← Back')));
    box.appendChild(article);
    return box;
  }

  function viewAbout() {
    var box = el('div', { class: 'prose' });
    box.appendChild(el('h2', { class: 'section' }, 'About this archive'));
    box.appendChild(el('p', {}, 'This is a personal archive: things one person wrote down over time - thoughts, stories, feelings, things they loved, people, places, songs, quotes and lessons.'));
    box.appendChild(el('p', {}, 'Nothing here was written by software. Where software suggested a title or a category, it is marked "suggested"; the words of the entries themselves were never edited, shortened or rewritten.'));
    box.appendChild(el('h3', {}, 'How to read it'));
    box.appendChild(el('ul', {}, [
      el('li', {}, 'Timeline - everything in order, grouped by year.'),
      el('li', {}, 'Collections - the groups the author made, plus everything left unfiled.'),
      el('li', {}, 'Search - look for a name, a place, a word.'),
      el('li', {}, 'Constellation - a map. Entries that share words sit near each other. Drag to move, scroll or pinch to zoom, click a star to read it.')
    ]));
    box.appendChild(el('h3', {}, 'Three different dates'));
    box.appendChild(el('p', {}, 'An entry can carry the year it is about, the date it was written down, and the dates of any later notes. They are kept apart on purpose: what someone believed in 2011 and what they concluded in 2019 are different things, and both are worth having.'));
    box.appendChild(el('h3', {}, 'If this page ever stops working'));
    box.appendChild(el('p', {}, 'Open archive.txt. It is the same archive in plain text and will open in any text editor on any computer, with no internet and no software to install. archive.json holds the same content in a structured form for anyone who wants to move it somewhere else.'));
    box.appendChild(el('p', {}, DATA.edition === 'inheritance'
      ? 'This is the inheritance edition. Entries the author marked private are not part of it.'
      : 'This is the working copy. It contains everything, including entries marked private.'));
    box.appendChild(el('p', { class: 'note' }, 'Built ' + fmtDate(DATA.builtAt) + ' with ' + (DATA.generator || 'Constellation') + '. Schema ' + (DATA.schema || 'unknown') + '.'));
    return box;
  }

  // --- constellation ------------------------------------------------------

  var sky = null;

  function viewSky() {
    var box = el('div');
    box.appendChild(el('h2', { class: 'section' }, 'Constellation'));
    box.appendChild(el('p', { class: 'note' }, 'Each point is one entry. Points that share words sit near each other; the glowing areas are the collections. Drag to move, scroll or pinch to zoom, click a point to read it. Nearness means similar words - nothing more.'));

    var wrap = el('div', { id: 'sky-wrap' });
    var canvas = el('canvas', { id: 'sky' });
    wrap.appendChild(canvas);
    var tip = el('div', { class: 'sky-tip' });
    wrap.appendChild(tip);
    wrap.appendChild(el('div', { class: 'sky-controls' }, [
      el('button', { onclick: function () { sky.zoomBy(1.4); } }, '+'),
      el('button', { onclick: function () { sky.zoomBy(1 / 1.4); } }, '−'),
      el('button', { onclick: function () { sky.fit(); } }, 'Fit')
    ]));
    wrap.appendChild(el('div', { class: 'sky-legend' }, ENTRIES.length + ' entries'));
    box.appendChild(wrap);
    var panel = el('div', { style: 'margin-top:1rem;min-height:3rem' });
    box.appendChild(panel);

    setTimeout(function () { sky = startSky(canvas, tip, panel); }, 0);
    return box;
  }

  function startSky(canvas, tip, panel) {
    var ctx = canvas.getContext('2d');
    if (!ctx) {
      panel.appendChild(el('p', { class: 'empty' }, 'This browser cannot draw the map. Use the Timeline or Search instead - they show the same entries.'));
      return { zoomBy: function () {}, fit: function () {} };
    }

    var stars = [];
    for (var k = 0; k < ENTRIES.length; k++) {
      var e = ENTRIES[k];
      var p = e.position || { x: 0, y: 0 };
      stars.push({
        id: e._id, x: p.x || 0, y: p.y || 0, e: e,
        color: (e.clusterId && clusterById[e.clusterId]) ? clusterById[e.clusterId].color : '#9fb0c8'
      });
    }
    if (!stars.length) {
      panel.appendChild(el('p', { class: 'empty' }, 'No entries to map.'));
      return { zoomBy: function () {}, fit: function () {} };
    }

    // Entries with no computed position would all sit on top of each other;
    // spread them deterministically so the map is still readable.
    var allZero = stars.every(function (s) { return s.x === 0 && s.y === 0; });
    if (allZero) {
      stars.forEach(function (s, idx) {
        var a = idx * 2.399963;
        var r = 26 * Math.sqrt(idx + 1);
        s.x = Math.cos(a) * r;
        s.y = Math.sin(a) * r;
      });
    }

    var index = {};
    var idxOf = {};
    stars.forEach(function (s, n) { idxOf[s.id] = n; });

    var edges = [];
    for (var m = 0; m < ENTRIES.length; m++) {
      var from = idxOf[ENTRIES[m]._id];
      var rel = ENTRIES[m].related || [];
      for (var r2 = 0; r2 < rel.length; r2++) {
        var to = idxOf[rel[r2].entryId];
        if (to === undefined || to <= from) continue;
        edges.push([from, to, rel[r2].basis === 'author' ? 1 : 0]);
      }
    }
    var edgesOf = {};
    edges.forEach(function (ed, n) {
      (edgesOf[ed[0]] = edgesOf[ed[0]] || []).push(n);
      (edgesOf[ed[1]] = edgesOf[ed[1]] || []).push(n);
    });

    /* Viewport culling. Without this a phone cannot pan 5,000 points. */
    var CELL = 220;
    function key(cx, cy) { return cx + ':' + cy; }
    stars.forEach(function (s, n) {
      var kk = key(Math.floor(s.x / CELL), Math.floor(s.y / CELL));
      (index[kk] = index[kk] || []).push(n);
    });

    var bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    stars.forEach(function (s) {
      if (s.x < bounds.minX) bounds.minX = s.x;
      if (s.y < bounds.minY) bounds.minY = s.y;
      if (s.x > bounds.maxX) bounds.maxX = s.x;
      if (s.y > bounds.maxY) bounds.maxY = s.y;
    });

    var cam = { x: 0, y: 0, scale: 1 };
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0;
    var dirty = true;
    var selected = null;
    var hovered = null;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      dirty = true;
    }

    function fit() {
      resize();
      var pad = 60;
      var bw = Math.max(1, bounds.maxX - bounds.minX);
      var bh = Math.max(1, bounds.maxY - bounds.minY);
      cam.scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
      if (!isFinite(cam.scale) || cam.scale <= 0) cam.scale = 1;
      cam.scale = Math.max(0.02, Math.min(cam.scale, 2));
      cam.x = (bounds.minX + bounds.maxX) / 2;
      cam.y = (bounds.minY + bounds.maxY) / 2;
      dirty = true;
    }

    function toScreen(x, y) {
      return [(x - cam.x) * cam.scale + w / 2, (y - cam.y) * cam.scale + h / 2];
    }
    function toWorld(sx, sy) {
      return [(sx - w / 2) / cam.scale + cam.x, (sy - h / 2) / cam.scale + cam.y];
    }

    function visibleStars() {
      var tl = toWorld(-40, -40);
      var br = toWorld(w + 40, h + 40);
      var out = [];
      var cx0 = Math.floor(tl[0] / CELL), cx1 = Math.floor(br[0] / CELL);
      var cy0 = Math.floor(tl[1] / CELL), cy1 = Math.floor(br[1] / CELL);
      for (var cx = cx0; cx <= cx1; cx++) {
        for (var cy = cy0; cy <= cy1; cy++) {
          var bucket = index[key(cx, cy)];
          if (!bucket) continue;
          for (var n = 0; n < bucket.length; n++) out.push(bucket[n]);
        }
      }
      return out;
    }

    function draw() {
      if (!dirty) return;
      dirty = false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0a0b10';
      ctx.fillRect(0, 0, w, h);

      // Regions: glow and name. Far out, this is all there is to see.
      for (var q = 0; q < REGIONS.length; q++) {
        var rg = REGIONS[q];
        var c = toScreen(rg.x, rg.y);
        var rad = Math.max(8, rg.radius * cam.scale);
        if (c[0] + rad < 0 || c[0] - rad > w || c[1] + rad < 0 || c[1] - rad > h) continue;
        var grad = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], rad);
        grad.addColorStop(0, hexToRgba(rg.color, 0.16));
        grad.addColorStop(1, hexToRgba(rg.color, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(c[0], c[1], rad, 0, Math.PI * 2);
        ctx.fill();
      }

      var vis = visibleStars();
      var showThreads = cam.scale > 0.16;
      var showLabels = cam.scale > 0.6 && vis.length < 420;

      /* The whole archive can be on screen at once, so the loops below
         transform inline (sx = x * scale + ox) rather than allocating a
         coordinate pair per point per frame, and batch points by colour. */
      var scale = cam.scale;
      var ox = w / 2 - cam.x * scale;
      var oy = h / 2 - cam.y * scale;

      if (showThreads) {
        var drawn = 0;
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(150,160,190,0.16)';
        ctx.beginPath();
        for (var v = 0; v < vis.length && drawn < 3500; v++) {
          var list = edgesOf[vis[v]];
          if (!list) continue;
          for (var z = 0; z < list.length; z++) {
            var ed = edges[list[z]];
            if (ed[0] !== vis[v]) continue;
            ctx.moveTo(stars[ed[0]].x * scale + ox, stars[ed[0]].y * scale + oy);
            ctx.lineTo(stars[ed[1]].x * scale + ox, stars[ed[1]].y * scale + oy);
            drawn++;
          }
        }
        ctx.stroke();
      }

      var baseR = scale < 0.25 ? 1.1 : scale < 0.6 ? 1.8 : 2.6;
      var buckets = {};
      for (var s2 = 0; s2 < vis.length; s2++) {
        var col = stars[vis[s2]].color;
        if (buckets[col]) buckets[col].push(vis[s2]);
        else buckets[col] = [vis[s2]];
      }
      ctx.globalAlpha = 0.9;
      for (var col2 in buckets) {
        if (!Object.prototype.hasOwnProperty.call(buckets, col2)) continue;
        var bucket = buckets[col2];
        ctx.fillStyle = col2;
        if (scale < 0.6) {
          var size = baseR * 2;
          for (var p1 = 0; p1 < bucket.length; p1++) {
            ctx.fillRect(stars[bucket[p1]].x * scale + ox - baseR, stars[bucket[p1]].y * scale + oy - baseR, size, size);
          }
        } else {
          ctx.beginPath();
          for (var p2 = 0; p2 < bucket.length; p2++) {
            var bx = stars[bucket[p2]].x * scale + ox;
            var by = stars[bucket[p2]].y * scale + oy;
            ctx.moveTo(bx + baseR, by);
            ctx.arc(bx, by, baseR, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      }
      if (showLabels) {
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = '#d8d2c4';
        ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
        for (var s3 = 0; s3 < vis.length; s3++) {
          var stl = stars[vis[s3]];
          ctx.fillText(titleOf(stl.e).text.slice(0, 34), stl.x * scale + ox + 6, stl.y * scale + oy + 3.5);
        }
      }
      ctx.globalAlpha = 1;

      // The selected star and its threads, bright.
      if (selected !== null && stars[selected]) {
        var sel = stars[selected];
        var list2 = edgesOf[selected] || [];
        ctx.strokeStyle = 'rgba(232,207,146,0.75)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (var z2 = 0; z2 < list2.length; z2++) {
          var ed2 = edges[list2[z2]];
          var a2 = toScreen(stars[ed2[0]].x, stars[ed2[0]].y);
          var b2 = toScreen(stars[ed2[1]].x, stars[ed2[1]].y);
          ctx.moveTo(a2[0], a2[1]);
          ctx.lineTo(b2[0], b2[1]);
        }
        ctx.stroke();
        var sp = toScreen(sel.x, sel.y);
        ctx.fillStyle = '#f4e6bd';
        ctx.beginPath();
        ctx.arc(sp[0], sp[1], baseR + 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      if (cam.scale < 0.6) {
        for (var q2 = 0; q2 < REGIONS.length; q2++) {
          var rg2 = REGIONS[q2];
          if (!rg2.count) continue;
          var c2 = toScreen(rg2.x, rg2.y);
          if (c2[0] < -100 || c2[0] > w + 100 || c2[1] < -40 || c2[1] > h + 40) continue;
          ctx.fillStyle = 'rgba(240,234,220,0.82)';
          ctx.font = '600 13px -apple-system, "Segoe UI", Roboto, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(rg2.name + ' (' + rg2.count + ')', c2[0], c2[1]);
          ctx.textAlign = 'left';
        }
      }
    }

    function loop() { draw(); requestAnimationFrame(loop); }

    function hexToRgba(hex, alpha) {
      var h2 = String(hex || '#9fb0c8').replace('#', '');
      if (h2.length === 3) h2 = h2[0] + h2[0] + h2[1] + h2[1] + h2[2] + h2[2];
      var num = parseInt(h2, 16);
      if (isNaN(num)) return 'rgba(159,176,200,' + alpha + ')';
      return 'rgba(' + ((num >> 16) & 255) + ',' + ((num >> 8) & 255) + ',' + (num & 255) + ',' + alpha + ')';
    }

    function nearest(sx, sy, maxPx) {
      var best = null, bestD = maxPx * maxPx;
      var vis = visibleStars();
      var ox = w / 2 - cam.x * cam.scale;
      var oy = h / 2 - cam.y * cam.scale;
      for (var n = 0; n < vis.length; n++) {
        var px = stars[vis[n]].x * cam.scale + ox;
        var py = stars[vis[n]].y * cam.scale + oy;
        var d = (px - sx) * (px - sx) + (py - sy) * (py - sy);
        if (d < bestD) { bestD = d; best = vis[n]; }
      }
      return best;
    }

    function select(n) {
      selected = n;
      dirty = true;
      panel.textContent = '';
      if (n === null) return;
      var e2 = stars[n].e;
      var t2 = titleOf(e2);
      panel.appendChild(el('div', {}, [
        el('div', { class: t2.excerpt ? 't excerpt' : 't' }, t2.text),
        el('div', { class: 'meta' }, [
          el('span', {}, KIND_LABELS[e2.kind] || e2.kind),
          el('span', {}, clusterChip(e2)),
          el('span', {}, e2.whenHappened ? 'About ' + e2.whenHappened : 'Year not recorded')
        ]),
        el('div', { style: 'margin-top:0.5rem' },
          el('a', { href: '#/entry/' + e2._id }, 'Read this entry →'))
      ]));
    }

    // --- interaction ------------------------------------------------------
    var pointers = {};
    var dragStart = null;
    var moved = 0;
    var pinchStart = null;

    canvas.addEventListener('pointerdown', function (ev) {
      canvas.setPointerCapture(ev.pointerId);
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(pointers);
      moved = 0;
      if (ids.length === 1) {
        dragStart = { sx: ev.clientX, sy: ev.clientY, cx: cam.x, cy: cam.y };
        canvas.className = 'dragging';
      } else if (ids.length === 2) {
        var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
        pinchStart = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y), scale: cam.scale };
        dragStart = null;
      }
    });

    canvas.addEventListener('pointermove', function (ev) {
      if (!pointers[ev.pointerId]) {
        var rect0 = canvas.getBoundingClientRect();
        var n0 = nearest(ev.clientX - rect0.left, ev.clientY - rect0.top, 14);
        if (n0 !== hovered) {
          hovered = n0;
          if (n0 === null) tip.style.display = 'none';
          else {
            var pt0 = toScreen(stars[n0].x, stars[n0].y);
            tip.textContent = titleOf(stars[n0].e).text;
            tip.style.display = 'block';
            tip.style.left = Math.min(Math.max(4, pt0[0] + 10), Math.max(4, w - 200)) + 'px';
            tip.style.top = Math.max(4, pt0[1] - 34) + 'px';
          }
        }
        return;
      }
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(pointers);
      if (ids.length >= 2 && pinchStart) {
        var q1 = pointers[ids[0]], q2 = pointers[ids[1]];
        var dist = Math.hypot(q1.x - q2.x, q1.y - q2.y);
        if (pinchStart.dist > 0) {
          cam.scale = Math.max(0.02, Math.min(8, pinchStart.scale * (dist / pinchStart.dist)));
          dirty = true;
        }
        moved = 99;
        return;
      }
      if (dragStart) {
        var dx = ev.clientX - dragStart.sx;
        var dy = ev.clientY - dragStart.sy;
        moved += Math.abs(dx) + Math.abs(dy);
        cam.x = dragStart.cx - dx / cam.scale;
        cam.y = dragStart.cy - dy / cam.scale;
        dirty = true;
      }
    });

    function endPointer(ev) {
      var wasDrag = dragStart;
      delete pointers[ev.pointerId];
      if (Object.keys(pointers).length < 2) pinchStart = null;
      if (Object.keys(pointers).length === 0) {
        canvas.className = '';
        dragStart = null;
        if (wasDrag && moved < 6) {
          var rect = canvas.getBoundingClientRect();
          select(nearest(ev.clientX - rect.left, ev.clientY - rect.top, 16));
        }
      }
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    canvas.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var rect = canvas.getBoundingClientRect();
      var before = toWorld(ev.clientX - rect.left, ev.clientY - rect.top);
      var factor = Math.exp(-ev.deltaY * 0.0016);
      cam.scale = Math.max(0.02, Math.min(8, cam.scale * factor));
      var after = toWorld(ev.clientX - rect.left, ev.clientY - rect.top);
      cam.x += before[0] - after[0];
      cam.y += before[1] - after[1];
      dirty = true;
    }, { passive: false });

    window.addEventListener('resize', resize);
    fit();
    loop();

    return {
      zoomBy: function (f) { cam.scale = Math.max(0.02, Math.min(8, cam.scale * f)); dirty = true; },
      fit: fit
    };
  }

  // --- render -------------------------------------------------------------

  function render() {
    var view;
    switch (state.view) {
      case 'entry': view = viewEntry(); break;
      case 'collections': view = viewCollections(); break;
      case 'search': view = viewSearch(); break;
      case 'sky': view = viewSky(); break;
      case 'about': view = viewAbout(); break;
      default: view = viewTimeline();
    }
    shell(view);
    if (state.view !== 'entry') window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', function () { parseHash(); render(); });

  // --- the opening message comes first, always ----------------------------

  var openingEl = document.getElementById('opening');
  var enter = document.getElementById('enter');
  function enterArchive() {
    openingEl.style.display = 'none';
    root.style.display = 'block';
    if (!location.hash) location.hash = '#/timeline';
    parseHash();
    render();
  }
  enter.addEventListener('click', enterArchive);
  if (location.hash && location.hash !== '#' && location.hash !== '#/') {
    enterArchive();
  }
})();
`;
