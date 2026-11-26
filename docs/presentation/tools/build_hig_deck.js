/* Build docs/presentation/SecureSynth_Deck.pptx from the humanize-ppt brief in docs/presentation/brief/.
 *
 * Visual language follows Apple's keynote style: one claim per slide, large type, black/white with a single
 * system-blue accent, real screenshots in rounded frames, Lucide icons in tinted rounded squares (the app's motif).
 *
 * Needs pptxgenjs, sharp, react, react-dom and lucide-react. The last three come from frontend/node_modules:
 *   npm install --no-save pptxgenjs@3.12.0 sharp@0.33.5     (anywhere, then point NODE_PATH at it)
 *   NODE_PATH=<that>/node_modules:frontend/node_modules node docs/presentation/tools/build_hig_deck.js
 */
const fs = require('fs');
const path = require('path');
const pptxgen = require('pptxgenjs');
const sharp = require('sharp');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const L = require('lucide-react');

const ROOT = path.resolve(__dirname, '../../..');
const BRIEF = path.join(ROOT, 'docs/presentation/brief');
const OUT = path.join(ROOT, 'docs/presentation/SecureSynth_Deck.pptx');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ssdeck-'));

const plan = JSON.parse(fs.readFileSync(path.join(BRIEF, 'slide_plan.json'), 'utf8')).slides;
const notes = Object.fromEntries(
  fs.readFileSync(path.join(BRIEF, 'speaker_intent.md'), 'utf8').split('\n')
    .map((l) => l.match(/^(\d+)\. \*\*(.+?)\*\* (.+)$/)).filter(Boolean).map((m) => [Number(m[1]), m[3]]));

/* ---------- palette (Apple system colours) */
const K = {
  black: '0B0F17', ink: '1D1D1F', ink2: '424245', ink3: '6E6E73', hair: 'D2D2D7', fog: 'F5F5F7', white: 'FFFFFF',
  blue: '0A84FF', blueTint: 'E8F2FF', green: '30D158', greenInk: '248A3D', orange: 'FF9F0A', orangeInk: 'C93400', red: 'FF453A', redInk: 'D70015',
  dark2: '1C1C1E', dark3: '2C2C2E', darkInk2: 'A1A1A6',
};
const FONT = 'Helvetica Neue';
const W = 13.333, H = 7.5, M = 0.7;

/* ---------- assets */
async function icon(name, color, px = 256) {
  const svg = renderToStaticMarkup(React.createElement(L[name], { size: 24, color: `#${color}`, strokeWidth: 1.75 }));
  const buf = await sharp(Buffer.from(svg)).resize(px, px).png().toBuffer();
  return 'image/png;base64,' + buf.toString('base64');
}
/* Screenshot with rounded corners, flattened onto the slide background (keeps JPEG size small). */
async function framed(rel, wIn, bg) {
  const src = path.join(ROOT, rel);
  const meta = await sharp(src).metadata();
  const pxW = Math.min(meta.width, 2400), pxH = Math.round(pxW * meta.height / meta.width);
  const r = Math.round(pxW * (0.16 / wIn));
  const mask = Buffer.from(`<svg width="${pxW}" height="${pxH}"><rect width="${pxW}" height="${pxH}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
  const out = path.join(TMP, path.basename(rel).replace(/\.\w+$/, '') + `-${bg}.jpg`);
  await sharp(src).resize(pxW, pxH).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }])
    .flatten({ background: `#${bg}` }).jpeg({ quality: 82, mozjpeg: true }).toFile(out);
  return { path: out, ratio: meta.height / meta.width };
}

(async () => {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = 'SecureSynth';
  pres.subject = 'Risk-based authentication and account takeover detection';
  pres.author = 'Team The_Terminators';
  pres.company = "AVISHKAR'26";
  pres.theme = { headFontFace: FONT, bodyFontFace: FONT };

  const footer = (dark) => [
    { text: { text: 'SecureSynth', options: { x: M, y: H - 0.5, w: 3, h: 0.3, fontSize: 10, color: dark ? K.darkInk2 : K.ink3, margin: 0 } } },
  ];
  const num = (dark) => ({ x: W - M - 0.6, y: H - 0.5, w: 0.6, h: 0.3, fontSize: 10, color: dark ? K.darkInk2 : K.ink3, align: 'right' });
  const titlePh = (dark) => ({ placeholder: { options: { name: 'title', type: 'title', x: M, y: 0.5, w: W - 2 * M, h: 1.0, fontSize: 36, bold: true, color: dark ? K.white : K.ink, valign: 'top', margin: 0, fontFace: FONT }, text: '' } });
  pres.defineSlideMaster({ title: 'LIGHT', background: { color: K.white }, objects: [...footer(false), titlePh(false)], slideNumber: num(false) });
  pres.defineSlideMaster({ title: 'DARK', background: { color: K.black }, objects: [...footer(true), titlePh(true)], slideNumber: num(true) });
  pres.defineSlideMaster({ title: 'DARK_BLANK', background: { color: K.black }, objects: [] });

  const P = Object.fromEntries(plan.map((s) => [s.id, s]));
  const T = (o) => ({ isTextBox: true, margin: 0, fontFace: FONT, ...o });
  const newSlide = (id, master) => {
    const s = pres.addSlide({ masterName: master, sectionTitle: currentSection });
    if (master !== 'DARK_BLANK') s.addText(P[id].title, { placeholder: 'title' });
    if (notes[P[id].n]) s.addNotes(notes[P[id].n]);
    return s;
  };
  let currentSection = '';
  const section = (t) => { currentSection = t; pres.addSection({ title: t }); };
  const tile = async (s, x, y, name, tint, fg, size = 0.56) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: size, h: size, rectRadius: 0.14, fill: { color: tint }, line: { color: tint }, objectName: `icon-tile-${name}` });
    s.addImage({ data: await icon(name, fg), x: x + size * 0.22, y: y + size * 0.22, w: size * 0.56, h: size * 0.56, altText: name });
  };
  const card = (s, x, y, w, h, fill = K.fog, name = 'card') =>
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.18, fill: { color: fill }, line: { color: fill }, objectName: name });
  const shot = async (s, rel, x, y, w, bg, alt, border) => {
    const f = await framed(rel, w, bg);
    const h = w * f.ratio;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x - 0.02, y: y - 0.02, w: w + 0.04, h: h + 0.04, rectRadius: 0.17, fill: { color: border }, line: { color: border }, objectName: 'screenshot-frame' });
    s.addImage({ path: f.path, x, y, w, h, altText: alt });
    return h;
  };

  /* 1. Title */
  section('Opening');
  {
    const s = pres.addSlide({ masterName: 'DARK_BLANK', sectionTitle: currentSection });
    s.addNotes(notes[1]);
    s.addImage({ path: path.join(ROOT, 'frontend/public/brand/synth-core-dark-1024.png'), x: M, y: 0.6, w: 0.75, h: 0.75, altText: 'SecureSynth logo' });
    s.addText('SecureSynth', T({ x: M, y: 2.15, w: 5.6, h: 1.1, fontSize: 60, bold: true, color: K.white, charSpacing: -1 }));
    s.addText("Possession isn't presence.", T({ x: M, y: 3.3, w: 5.6, h: 0.7, fontSize: 28, color: K.darkInk2 }));
    s.addText('Risk-based authentication and account takeover detection that keeps checking after sign-in.', T({ x: M, y: 4.25, w: 5.0, h: 0.9, fontSize: 16, color: K.darkInk2, valign: 'top' }));
    s.addText("AVISHKAR'26  ·  Problem 24  ·  Team The_Terminators", T({ x: M, y: H - 0.9, w: 6, h: 0.35, fontSize: 12, color: K.ink3 }));
    await shot(s, P.title.media.image, 6.55, 1.55, 6.1, K.black, 'SecureSynth landing page', K.dark3);
  }

  /* 2. The gap */
  section('The problem');
  {
    const s = newSlide('gap', 'LIGHT');
    const cards = [
      ['Fish', 'Phishing relay', 'A fake page forwards the one-time code to the real bank while the customer is still typing it.'],
      ['Smartphone', 'SIM swap', 'The attacker moves the phone number to their own SIM and receives the SMS code.'],
      ['MonitorSmartphone', 'Session hijack', 'The customer signs in properly, then someone else takes over the open session.'],
    ];
    const cw = (W - 2 * M - 2 * 0.35) / 3;
    for (let i = 0; i < 3; i++) {
      const x = M + i * (cw + 0.35), y = 1.75;
      card(s, x, y, cw, 2.85, K.fog, `attack-${i}`);
      await tile(s, x + 0.35, y + 0.35, cards[i][0], K.blueTint, K.blue);
      s.addText(cards[i][1], T({ x: x + 0.35, y: y + 1.12, w: cw - 0.7, h: 0.45, fontSize: 20, bold: true, color: K.ink }));
      s.addText(cards[i][2], T({ x: x + 0.35, y: y + 1.6, w: cw - 0.7, h: 1.0, fontSize: 15, color: K.ink2, valign: 'top' }));
    }
    s.addText('0 of 367', T({ x: M, y: 5.0, w: 4.0, h: 1.1, fontSize: 64, bold: true, color: K.blue, charSpacing: -1 }));
    s.addText('takeovers stopped by password plus OTP alone in our evaluation. Every one arrived with valid credentials.', T({ x: 4.85, y: 5.15, w: 7.7, h: 0.85, fontSize: 18, color: K.ink2, valign: 'middle' }));
  }

  /* 3. Static rules */
  {
    const s = newSlide('rules', 'LIGHT');
    const stats = [['98.6%', 'of genuine travellers were challenged by static rules'], ['28.6%', 'of all genuine sessions were interrupted']];
    const cw = (W - 2 * M - 0.35) / 2;
    stats.forEach(([n, l], i) => {
      const x = M + i * (cw + 0.35);
      card(s, x, 1.75, cw, 3.3, K.fog, `stat-${i}`);
      s.addText(n, T({ x: x + 0.45, y: 2.05, w: cw - 0.9, h: 1.6, fontSize: 96, bold: true, color: K.ink, charSpacing: -2 }));
      s.addText(l, T({ x: x + 0.45, y: 3.75, w: cw - 0.9, h: 0.9, fontSize: 20, color: K.ink2, valign: 'top' }));
    });
    s.addText('Rules did catch 76.6% of takeovers. The cost of that lands on the customers who were never under attack.', T({ x: M, y: 5.45, w: W - 2 * M, h: 0.8, fontSize: 18, color: K.ink3 }));
  }

  /* 4. Decision loop */
  section('The idea');
  {
    const s = newSlide('loop', 'LIGHT');
    const steps = [['KeyRound', 'Sign in', 'Password (Argon2id) and a real TOTP code'], ['Activity', 'Score', 'At login, payee creation and every transfer'],
      ['Scale', 'Decide', 'The backend enforces the result'], ['Smartphone', 'Verify', 'Number match on a separate trusted device']];
    const bw = 2.6, gap = (W - 2 * M - 4 * bw) / 3;
    for (let i = 0; i < 4; i++) {
      const x = M + i * (bw + gap), y = 1.75;
      card(s, x, y, bw, 2.35, K.fog, `step-${i}`);
      await tile(s, x + 0.3, y + 0.3, steps[i][0], K.blueTint, K.blue, 0.5);
      s.addText(steps[i][1], T({ x: x + 0.3, y: y + 0.95, w: bw - 0.6, h: 0.42, fontSize: 20, bold: true, color: K.ink }));
      s.addText(steps[i][2], T({ x: x + 0.3, y: y + 1.4, w: bw - 0.6, h: 0.8, fontSize: 14, color: K.ink2, valign: 'top' }));
      if (i < 3) s.addShape(pres.shapes.RIGHT_ARROW, { x: x + bw + gap / 2 - 0.16, y: y + 1.05, w: 0.32, h: 0.28, fill: { color: K.hair }, line: { color: K.hair }, objectName: `arrow-${i}` });
    }
    const outs = [['ALLOW', K.greenInk, 'E9F8EE', 'Carries on'], ['STEP-UP', K.orangeInk, 'FFF4E5', 'Trusted device decides'], ['BLOCK', K.redInk, 'FFECEB', 'Session restricted']];
    const ow = (W - 2 * M - 2 * 0.3) / 3;
    outs.forEach(([t, ink, tint, d], i) => {
      const x = M + i * (ow + 0.3), y = 4.45;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: ow, h: 0.85, rectRadius: 0.42, fill: { color: tint }, line: { color: tint }, objectName: `outcome-${t}` });
      s.addText([{ text: t, options: { bold: true, color: ink } }, { text: `  ${d}`, options: { color: K.ink2 } }], T({ x: x + 0.35, y, w: ow - 0.45, h: 0.85, fontSize: 15, valign: 'middle', wrap: false }));
    });
    s.addText('score = 0.8 × ML index + policy points    ·    step-up at 77.73    ·    block at 89.1', T({ x: M, y: 5.6, w: W - 2 * M, h: 0.45, fontSize: 14, color: K.ink3, fontFace: 'Menlo' }));
  }

  /* 5. Normal is personal */
  {
    const s = newSlide('personal', 'LIGHT');
    const pts = [['User', '15 features, each measured against this customer’s own history'], ['Trees', 'One shared Isolation Forest turns them into a rarity percentile'],
      ['ListChecks', 'Written policy points on top, shown to analysts line by line']];
    for (let i = 0; i < 3; i++) {
      const y = 1.85 + i * 1.18;
      await tile(s, M, y, pts[i][0], K.blueTint, K.blue, 0.5);
      s.addText(pts[i][1], T({ x: M + 0.75, y: y - 0.04, w: 3.85, h: 0.95, fontSize: 17, color: K.ink, valign: 'top' }));
    }
    s.addText('A 2 a.m. sign-in is ordinary for a night-shift worker and strange for someone who works nine to five.', T({ x: M, y: 5.5, w: 4.6, h: 0.9, fontSize: 14, color: K.ink3, italic: true, valign: 'top' }));
    await shot(s, P.personal.media.image, 5.65, 1.75, 6.95, K.white, 'Command Centre explaining a live session', K.hair);
  }

  /* 6. Learning */
  {
    const s = newSlide('learning', 'LIGHT');
    card(s, M, 1.85, 3.6, 2.6, K.fog, 'candidate');
    await tile(s, M + 0.35, 2.15, 'Inbox', 'EDEDF0', K.ink3, 0.5);
    s.addText('Candidate profile', T({ x: M + 0.35, y: 2.8, w: 2.9, h: 0.45, fontSize: 20, bold: true, color: K.ink }));
    s.addText('Collects new behaviour. Never used for scoring.', T({ x: M + 0.35, y: 3.3, w: 2.9, h: 0.9, fontSize: 15, color: K.ink2, valign: 'top' }));
    const gx = M + 3.6 + 0.45, gw = W - 2 * M - 2 * 3.6 - 0.9;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: gx, y: 1.85, w: gw, h: 2.6, rectRadius: 0.18, fill: { color: K.white }, line: { color: K.hair, width: 1 }, objectName: 'gate' });
    s.addText('Promoted only when', T({ x: gx + 0.35, y: 2.05, w: gw - 0.7, h: 0.4, fontSize: 14, color: K.ink3 }));
    s.addText([
      { text: 'The customer verified it on the trusted device', options: { bullet: true, breakLine: true } },
      { text: 'Two clean sessions followed', options: { bullet: true, breakLine: true } },
      { text: '24 hours have passed', options: { bullet: true } }], T({ x: gx + 0.35, y: 2.5, w: gw - 0.7, h: 1.7, fontSize: 17, color: K.ink, paraSpaceAfter: 8, valign: 'top' }));
    const tx = W - M - 3.6;
    card(s, tx, 1.85, 3.6, 2.6, K.blueTint, 'trusted');
    await tile(s, tx + 0.35, 2.15, 'ShieldCheck', K.blue, K.white, 0.5);
    s.addText('Trusted profile', T({ x: tx + 0.35, y: 2.8, w: 2.9, h: 0.45, fontSize: 20, bold: true, color: K.ink }));
    s.addText('The only baseline used to score sessions.', T({ x: tx + 0.35, y: 3.3, w: 2.9, h: 0.9, fontSize: 15, color: K.ink2, valign: 'top' }));
    s.addShape(pres.shapes.RIGHT_ARROW, { x: M + 3.6 + 0.07, y: 3.0, w: 0.32, h: 0.3, fill: { color: K.hair }, line: { color: K.hair }, objectName: 'arrow-in' });
    s.addShape(pres.shapes.RIGHT_ARROW, { x: tx - 0.38, y: 3.0, w: 0.32, h: 0.3, fill: { color: K.hair }, line: { color: K.hair }, objectName: 'arrow-out' });
    const facts = [['Plane', 'Verified travel becomes a 7-day window, not permanent trust'], ['Ban', 'Blocked sessions lose everything they contributed'], ['History', 'Every change is versioned and can be rolled back']];
    const fw = (W - 2 * M - 2 * 0.35) / 3;
    for (let i = 0; i < 3; i++) {
      const x = M + i * (fw + 0.35);
      await tile(s, x, 4.95, facts[i][0], K.fog, K.ink2, 0.46);
      s.addText(facts[i][1], T({ x: x + 0.65, y: 4.9, w: fw - 0.7, h: 0.85, fontSize: 15, color: K.ink2, valign: 'top' }));
    }
  }

  /* 7. Result */
  section('The evidence');
  {
    const s = newSlide('result', 'LIGHT');
    s.addChart(pres.charts.BAR, [
      { name: 'Static rules', labels: ['Takeovers caught', 'Genuine sessions interrupted', 'Travellers interrupted'], values: [76.6, 28.6, 98.6] },
      { name: 'SecureSynth', labels: ['Takeovers caught', 'Genuine sessions interrupted', 'Travellers interrupted'], values: [91.3, 5.2, 16.7] },
    ], {
      x: M, y: 1.7, w: 7.6, h: 4.4, barDir: 'col', barGapWidthPct: 60, chartColors: ['AEAEB2', K.blue],
      showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '0.0"%"', dataLabelFontSize: 12, dataLabelColor: K.ink2, dataLabelFontFace: '+mn-lt',
      valAxisHidden: true, valAxisMaxVal: 110, valAxisMinVal: 0, valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
      catAxisLabelColor: K.ink2, catAxisLabelFontSize: 13, catAxisLabelFontFace: '+mn-lt', catAxisLineShow: false,
      showLegend: true, legendPos: 't', legendFontSize: 13, legendColor: K.ink2, legendFontFace: '+mn-lt',
      showTitle: false, objectName: 'results-chart', altText: 'Static rules versus SecureSynth: takeovers caught 76.6% vs 91.3%, genuine sessions interrupted 28.6% vs 5.2%, travellers interrupted 98.6% vs 16.7%',
    });
    const big = [['91.3%', 'of takeovers caught', 'static rules: 76.6%'], ['5.2%', 'of genuine sessions interrupted', 'static rules: 28.6%']];
    big.forEach(([n, l, c], i) => {
      const y = 1.85 + i * 2.05;
      s.addText(n, T({ x: 8.75, y, w: 3.9, h: 1.05, fontSize: 66, bold: true, color: i === 0 ? K.blue : K.ink, charSpacing: -1 }));
      s.addText(l, T({ x: 8.75, y: y + 1.05, w: 3.9, h: 0.4, fontSize: 17, color: K.ink }));
      s.addText(c, T({ x: 8.75, y: y + 1.45, w: 3.9, h: 0.35, fontSize: 14, color: K.ink3 }));
    });
    s.addText('Protocol written before results. Model frozen. Fresh population (seed 9091): 4,665 sessions, 367 takeovers, scored once.', T({ x: M, y: 6.3, w: W - 2 * M, h: 0.4, fontSize: 13, color: K.ink3 }));
  }

  /* 8. Honest */
  {
    const s = newSlide('honest', 'LIGHT');
    const items = [['₹2.96 cr', 'Attack money prevented', 'Static rules prevented ₹2.98 cr, because they challenge nearly everyone.'],
      ['₹25 lakh', 'Genuine money blocked outright', 'Static rules blocked ₹0.3 lakh. Our blocks are more aggressive.'],
      ['58.6%', 'Familiar-device hijacks caught', 'Same device, same city, same hour: little in the behaviour to separate on.']];
    const cw = (W - 2 * M - 2 * 0.35) / 3;
    items.forEach(([n, h, d], i) => {
      const x = M + i * (cw + 0.35);
      card(s, x, 1.75, cw, 3.7, K.fog, `honest-${i}`);
      s.addText(n, T({ x: x + 0.4, y: 2.05, w: cw - 0.8, h: 1.0, fontSize: 54, bold: true, color: K.ink, charSpacing: -1 }));
      s.addText(h, T({ x: x + 0.4, y: 3.15, w: cw - 0.8, h: 0.75, fontSize: 18, bold: true, color: K.ink, valign: 'top' }));
      s.addText(d, T({ x: x + 0.4, y: 3.9, w: cw - 0.8, h: 1.3, fontSize: 15, color: K.ink2, valign: 'top' }));
    });
    s.addText('The main gain is less friction, not more money saved. The block false-positive rate also drifted from the 0.5% target to 0.81%.', T({ x: M, y: 5.75, w: W - 2 * M, h: 0.7, fontSize: 16, color: K.ink3 }));
  }

  /* 9. After the block */
  section('Beyond detection');
  {
    const s = newSlide('after', 'LIGHT');
    const stages = [['Ghost', 'Contain', 'Restrict, or isolate in a synthetic bank'], ['Archive', 'Collect evidence', 'Network, device, risk and attempt, encrypted'],
      ['Search', 'Investigate', 'Queue, workspace, timeline, correlation graph'], ['FileText', 'Report', 'Demo complaint or guided portal hand-off'],
      ['UserCheck', 'Recover', 'Fresh verified sign-in, analyst approved']];
    for (let i = 0; i < 5; i++) {
      const y = 1.7 + i * 0.93;
      await tile(s, M, y, stages[i][0], K.blueTint, K.blue, 0.52);
      s.addText(stages[i][1], T({ x: M + 0.75, y: y - 0.02, w: 3.6, h: 0.32, fontSize: 17, bold: true, color: K.ink }));
      s.addText(stages[i][2], T({ x: M + 0.75, y: y + 0.3, w: 4.2, h: 0.32, fontSize: 13, color: K.ink2 }));
    }
    await shot(s, P.after.media.image, 5.65, 1.75, 6.95, K.white, 'Incident queue with analyst decisions', K.hair);
  }

  /* 10. Evidence */
  {
    const s = newSlide('evidence', 'LIGHT');
    await shot(s, P.evidence.media.image, M, 1.75, 6.95, K.white, 'Evidence tab of an investigation', K.hair);
    const x = 8.05, w = W - M - x;
    const blocks = ['Entry 41', 'Entry 42', 'Entry 43'];
    blocks.forEach((b, i) => {
      const y = 1.8 + i * 1.05;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.72, rectRadius: 0.14, fill: { color: K.fog }, line: { color: K.fog }, objectName: `chain-${i}` });
      s.addText([{ text: b, options: { bold: true, color: K.ink } }, { text: '   SHA-256 of item + previous hash', options: { color: K.ink3 } }], T({ x: x + 0.25, y, w: w - 0.4, h: 0.72, fontSize: 13, valign: 'middle' }));
      if (i < 2) s.addShape(pres.shapes.DOWN_ARROW, { x: x + w / 2 - 0.12, y: y + 0.76, w: 0.24, h: 0.24, fill: { color: K.hair }, line: { color: K.hair }, objectName: `chain-arrow-${i}` });
    });
    s.addText([
      { text: 'Change one item and every later hash stops matching.', options: { breakLine: true } },
      { text: 'Verification raises an alert and never repairs anything.' }], T({ x, y: 4.95, w, h: 1.2, fontSize: 15, color: K.ink2, valign: 'top', paraSpaceAfter: 6 }));
    s.addText('Tamper-evident, not immutable.', T({ x, y: 6.25, w, h: 0.4, fontSize: 16, bold: true, color: K.ink }));
  }

  /* 11. Intel (dark) */
  {
    const s = newSlide('intel', 'DARK');
    const links = [['Shared IP address', 'Weak, moderate within 24 hours'], ['Shared device or payee', 'Moderate across different customers'], ['Two or more links', 'Strong']];
    links.forEach(([h, d], i) => {
      const y = 1.9 + i * 1.15;
      s.addText(h, T({ x: M, y, w: 3.6, h: 0.4, fontSize: 18, bold: true, color: K.white }));
      s.addText(d, T({ x: M, y: y + 0.42, w: 3.6, h: 0.4, fontSize: 14, color: K.darkInk2 }));
    });
    s.addText('Every link comes with its explanation and provenance. Nothing in the graph blocks a user or files a report on its own.', T({ x: M, y: 5.35, w: 3.7, h: 1.2, fontSize: 14, color: K.darkInk2, valign: 'top' }));
    await shot(s, P.intel.media.image, 4.75, 1.75, 7.85, K.black, 'Fraud intelligence correlation graph', K.dark3);
  }

  /* 12. Demo (dark) */
  section('Demo');
  {
    const s = newSlide('demo', 'DARK');
    await shot(s, P.demo.media.image, M, 1.75, 7.6, K.black, 'Judge mode: takeover blocked, balance unchanged', K.dark3);
    s.addText([{ text: 'Right password.', options: { breakLine: true } }, { text: 'Right OTP.', options: { breakLine: true } }, { text: 'Wrong person.', options: { color: K.blue } }],
      T({ x: 8.75, y: 1.85, w: 3.9, h: 2.2, fontSize: 32, bold: true, color: K.white, valign: 'top' }));
    s.addText('Judge mode runs the takeover through the real API. It’s blocked at a risk index of 99.1, and the protected balance of ₹96,200 doesn’t move.', T({ x: 8.75, y: 4.25, w: 3.9, h: 1.6, fontSize: 15, color: K.darkInk2, valign: 'top' }));
  }

  /* 13. Built to be checked */
  section('Close');
  {
    const s = newSlide('built', 'LIGHT');
    const tiles = [['165', 'backend tests passing'], ['5.61 ms', 'p95 decision latency'], ['6 / 6', 'frozen model hashes match'], ['0', 'external services needed to run']];
    const tw = (W - 2 * M - 3 * 0.3) / 4;
    tiles.forEach(([n, l], i) => {
      const x = M + i * (tw + 0.3);
      card(s, x, 2.0, tw, 2.6, K.fog, `tile-${i}`);
      s.addText(n, T({ x: x + 0.3, y: 2.35, w: tw - 0.4, h: 1.0, fontSize: 44, bold: true, color: i === 0 ? K.blue : K.ink, charSpacing: -1, fit: 'none', wrap: false }));
      s.addText(l, T({ x: x + 0.3, y: 3.45, w: tw - 0.6, h: 0.9, fontSize: 16, color: K.ink2, valign: 'top' }));
    });
    s.addText('Reproduce it with make test and make eval. The evaluation refuses to run if a frozen file has changed.', T({ x: M, y: 5.1, w: W - 2 * M, h: 0.5, fontSize: 15, color: K.ink3 }));
  }

  /* 14. Next */
  {
    const s = newSlide('next', 'LIGHT');
    const cols = [['What we’ve shown', K.fog, ['Personal baselines cut friction by about four fifths', 'Every decision is explained and enforced on the server', 'The baseline can’t be trained by an attacker', 'Incidents keep their evidence and can be audited']],
      ['What production needs', K.blueTint, ['Validation on real, consented, labelled bank data', 'A real trusted-device app with hardware-backed keys', 'Payee-risk and transaction-intent signals', 'PostgreSQL, TLS, KMS-held keys, distributed rate limits', 'Ledger checkpoints anchored outside the system']]];
    const cw = (W - 2 * M - 0.35) / 2;
    cols.forEach(([h, fill, list], i) => {
      const x = M + i * (cw + 0.35);
      card(s, x, 1.75, cw, 4.6, fill, `col-${i}`);
      s.addText(h, T({ x: x + 0.4, y: 2.0, w: cw - 0.8, h: 0.5, fontSize: 22, bold: true, color: K.ink }));
      s.addText(list.map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < list.length - 1 } })), T({ x: x + 0.4, y: 2.65, w: cw - 0.8, h: 3.4, fontSize: 16, color: K.ink2, paraSpaceAfter: 10, valign: 'top' }));
    });
  }

  /* 15. Close */
  {
    const s = pres.addSlide({ masterName: 'DARK_BLANK', sectionTitle: currentSection });
    s.addNotes(notes[15]);
    s.addImage({ path: path.join(ROOT, 'frontend/public/brand/synth-core-dark-1024.png'), x: W / 2 - 0.55, y: 1.55, w: 1.1, h: 1.1, altText: 'SecureSynth logo' });
    s.addText("Possession isn't presence.", T({ x: 1, y: 3.0, w: W - 2, h: 1.0, fontSize: 48, bold: true, color: K.white, align: 'center', charSpacing: -1 }));
    s.addText('SecureSynth keeps checking, explains itself, and asks the real customer when it isn’t sure.', T({ x: 1.5, y: 4.05, w: W - 3, h: 0.6, fontSize: 20, color: K.darkInk2, align: 'center' }));
    s.addText('github.com/mdhussain398/SecureSynth   ·   Team The_Terminators   ·   AV26-50F33FD4DE', T({ x: 1, y: H - 1.1, w: W - 2, h: 0.4, fontSize: 13, color: K.ink3, align: 'center' }));
  }

  await pres.writeFile({ fileName: OUT });
  console.log('wrote', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
