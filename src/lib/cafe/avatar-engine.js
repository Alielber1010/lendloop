/*!
 * Café Radio Avatar Engine v1
 * Original chibi pixel-art avatars built from layered, mix-and-match parts.
 * No dependencies. Works in the browser (window.CafeAvatar) and in Node (module.exports).
 *
 * Sprite grid: 32 x 40 px. Big head (16x16), small body, colored outlines, auto shading.
 * Every part is a mask + colors; the engine outlines, shades and stacks the layers.
 *
 * Public API
 *   CafeAvatar.W, CafeAvatar.H                      sprite size
 *   CafeAvatar.SLOTS                                slot list for editors
 *   CafeAvatar.items(slot) / getItem(slot, id)      catalog
 *   CafeAvatar.palette(name)                        [{hex, rarity}]
 *   CafeAvatar.defaultAvatar()                      a starting avatar
 *   CafeAvatar.compose(avatar, {pose, blink})       -> Array(W*H) of '#rrggbb' | null
 *   CafeAvatar.draw(ctx2d, avatar, {pose, blink, scale, x, y, shadow})
 *   CafeAvatar.frame(anim, timeMs, seed)            -> {pose, blink}  (anim: idle|walk|sit|wave)
 *   CafeAvatar.encode(avatar) / decode(code)        compact shareable code
 *   CafeAvatar.RARITIES                             [{id:'basic'},{id:'mid'},{id:'legendary'}]
 *   CafeAvatar.roll(seed?, {odds})                  one avatar + its rarity report  (odds: {basic:70, mid:25, legendary:5})
 *   CafeAvatar.generate({count, odds, seed})        many of those
 *   CafeAvatar.rollItem({odds, slot, seed})         one random item and its rarity (for drops/rewards later)
 *   CafeAvatar.wornParts(avatar) / avatarRarity(avatar)   what it wears, and its overall rarity (3+ legendary parts = Legendary, 3+ mid-or-better = Mid)
 *
 * Rarity labels: 'basic' | 'mid' | 'legendary'. Labels only: the engine locks nothing.
 * Who may wear what (unlocks, purchases, Regulars rewards) is a separate layer to add later.
 */
(function (root) {
  'use strict';

  var W = 32, H = 40;
  function idx(x, y) { return y * W + x; }
  function M() { return new Uint8Array(W * H); }
  function inb(x, y) { return x >= 0 && x < W && y >= 0 && y < H; }
  function set(m, x, y) { if (inb(x, y)) m[idx(x, y)] = 1; }
  function get(m, x, y) { return inb(x, y) && m[idx(x, y)] === 1; }
  function spans(m, list, dy) { dy = dy || 0; for (var i = 0; i < list.length; i++) { var s = list[i]; for (var x = s[1]; x <= s[2]; x++) set(m, x, s[0] + dy); } return m; }
  function rect(m, x0, y0, x1, y1, dy) { dy = dy || 0; for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) set(m, x, y + dy); return m; }
  function pts(m, list, dy) { dy = dy || 0; for (var i = 0; i < list.length; i++) set(m, list[i][0], list[i][1] + dy); return m; }
  function union(a, b) { for (var i = 0; i < a.length; i++) if (b[i]) a[i] = 1; return a; }
  function sub(a, b) { for (var i = 0; i < a.length; i++) if (b[i]) a[i] = 0; return a; }
  function mirrorSpans(list) { var out = list.slice(); for (var i = 0; i < list.length; i++) { var s = list[i]; out.push([s[0], 31 - s[2], 31 - s[1]]); } return out; }
  function mirrorPts(list) { var out = list.slice(); for (var i = 0; i < list.length; i++) out.push([31 - list[i][0], list[i][1]]); return out; }
  function ellipse(m, cx, cy, rx, ry) {
    for (var y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (var x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        var dx = (x - cx) / rx, d2 = (y - cy) / ry;
        if (dx * dx + d2 * d2 <= 1) set(m, x, y);
      }
    return m;
  }
  function shift(list, dy) { return list.map(function (p) { return [p[0], p[1] + dy]; }); }

  /* ---------------------------------------------------------------- color */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function hexToHsl(hex) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      var d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s * 100, l * 100];
  }
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    var k = function (n) { return (n + h / 30) % 12; }, a = s * Math.min(l, 1 - l);
    var f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); };
    var hx = function (v) { return ('0' + Math.round(v * 255).toString(16)).slice(-2); };
    return '#' + hx(f(0)) + hx(f(8)) + hx(f(4));
  }
  function towardHue(h, target, amt) { var d = ((target - h + 540) % 360) - 180; return (h + Math.sign(d) * Math.min(Math.abs(d), amt) + 360) % 360; }
  function mix(a, b, t) {
    var na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
    var c = [16, 8, 0].map(function (sh) { var x = (na >> sh) & 255, y = (nb >> sh) & 255; return Math.round(x + (y - x) * t); });
    return '#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }
  var rampCache = {};
  // Hue-shifted ramp: shadows lean cool, highlights lean warm, outline is a deep tint of the color itself.
  function ramp(hex) {
    if (rampCache[hex]) return rampCache[hex];
    var hsl = hexToHsl(hex), h = hsl[0], s = hsl[1], l = hsl[2];
    var r = {
      base: hex,
      shade: hslToHex(towardHue(h, 245, 12), clamp(s + 8, 0, 100), clamp(l - 14, 3, 92)),
      deep: hslToHex(towardHue(h, 245, 18), clamp(s + 10, 0, 100), clamp(l - 26, 3, 85)),
      hl: hslToHex(towardHue(h, 55, 10), clamp(s - 4, 0, 100), clamp(l + 12, 6, 97)),
      outline: hslToHex(towardHue(h, 250, 20), clamp(s * 0.65 + 12, 0, 80), clamp(l * 0.28, 7, 22))
    };
    rampCache[hex] = r;
    return r;
  }

  /* ---------------------------------------------------------------- palettes */
  var PALETTES = {
    skin: [
      ['#FDE3CC', 'basic'], ['#F5CDAE', 'basic'], ['#ECB892', 'basic'], ['#DDA07A', 'basic'],
      ['#C3855D', 'basic'], ['#A46A45', 'basic'], ['#83502F', 'basic'], ['#5F3820', 'basic'],
      ['#A8D89A', 'legendary'], ['#9CC4F0', 'legendary'], ['#C9AEF0', 'legendary'],
      // animal fur
      ['#F7F3EA', 'legendary'], ['#E8873A', 'legendary']
    ],
    hair: [
      ['#2B2228', 'basic'], ['#4B2F22', 'basic'], ['#7A4A2C', 'basic'], ['#A04E28', 'basic'],
      ['#D97A32', 'basic'], ['#E9C35E', 'basic'], ['#F1E3BE', 'basic'], ['#A9A29C', 'basic'], ['#F4F1EC', 'basic'],
      ['#F28DB4', 'legendary'], ['#5B8DEF', 'legendary'], ['#62D2AE', 'legendary'], ['#9B6BE0', 'legendary']
    ],
    eyes: [
      ['#6B4226', 'basic'], ['#3A2A22', 'basic'], ['#8A6A2E', 'basic'], ['#3F8A55', 'basic'],
      ['#3D74C4', 'basic'], ['#7C8A96', 'basic'],
      ['#D84A5A', 'legendary'], ['#8E5BD6', 'legendary'], ['#E0A82E', 'legendary']
    ],
    cloth: [
      ['#F25F5C', 'basic'], ['#F2A93B', 'basic'], ['#FFE066', 'basic'], ['#70C1B3', 'basic'],
      ['#4F8A4B', 'basic'], ['#2F5D50', 'basic'], ['#3E5C76', 'basic'], ['#5B8DEF', 'basic'],
      ['#7B8CDE', 'basic'], ['#F2B5C4', 'basic'], ['#9B2C3A', 'basic'], ['#8A5A3C', 'basic'],
      ['#2F3138', 'basic'], ['#C9CBD4', 'basic'], ['#F5EFE6', 'basic'],
      ['#E8B04B', 'mid'], ['#B794F6', 'mid'], ['#FF7AB6', 'legendary'], ['#2EE6C5', 'legendary']
    ]
  };
  function palette(name) { return (PALETTES[name] || []).map(function (p) { return { hex: p[0], rarity: p[1] }; }); }
  function colorRarity(name, hex) {
    var p = PALETTES[name] || [];
    for (var i = 0; i < p.length; i++) if (p[i][0].toLowerCase() === String(hex).toLowerCase()) return p[i][1];
    return null; // not in palette = not allowed
  }

  /* ---------------------------------------------------------------- body geometry */
  var HEAD = [[5, 11, 20], [6, 9, 22]];
  for (var hy = 7; hy <= 18; hy++) HEAD.push([hy, 8, 23]);
  HEAD.push([19, 9, 22], [20, 11, 20]);
  var EARS = [[7, 12], [7, 13], [7, 14], [24, 12], [24, 13], [24, 14]];

  // pose: stand | breathe | walkA | walkB | sit | wave | wave2
  function geometry(pose) {
    var dy = 0;
    if (pose === 'sit') dy = 3;
    if (pose === 'walkA') dy = -1;
    if (pose === 'breathe') dy = 1;
    var g = { pose: pose, dy: dy };
    g.waist = 30 + dy;
    g.torso = { x0: 11, x1: 20, y0: 22 + dy, y1: 30 + dy };
    var armRow = function (x0, y) { return [[x0, y], [x0 + 1, y]]; };
    g.armL = []; for (var y = 23; y <= 29; y++) g.armL.push(armRow(9, y + dy));
    g.handL = [[9, 30 + dy], [10, 30 + dy], [9, 31 + dy], [10, 31 + dy]];
    if (pose === 'wave' || pose === 'wave2') {
      var o = pose === 'wave2' ? 1 : 0;
      // arm swings out past the head so the waving hand reads clearly
      g.armR = [armRow(21, 23 + dy), armRow(22, 22 + dy), armRow(23, 21 + dy), armRow(24, 20 + dy),
        armRow(25 + o, 19 + dy), armRow(25 + o, 18 + dy), armRow(25 + o, 17 + dy)];
      g.handR = [];
      for (var wy = 14; wy <= 16; wy++) for (var wx = 25 + o; wx <= 27 + o; wx++) g.handR.push([wx, wy + dy]);
      g.handR.push([24 + o, 16 + dy]);
      g.waving = true;
    } else {
      g.armR = []; for (var ry = 23; ry <= 29; ry++) g.armR.push(armRow(21, ry + dy));
      g.handR = [[21, 30 + dy], [22, 30 + dy], [21, 31 + dy], [22, 31 + dy]];
    }
    var legTop = g.waist + 1, lFoot = 37, rFoot = 37;
    if (pose === 'walkA') lFoot = 35;
    if (pose === 'walkB') rFoot = 35;
    g.legL = []; for (var ly = legTop; ly < lFoot; ly++) g.legL.push([[12, ly], [13, ly], [14, ly]]);
    g.legR = []; for (var ly2 = legTop; ly2 < rFoot; ly2++) g.legR.push([[17, ly2], [18, ly2], [19, ly2]]);
    g.footL = []; g.footR = [];
    for (var f = 0; f < 2; f++) {
      for (var fx = 11; fx <= 14; fx++) g.footL.push([fx, lFoot + f]);
      for (var fx2 = 17; fx2 <= 20; fx2++) g.footR.push([fx2, rFoot + f]);
    }
    g.footTopL = lFoot; g.footTopR = rFoot;
    return g;
  }
  function flat(rows) { var out = []; rows.forEach(function (r) { r.forEach(function (p) { out.push(p); }); }); return out; }
  function feetMask(g) { return pts(pts(M(), g.footL), g.footR); }
  function legsMask(g, n) {
    var m = M();
    var take = function (leg) { (n == null ? leg : leg.slice(0, n)).forEach(function (r) { r.forEach(function (p) { set(m, p[0], p[1]); }); }); };
    take(g.legL); take(g.legR);
    return m;
  }
  function sleeves(g, n) {
    var m = M();
    [g.armL, g.armR].forEach(function (arm) { arm.slice(0, n).forEach(function (r) { r.forEach(function (p) { set(m, p[0], p[1]); }); }); });
    return m;
  }
  function torso(g) { return rect(M(), 11, 22, 20, 30, g.dy); }
  function collar(g) { return pts(M(), [[14, 22], [15, 22], [16, 22], [17, 22]], g.dy); }
  function neckZone(g) { return rect(M(), 13, 20, 18, 22, g.dy); }
  function waistMask(g) { var m = rect(M(), 11, g.waist, 20, g.waist); set(m, 15, g.waist + 1); set(m, 16, g.waist + 1); return m; }

  /* ---------------------------------------------------------------- catalog */
  // Layer: { z, mask, key|pattern(x,y)->key, texture(x,y)->'shade'|'hl'|'deep'|null, flat, outline:false,
  //          noOutline: mask, details:[[x,y,'c1.shade'|'#hex'|'skin.outline'...]], tone:'shade' }
  // Z order: 0 back item, 1 back hair, 2 skin, 3 bottom, 4 shoes, 5 top, 6 over-top bottoms,
  //          7 neck, 8 face, 9 front hair, 10 hat, 11 glasses, 12 held item
  var CAT = {};
  function add(slot, def) { def.slot = slot; (CAT[slot] = CAT[slot] || []).push(def); }
  var NONE = function (slot, name) { add(slot, { id: 'none', name: name || 'None', rarity: 'basic', colors: 0, build: function () { return []; } }); };

  /* ---- eyes ---- */
  function eyePixels(style, x0, side, ctx) {
    var r = ramp(ctx.c1), K = ctx.lash, Wt = '#FFFFFF', out = [], dy = ctx.dy;
    var p = function (x, y, c) { out.push([x, y + dy, c]); };
    if (ctx.blink && style !== 'happy') { p(x0, 14, K); p(x0 + 1, 14, K); p(x0 + 2, 14, K); return out; }
    if (style === 'happy') { p(x0, 14, K); p(x0 + 1, 13, K); p(x0 + 2, 14, K); return out; }
    if (style === 'bead') { for (var by = 13; by <= 15; by++) { p(x0 + 1, by, K); p(x0 + 2, by, K); } p(x0 + 1, 13, ramp(K).hl); return out; }
    if (style === 'sleepy') { p(x0, 14, K); p(x0 + 1, 14, K); p(x0 + 2, 14, K); p(x0, 13, ctx.skinShade); p(x0 + 1, 13, ctx.skinShade); p(x0 + 2, 13, ctx.skinShade); p(x0 + 1, 15, r.base); return out; }
    var top = style === 'big' ? 11 : 12;
    for (var x = x0; x <= x0 + 2; x++) p(x, top, K);
    if (style === 'lash') { p(side < 0 ? x0 - 1 : x0 + 3, 12, K); p(side < 0 ? x0 - 1 : x0 + 3, 11, K); }
    if (style === 'big') { p(x0, 12, Wt); p(x0 + 1, 12, r.base); p(x0 + 2, 12, r.base); }
    p(x0, 13, Wt); p(x0 + 1, 13, r.base); p(x0 + 2, 13, r.base);
    p(x0, 14, r.base); p(x0 + 1, 14, r.outline); p(x0 + 2, 14, r.base);
    p(x0, 15, r.hl); p(x0 + 1, 15, r.base); p(x0 + 2, 15, style === 'sparkle' ? Wt : r.base);
    if (style === 'sparkle') { p(x0 + 1, 14, r.deep); }
    return out;
  }
  function eyeItem(id, name, rarity, leftStyle, rightStyle) {
    add('eyes', { id: id, name: name, rarity: rarity, colors: 1, palette: 'eyes', defaults: { c1: '#6B4226' },
      build: function (g, ctx) {
        var d = eyePixels(leftStyle, 10, -1, ctx).concat(eyePixels(rightStyle || leftStyle, 19, 1, ctx));
        return [{ z: 8, details: d }];
      } });
  }
  eyeItem('round', 'Round', 'basic', 'round');
  eyeItem('lash', 'Lashes', 'basic', 'lash');
  eyeItem('happy', 'Happy', 'basic', 'happy');
  eyeItem('sleepy', 'Sleepy', 'basic', 'sleepy');
  eyeItem('big', 'Big', 'mid', 'big');
  eyeItem('wink', 'Wink', 'mid', 'round', 'happy');
  eyeItem('sparkle', 'Sparkle', 'legendary', 'sparkle');
  eyeItem('bead', 'Button eyes', 'mid', 'bead');

  /* ---- mouth ---- */
  function mouthItem(id, name, rarity, fn) {
    add('mouth', { id: id, name: name, rarity: rarity, colors: 0, build: function (g, ctx) {
      var out = []; fn(function (x, y, c) { out.push([x, y + ctx.dy, c || ctx.mouth]); }, ctx); return [{ z: 8, details: out }];
    } });
  }
  mouthItem('smile', 'Smile', 'basic', function (p) { p(14, 18); p(15, 19); p(16, 19); p(17, 18); });
  mouthItem('small', 'Small', 'basic', function (p) { p(15, 19); p(16, 19); });
  mouthItem('open', 'Open', 'basic', function (p) { p(15, 18); p(16, 18); p(15, 19, '#D9646A'); p(16, 19, '#D9646A'); });
  mouthItem('pout', 'Pout', 'basic', function (p) { p(15, 19); p(16, 18); });
  mouthItem('grin', 'Grin', 'mid', function (p) { p(13, 17); p(14, 18); p(15, 18, '#FFFFFF'); p(16, 18, '#FFFFFF'); p(17, 18); p(18, 17); p(15, 19); p(16, 19); });
  mouthItem('tongue', 'Cheeky', 'mid', function (p) { p(14, 18); p(15, 19); p(16, 19); p(17, 18); p(16, 20, '#E07A86'); });
  mouthItem('cat', 'Cat', 'legendary', function (p) { p(13, 18); p(14, 19); p(15, 18); p(16, 18); p(17, 19); p(18, 18); });
  // Animal snout: a dark nose over a small "w" mouth.
  mouthItem('snout', 'Snout', 'mid', function (p) { p(15, 16, '#2B2228'); p(16, 16, '#2B2228'); p(15, 17, '#2B2228'); p(16, 17, '#4A3A40'); p(14, 18); p(15, 19); p(16, 19); p(17, 18); });
  // Kitty: a little yellow button nose and no mouth.
  mouthItem('kittynose', 'Button nose', 'legendary', function (p) { p(15, 16, '#F7CF4A'); p(16, 16, '#F7CF4A'); p(15, 17, '#E0A82E'); p(16, 17, '#E0A82E'); });

  /* ---- cheeks ---- */
  NONE('cheeks');
  add('cheeks', { id: 'blush', name: 'Blush', rarity: 'basic', colors: 0, build: function (g, ctx) {
    var c = mix(ctx.skin, '#F0606E', 0.42), d = ctx.dy;
    return [{ z: 8, details: [[9, 16 + d, c], [10, 16 + d, c], [21, 16 + d, c], [22, 16 + d, c]] }];
  } });
  add('cheeks', { id: 'freckles', name: 'Freckles', rarity: 'basic', colors: 0, build: function (g, ctx) {
    var c = ramp(ctx.skin).deep, d = ctx.dy;
    return [{ z: 8, details: [[9, 16 + d, c], [11, 17 + d, c], [10, 18 + d, c], [22, 16 + d, c], [20, 17 + d, c], [21, 18 + d, c]] }];
  } });
  add('cheeks', { id: 'stars', name: 'Star cheeks', rarity: 'legendary', colors: 0, build: function (g, ctx) {
    var c = '#FFD34E', d = ctx.dy;
    return [{ z: 8, details: [[9, 17 + d, c], [10, 16 + d, c], [10, 17 + d, c], [11, 17 + d, c], [10, 18 + d, c], [21, 17 + d, c], [22, 16 + d, c], [22, 17 + d, c], [23, 17 + d, c], [22, 18 + d, c]] }];
  } });

  // Animal face markings. z 7.5 paints them under the eyes and mouth (z 8).
  add('cheeks', { id: 'panda', name: 'Panda patches', rarity: 'legendary', colors: 0, build: function (g) {
    var d = g.dy, m = union(ellipse(M(), 11, 13.6 + d, 2.6, 2.9), ellipse(M(), 20, 13.6 + d, 2.6, 2.9));
    return [{ z: 7.5, mask: m, key: '#2B2228', outline: false }];
  } });
  add('cheeks', { id: 'muzzle', name: 'Fox muzzle', rarity: 'legendary', colors: 0, build: function (g) {
    var d = g.dy, m = ellipse(M(), 15.5, 17.6 + d, 5.2, 2.6);
    return [{ z: 7.5, mask: m, key: '#F7F3EA', outline: false },
      { z: 7.6, details: [[9, 16 + d, '#F7F3EA'], [22, 16 + d, '#F7F3EA']] }];
  } });
  add('cheeks', { id: 'whiskers', name: 'Whiskers', rarity: 'mid', colors: 0, build: function (g) {
    var d = g.dy, c = '#2B2228';
    return [{ z: 8, details: mirrorPts([[4, 15], [5, 15], [6, 15], [4, 17], [5, 17], [6, 17]]).map(function (p) { return [p[0], p[1] + d, c]; }) }];
  } });

  /* ---- hair ---- */
  var CAP = [[2, 12, 19], [3, 10, 21], [4, 9, 22], [5, 8, 23], [6, 7, 24], [7, 7, 24], [8, 7, 24]];
  function hairItem(id, name, rarity, front, back, extra) {
    add('hair', { id: id, name: name, rarity: rarity, colors: 1, palette: 'hair', defaults: { c1: '#4B2F22' },
      build: function (g, ctx) {
        var L = [];
        if (back) L.push(Object.assign({ z: 1, mask: spansOrMask(back, g), key: 'c1' }, (extra && extra.back) || {}));
        if (front) L.push(Object.assign({ z: 9, mask: spansOrMask(front, g), key: 'c1', texture: strands }, (extra && extra.front) || {}));
        if (extra && extra.layers) extra.layers(g, ctx).forEach(function (l) { L.push(l); });
        return L;
      } });
  }
  function spansOrMask(def, g) { return typeof def === 'function' ? def(g) : spans(M(), def, g.dy); }
  // a soft shine band on hair: 2 px highlight row segment on the upper left
  function strands(x, y, m, dy) {
    var ry = y - dy;
    if ((ry === 4 && x >= 10 && x <= 12) || (ry === 5 && x >= 9 && x <= 10)) return 'hl';
    return null;
  }

  hairItem('short', 'Short', 'basic', CAP.concat([[9, 7, 24], [10, 7, 12], [10, 18, 24], [11, 7, 9], [11, 22, 24], [12, 7, 8], [12, 23, 24]]));
  hairItem('messy', 'Messy', 'basic', [[0, 11, 11], [0, 18, 18], [1, 10, 12], [1, 14, 15], [1, 17, 19], [2, 9, 22], [3, 8, 23], [4, 7, 24], [5, 7, 24],
    [6, 6, 25], [7, 6, 25], [8, 7, 24], [9, 7, 24], [10, 7, 10], [10, 12, 14], [10, 17, 19], [10, 21, 24], [11, 7, 8], [11, 13, 13], [11, 18, 18], [11, 23, 24], [12, 7, 7], [12, 24, 24]]);
  var BOB_FRONT = CAP.concat([[9, 7, 24], [10, 7, 24]]);
  var bobSides = []; for (var by = 11; by <= 19; by++) bobSides.push([by, 6, 8], [by, 23, 25]);
  hairItem('bob', 'Bob', 'basic', BOB_FRONT.concat(bobSides, [[20, 7, 9], [20, 22, 24]]));
  var longSides = []; for (var ly3 = 11; ly3 <= 21; ly3++) longSides.push([ly3, 6, 8], [ly3, 23, 25]);
  var longBack = []; for (var lb = 8; lb <= 27; lb++) longBack.push([lb, 5, 26]);
  longBack.push([28, 6, 25], [29, 7, 24], [30, 9, 22]);
  hairItem('long', 'Long', 'basic', BOB_FRONT.concat(longSides), longBack);
  var tail = [[6, 25, 26], [7, 25, 27], [8, 25, 28]];
  for (var ty = 9; ty <= 16; ty++) tail.push([ty, 26, 29]);
  tail.push([17, 26, 28], [18, 26, 28], [19, 27, 28], [20, 27, 27]);
  hairItem('ponytail', 'Ponytail', 'basic', CAP.concat([[9, 7, 24], [10, 7, 11], [10, 20, 24], [11, 7, 8], [11, 23, 24], [12, 7, 7], [12, 24, 24]]), tail,
    { back: { details: null }, layers: function (g) { return [{ z: 9, details: [[25, 7 + g.dy, '#F25F5C'], [25, 8 + g.dy, '#F25F5C']] }]; } });
  hairItem('buzz', 'Buzz', 'basic', [[3, 11, 20], [4, 9, 22], [5, 8, 23], [6, 8, 23], [7, 8, 9], [7, 22, 23]], null,
    { front: { texture: function (x, y) { return (x + y) % 2 === 0 ? 'shade' : null; } } });
  hairItem('curly', 'Curly', 'basic',
    CAP.concat([[9, 7, 10], [9, 13, 18], [9, 21, 24], [10, 8, 9], [10, 14, 17], [10, 22, 23]]),
    function (g) { return ellipse(M(), 15.5, 9 + g.dy, 12.6, 10.4); },
    { back: { texture: function (x, y) { return (x * 3 + y * 5) % 7 === 0 ? 'shade' : ((x * 5 + y * 3) % 11 === 0 ? 'hl' : null); } },
      front: { texture: function (x, y) { return (x * 3 + y * 5) % 7 === 0 ? 'shade' : null; } } });
  hairItem('sidepart', 'Side part', 'mid', CAP.concat([[9, 7, 24], [10, 7, 19], [10, 23, 24], [11, 7, 15], [11, 23, 24], [12, 7, 11], [13, 7, 9], [14, 7, 8]]));
  hairItem('bun', 'Bun', 'mid', CAP.concat([[9, 7, 24], [10, 7, 12], [10, 18, 24], [11, 7, 9], [11, 22, 24], [12, 7, 8], [12, 23, 24]]), null,
    { layers: function (g) { return [{ z: 9, mask: spans(M(), [[0, 13, 18], [1, 12, 19], [2, 12, 19], [3, 13, 18]], g.dy), key: 'c1' }]; } });
  hairItem('spiky', 'Spiky', 'mid', [[0, 9, 9], [0, 15, 16], [0, 22, 22], [1, 9, 10], [1, 14, 17], [1, 21, 22], [2, 9, 22], [3, 8, 23], [4, 7, 24],
    [5, 5, 26], [6, 4, 27], [7, 6, 25], [8, 7, 24], [9, 7, 24], [10, 8, 10], [10, 14, 17], [10, 21, 23], [11, 9, 9], [11, 15, 16], [11, 22, 22], [12, 15, 16]]);
  hairItem('mohawk', 'Mohawk', 'mid', [[0, 14, 17], [1, 13, 18], [2, 13, 18], [3, 13, 18], [4, 13, 18], [5, 13, 18], [6, 14, 17]], null,
    { layers: function (g) { return [{ z: 9, mask: spans(M(), [[4, 10, 21], [5, 8, 23], [6, 8, 23], [7, 8, 9], [7, 22, 23]], g.dy), key: 'c1', flat: true, tone: 'shade', outline: false, under: true }]; } });
  var twinBack = [[7, 5, 7], [8, 4, 7], [9, 3, 6], [10, 2, 6], [11, 1, 5]];
  for (var tw = 12; tw <= 20; tw++) twinBack.push([tw, 1, 5]);
  twinBack.push([21, 2, 5], [22, 2, 4], [23, 3, 4], [24, 3, 3]);
  hairItem('twintails', 'Twin tails', 'legendary', BOB_FRONT.concat([[11, 7, 8], [11, 23, 24], [12, 7, 8], [12, 23, 24], [13, 7, 7], [13, 24, 24]]), mirrorSpans(twinBack),
    { layers: function (g) { var d = g.dy; return [{ z: 9, details: [[6, 8 + d, '#F28DB4'], [6, 9 + d, '#F28DB4'], [25, 8 + d, '#F28DB4'], [25, 9 + d, '#F28DB4']] }]; } });
  hairItem('flow', 'Flowing', 'legendary',
    CAP.concat([[9, 7, 24], [10, 7, 17], [10, 21, 24], [11, 7, 13], [11, 22, 24], [12, 7, 10], [12, 23, 25]], (function () { var s = []; for (var y = 13; y <= 23; y++) s.push([y, 6, 8], [y, 23, 25]); return s; })()),
    (function () { var s = []; for (var y = 6; y <= 32; y++) s.push([y, y < 10 ? 6 : 4, y < 10 ? 25 : 27]); s.push([33, 6, 25], [34, 9, 22]); return s; })());
  NONE('hair', 'Bald');

  /* ---- tops ---- */
  function topItem(id, name, rarity, colors, defaults, maskFn, more) {
    add('top', { id: id, name: name, rarity: rarity, colors: colors, palette: 'cloth', defaults: defaults,
      build: function (g, ctx) {
        var m = maskFn(g);
        var layer = Object.assign({ z: 5, mask: m, key: 'c1', noOutline: neckZone(g) }, more ? more(g, ctx, m) : {});
        return [layer];
      } });
  }
  topItem('tee', 'T-shirt', 'basic', 1, { c1: '#70C1B3' }, function (g) { return sub(union(torso(g), sleeves(g, 3)), collar(g)); });
  topItem('tank', 'Tank top', 'basic', 1, { c1: '#F2A93B' }, function (g) { var m = sub(torso(g), collar(g)); m[idx(11, 22 + g.dy)] = 0; m[idx(20, 22 + g.dy)] = 0; return m; });
  topItem('stripes', 'Stripes', 'basic', 2, { c1: '#F5EFE6', c2: '#3E5C76' }, function (g) { return sub(union(torso(g), sleeves(g, 3)), collar(g)); },
    function (g) { return { pattern: function (x, y) { return (y - g.torso.y0) % 3 === 2 ? 'c2' : 'c1'; } }; });
  topItem('apron', 'Barista apron', 'basic', 2, { c1: '#2F5D50', c2: '#F5EFE6' }, function (g) { return sub(union(torso(g), sleeves(g, 3)), collar(g)); },
    function (g) {
      var d = g.dy;
      return { pattern: function (x, y) { var ry = y - d; return ((x >= 12 && x <= 19 && ry >= 25) || (x >= 13 && x <= 18 && ry >= 23)) ? 'c1' : 'c2'; },
        details: [[12, 22 + d, 'c1.base'], [12, 23 + d, 'c1.base'], [12, 24 + d, 'c1.base'], [19, 22 + d, 'c1.base'], [19, 23 + d, 'c1.base'], [19, 24 + d, 'c1.base'],
          [14, 27 + d, 'c1.shade'], [15, 27 + d, 'c1.shade'], [16, 27 + d, 'c1.shade'], [17, 27 + d, 'c1.shade'], [14, 28 + d, 'c1.shade'], [17, 28 + d, 'c1.shade']] };
    });
  topItem('hoodie', 'Hoodie', 'mid', 2, { c1: '#7B8CDE', c2: '#F5EFE6' }, function (g) {
    var m = sub(union(torso(g), sleeves(g, 7)), collar(g));
    return pts(m, [[11, 21], [12, 21], [13, 21], [18, 21], [19, 21], [20, 21]], g.dy);
  }, function (g) {
    var d = g.dy;
    return { details: [[14, 23 + d, 'c2.base'], [14, 24 + d, 'c2.base'], [17, 23 + d, 'c2.base'], [17, 24 + d, 'c2.base'],
      [13, 27 + d, 'c1.shade'], [14, 27 + d, 'c1.shade'], [15, 27 + d, 'c1.shade'], [16, 27 + d, 'c1.shade'], [17, 27 + d, 'c1.shade'], [18, 27 + d, 'c1.shade'],
      [13, 28 + d, 'c1.shade'], [18, 28 + d, 'c1.shade'], [13, 29 + d, 'c1.shade'], [18, 29 + d, 'c1.shade']] };
  });
  topItem('jacket', 'Jacket', 'mid', 2, { c1: '#2F3138', c2: '#F25F5C' }, function (g) { return sub(union(torso(g), sleeves(g, 7)), collar(g)); },
    function (g) {
      var d = g.dy;
      return { pattern: function (x, y) { return (x === 15 || x === 16) && y - d <= 29 ? 'c2' : 'c1'; },
        details: [[14, 22 + d, 'c1.hl'], [14, 23 + d, 'c1.hl'], [17, 22 + d, 'c1.hl'], [17, 23 + d, 'c1.hl'], [13, 26 + d, 'c1.shade'], [18, 26 + d, 'c1.shade']] };
    });
  topItem('dress', 'Dress', 'mid', 2, { c1: '#F2B5C4', c2: '#F5EFE6' }, function (g) {
    var m = sub(union(torso(g), sleeves(g, 2)), collar(g));
    return spans(m, [[31, 10, 21], [32, 10, 21], [33, 9, 22], [34, 9, 22], [35, 8, 23]], g.dy);
  }, function (g) {
    var d = g.dy;
    return { pattern: function (x, y) { return y - d === 29 ? 'c2' : 'c1'; },
      texture: function (x, y) { var ry = y - d; return ry >= 32 && (x === 11 || x === 15 || x === 20) ? 'shade' : null; } };
  });
  topItem('sweater', 'Star sweater', 'legendary', 2, { c1: '#9B2C3A', c2: '#FFE066' }, function (g) { return sub(union(torso(g), sleeves(g, 7)), collar(g)); },
    function (g) {
      var d = g.dy, c = 'c2.base';
      return { details: [[15, 24 + d, c], [16, 24 + d, c], [13, 25 + d, c], [14, 25 + d, c], [15, 25 + d, c], [16, 25 + d, c], [17, 25 + d, c], [18, 25 + d, c],
        [14, 26 + d, c], [15, 26 + d, c], [16, 26 + d, c], [17, 26 + d, c], [14, 27 + d, c], [17, 27 + d, c]],
        pattern: function (x, y) { return y - d === 30 ? 'c2' : 'c1'; } };
    });
  topItem('kimono', 'Wave robe', 'legendary', 2, { c1: '#2F5D50', c2: '#F2A93B' }, function (g) { return sub(union(torso(g), sleeves(g, 5)), collar(g)); },
    function (g) {
      var d = g.dy;
      return { pattern: function (x, y) { var ry = y - d; return ((x - ry === -9 || x + ry === 40) && ry <= 26) || ry === 27 ? 'c2' : 'c1'; } };
    });

  // Panda body: white front, black arms and paws.
  topItem('pandasuit', 'Panda suit', 'legendary', 2, { c1: '#F5EFE6', c2: '#2F3138' }, function (g) {
    return pts(sub(union(torso(g), sleeves(g, 7)), collar(g)), g.handL.concat(g.handR));
  }, function (g) {
    return { pattern: function (x, y) { return x <= 10 || x >= 21 || y - g.dy <= 23 ? 'c2' : 'c1'; } };
  });

  /* ---- bottoms ---- */
  function bottomItem(id, name, rarity, colors, defaults, maskFn, more, z) {
    add('bottom', { id: id, name: name, rarity: rarity, colors: colors, palette: 'cloth', defaults: defaults,
      build: function (g, ctx) { return [Object.assign({ z: z || 3, mask: maskFn(g), key: 'c1' }, more ? more(g) : {})]; } });
  }
  bottomItem('pants', 'Pants', 'basic', 1, { c1: '#3E5C76' }, function (g) { return union(waistMask(g), legsMask(g)); });
  bottomItem('shorts', 'Shorts', 'basic', 1, { c1: '#8A5A3C' }, function (g) { return union(waistMask(g), legsMask(g, 2)); });
  bottomItem('skirt', 'Skirt', 'basic', 1, { c1: '#9B2C3A' }, function (g) {
    var w = g.waist; return spans(M(), [[w, 11, 20], [w + 1, 10, 21], [w + 2, 10, 21], [w + 3, 9, 22]]);
  }, function (g) { var w = g.waist; return { texture: function (x, y) { return y >= w + 2 && (x === 12 || x === 15 || x === 18) ? 'shade' : null; } }; });
  bottomItem('joggers', 'Joggers', 'basic', 2, { c1: '#2F3138', c2: '#C9CBD4' }, function (g) { return union(waistMask(g), legsMask(g)); },
    function (g) { var lastL = g.legL[g.legL.length - 1][0][1], lastR = g.legR[g.legR.length - 1][0][1];
      return { pattern: function (x, y) { return (x <= 15 && y === lastL) || (x > 15 && y === lastR) ? 'c2' : 'c1'; },
        details: [[11, g.waist + 1 - 1, 'c2.base']] }; });
  bottomItem('overalls', 'Overalls', 'mid', 2, { c1: '#5B8DEF', c2: '#E8B04B' }, function (g) {
    var m = union(waistMask(g), legsMask(g));
    rect(m, 13, 24, 18, 29, g.dy);
    return pts(m, [[12, 22], [12, 23], [19, 22], [19, 23]], g.dy);
  }, function (g) { var d = g.dy; return { details: [[13, 24 + d, 'c2.base'], [18, 24 + d, 'c2.base'], [15, 26 + d, 'c1.shade'], [16, 26 + d, 'c1.shade']], noOutline: neckZone(g) }; }, 6);

  /* ---- shoes ---- */
  function shoeItem(id, name, rarity, colors, defaults, maskFn, more) {
    add('shoes', { id: id, name: name, rarity: rarity, colors: colors, palette: 'cloth', defaults: defaults,
      build: function (g, ctx) { var m = maskFn(g); return [Object.assign({ z: 4, mask: m, key: 'c1' }, more ? more(g, m) : {})]; } });
  }
  shoeItem('sneakers', 'Sneakers', 'basic', 2, { c1: '#F25F5C', c2: '#F5EFE6' }, feetMask,
    function (g, m) { return { pattern: function (x, y) { return get(m, x, y + 1) ? 'c1' : 'c2'; } }; });
  shoeItem('boots', 'Boots', 'basic', 1, { c1: '#5A3828' }, function (g) {
    var m = feetMask(g);
    var l = g.legL[g.legL.length - 1], r = g.legR[g.legR.length - 1];
    pts(m, l.concat(r));
    return m;
  });
  shoeItem('sandals', 'Sandals', 'basic', 1, { c1: '#8A5A3C' }, feetMask,
    function (g, m) { return { pattern: function (x, y) { return get(m, x, y - 1) ? 'skin' : 'c1'; } }; });
  shoeItem('bunny', 'Bunny slippers', 'legendary', 1, { c1: '#F5EFE6' }, function (g) {
    var m = feetMask(g);
    pts(m, [[11, g.footTopL - 1], [11, g.footTopL - 2], [13, g.footTopL - 1], [13, g.footTopL - 2],
      [18, g.footTopR - 1], [18, g.footTopR - 2], [20, g.footTopR - 1], [20, g.footTopR - 2]]);
    return m;
  }, function (g) { return { details: [[12, g.footTopL, '#2B2228'], [19, g.footTopR, '#2B2228'], [11, g.footTopL - 1, '#F28DB4'], [20, g.footTopR - 1, '#F28DB4']] }; });
  NONE('shoes', 'Barefoot');

  /* ---- hats ---- */
  function hatItem(id, name, rarity, colors, defaults, layersFn) {
    add('hat', { id: id, name: name, rarity: rarity, colors: colors, palette: 'cloth', defaults: defaults, fixed: defaults && defaults.fixed,
      build: function (g, ctx) { return layersFn(g, ctx); } });
  }
  NONE('hat');
  hatItem('beanie', 'Beanie', 'basic', 2, { c1: '#F25F5C', c2: '#F5EFE6' }, function (g) {
    var d = g.dy;
    var m = spans(M(), [[0, 14, 17], [1, 12, 19], [2, 10, 21], [3, 9, 22], [4, 8, 23], [5, 7, 24], [6, 7, 24], [7, 6, 25], [8, 6, 25]], d);
    return [{ z: 10, mask: m, pattern: function (x, y) { var ry = y - d; return ry >= 7 || ry === 0 ? 'c2' : 'c1'; },
      texture: function (x, y) { var ry = y - d; return ry >= 7 && x % 2 === 0 ? 'shade' : null; } }];
  });
  hatItem('cap', 'Cap', 'basic', 2, { c1: '#3E5C76', c2: '#F5EFE6' }, function (g) {
    var d = g.dy;
    return [{ z: 10, mask: spans(M(), [[2, 11, 20], [3, 9, 22], [4, 8, 23], [5, 7, 24], [6, 7, 24], [7, 7, 24]], d), key: 'c1', details: [[15, 2 + d, 'c2.base'], [16, 2 + d, 'c2.base']] },
      { z: 10, mask: spans(M(), [[8, 7, 28]], d), key: 'c2' }];
  });
  hatItem('bucket', 'Bucket hat', 'basic', 1, { c1: '#E9C35E' }, function (g) {
    var d = g.dy;
    return [{ z: 10, mask: spans(M(), [[3, 11, 20], [4, 10, 21], [5, 9, 22], [6, 9, 22], [7, 6, 25], [8, 5, 26]], d), key: 'c1',
      texture: function (x, y) { return y - d === 6 ? 'deep' : null; } }];
  });
  hatItem('beret', 'Beret', 'mid', 1, { c1: '#9B2C3A' }, function (g) {
    return [{ z: 10, mask: spans(M(), [[2, 15, 16], [3, 11, 21], [4, 9, 24], [5, 8, 25], [6, 8, 25], [7, 10, 23]], g.dy), key: 'c1' }];
  });
  hatItem('flower', 'Flower clip', 'mid', 1, { c1: '#F28DB4' }, function (g) {
    var d = g.dy;
    return [{ z: 10, mask: spans(M(), [[5, 21, 22], [6, 20, 23], [7, 20, 23], [8, 21, 22]], d), key: 'c1', details: [[21, 6 + d, '#FFE066'], [22, 7 + d, '#FFE066']] }];
  });
  hatItem('headphones', 'Headphones', 'legendary', 2, { c1: '#2F3138', c2: '#F2A93B' }, function (g) {
    var d = g.dy, band = [[1, 11, 20], [2, 9, 10], [2, 21, 22], [3, 8, 8], [3, 23, 23], [4, 7, 7], [4, 24, 24]];
    for (var y = 5; y <= 10; y++) band.push([y, 6, 6], [y, 25, 25]);
    var cups = []; for (var cy = 11; cy <= 16; cy++) cups.push([cy, 4, 7], [cy, 24, 27]);
    return [{ z: 10, mask: spans(M(), band, d), key: 'c1' }, { z: 10, mask: spans(M(), cups, d), key: 'c2' }];
  });
  hatItem('catears', 'Cat ears', 'legendary', 2, { c1: '#2B2228', c2: '#F28DB4' }, function (g) {
    var d = g.dy;
    return [{ z: 10, mask: spans(M(), mirrorSpans([[1, 8, 8], [2, 8, 9], [3, 8, 10], [4, 7, 11], [5, 7, 11]]), d), key: 'c1',
      details: mirrorPts([[9, 3], [9, 4], [10, 4]]).map(function (p) { return [p[0], p[1] + d, 'c2.base']; }) }];
  });
  hatItem('crown', 'Crown', 'legendary', 0, { c1: '#E8B04B' }, function (g) {
    var d = g.dy;
    return [{ z: 10, mask: spans(M(), [[0, 10, 10], [0, 15, 16], [0, 21, 21], [1, 10, 11], [1, 14, 17], [1, 20, 21], [2, 10, 21], [3, 10, 21], [4, 10, 21]], d), key: 'c1',
      details: [[12, 3 + d, '#5B8DEF'], [15, 3 + d, '#E04A4A'], [16, 3 + d, '#E04A4A'], [19, 3 + d, '#5B8DEF']] }];
  });

  // Animal ears (worn in the hat slot).
  hatItem('pandaears', 'Panda ears', 'legendary', 0, { c1: '#2B2228' }, function (g) {
    var d = g.dy;
    return [{ z: 10, mask: union(ellipse(M(), 9.2, 5.2 + d, 2.8, 2.6), ellipse(M(), 22.8, 5.2 + d, 2.8, 2.6)), key: 'c1' }];
  });
  hatItem('foxears', 'Fox ears', 'legendary', 0, { c1: '#E8873A' }, function (g) {
    var d = g.dy, ear = [[0, 8, 8], [1, 8, 9], [2, 8, 10], [3, 7, 11], [4, 7, 12], [5, 7, 12], [6, 7, 11]];
    return [{ z: 10, mask: spans(M(), mirrorSpans(ear), d), pattern: function (x, y) { return y - d <= 1 ? '#3A2418' : 'c1'; },
      details: mirrorPts([[9, 3], [9, 4], [10, 4], [9, 5], [10, 5]]).map(function (p) { return [p[0], p[1] + d, '#F7E3D4']; }) }];
  });
  hatItem('kittyears', 'Kitty ears & bow', 'legendary', 1, { c1: '#F25F5C' }, function (g) {
    var d = g.dy, ear = [[2, 8, 9], [3, 8, 10], [4, 7, 11], [5, 7, 11], [6, 7, 10]];
    var bow = spans(M(), [[1, 19, 20], [1, 25, 26], [2, 18, 21], [2, 24, 27], [3, 18, 27], [4, 18, 27], [5, 18, 21], [5, 24, 27], [6, 19, 20], [6, 25, 26]], d);
    return [{ z: 10, mask: spans(M(), mirrorSpans(ear), d), key: '#F7F3EA', details: mirrorPts([[9, 4], [9, 5]]).map(function (p) { return [p[0], p[1] + d, '#F6B8C8']; }) },
      { z: 10.5, mask: bow, key: 'c1', details: [[22, 3 + d, 'c1.deep'], [23, 3 + d, 'c1.deep'], [22, 4 + d, 'c1.shade'], [23, 4 + d, 'c1.shade']] }];
  });

  /* ---- glasses (face accessory) ---- */
  NONE('face');
  add('face', { id: 'glasses', name: 'Glasses', rarity: 'basic', colors: 1, palette: 'cloth', defaults: { c1: '#2F3138' }, build: function (g, ctx) {
    var m = M(), d = g.dy;
    [[9, 13], [18, 22]].forEach(function (r) { for (var x = r[0]; x <= r[1]; x++) { set(m, x, 11 + d); set(m, x, 16 + d); } for (var y = 11; y <= 16; y++) { set(m, r[0], y + d); set(m, r[1], y + d); } });
    rect(m, 14, 13, 17, 13, d);
    return [{ z: 11, mask: m, key: 'c1', flat: true, outline: false }];
  } });
  add('face', { id: 'shades', name: 'Sunglasses', rarity: 'mid', colors: 1, palette: 'cloth', defaults: { c1: '#2F3138' }, build: function (g, ctx) {
    var d = g.dy, m = rect(rect(M(), 9, 12, 13, 15, d), 18, 12, 22, 15, d);
    rect(m, 14, 12, 17, 12, d);
    return [{ z: 11, mask: m, key: 'c1', flat: true, outline: false, details: [[10, 13 + d, 'c1.hl'], [11, 13 + d, 'c1.hl'], [19, 13 + d, 'c1.hl'], [20, 13 + d, 'c1.hl']] }];
  } });
  add('face', { id: 'starshades', name: 'Star shades', rarity: 'legendary', colors: 1, palette: 'cloth', defaults: { c1: '#FF7AB6' }, build: function (g, ctx) {
    var d = g.dy, star = [[11, 11], [9, 12], [10, 12], [11, 12], [12, 12], [13, 12], [10, 13], [11, 13], [12, 13], [10, 14], [11, 14], [12, 14], [9, 15], [10, 15], [12, 15], [13, 15]];
    var m = pts(M(), mirrorPts(star), d); rect(m, 14, 12, 17, 12, d);
    return [{ z: 11, mask: m, key: 'c1', outline: false }];
  } });

  /* ---- neck ---- */
  NONE('neck');
  add('neck', { id: 'bowtie', name: 'Bow tie', rarity: 'basic', colors: 1, palette: 'cloth', defaults: { c1: '#F25F5C' }, build: function (g) {
    var m = pts(M(), [[13, 22], [14, 22], [17, 22], [18, 22], [13, 23], [14, 23], [15, 23], [16, 23], [17, 23], [18, 23], [13, 24], [14, 24], [17, 24], [18, 24]], g.dy);
    return [{ z: 7, mask: m, key: 'c1', outline: false, details: [[15, 23 + g.dy, 'c1.shade'], [16, 23 + g.dy, 'c1.shade']] }];
  } });
  add('neck', { id: 'scarf', name: 'Scarf', rarity: 'mid', colors: 2, palette: 'cloth', defaults: { c1: '#F2A93B', c2: '#F5EFE6' }, build: function (g) {
    var m = spans(M(), [[21, 11, 20], [22, 10, 21], [23, 11, 20], [24, 17, 18], [25, 17, 18], [26, 17, 19], [27, 17, 19]], g.dy);
    return [{ z: 7, mask: m, pattern: function (x) { return x % 3 === 0 ? 'c2' : 'c1'; } }];
  } });
  add('neck', { id: 'chain', name: 'Gold chain', rarity: 'legendary', colors: 0, build: function (g) {
    var d = g.dy;
    return [{ z: 7, details: [[12, 23, '#E8B04B'], [13, 24, '#E8B04B'], [14, 25, '#F2D27A'], [15, 25, '#E8B04B'], [16, 25, '#E8B04B'], [17, 25, '#F2D27A'], [18, 24, '#E8B04B'], [19, 23, '#E8B04B'], [15, 26, '#FFE79A'], [16, 26, '#E8B04B']].map(function (p) { return [p[0], p[1] + d, p[2]]; }) }];
  } });

  /* ---- back ---- */
  NONE('back');
  add('back', { id: 'cape', name: 'Cape', rarity: 'mid', colors: 1, palette: 'cloth', defaults: { c1: '#9B2C3A' }, build: function (g) {
    var s = [[21, 10, 21]]; for (var y = 22; y <= 27; y++) s.push([y, 9, 22]); for (var y2 = 28; y2 <= 31; y2++) s.push([y2, 8, 23]); for (var y3 = 32; y3 <= 35; y3++) s.push([y3, 7, 24]);
    return [{ z: 0, mask: spans(M(), s, g.dy), key: 'c1', texture: function (x, y) { return (x === 8 || x === 23) ? 'shade' : null; } }];
  } });
  add('back', { id: 'wings', name: 'Wings', rarity: 'legendary', colors: 1, palette: 'cloth', defaults: { c1: '#F5EFE6' }, build: function (g) {
    var s = mirrorSpans([[17, 7, 8], [18, 5, 9], [19, 3, 9], [20, 2, 9], [21, 1, 9], [22, 1, 9], [23, 2, 9], [24, 3, 9], [25, 4, 9], [26, 6, 9], [27, 8, 9]]);
    return [{ z: 0, mask: spans(M(), s, g.dy), key: 'c1', texture: function (x, y) { return ((x + y) % 3 === 0 && (x < 8 || x > 23)) ? 'shade' : null; } }];
  } });
  add('back', { id: 'guitar', name: 'Guitar', rarity: 'mid', colors: 1, palette: 'cloth', defaults: { c1: '#D97A32' }, build: function (g) {
    var d = g.dy;
    var neck = pts(M(), [[4, 8], [5, 9], [5, 10], [6, 11], [6, 12], [7, 13], [7, 14], [8, 15], [8, 16], [9, 17], [9, 18]], d);
    var body = spans(M(), [[19, 7, 11], [20, 6, 12], [21, 6, 12], [22, 7, 11], [23, 6, 12], [24, 6, 12], [25, 7, 11]], d);
    return [{ z: 0, mask: neck, key: '#5A3828', outline: true }, { z: 0, mask: body, key: 'c1', details: [[9, 22 + d, '#2B2228']] }];
  } });

  // Kitsune: three fluffy fox tails fanning out from behind the lower back, each with a white tip.
  // Each tail is a tilted ellipse on its own layer, so each gets its own outline.
  add('back', { id: 'kitsune', name: 'Three tails', rarity: 'legendary', colors: 0, defaults: { c1: '#E8873A', c2: '#F7F3EA' }, build: function (g) {
    var d = g.dy;
    var tail = function (bx, by, tx, ty, r) {
      var cx = (bx + tx) / 2, cy = (by + ty) / 2 + d, len = Math.sqrt((tx - bx) * (tx - bx) + (ty - by) * (ty - by)) / 2;
      var ux = (tx - bx) / (2 * len), uy = (ty - by) / (2 * len), m = M();
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var dx = x - cx, dy2 = y - cy, along = dx * ux + dy2 * uy, across = -dx * uy + dy2 * ux;
        // fuller toward the tip, slimmer at the base
        var rr = r * (0.7 + 0.3 * (along / len + 1) / 2);
        if ((along / len) * (along / len) + (across / rr) * (across / rr) <= 1) set(m, x, y);
      }
      return { z: 0, mask: m, pattern: function (x, y) {
        var ex = x - (tx), ey = y - (ty + d); return ex * ex + ey * ey <= 10 ? 'c2' : 'c1'; } };
    };
    return [
      tail(12, 31, 2, 17, 3.2),    // up and out to the left
      tail(19, 31, 29, 16, 3.2),   // up and out to the right
      tail(18, 33, 30, 29, 2.9)    // low, sweeping right
    ];
  } });

  /* ---- held item ---- */
  NONE('held', 'Empty hands');
  function heldItem(id, name, rarity, colors, defaults, fn) {
    add('held', { id: id, name: name, rarity: rarity, colors: colors, palette: 'cloth', defaults: defaults, build: function (g, ctx) { return g.waving ? [] : fn(g, ctx); } });
  }
  heldItem('coffee', 'Coffee', 'basic', 1, { c1: '#8A5A3C' }, function (g) {
    var d = g.dy, m = spans(M(), [[26, 22, 26], [27, 23, 26], [28, 23, 26], [29, 23, 26], [30, 23, 26], [31, 24, 26]], d);
    return [{ z: 12, mask: m, pattern: function (x, y) { var ry = y - d; return ry === 26 ? '#EDE3D3' : (ry === 28 || ry === 29 ? 'c1' : '#F7F1E7'); } }];
  });
  heldItem('book', 'Book', 'basic', 1, { c1: '#3E5C76' }, function (g) {
    var d = g.dy;
    return [{ z: 12, mask: rect(M(), 22, 26, 26, 31, d), key: 'c1', details: [[26, 27 + d, '#F5EFE6'], [26, 28 + d, '#F5EFE6'], [26, 29 + d, '#F5EFE6'], [26, 30 + d, '#F5EFE6'], [24, 28 + d, 'c1.hl']] }];
  });
  heldItem('vinyl', 'Vinyl record', 'mid', 1, { c1: '#F25F5C' }, function (g) {
    var d = g.dy;
    return [{ z: 12, mask: ellipse(M(), 25, 28 + d, 3.3, 3.3), key: '#22201F', texture: function (x, y) { return ((x + y) % 4 === 0) ? 'hl' : null; },
      details: [[25, 28 + d, 'c1.base'], [24, 28 + d, 'c1.base'], [25, 27 + d, 'c1.base']] }];
  });
  heldItem('boba', 'Bubble tea', 'legendary', 1, { c1: '#F28DB4' }, function (g) {
    var d = g.dy, m = spans(M(), [[26, 22, 26], [27, 22, 26], [28, 22, 26], [29, 23, 26], [30, 23, 26], [31, 23, 26]], d);
    return [{ z: 12, mask: m, pattern: function (x, y) { var ry = y - d; return ry === 26 ? '#F2EAF0' : (ry >= 30 ? '#4A2F22' : '#E8C9A8'); } },
      { z: 12, details: [[25, 23 + d, 'c1.base'], [25, 24 + d, 'c1.base'], [25, 25 + d, 'c1.base'], [24, 29 + d, '#4A2F22']] }];
  });

  heldItem('bamboo', 'Bamboo', 'mid', 0, { c1: '#6FA84A' }, function (g) {
    var d = g.dy, stalk = rect(M(), 24, 19, 25, 33, d);
    return [{ z: 12, mask: stalk, key: 'c1', details: [[24, 23 + d, 'c1.deep'], [25, 23 + d, 'c1.deep'], [24, 28 + d, 'c1.deep'], [25, 28 + d, 'c1.deep']] },
      { z: 12, mask: spans(M(), [[19, 26, 28], [20, 27, 29], [21, 28, 29]], d), key: '#8FCB5E' }];
  });

  /* ---------------------------------------------------------------- slots & defaults */
  var SLOTS = [
    { id: 'skin', label: 'Skin', palette: 'skin', colorOnly: true },
    { id: 'hair', label: 'Hair' },
    { id: 'eyes', label: 'Eyes' },
    { id: 'mouth', label: 'Mouth' },
    { id: 'cheeks', label: 'Cheeks' },
    { id: 'top', label: 'Top' },
    { id: 'bottom', label: 'Bottom' },
    { id: 'shoes', label: 'Shoes' },
    { id: 'hat', label: 'Hat' },
    { id: 'face', label: 'Glasses' },
    { id: 'neck', label: 'Neck' },
    { id: 'back', label: 'Back' },
    { id: 'held', label: 'In hand' }
  ];
  var PART_SLOTS = SLOTS.filter(function (s) { return !s.colorOnly; }).map(function (s) { return s.id; });

  function items(slot) { return CAT[slot] || []; }
  function getItem(slot, id) { var l = CAT[slot] || []; for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }

  function defaultAvatar() {
    return {
      v: 1, skin: '#ECB892',
      hair: { id: 'messy', c1: '#4B2F22' },
      eyes: { id: 'round', c1: '#6B4226' },
      mouth: { id: 'smile' }, cheeks: { id: 'blush' },
      top: { id: 'apron', c1: '#2F5D50', c2: '#F5EFE6' },
      bottom: { id: 'pants', c1: '#3E5C76' },
      shoes: { id: 'sneakers', c1: '#F25F5C', c2: '#F5EFE6' },
      hat: { id: 'none' }, face: { id: 'none' }, neck: { id: 'none' }, back: { id: 'none' },
      held: { id: 'coffee', c1: '#8A5A3C' }
    };
  }

  // Ready-made animal avatars, built only from catalog parts.
  var PRESETS = {
    panda: {
      v: 1, skin: '#F7F3EA',
      hair: { id: 'none' }, eyes: { id: 'round', c1: '#3A2A22' }, mouth: { id: 'snout' }, cheeks: { id: 'panda' },
      top: { id: 'pandasuit', c1: '#F5EFE6', c2: '#2F3138' }, bottom: { id: 'pants', c1: '#2F3138' }, shoes: { id: 'boots', c1: '#2F3138' },
      hat: { id: 'pandaears' }, face: { id: 'none' }, neck: { id: 'none' }, back: { id: 'none' }, held: { id: 'bamboo' }
    },
    kitsune: {
      v: 1, skin: '#E8873A',
      hair: { id: 'none' }, eyes: { id: 'happy', c1: '#E0A82E' }, mouth: { id: 'snout' }, cheeks: { id: 'muzzle' },
      top: { id: 'kimono', c1: '#9B2C3A', c2: '#E8B04B' }, bottom: { id: 'pants', c1: '#2F3138' }, shoes: { id: 'sandals', c1: '#8A5A3C' },
      hat: { id: 'foxears' }, face: { id: 'none' }, neck: { id: 'none' }, back: { id: 'kitsune' }, held: { id: 'none' }
    },
    kitty: {
      v: 1, skin: '#F7F3EA',
      hair: { id: 'none' }, eyes: { id: 'bead', c1: '#3A2A22' }, mouth: { id: 'kittynose' }, cheeks: { id: 'whiskers' },
      top: { id: 'tee', c1: '#FFE066' }, bottom: { id: 'overalls', c1: '#5B8DEF', c2: '#FFE066' }, shoes: { id: 'none' },
      hat: { id: 'kittyears', c1: '#F25F5C' }, face: { id: 'none' }, neck: { id: 'none' }, back: { id: 'none' }, held: { id: 'none' }
    }
  };

  /* ---------------------------------------------------------------- compose */
  function resolve(spec, ctx) {
    if (!spec) return null;
    if (spec.charAt(0) === '#') return spec;
    var parts = spec.split('.'), r = rampFor(parts[0], ctx);
    return r[parts[1] || 'base'];
  }
  function rampFor(key, ctx) {
    if (key.charAt(0) === '#') return ramp(key);
    if (key === 'skin') return ramp(ctx.skin);
    return ramp(ctx[key] || ctx.c1 || '#888888');
  }

  function paint(buf, L) {
    var ctx = L.ctx, m = L.mask;
    if (m) {
      var baseKey = L.key || 'c1';
      if (L.outline !== false) {
        var oc = L.outlineColor || rampFor(baseKey, ctx).outline;
        for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
          if (m[idx(x, y)]) continue;
          if (get(m, x - 1, y) || get(m, x + 1, y) || get(m, x, y - 1) || get(m, x, y + 1)) {
            if (L.noOutline && L.noOutline[idx(x, y)]) continue;
            buf[idx(x, y)] = oc;
          }
        }
      }
      var minx = W, maxx = 0;
      for (var i = 0; i < m.length; i++) if (m[i]) { var px = i % W; if (px < minx) minx = px; if (px > maxx) maxx = px; }
      var cx = (minx + maxx) / 2;
      for (var y2 = 0; y2 < H; y2++) for (var x2 = 0; x2 < W; x2++) {
        if (!m[idx(x2, y2)]) continue;
        var key = L.pattern ? L.pattern(x2, y2) : baseKey;
        if (key.charAt(0) === '#' && L.pattern) { buf[idx(x2, y2)] = key; continue; }
        var r = rampFor(key, ctx), c = r.base;
        if (L.flat) { c = L.tone ? r[L.tone] : r.base; }
        else {
          var tex = L.texture ? L.texture(x2, y2, m, ctx.dy) : null;
          if (!get(m, x2 + 1, y2) || !get(m, x2, y2 + 1)) c = r.shade;
          else if (!get(m, x2, y2 - 1) && x2 <= cx) c = r.hl;
          if (tex) c = r[tex];
        }
        if (L.under && buf[idx(x2, y2)] && buf[idx(x2, y2)] !== rampFor('skin', ctx).base && buf[idx(x2, y2)] !== rampFor('skin', ctx).shade && buf[idx(x2, y2)] !== rampFor('skin', ctx).hl) continue;
        buf[idx(x2, y2)] = c;
      }
    }
    if (L.details) for (var d = 0; d < L.details.length; d++) {
      var dt = L.details[d];
      if (!inb(dt[0], dt[1])) continue;
      buf[idx(dt[0], dt[1])] = resolve(dt[2], ctx);
    }
  }

  var composeCache = new Map();
  function compose(avatar, opts) {
    opts = opts || {};
    var pose = opts.pose || 'stand', blink = !!opts.blink;
    var cacheKey = JSON.stringify(avatar) + '|' + pose + '|' + blink;
    if (composeCache.has(cacheKey)) return composeCache.get(cacheKey);

    var a = avatar || defaultAvatar();
    var g = geometry(pose);
    var skin = a.skin || '#ECB892';
    var sr = ramp(skin);
    var layers = [];
    var shoes = a.shoes && a.shoes.id !== 'none' ? a.shoes.id : null;

    // skin body
    var body = spans(M(), HEAD, g.dy);
    pts(body, EARS, g.dy);
    rect(body, 14, 21, 17, 22, g.dy);
    rect(body, 11, 22, 20, 30, g.dy);
    pts(body, flat(g.armL)); pts(body, flat(g.armR)); pts(body, g.handL); pts(body, g.handR);
    union(body, legsMask(g));
    if (!shoes) union(body, feetMask(g));
    var baseCtx = { skin: skin, dy: g.dy };
    layers.push({ z: 2, mask: body, key: 'skin', ctx: baseCtx, texture: function (x, y) {
      var ry = y - g.dy; // ear inner shade
      if ((x === 7 || x === 24) && ry === 13) return 'shade';
      return null;
    } });

    PART_SLOTS.forEach(function (slot) {
      var sel = a[slot]; if (!sel) return;
      var it = getItem(slot, sel.id); if (!it || it.id === 'none') return;
      var defs = it.defaults || {};
      var ctx = { skin: skin, dy: g.dy, c1: it.colors >= 1 ? (sel.c1 || defs.c1) : defs.c1, c2: it.colors >= 2 ? (sel.c2 || defs.c2) : defs.c2,
        blink: blink, lash: '#2B1D1A', mouth: sr.outline, skinShade: sr.shade };
      var built = it.build(g, ctx) || [];
      built.forEach(function (l) { l.ctx = ctx; layers.push(l); });
    });

    layers.sort(function (p, q) { return p.z - q.z; });
    var buf = new Array(W * H).fill(null);
    layers.forEach(function (l) { paint(buf, l); });

    if (composeCache.size > 600) composeCache.clear();
    composeCache.set(cacheKey, buf);
    return buf;
  }

  function draw(c2d, avatar, opts) {
    opts = opts || {};
    var s = opts.scale || 1, ox = opts.x || 0, oy = opts.y || 0;
    var buf = compose(avatar, opts);
    if (opts.shadow !== false) {
      c2d.fillStyle = 'rgba(0,0,0,0.22)';
      c2d.fillRect(ox + 10 * s, oy + 39 * s, 12 * s, s);
      c2d.fillRect(ox + 12 * s, oy + 38 * s, 8 * s, s);
    }
    var y0 = opts.cropTop || 0, y1 = opts.cropBottom == null ? H : opts.cropBottom;
    for (var y = y0; y < y1; y++) for (var x = 0; x < W; x++) {
      var c = buf[idx(x, y)];
      if (!c) continue;
      c2d.fillStyle = c;
      c2d.fillRect(ox + x * s, oy + (y - y0) * s, s, s);
    }
  }

  // Animation helper: anim 'idle' | 'walk' | 'sit' | 'wave'
  function frame(anim, t, seed) {
    seed = seed || 0;
    var blink = ((t + seed * 977) % 4300) < 140;
    if (anim === 'walk') return { pose: Math.floor(t / 170) % 2 ? 'walkA' : 'walkB', blink: false };
    if (anim === 'sit') return { pose: 'sit', blink: blink };
    if (anim === 'wave') return { pose: Math.floor(t / 230) % 2 ? 'wave' : 'wave2', blink: false };
    return { pose: Math.floor((t + seed * 311) / 700) % 2 ? 'breathe' : 'stand', blink: blink };
  }

  /* ---------------------------------------------------------------- rarity, codes, generator */
  // Rarity is a LABEL only. Nothing is locked by the engine. Ownership/locking will be a separate layer later.
  var RARITIES = [
    { id: 'basic', label: 'Basic' },
    { id: 'mid', label: 'Mid' },
    { id: 'legendary', label: 'Legendary' }
  ];
  var RANK = { basic: 0, mid: 1, legendary: 2 };
  function rarityRank(r) { return RANK[r] == null ? 0 : RANK[r]; }
  // Every part and colour the avatar wears, with its rarity
  function wornParts(a) {
    var out = [];
    var sr = colorRarity('skin', a.skin);
    if (sr) out.push({ slot: 'skin', color: a.skin, rarity: sr, name: 'Skin colour' });
    PART_SLOTS.forEach(function (slot) {
      var sel = a[slot]; if (!sel) return;
      var it = getItem(slot, sel.id); if (!it || it.id === 'none') return;
      out.push({ slot: slot, id: it.id, rarity: it.rarity, name: it.name });
      ['c1', 'c2'].forEach(function (k, i) {
        if (it.colors > i && sel[k] && it.palette) {
          var t = colorRarity(it.palette, sel[k]);
          if (t) out.push({ slot: slot, color: sel[k], rarity: t, name: it.name + ' colour' });
        }
      });
    });
    return out;
  }
  // Overall rarity of an avatar, from how many rare parts it wears (one rare sock doesn't make it Legendary):
  //   Legendary = at least 3 legendary parts, Mid = at least 3 parts that are Mid or better, otherwise Basic.
  var OVERALL_RULES = { legendary: 3, mid: 3 };
  function avatarRarity(a) {
    var c = { basic: 0, mid: 0, legendary: 0 };
    PART_SLOTS.forEach(function (slot) {
      var sel = a[slot], it = sel && getItem(slot, sel.id);
      if (it && it.id !== 'none') c[it.rarity]++;
    });
    if (c.legendary >= OVERALL_RULES.legendary) return 'legendary';
    if (c.legendary + c.mid >= OVERALL_RULES.mid) return 'mid';
    return 'basic';
  }  function sanitize(a) {
    var d = defaultAvatar(), out = { v: 1 };
    out.skin = colorRarity('skin', a && a.skin) ? a.skin : d.skin;
    PART_SLOTS.forEach(function (slot) {
      var sel = a && a[slot], it = sel && getItem(slot, sel.id);
      if (!it) { out[slot] = d[slot]; return; }
      var o = { id: it.id };
      if (it.colors >= 1) o.c1 = (it.palette && colorRarity(it.palette, sel.c1)) ? sel.c1 : it.defaults.c1;
      if (it.colors >= 2) o.c2 = (it.palette && colorRarity(it.palette, sel.c2)) ? sel.c2 : it.defaults.c2;
      out[slot] = o;
    });
    return out;
  }
  function b64(s) { return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'); }
  function unb64(s) { return typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary'); }
  function encode(a) {
    var s = sanitize(a), parts = [s.skin.slice(1)];
    PART_SLOTS.forEach(function (slot) { var o = s[slot]; parts.push([o.id, o.c1 ? o.c1.slice(1) : '', o.c2 ? o.c2.slice(1) : ''].join('.')); });
    return 'CR1-' + b64(parts.join('|')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(code) {
    try {
      var raw = unb64(String(code).replace(/^CR1-/, '').replace(/-/g, '+').replace(/_/g, '/'));
      var parts = raw.split('|'), a = { v: 1, skin: '#' + parts[0] };
      PART_SLOTS.forEach(function (slot, i) {
        var p = (parts[i + 1] || 'none..').split('.');
        a[slot] = { id: p[0] }; if (p[1]) a[slot].c1 = '#' + p[1]; if (p[2]) a[slot].c2 = '#' + p[2];
      });
      return sanitize(a);
    } catch (e) { return defaultAvatar(); }
  }
  function mulberry(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function makeRng(seedOrRng) {
    if (typeof seedOrRng === 'function') return seedOrRng;
    return mulberry(seedOrRng == null ? (Date.now() ^ Math.floor(Math.random() * 1e9)) : seedOrRng);
  }
  var DEFAULT_ODDS = { basic: 70, mid: 25, legendary: 5 };
  // Odds are percentages per rarity, e.g. { basic: 70, mid: 25, legendary: 5 }. They don't have to add to 100.
  function normOdds(odds) {
    var o = {}, total = 0;
    RARITIES.forEach(function (r) { var v = odds && odds[r.id] != null ? Number(odds[r.id]) : (odds ? 0 : DEFAULT_ODDS[r.id]); o[r.id] = isFinite(v) && v > 0 ? v : 0; total += o[r.id]; });
    if (!total) return Object.assign({}, DEFAULT_ODDS);
    return o;
  }
  // Roll one rarity using the odds, limited to the rarities that actually exist in `available`.
  // If none of the available rarities has odds above 0, falls back to the lowest available.
  function rollRarity(rng, odds, available) {
    var ids = available.filter(function (r) { return odds[r] > 0; });
    if (!ids.length) return available.slice().sort(function (x, y) { return rarityRank(x) - rarityRank(y); })[0];
    var total = ids.reduce(function (t, r) { return t + odds[r]; }, 0), roll = rng() * total;
    for (var i = 0; i < ids.length; i++) { if (roll < odds[ids[i]]) return ids[i]; roll -= odds[ids[i]]; }
    return ids[ids.length - 1];
  }
  // When a required slot has nothing at any rarity you gave odds to, use the closest rarity it does have
  // (below the highest one you asked for first, then above).
  function nearestRarity(have, odds) {
    var top = Math.max.apply(null, RARITIES.filter(function (r) { return odds[r.id] > 0; }).map(function (r) { return rarityRank(r.id); }));
    var below = have.filter(function (r) { return rarityRank(r) < top; }).sort(function (x, y) { return rarityRank(y) - rarityRank(x); });
    return below.length ? below[0] : have.slice().sort(function (x, y) { return rarityRank(x) - rarityRank(y); })[0];
  }
  function uniq(arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function rollColor(rng, name, odds) {
    var pal = palette(name), r = rollRarity(rng, odds, uniq(pal.map(function (c) { return c.rarity; })));
    var c = pick(rng, pal.filter(function (x) { return x.rarity === r; }));
    return { hex: c.hex, rarity: c.rarity };
  }
  var EMPTY_CHANCE = { hat: 0.55, face: 0.75, neck: 0.75, back: 0.85, held: 0.45, cheeks: 0.3, hair: 0.05, shoes: 0.05 };

  /**
   * One random avatar, rolled slot by slot with rarity odds.
   *   roll(seed?, { odds: { basic: 70, mid: 25, legendary: 5 } })
   *   -> { avatar, rarity, parts: [{ slot, id, name, rarity }], counts: { basic, mid, legendary } }
   * For each slot the engine rolls a rarity, then picks an item of that rarity.
   * A slot that has no item of the rolled rarity re-rolls among the rarities it does have.
   * Optional slots (hat, glasses...) can come out empty only on a Basic roll.
   */
  function roll(seedOrRng, opts) {
    opts = opts || {};
    var rng = makeRng(seedOrRng), odds = normOdds(opts.odds);
    var sk = rollColor(rng, 'skin', odds);
    var a = { v: 1, skin: sk.hex };
    PART_SLOTS.forEach(function (slot) {
      var all = items(slot), real = all.filter(function (it) { return it.id !== 'none'; });
      var none = getItem(slot, 'none');
      var have = uniq(real.map(function (it) { return it.rarity; }));
      var avail = none && have.indexOf('basic') < 0 ? have.concat('basic') : have; // an empty optional slot counts as Basic
      var r, it;
      if (avail.some(function (x) { return odds[x] > 0; })) r = rollRarity(rng, odds, avail);
      else if (none) r = 'basic';
      else r = nearestRarity(have, odds);
      var ofR = real.filter(function (x) { return x.rarity === r; });
      if (r === 'basic' && none && (!ofR.length || (EMPTY_CHANCE[slot] && rng() < EMPTY_CHANCE[slot]))) it = none;
      else it = pick(rng, ofR);
      var o = { id: it.id };
      if (it.colors >= 1) o.c1 = it.palette ? rollColor(rng, it.palette, odds).hex : it.defaults.c1;
      if (it.colors >= 2) o.c2 = it.palette ? rollColor(rng, it.palette, odds).hex : it.defaults.c2;
      a[slot] = o;
    });
    return describe(a);
  }
  // Rarity report for any avatar: its highest rarity, each worn part's rarity, and counts.
  function describe(a) {
    var parts = [], counts = { basic: 0, mid: 0, legendary: 0 };
    PART_SLOTS.forEach(function (slot) {
      var sel = a[slot], it = sel && getItem(slot, sel.id);
      if (!it || it.id === 'none') return;
      parts.push({ slot: slot, id: it.id, name: it.name, rarity: it.rarity });
      counts[it.rarity] = (counts[it.rarity] || 0) + 1;
    });
    return { avatar: a, rarity: avatarRarity(a), parts: parts, counts: counts };
  }
  // Shortcut that returns just the avatar.
  function random(seedOrRng, opts) { return roll(seedOrRng, opts).avatar; }

  /**
   * Many avatars at once.
   *   generate({ count: 12, odds: { basic: 70, mid: 25, legendary: 5 }, seed: 42 })
   *   -> [{ avatar, rarity, parts, counts }, ...]
   * The same seed and odds always give the same avatars.
   */
  function generate(opts) {
    opts = opts || {};
    var rng = makeRng(opts.seed), n = Math.max(1, Math.min(500, opts.count || 1)), out = [];
    for (var i = 0; i < n; i++) out.push(roll(rng, opts));
    return out;
  }

  /**
   * One random item (for drops, rewards, shop rotations later).
   *   rollItem({ odds: { basic: 70, mid: 25, legendary: 5 }, slot: 'hat', seed })
   *   -> { slot, id, name, rarity, c1, c2 }
   * The rarity is rolled first using the odds, then an item of that rarity from any slot (or the given slot).
   */
  function rollItem(opts) {
    opts = opts || {};
    var rng = makeRng(opts.seed), odds = normOdds(opts.odds);
    var slots = opts.slot ? [opts.slot] : PART_SLOTS, all = [];
    slots.forEach(function (s) { items(s).forEach(function (it) { if (it.id !== 'none') all.push(it); }); });
    if (!all.length) return null;
    var r = rollRarity(rng, odds, uniq(all.map(function (it) { return it.rarity; })));
    var it = pick(rng, all.filter(function (x) { return x.rarity === r; }));
    var out = { slot: it.slot, id: it.id, name: it.name, rarity: it.rarity }, d = it.defaults || {};
    if (it.colors >= 1) out.c1 = it.palette ? rollColor(rng, it.palette, { basic: 1, mid: 0, legendary: 0 }).hex : d.c1;
    if (it.colors >= 2) out.c2 = it.palette ? rollColor(rng, it.palette, { basic: 1, mid: 0, legendary: 0 }).hex : d.c2;
    return out;
  }

  var API = {
    W: W, H: H, SLOTS: SLOTS, PART_SLOTS: PART_SLOTS, RARITIES: RARITIES,
    items: items, getItem: getItem, palette: palette, colorRarity: colorRarity, rarityRank: rarityRank,
    defaultAvatar: defaultAvatar, compose: compose, draw: draw, frame: frame,
    wornParts: wornParts, avatarRarity: avatarRarity, sanitize: sanitize,
    encode: encode, decode: decode, random: random, roll: roll, generate: generate, rollItem: rollItem, describe: describe, DEFAULT_ODDS: DEFAULT_ODDS, OVERALL_RULES: OVERALL_RULES,
    seeded: mulberry, ramp: ramp, PRESETS: PRESETS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.CafeAvatar = API;
})(typeof window !== 'undefined' ? window : globalThis);
