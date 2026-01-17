
import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();
const PORT = process.env.PORT || 8080;
app.use(helmet());
app.use(cors({ origin: '*', methods: ['GET'] }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }));

const ASUS_PAGES_UX8406 = {
  product: 'https://www.asus.com/us/laptops/for-home/zenbook/asus-zenbook-duo-2024-ux8406/',
  techspec: 'https://www.asus.com/laptops/for-home/zenbook/asus-zenbook-duo-2024-ux8406/techspec/'
};

async function fetchHtml(url) {
  const res = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ASUS-Model-Viewer/1.0)',
      'Accept-Language': 'en-US,en;q=0.9,he;q=0.8'
    }
  });
  return res.data;
}

function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }
function classifyRoleFromUrl(url) {
  const u = url.toLowerCase();
  if (u.includes('hero') || u.includes('kv') || u.includes('keyvisual')) return 'hero';
  if (u.includes('dual') || u.includes('duo')) return 'mode-dual-screen';
  if (u.includes('laptop')) return 'mode-laptop';
  if (u.includes('desktop')) return 'desktop-mode';
  if (u.includes('kickstand')) return 'kickstand';
  if (u.includes('port') || u.includes('io')) return 'ports';
  if (u.includes('pen')) return 'pen';
  return 'lifestyle';
}
function parseImagesFromHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const urls = [];
  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    const alt = ($(el).attr('alt') || '').trim();
    if (!src) return;
    if (!/\.(png|jpe?g|webp)(\?|$)/i.test(src)) return;
    const full = src.startsWith('http') ? src : new URL(src, baseUrl).href;
    urls.push({ url: full, alt });
  });
  $('picture source').each((_, el) => {
    const srcset = ($(el).attr('srcset') || '').split(',').map(s => s.trim().split(' ')[0]);
    srcset.forEach(src => {
      if (!src) return;
      if (!/\.(png|jpe?g|webp)(\?|$)/i.test(src)) return;
      const full = src.startsWith('http') ? src : new URL(src, baseUrl).href;
      urls.push({ url: full, alt: '' });
    });
  });
  const filtered = urls
    .filter(x => /asus\.com|dlcdnwebimgs\.asus\.com/i.test(x.url))
    .map(x => ({ ...x, role: classifyRoleFromUrl(x.url) }));
  const seen = new Set();
  return filtered.filter(x => { if (seen.has(x.url)) return false; seen.add(x.url); return true; });
}

function tryParseSpecsFromHtml(html) {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ').toLowerCase();
  const gotOLED = text.includes('oled') && (text.includes('2880 x 1800') || text.includes('1920 x 1200'));
  const gotPorts = text.includes('thunderbolt') || text.includes('hdmi');
  const gotCpu = text.includes('core ultra');
  if (!(gotOLED && gotPorts && gotCpu)) return null;

  const specs = {};
  if (text.includes('2880 x 1800') || text.includes('3k')) {
    specs.display = specs.display || {};
    specs.display.options = ['14" OLED 3K (2880x1800) up to 120Hz', '14" OLED FHD+ (1920x1200) 60Hz'];
  }
  if (text.includes('true black 500') || text.includes('hdr')) {
    specs.display = specs.display || {};
    specs.display.hdr = 'VESA HDR True Black 500, 100% DCI-P3, Pantone Validated';
  }
  if (text.includes('core ultra')) {
    specs.cpu = ['Intel Core Ultra 5 125H', 'Intel Core Ultra 7 155H / 255H', 'Intel Core Ultra 9 185H / 285H'];
  }
  if (text.includes('arc')) specs.gpu = 'Intel Arc Graphics';
  if (text.includes('lpddr5x')) specs.memory = '16GB / 32GB LPDDR5X (soldered)';
  if (text.includes('m.2') || text.includes('pcie 4.0')) specs.storage = 'M.2 NVMe PCIe 4.0 (up to 2TB), single slot 2280';
  if (text.includes('thunderbolt 4') || text.includes('usb 4')) specs.ports = ['2x Thunderbolt 4', '1x USB-A 3.2 Gen1', '1x HDMI 2.1 (TMDS)', '3.5mm audio jack'];
  if (text.includes('75wh')) specs.battery = '75Wh, USB-C 65W';
  if (text.includes('wi-fi 7') || text.includes('802.11be')) specs.wireless = 'Wi‑Fi 7 + Bluetooth 5.4 (some variants), otherwise Wi‑Fi 6E + BT 5.3';
  return specs;
}

const FALLBACK_SPEC_UX8406 = {
  model: 'UX8406',
  family: 'ASUS Zenbook DUO (2024)',
  variants: ['UX8406MA', 'UX8406CA'],
  display: {
    panels: 2,
    sizes_inches: '14.0" + 14.0"',
    options: ['14" OLED 3K (2880x1800) 120Hz', '14" OLED FHD+ (1920x1200) 60Hz'],
    hdr: 'VESA HDR True Black 500, 100% DCI-P3, Pantone Validated, Touch + Pen'
  },
  cpu: ['Intel Core Ultra 5 125H', 'Intel Core Ultra 7 155H / 255H', 'Intel Core Ultra 9 185H / 285H'],
  ai_npu: 'Intel AI Boost NPU (~11–13 TOPS by variant)',
  gpu: 'Intel Arc Graphics (integrated)',
  memory: '16GB or 32GB LPDDR5X (on-board)',
  storage: 'M.2 NVMe PCIe 4.0 — 512GB/1TB/2TB (single 2280 slot)',
  ports: ['2× Thunderbolt 4', '1× USB‑A 3.2 Gen1', '1× HDMI 2.1 (TMDS)', '1× 3.5mm audio jack'],
  camera: 'FHD + IR (Windows Hello)',
  wireless: 'Wi‑Fi 6E + BT 5.3 (some variants with Wi‑Fi 7 + BT 5.4)',
  battery: '75Wh, USB‑C 65W',
  dimensions_weight: { dimensions: '≈ 12.34" × 8.58" × 0.57–0.78"', weight_approx: '≈ 1.6–1.7 kg incl. keyboard' },
  sources: [ASUS_PAGES_UX8406.product, ASUS_PAGES_UX8406.techspec]
};

function marketingCopy({ lang = 'he' } = {}) {
  if (lang === 'en') {
    return {
      headline: 'Zenbook DUO UX8406 — Dual 14" OLED productivity, anywhere',
      subheadline: 'Two 14" OLED panels up to 3K/120Hz, Intel Core Ultra with NPU, detachable keyboard.',
      key_benefits: [
        'Dual 14" OLED (up to 3K/120Hz) to reduce window switching and speed up workflows',
        'Intel Core Ultra with Intel Arc and AI Boost NPU for smart performance',
        'Portable setup: detachable Bluetooth keyboard, kickstand, 75Wh battery, 65W USB‑C',
        'Modern I/O: 2× TB4, HDMI 2.1, USB‑A, 3.5mm'
      ],
      short_description:
        'UX8406 brings true dual-screen productivity anywhere. Two sharp 14" OLED panels, Intel Core Ultra with NPU, and TB4 I/O pack desktop flexibility into a portable design.',
      sources: FALLBACK_SPEC_UX8406.sources
    };
  }
  return {
    headline: 'Zenbook DUO UX8406 — פרודוקטיביות של שני מסכים, בכל מקום',
    subheadline: 'שני מסכי OLED בגודל 14״ (עד 3K/120Hz), מעבדי Intel Core Ultra עם NPU, ומקלדת מתנתקת.',
    key_benefits: [
      'שתי תצוגות OLED 14״ (עד 3K/120Hz) להפחתת קפיצות בין חלונות והאצת זרימות עבודה',
      'Intel Core Ultra עם Intel Arc ו‑AI Boost NPU לביצועים חכמים',
      'ניידות מלאה: מקלדת Bluetooth מתנתקת, מעמד מובנה, סוללת 75Wh וטעינת USB‑C 65W',
      'חיבורים מודרניים: 2× Thunderbolt 4, HDMI 2.1, USB‑A ושקע אודיו 3.5 מ״מ'
    ],
    short_description:
      'ה‑UX8406 מביא חוויית עבודה של שני מסכים לכל מקום. שני פאנלי OLED 14״ חדים, Intel Core Ultra עם NPU, וחיבורי TB4 מספקים שילוב של צבעים מדויקים וניידות.',
    sources: FALLBACK_SPEC_UX8406.sources
  };
}

// Health
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'asus-model-api', time: new Date().toISOString() }));

// SPEC
app.get('/api/spec', async (req, res) => {
  try {
    const model = (req.query.model || '').toUpperCase().trim();
    if (!model) return res.status(400).json({ error: 'Missing ?model=' });
    if (!/^UX8406/.test(model)) return res.status(501).json({ error: 'Model not supported yet', supported: ['UX8406'] });

    let parsed = null;
    try {
      const html = await fetchHtml(ASUS_PAGES_UX8406.techspec);
      parsed = tryParseSpecsFromHtml(html);
    } catch (_) {}
    const payload = {
      model: 'UX8406',
      family: FALLBACK_SPEC_UX8406.family,
      variants: FALLBACK_SPEC_UX8406.variants,
      display: parsed?.display || FALLBACK_SPEC_UX8406.display,
      cpu_options: parsed?.cpu || FALLBACK_SPEC_UX8406.cpu,
      ai_npu: FALLBACK_SPEC_UX8406.ai_npu,
      gpu: parsed?.gpu || FALLBACK_SPEC_UX8406.gpu,
      memory: parsed?.memory || FALLBACK_SPEC_UX8406.memory,
      storage: parsed?.storage || FALLBACK_SPEC_UX8406.storage,
      io_ports: parsed?.ports || FALLBACK_SPEC_UX8406.ports,
      camera: FALLBACK_SPEC_UX8406.camera,
      wireless: parsed?.wireless || FALLBACK_SPEC_UX8406.wireless,
      battery: parsed?.battery || FALLBACK_SPEC_UX8406.battery,
      dimensions_weight: FALLBACK_SPEC_UX8406.dimensions_weight,
      sources: FALLBACK_SPEC_UX8406.sources,
      fetched_at: new Date().toISOString()
    };
    res.json(payload);
  } catch (err) { res.status(500).json({ error: 'Internal error', detail: String(err) }); }
});

// IMAGES
app.get('/api/images', async (req, res) => {
  try {
    const model = (req.query.model || '').toUpperCase().trim();
    if (!model) return res.status(400).json({ error: 'Missing ?model=' });
    if (!/^UX8406/.test(model)) return res.status(501).json({ error: 'Model not supported yet', supported: ['UX8406'] });

    let images = [];
    try {
      const [pHtml, sHtml] = await Promise.all([fetchHtml(ASUS_PAGES_UX8406.product), fetchHtml(ASUS_PAGES_UX8406.techspec)]);
      const fromProduct = parseImagesFromHtml(pHtml, ASUS_PAGES_UX8406.product);
      const fromSpec = parseImagesFromHtml(sHtml, ASUS_PAGES_UX8406.techspec);
      images = uniq([...fromProduct, ...fromSpec].map(x => JSON.stringify(x))).map(s => JSON.parse(s));
    } catch (_) {}

    res.json({
      model: 'UX8406',
      source_pages: [ASUS_PAGES_UX8406.product, ASUS_PAGES_UX8406.techspec],
      images,
      note: 'URLs are linked/embedded from ASUS. Do not re-host. © ASUS',
      fetched_at: new Date().toISOString()
    });
  } catch (err) { res.status(500).json({ error: 'Internal error', detail: String(err) }); }
});

// MARKETING
app.get('/api/marketing', async (req, res) => {
  try {
    const model = (req.query.model || '').toUpperCase().trim();
    const lang = (req.query.lang || 'he').toLowerCase();
    if (!model) return res.status(400).json({ error: 'Missing ?model=' });
    if (!/^UX8406/.test(model)) return res.status(501).json({ error: 'Model not supported yet', supported: ['UX8406'] });

    const copy = marketingCopy({ lang });
    res.json({ model: 'UX8406', lang, ...copy, fetched_at: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: 'Internal error', detail: String(err) }); }
});

app.listen(PORT, () => console.log(`ASUS model API listening on http://localhost:${PORT}`));
``
