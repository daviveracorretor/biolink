(() => {
  'use strict';
  const config = window.SITE_CONFIG || {};
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const MAX_PROPERTY_PHOTO_SIZE = 20 * 1024 * 1024;
  const ALLOWED_PROPERTY_PHOTO_TYPES = new Set(['image/jpeg','image/png','image/webp','image/avif','image/heic','image/heif']);
  const ALL_CATEGORIES = '__all__';
  // One shared media query: the card slideshow now also reacts when the OS setting changes,
  // instead of being decided once at load time.
  const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
  const CATEGORY_STORAGE_KEY = 'dv-property-category';
  const state = { properties: [], category: ALL_CATEGORIES, gallery: [], galleryIndex: 0, galleryTitle: '', galleryRequestId: 0, pendingPhotos: [], uploadFiles: [], coverPhoto: null, cardSlideshowCleanups: [], refreshPromise: null, user: null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // The local preview (tools/preview-server.js) ships a tiny REST stand-in so the admin panel can
  // be exercised without a Supabase account. It only exists on localhost; production never sees it.
  // Local preview: the flag comes from the URL (?local=1) or is injected by tools/visual-check.js.
  // Without it the page behaves exactly like production, with no simulated admin session.
  const LOCAL_PREVIEW = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && (window.__localPreview === 1 || new URLSearchParams(location.search).has('local'));
  const hasSupabase = () => Boolean(LOCAL_PREVIEW || (config.supabase?.url && config.supabase?.anonKey));
  const wa = (message = 'Olá, Davi! Gostaria de conversar sobre imóveis em Cascavel.') => config.whatsapp ? `https://wa.me/${encodeURIComponent(config.whatsapp)}?text=${encodeURIComponent(message)}` : '#admin';
  // Money is formatted without a prefix; callers that need "A partir de" add it themselves.
  const brl = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
  const money = n => n ? `A partir de ${brl(n)}` : 'Consulte condições';
  const propertyOrder = (a,b) => Number(Boolean(b.featured))-Number(Boolean(a.featured)) || Number(a.display_order ?? Number.MAX_SAFE_INTEGER)-Number(b.display_order ?? Number.MAX_SAFE_INTEGER) || String(b.created_at||'').localeCompare(String(a.created_at||''));
  // Price presentation
  // price_display : total | entry | both  (which values the listing shows at all)
  // price_highlight: total | entry | auto  (which of them is the big, emphasised number)
  // entry_mode     : amount | installments (the entry is shown as R$ value or only as "Nx")
  // ---------------------------------------------------------------- listing prices
  // price_items is a list of free price lines:
  //   [{ label: 'Sinal', text: 'de R$ 20 mil', highlight: true },
  //    { label: 'Restante da entrada', text: 'em 40x', highlight: false },
  //    { label: 'Valor total', text: 'R$ 299 mil', highlight: false }]
  // Listings created before this model still render from price / entry_* fields.
  // Old listings were migrated with a raw number as the text ("240,000.00"). When the stored text has
  // no words, the value is re-formatted as currency from the numeric column instead.
  function prettyPriceText(text, fallback) {
    const raw = String(text || '').trim();
    if (!raw) return fallback ? brl(fallback) : '';
    const hasWords = /[a-zA-ZÀ-ÿ]/.test(raw);
    const looksRaw = /^\d[\d.,]*$/.test(raw);
    if (!hasWords && looksRaw) {
      const numeric = numericPriceOf([{ text: raw, highlight: true }]);
      if (numeric) return brl(numeric);
    }
    return raw;
  }
  function priceItemsOf(property) {
    const raw = property?.price_items;
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
    const items = list
      .map(item => {
        const label = String(item?.label ?? '').trim();
        let text = String(item?.text ?? '').trim();
        // A label that just repeats the number is not a label.
        const cleanLabel = /^\d[\d.,]*$/.test(label) ? '' : label;
        text = prettyPriceText(text, Number(property?.price) > 0 ? Number(property.price) : null);
        if (cleanLabel && cleanLabel === text) return { label: '', text, highlight: Boolean(item?.highlight) };
        return { label: cleanLabel, text, highlight: Boolean(item?.highlight) };
      })
      .filter(item => item.label || item.text);
    if (!items.length) return legacyPriceItems(property);
    // Exactly one leading item: the flagged one, else the first.
    const firstHighlighted = items.findIndex(item => item.highlight);
    return items.map((item, index) => ({ ...item, highlight: index === (firstHighlighted >= 0 ? firstHighlighted : 0) }));
  }
  function legacyPriceItems(property) {
    if (!property) return [];
    const total = Number(property.price) > 0 ? Number(property.price) : null;
    const entryAmount = Number(property.entry_price) > 0 ? Number(property.entry_price) : null;
    const installments = Number(property.entry_installments) > 0 ? Math.round(Number(property.entry_installments)) : null;
    const entryName = property.entry_label === 'Sinal' ? 'Sinal' : 'Entrada';
    const custom = [property.price_highlight_label, property.price_secondary_label, property.price_extra_label]
      .map(value => String(value || '').trim()).filter(Boolean);
    const mode = ['entry', 'both'].includes(property.price_display) ? property.price_display : 'total';
    // Order follows the highlight choice: the leading value is always the first line.
    const highlightChoice = ['total', 'entry'].includes(property.price_highlight) ? property.price_highlight : 'auto';
    const leadWithEntry = mode !== 'total' && (highlightChoice === 'entry' || (highlightChoice === 'auto' && Boolean(entryAmount || installments)));
    const totalLine = total ? { label: 'Valor total', text: brl(total), highlight: false } : null;
    const entryLine = (entryAmount || installments)
      ? { label: entryName, text: entryAmount ? brl(entryAmount) : `em até ${installments}x`, highlight: false }
      : null;
    const items = leadWithEntry ? [entryLine, totalLine] : [totalLine, entryLine];
    const clean = items.filter(Boolean);
    if (!clean.length && custom.length) return custom.map((text, index) => ({ label: '', text, highlight: index === 0 }));
    // With a value and its parcelas, the installments get their own line only when there is no
    // separate amount to show; otherwise the text already reads well on one line.
    return clean.map((item, index) => ({ ...item, highlight: index === 0 }));
  }
  // The numeric value kept for ordering/search: the number inside the highlighted line.
  function numericPriceOf(items) {
    const read = text => {
      const digits = String(text || '').replace(/[^\d.,]/g, '');
      if (!digits) return null;
      // "299.000,00" / "299 mil" / "20,000.00"
      const normalized = /,\d{2}$/.test(digits)
        ? digits.replace(/\./g, '').replace(',', '.')
        : digits.replace(/,/g, '');
      const value = Number(normalized);
      return Number.isFinite(value) && value > 0 ? value : null;
    };
    const main = items.find(item => item.highlight) || items[0];
    // A line like "em até 40x" is a number of installments, never a price: skip it.
    const isInstallmentText = text => /\b\d+\s*x\b|\bem\s+até\b|\bvezes\b/i.test(String(text || '')) && !/r\$/i.test(String(text || ''));
    const direct = isInstallmentText(main?.text) ? null : read(main?.text);
    if (direct) return direct;
    const all = items.filter(item => !isInstallmentText(item.text)).map(item => read(item.text)).filter(Boolean);
    return all.length ? Math.max(...all) : null;
  }
  function propertyPriceMarkup(property, className) {
    const items = priceItemsOf(property);
    if (!items.length) {
      return `<div class="${className} price-lines"><span class="price-line price-main"><span class="price-value">Consulte condições</span></span></div>`;
    }
    const lines = items.map(item => {
      const kind = item.label ? `<span class="price-kind">${esc(item.label)}</span>` : '';
      return `<span class="price-line price-${item.highlight ? 'main' : 'secondary'}">${kind}<span class="price-value">${esc(item.text)}</span></span>`;
    }).join('');
    return `<div class="${className} price-lines">${lines}</div>`;
  }

  const categoryKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
  const categoryAliases = { planta:'Planta', novos:'Planta', lancamento:'Planta', lancamentos:'Planta', cohapar:'Cohapar', mcmv:'Cohapar', 'minha casa minha vida':'Cohapar', lotes:'Lotes', terrenos:'Lotes', prontos:'Prontos', casas:'Prontos', 'apartamentos prontos':'Prontos' };
  const categoryCodePrefixes = { planta:'PL', novos:'PL', lancamentos:'PL', cohapar:'CH', 'minha casa minha vida':'CH', lotes:'LT', terrenos:'LT', prontos:'PR', casas:'PR', 'apartamentos prontos':'PR' };
  const categoryCodePrefix = category => categoryCodePrefixes[categoryKey(category)] || '';
  const canonicalCategory = value => categoryAliases[categoryKey(value)] || (config.categories || []).find(category => categoryKey(category) === categoryKey(value)) || value || '';
  const propertyFeatures = p => Array.isArray(p?.features) ? p.features : (p?.features?.items || []);
  function orderedPropertyPhotos(p) {
    const photos = Array.isArray(p?.photos) ? [...p.photos] : [];
    const coverIndex = photos.findIndex(photo => photo?.path && photo.path === p.cover);
    if (coverIndex > 0) photos.unshift(photos.splice(coverIndex,1)[0]);
    return photos;
  }
  const propertyFloorPlans = p => Array.isArray(p?.features?.floor_plans) ? p.features.floor_plans : [];
  const decimal = value => Number(value).toLocaleString('pt-BR', { maximumFractionDigits:2 });
  const floorPlanLabel = plan => {
    if (typeof plan === 'string') return plan;
    return [plan.bedrooms != null ? `${plan.bedrooms} ${plan.bedrooms === 1 ? 'quarto' : 'quartos'}` : '', plan.suites != null ? (plan.suites ? `${plan.suites} ${plan.suites === 1 ? 'suíte' : 'suítes'}` : 'sem suíte') : '', plan.area ? `${decimal(plan.area)} m²` : ''].filter(Boolean).join(' · ');
  };
  function addFloorPlanRow(plan = {}) {
    const row = document.createElement('div');
    row.className = 'floor-plan-row';
    row.innerHTML = '<label>Quartos<input name="plan_bedrooms" type="number" min="0" step="1" inputmode="numeric" placeholder="Ex.: 2"></label><label>Suítes<select name="plan_suites"><option value="">Não informado</option><option value="0">Sem suíte</option><option value="1">1 suíte</option><option value="2">2 suítes</option><option value="3">3 suítes</option></select></label><label>Área (m²)<input name="plan_area" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Ex.: 62,43"></label><button class="text-button remove-floor-plan" type="button" aria-label="Remover planta">Remover</button>';
    row.querySelector('[name="plan_bedrooms"]').value = plan.bedrooms ?? '';
    row.querySelector('[name="plan_suites"]').value = plan.suites ?? '';
    row.querySelector('[name="plan_area"]').value = plan.area ?? '';
    row.querySelector('.remove-floor-plan').onclick = () => row.remove();
    $('#floor-plans-editor').append(row);
  }
  function readFloorPlans() {
    return $$('.floor-plan-row', $('#floor-plans-editor')).map(row => {
      const bedrooms = row.querySelector('[name="plan_bedrooms"]').value;
      const suites = row.querySelector('[name="plan_suites"]').value;
      const area = row.querySelector('[name="plan_area"]').value;
      return { bedrooms:bedrooms === '' ? null : Number(bedrooms), suites:suites === '' ? null : Number(suites), area:area === '' ? null : Number(area) };
    }).filter(plan => Object.values(plan).some(value => value !== null));
  }

  function initTheme() {
    const saved = localStorage.getItem('dv-theme');
    // The site ships as a dark, matte interface; a stored preference still wins, and the
    // toggle keeps working for anyone who prefers a light surface.
    document.documentElement.dataset.theme = saved || 'dark';
    const button = $('#theme-toggle');
    // The sun/moon icons are swapped by CSS, so no icon element needs to be replaced here.
    const updateButton = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = dark ? '#121316' : '#f4f5f7';
      const label = dark ? 'Ativar tema claro' : 'Ativar tema escuro';
      button.setAttribute('aria-label', label);
      button.title = label;
    };
    updateButton();
    button.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next; localStorage.setItem('dv-theme', next);
      updateButton();
    });
  }
  // Read-only helpers used by tests and by the dev server; they expose pure functions without
  // leaking any state to the page.
  window.DaviVeraSite = { propertyOrder, propertyPriceMarkup, canonicalCategory, orderedPropertyPhotos, floorPlanLabel, categoryCodePrefix, categoryKey };
  function setupProfile() {
    // The portrait already ships in the markup, so a configured photo only replaces it.
    // (Rebuilding the button's innerHTML on every load threw away the <img> alt and dimensions.)
    const avatarImage = $('#avatar img');
    if (config.profileImage && avatarImage && !avatarImage.src.endsWith(config.profileImage)) {
      avatarImage.src = config.profileImage;
    }
    if (avatarImage) avatarImage.addEventListener('error', () => { avatarImage.hidden = true; }, { once:true });
    const insta = $('#instagram-link');
    if (config.instagram) { insta.href = config.instagram; insta.target = '_blank'; insta.rel = 'noopener'; } else insta.hidden = true;
    const messages = {
      'owner-link': 'Olá, Davi! Tenho um imóvel em Cascavel e gostaria de conversar sobre anunciar.',
      'simulate-link': 'Olá, Davi! Gostaria de fazer uma simulação de crédito imobiliário.',
      'simulate-link-secondary': 'Olá, Davi! Gostaria de fazer uma simulação de crédito imobiliário.',
      'floating-whatsapp': 'Olá, Davi! Vi seu site e gostaria de conversar sobre imóveis em Cascavel.',
      'whatsapp-card-link': 'Olá, Davi! Gostaria de ver as opções de imóveis disponíveis.',
    };
    Object.entries(messages).forEach(([id, text]) => {
      const element = document.getElementById(id);
      if (!element) return;
      element.href = wa(text);
      if (!config.whatsapp) element.title = 'Configure o WhatsApp em config.js';
    });
    // Every remaining WhatsApp entry point shares the default greeting.
    ['whatsapp-link','buyer-link','about-contact','empty-state-link'].forEach(id => {
      const element = document.getElementById(id);
      if (!element) return;
      element.href = wa();
      if (!config.whatsapp) element.title = 'Configure o WhatsApp em config.js';
    });
    const spotlight = $('#spotlight');
    if (config.spotlight?.visible === false) {
      spotlight?.setAttribute('hidden', '');
    } else if (spotlight) {
      const title = $('#credit-title');
      const description = $('.credit-description', spotlight);
      const button = $('#simulate-link-secondary');
      if (config.spotlight?.title && title) title.textContent = config.spotlight.title;
      if (config.spotlight?.description && description) description.textContent = config.spotlight.description;
      if (config.spotlight?.button && button) button.textContent = config.spotlight.button;
    }
    $('#year').textContent = new Date().getFullYear();
  }
  // The bento KPI cards read from the same catalog the grid uses, so they can never disagree.
  function renderHeroStats() {
    const cells = $$('[data-stat]');
    if (!cells.length) return;
    const visible = state.properties.filter(property => ['published', 'reserved', 'sold'].includes(property.status));
    const regions = new Set(visible.map(property => String(property.region || '').split(/[,·-]/)[0].trim().toLocaleLowerCase('pt-BR')).filter(Boolean));
    const featured = visible.filter(property => property.featured).length;
    const values = { total: visible.length, regions: regions.size, featured };
    cells.forEach(cell => {
      const value = values[cell.dataset.stat];
      if (value !== undefined) cell.textContent = String(value).padStart(2, '0');
    });
  }
  function filteredProperties() {
    return state.properties.filter(p => p.status === 'published' || ['reserved','sold'].includes(p.status))
      .filter(p => !state.category || state.category === ALL_CATEGORIES || canonicalCategory(p.category) === state.category);
  }
  function renderCategories() {
    const host = $('#category-filters');
    const visibleStatuses = new Set(['published','reserved','sold']);
    const available = (config.categories || []).filter(category => state.properties.some(property => visibleStatuses.has(property.status) && canonicalCategory(property.category) === category));
    if (state.category !== ALL_CATEGORIES && available.length && !available.includes(state.category)) {
      state.category = ALL_CATEGORIES;
      localStorage.setItem(CATEGORY_STORAGE_KEY, state.category);
    }
    const chip = (value, label, extraClass = '') => {
      const active = state.category === value;
      return `<button class="category-chip ${extraClass} ${active ? 'active' : ''}" type="button" data-category="${esc(value)}" aria-pressed="${active}">${active ? '<span class="category-check" aria-hidden="true">✓</span>' : ''}${esc(label)}</button>`;
    };
    host.innerHTML = [chip(ALL_CATEGORIES, 'Todos', 'category-chip-all'), ...available.map(c => chip(c, c, `category-chip-${categoryKey(c).replace(/[^a-z0-9]+/g, '-')}`))].join('');
    host.onclick = e => {
      const button = e.target.closest('[data-category]');
      if (!button) return;
      const next = button.dataset.category;
      if (next === state.category) return;
      state.category = next;
      localStorage.setItem(CATEGORY_STORAGE_KEY, next);
      renderCategories();
      renderProperties();
    };
    // The Cohapar explanation is already presented in the credit section, so the filter bar only
    // shows a short reminder instead of a second, identical call to action.
    const info = $('#category-info');
    if (info) {
      info.hidden = state.category !== 'Cohapar';
      info.innerHTML = state.category === 'Cohapar'
        ? '<p class="category-note"><strong>Imóveis com subsídio</strong> Estes imóveis fazem parte do programa Casa Fácil Paraná. Veja os requisitos na seção de crédito.</p>'
        : '';
    }
    const select = $('#property-form select[name="category"]'); if (select) select.innerHTML = (config.categories || []).map(c => `<option>${esc(c)}</option>`).join('');
  }
  function updatePropertyCodeHint() {
    const form = $('#property-form');
    if (!form) return;
    const code = form.elements.code.value.trim();
    const prefix = categoryCodePrefix(form.elements.category.value);
    $('#property-code-hint').textContent = code
      ? `Código ${code} preservado neste imóvel.`
      : prefix ? `Formato do código: ${prefix}-001, ${prefix}-002… O número é atribuído ao salvar.` : 'Escolha uma categoria para ver o formato do código.';
  }
  function renderProperties() {
    renderHeroStats();
    // Cards are rebuilt on every filter change; restart the staggered entrance for the new set.
    setTimeout(initStagger, 0);
    state.cardSlideshowCleanups.forEach(cleanup => cleanup());
    state.cardSlideshowCleanups = [];
    const list = filteredProperties().sort(propertyOrder); const grid = $('#property-grid');
    $('#listing-count').textContent = `${list.length} ${list.length === 1 ? 'imóvel' : 'imóveis'}`;
    $('#empty-state').hidden = list.length > 0; grid.innerHTML = list.map(p => {
      const photos = orderedPropertyPhotos(p).filter(photo => photo?.url);
      const cover = photos[0]?.url || p.cover_url || '';
      const tags = [p.featured ? '<span class="badge">DESTAQUE</span>':'', p.status === 'reserved' ? '<span class="badge status">RESERVADO</span>':'', p.status === 'sold' ? '<span class="badge status">VENDIDO</span>':''].join('');
      const category = canonicalCategory(p.category) || 'Imóvel';
      const categoryClass = `category-${categoryKey(category).replace(/[^a-z0-9]+/g, '-')}`;
      const facts = [p.bedrooms ? `${esc(p.bedrooms)} ${p.bedrooms === 1 ? 'quarto' : 'quartos'}`:'', p.area ? `${decimal(p.area)} m²`:'', p.parking ? `${esc(p.parking)} ${p.parking === 1 ? 'vaga' : 'vagas'}`:''].filter(Boolean).map(fact => `<span>${fact}</span>`).join('');
      const morePhotos = photos.length > 1 ? `<span class="card-more-photos" aria-hidden="true">${photos.length} fotos</span>` : '';
      return `<article class="property-card" tabindex="0" role="button" aria-label="${esc(p.title)} — ver detalhes" data-id="${esc(p.id)}"><div class="property-image">${cover ? `<img src="${esc(cover)}" alt="${esc(p.title)}" data-photo-index="0" loading="lazy">`:''}<div class="property-badges">${tags}</div><span class="property-category-badge ${categoryClass}">${esc(category)}</span>${morePhotos}</div><div class="property-copy"><h3>${esc(p.title)}</h3><p class="property-region">${esc(p.region || 'Cascavel, PR')}</p>${propertyPriceMarkup(p,'property-price')}${facts ? `<p class="property-meta">${facts}</p>`:''}</div></article>`;
    }).join('');
    // A click anywhere on the card opens it. The photo counter is decorative (aria-hidden), so the
    // whole card is the only control: no nested button, no duplicated dialog on Enter.
    $$('.property-card', grid).forEach(card => {
      card.onclick = () => openProperty(card.dataset.id);
      card.onkeydown = event => {
        if (event.target !== card) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openProperty(card.dataset.id); }
      };
    });
    $$('.property-card', grid).forEach(card => {
      const property = state.properties.find(item => String(item.id) === card.dataset.id);
      // The slideshow is only armed when the visitor has not asked for reduced motion.
      const photos = orderedPropertyPhotos(property).filter(photo => photo?.url).slice(0, 5);
      const image = $('.property-image img', card);
      if (!image || photos.length < 2 || REDUCED_MOTION.matches) return;
      let inView = false;
      let timer = null;
      let loadingNext = false;
      const schedule = (delay = 3000) => {
        if (timer !== null || !inView || document.hidden) return;
        timer = setTimeout(() => { timer = null; advance(); }, delay);
      };
      const advance = () => {
        if (!inView || document.hidden) return;
        if (loadingNext) return;
        if ($('#property-modal').open || $('#image-modal').open) { schedule(3000); return; }
        const index = (Number(image.dataset.photoIndex) + 1) % photos.length;
        const nextImage = new Image();
        loadingNext = true;
        let shown = false;
        const showNext = () => {
          if (shown) return;
          shown = true;
          loadingNext = false;
          if (!inView || !card.isConnected) { schedule(350); return; }
          if (document.hidden || $('#property-modal').open || $('#image-modal').open) { schedule(3000); return; }
          image.classList.remove('card-photo-enter');
          void image.offsetWidth;
          image.src = photos[index].url;
          image.alt = `${property.title} — foto ${index + 1}`;
          image.dataset.photoIndex = String(index);
          image.classList.add('card-photo-enter');
          schedule(3000);
        };
        nextImage.onload = showNext;
        nextImage.onerror = () => { loadingNext = false; schedule(5000); };
        nextImage.src = photos[index].url;
        if (nextImage.complete && nextImage.naturalWidth) requestAnimationFrame(showNext);
      };
      const onVisibilityChange = () => {
        if (document.hidden && timer !== null) { clearTimeout(timer); timer = null; }
        else schedule();
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      let observer = null;
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver(entries => {
          const entry = entries.find(item => item.target === card);
          if (!entry) return;
          inView = entry.isIntersecting && entry.intersectionRatio >= 0.25;
          if (inView) schedule();
          else if (timer !== null) { clearTimeout(timer); timer = null; }
        }, { threshold: [0, 0.25], rootMargin: '0px 0px -5% 0px' });
        observer.observe(card);
      } else {
        inView = true;
        schedule();
      }
      state.cardSlideshowCleanups.push(() => {
        if (timer !== null) clearTimeout(timer);
        observer?.disconnect();
        document.removeEventListener('visibilitychange', onVisibilityChange);
      });
    });
  }
  async function track(id) { if (!config.analyticsEndpoint) return; try { await fetchWithTimeout(config.analyticsEndpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({event:'property_view', property_id:id, timestamp:new Date().toISOString()}) },8000); } catch {} }
  // ---------------------------------------------------------------- carousel state
  // The property dialog shows ONE photo at a time. Navigation is index based (not scroll based),
  // which keeps the arrows working even when the strip is not scrollable.
  const carousel = { index: 0, total: 0, items: [] };
  function renderCarousel(index = 0) {
    const strip = $('.modal-gallery-stage') || $('.modal-gallery');
    if (!strip) return;
    const items = $$('.modal-photo-item', strip);
    carousel.items = items;
    carousel.total = items.length;
    carousel.index = Math.min(Math.max(index, 0), Math.max(items.length - 1, 0));
    items.forEach((item, i) => {
      const active = i === carousel.index;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    const counter = $('.modal-gallery-count');
    if (counter) counter.textContent = `${carousel.index + 1} / ${items.length}`;
    const prev = $('[data-gallery-step="-1"]');
    const next = $('[data-gallery-step="1"]');
    if (prev) prev.disabled = carousel.index === 0;
    if (next) next.disabled = carousel.index >= items.length - 1;
    // A single dot per photo (capped) shows the position without counting every slide.
    const dots = $('.modal-gallery-dots');
    if (dots) {
      const max = Math.min(items.length, 8);
      dots.innerHTML = Array.from({ length: max }, (_, i) => {
        const target = Math.round((i * (items.length - 1)) / Math.max(max - 1, 1));
        return `<button type="button" data-gallery-dot="${target}" class="${target === carousel.index ? 'is-active' : ''}" aria-label="Ir para a foto ${target + 1}"></button>`;
      }).join('');
    }
    // Preload the neighbours so the next tap is instant.
    [carousel.index + 1, carousel.index - 1].forEach(offset => {
      const photo = items[offset]?.querySelector('img');
      if (photo?.src) { const preload = new Image(); preload.src = photo.src; }
    });
  }
  function stepCarousel(direction) {
    if (carousel.total < 2) return;
    renderCarousel(carousel.index + direction);
  }

  function modalPhotoMarkup(p, allowReorder = false) {
    const photos = orderedPropertyPhotos(p).filter(photo => photo?.url);
    if (!photos.length && p.cover_url) return `<div class="modal-photo-item"><img src="${esc(p.cover_url)}" alt="${esc(p.title)} — foto 1" data-photo-index="0" loading="lazy"></div>`;
    const many = photos.length > 1;
    // Visitors get exactly two controls on the photo strip: previous and next, plus the position
    // counter. The drag handle and the reorder arrows are admin tooling and are only rendered for
    // the signed-in administrator, never for the public.
    const nav = many && !allowReorder
      ? `<button type="button" class="modal-gallery-arrow modal-gallery-prev" data-gallery-step="-1" aria-label="Foto anterior"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5-6.5 6.5 6.5 6.5"/></svg></button><button type="button" class="modal-gallery-arrow modal-gallery-next" data-gallery-step="1" aria-label="Próxima foto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5.5 6.5 6.5-6.5 6.5"/></svg></button><div class="modal-gallery-footer"><div class="modal-gallery-dots" aria-hidden="true"></div><span class="modal-gallery-count">1 / ${photos.length}</span></div>`
      : '';
    const slides = photos.map((photo, i) => {
      const reorder = allowReorder
        ? `<div class="modal-photo-order"><button type="button" class="photo-drag-handle" data-photo-drag="${i}" aria-label="Arrastar foto ${i+1} para reordenar" title="Arraste para mudar a ordem"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="6" r="1.5"/><circle cx="16" cy="6" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/></svg></button><button type="button" data-modal-photo-move="${i}" data-move-to="${i-1}" ${i === 0 ? 'disabled' : ''} aria-label="Mover foto ${i+1} para antes">↑</button><button type="button" data-modal-photo-move="${i}" data-move-to="${i+1}" ${i === photos.length - 1 ? 'disabled' : ''} aria-label="Mover foto ${i+1} para depois">↓</button></div>`
        : '';
      const active = i === 0 ? ' is-active' : '';
      return `<div class="modal-photo-item${active}" data-photo-sort-item="${i}" data-photo-index="${i}"><img src="${esc(photo.url)}" alt="${esc(p.title)} — foto ${i+1}" data-photo-index="${i}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">${reorder}</div>`;
    }).join('');
    return `<div class="modal-gallery-stage">${slides}</div>${nav}`;
  }
  function enablePhotoDragging(container, itemSelector, onDrop) {
    if (!container) return;
    container.querySelectorAll('[data-photo-drag]').forEach(handle => {
      handle.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        const source = handle.closest(itemSelector);
        if (!source) return;
        const from = Number(source.dataset.photoSortItem);
        const rect = source.getBoundingClientRect();
        const placeholder = document.createElement('div');
        placeholder.className = 'photo-sort-placeholder';
        placeholder.style.width = `${rect.width}px`;
        placeholder.style.height = `${rect.height}px`;
        placeholder.setAttribute('aria-hidden', 'true');
        source.before(placeholder);
        source.classList.add('photo-dragging');
        Object.assign(source.style, { position:'fixed', left:`${rect.left}px`, top:`${rect.top}px`, width:`${rect.width}px`, height:`${rect.height}px`, zIndex:'1000', pointerEvents:'none', margin:'0', transition:'none' });
        container.classList.add('photo-sort-active');
        const offsetX = event.clientX - rect.left;
        const offsetY = event.clientY - rect.top;
        const resetSource = () => {
          source.classList.remove('photo-dragging');
          ['position','left','top','width','height','zIndex','pointerEvents','margin','transition'].forEach(key => { source.style[key] = ''; });
          container.classList.remove('photo-sort-active');
        };
        const finish = cancelled => {
          handle.removeEventListener('pointermove', track);
          handle.removeEventListener('pointerup', onPointerUp);
          handle.removeEventListener('pointercancel', onPointerCancel);
          if (cancelled) {
            placeholder.replaceWith(source);
            resetSource();
            return;
          }
          placeholder.replaceWith(source);
          resetSource();
          container.querySelectorAll(`${itemSelector}.photo-drop-target`).forEach(item => item.classList.remove('photo-drop-target'));
          container.querySelectorAll(itemSelector).forEach((item,index) => { item.dataset.photoSortItem = String(index); });
          const to = [...container.querySelectorAll(itemSelector)].indexOf(source);
          if (to !== from) onDrop(from, to);
        };
        const track = moveEvent => {
          source.style.left = `${moveEvent.clientX - offsetX}px`;
          source.style.top = `${moveEvent.clientY - offsetY}px`;
          const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest(itemSelector);
          if (!target || target === source || target.parentElement !== container) return;
          const targetRect = target.getBoundingClientRect();
          const sameRow = Math.abs(moveEvent.clientY - (targetRect.top + targetRect.height / 2)) < targetRect.height * .42;
          const after = sameRow ? moveEvent.clientX > targetRect.left + targetRect.width / 2 : moveEvent.clientY > targetRect.top + targetRect.height / 2;
          container.insertBefore(placeholder, after ? target.nextSibling : target);
          container.querySelectorAll(`${itemSelector}.photo-drop-target`).forEach(item => item.classList.remove('photo-drop-target'));
          target.classList.add('photo-drop-target');
        };
        const onPointerUp = () => finish(false);
        const onPointerCancel = () => finish(true);
        handle.addEventListener('pointermove', track);
        handle.addEventListener('pointerup', onPointerUp);
        handle.addEventListener('pointercancel', onPointerCancel);
        try { handle.setPointerCapture(event.pointerId); } catch {}
      });
    });
  }
  async function movePropertyPhoto(p, from, to) {
    const current = orderedPropertyPhotos(p);
    if (to < 0 || to >= current.length || from < 0 || from >= current.length || from === to) return;
    const reordered = [...current];
    const [photo] = reordered.splice(from, 1);
    reordered.splice(to, 0, photo);
    const previousCover = p.cover;
    p.photos = reordered;
    p.cover = reordered[0]?.path || null;
    if (String(p.id) === 'preview') state.pendingPhotos = reordered;
    const editingThisProperty = String($('#property-form').elements.id.value) === String(p.id);
    if (editingThisProperty) { state.pendingPhotos = reordered; state.coverPhoto = p.cover; }
    try {
      if (String(p.id) !== 'preview') {
        await api(`${encodeURIComponent(config.supabase.table)}?id=eq.${encodeURIComponent(p.id)}`, { method:'PATCH', headers:{Prefer:'return=minimal'}, body:JSON.stringify({photos:reordered,cover:p.cover}) });
      }
      renderProperties();
      if (editingThisProperty || String(p.id) === 'preview') renderPhotoPreview();
      openProperty(p.id);
      if (state.user && String(p.id) !== 'preview') setAdminStatus(`Ordem das fotos de “${p.title}” salva.`);
    } catch (error) {
      p.photos = current;
      p.cover = previousCover;
      if (editingThisProperty) { state.pendingPhotos = current; state.coverPhoto = previousCover; renderPhotoPreview(); }
      setAdminStatus(`Não foi possível salvar a ordem das fotos. ${error.message}`, true);
      openProperty(p.id);
    }
  }
  function openProperty(id) {
    const p = state.properties.find(x => String(x.id) === String(id)); if (!p) return;
    const propertyPhotos = orderedPropertyPhotos(p);
    const photos = propertyPhotos.map(x => x.url).filter(Boolean);
    if (!photos.length && p.cover_url) photos.push(p.cover_url);
    state.gallery = photos; state.galleryIndex = 0; state.galleryTitle = p.title; state.galleryRequestId++;
    const plural = (value, one, many) => `${value} ${Number(value) === 1 ? one : many}`;
    const facts = [['Área', p.area && `${decimal(p.area)} m²`], ['Quartos', p.bedrooms && plural(p.bedrooms, 'quarto', 'quartos')], ['Suítes', p.suites && plural(p.suites, 'suíte', 'suítes')], ['Banheiros', p.bathrooms && plural(p.bathrooms, 'banheiro', 'banheiros')], ['Vagas', p.parking && plural(p.parking, 'vaga', 'vagas')]].filter(([, value]) => value);
    const features = propertyFeatures(p); const floorPlans = propertyFloorPlans(p);
    // Preview listings have no id in the database: the address bar must not point at them.
    const isPreview = String(p.id) === 'preview';
    const url = new URL(location.href);
    if (!isPreview) url.hash = `imovel-${encodeURIComponent(p.id)}`;
    const contact = wa(`Olá, Davi! Tenho interesse no imóvel ${p.title}${p.code ? ` (código ${p.code})`:''}.`);
    // The photo reorder handles are only rendered for the signed-in administrator; visitors never
    // see them, so the hint that explains them is only shown in that same case.
    // Reorder controls belong to the administrator only: visitors get a plain, scrollable gallery.
    const canReorder = Boolean(state.user) && String(p.id) !== 'preview' && (p.photos?.length || 0) > 1;
    $('#modal-content').innerHTML = `<div class="modal-gallery">${modalPhotoMarkup(p, canReorder)}</div>${canReorder ? '<p class="photo-order-hint">Administrador: arraste a alça ⠿ para reordenar. A primeira foto é a capa e a ordem é salva automaticamente.</p>':''}<div class="modal-copy"><p class="eyebrow">${esc(canonicalCategory(p.category))} · ${esc(p.region || 'Cascavel, PR')}</p><h2>${esc(p.title)}</h2>${propertyPriceMarkup(p,'modal-price')}${p.code ? `<p>Código do anúncio: ${esc(p.code)}</p>`:''}<div class="modal-facts">${facts.map(([label, value]) => `<span><small>${esc(label)}</small>${esc(value)}</span>`).join('')}</div>${escapeParagraphs(p.description)}${features.length ? `<h3>Diferenciais</h3><ul class="modal-features">${features.map(feature => `<li>${esc(feature)}</li>`).join('')}</ul>`:''}${floorPlans.length ? `<h3>Plantas disponíveis</h3><ul class="modal-floor-plans">${floorPlans.map(floorPlanLabel).filter(Boolean).map(plan=>`<li>${esc(plan)}</li>`).join('')}</ul>`:''}${p.payment ? `<h3>Condições de pagamento</h3><p>${esc(p.payment)}</p>`:''}<div class="share-actions"><a class="button button-primary" href="${esc(contact)}" ${config.whatsapp?'target="_blank" rel="noopener"':''}>Falar sobre este imóvel ↗</a><button class="button button-secondary" id="copy-property-link">Copiar link</button><button class="button button-secondary" id="share-property">Compartilhar</button></div></div>`;
    $$('.modal-gallery img').forEach(img => img.onclick = () => showLarge(Number(img.dataset.photoIndex || 0)));
    $$('[data-gallery-step]').forEach(button => button.onclick = event => { event.stopPropagation(); stepCarousel(Number(button.dataset.galleryStep)); });
    $('.modal-gallery-dots')?.addEventListener('click', event => {
      const dot = event.target.closest('[data-gallery-dot]');
      if (dot) renderCarousel(Number(dot.dataset.galleryDot));
    });
    // Swipe left/right anywhere on the photo, for touch devices.
    const photoStrip = $('.modal-gallery-stage');
    if (photoStrip) {
      let startX = null;
      photoStrip.addEventListener('touchstart', event => { startX = event.touches[0]?.clientX ?? null; }, { passive: true });
      photoStrip.addEventListener('touchend', event => {
        if (startX === null) return;
        const delta = (event.changedTouches[0]?.clientX ?? startX) - startX;
        startX = null;
        if (Math.abs(delta) < 45) return;
        stepCarousel(delta < 0 ? 1 : -1);
      }, { passive: true });
    }
    renderCarousel(0);
    $$('[data-modal-photo-move]').forEach(button => button.onclick = () => movePropertyPhoto(p, Number(button.dataset.modalPhotoMove), Number(button.dataset.moveTo)));
    if (canReorder) enablePhotoDragging($('.modal-gallery-stage'), '.modal-photo-item', (from,to) => movePropertyPhoto(p,from,to));
    const copyLink = async (button, label = 'Link copiado') => {
      const shareUrl = isPreview ? location.href : url.href;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard indisponível');
        await navigator.clipboard.writeText(shareUrl);
        button.textContent = label;
      } catch {
        button.textContent = 'Copie o link da barra de endereço';
      }
    };
    $('#copy-property-link').onclick = () => copyLink($('#copy-property-link'));
    $('#share-property').onclick = async () => {
      if (!navigator.share) { await copyLink($('#share-property')); return; }
      try { await navigator.share({title:p.title,url:url.href}); }
      catch (error) { if (error?.name !== 'AbortError') await copyLink($('#share-property')); }
    };
    $('#property-modal').setAttribute('aria-label', p.title || 'Detalhes do imóvel');
    if (!$('#property-modal').open) $('#property-modal').showModal();
    history.replaceState(null,'',url);
    if (!isPreview) track(p.id);
  }
  function showLarge(index) {
    if (!state.gallery.length) return;
    state.galleryIndex = (index + state.gallery.length) % state.gallery.length;
    const source = state.gallery[state.galleryIndex];
    const image = $('#large-image');
    const dialog = $('#image-modal');
    const requestId = ++state.galleryRequestId;
    $('#gallery-count').textContent = `${state.galleryIndex + 1} / ${state.gallery.length}`;
    // Both arrows stay visible; only a single-photo gallery hides them. They are never disabled,
    // the viewer wraps around, which is the behaviour the visitor expects in a lightbox.
    $$('.gallery-arrow').forEach(arrow => { arrow.hidden = state.gallery.length < 2; arrow.disabled = false; });
    if (!dialog.open) dialog.showModal();

    let committed = false;
    const commitImage = () => {
      if (committed || requestId !== state.galleryRequestId) return;
      committed = true;
      image.src = source;
      image.alt = `${state.galleryTitle} — foto ${state.galleryIndex + 1}`;
      if (typeof image.animate === 'function') {
        image.animate([
          { opacity: 0, transform: 'translateY(10px) scale(.985)', filter: 'blur(3px)' },
          { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' }
        ], { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
      const nextSource = state.gallery[(state.galleryIndex + 1) % state.gallery.length];
      if (nextSource && nextSource !== source) { const nextImage = new Image(); nextImage.src = nextSource; }
    };
    const preload = new Image();
    preload.onload = commitImage;
    preload.onerror = commitImage;
    preload.src = source;
    if (preload.complete) requestAnimationFrame(commitImage);
  }
  function authHeaders() { return {'apikey':config.supabase.anonKey, 'Authorization':`Bearer ${state.user?.access_token || config.supabase.anonKey}`, 'Content-Type':'application/json'}; }
  async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, {...options,signal:controller.signal}); }
    catch (error) {
      if (controller.signal.aborted) throw new Error(`A conexão demorou mais de ${Math.round(timeoutMs/1000)} segundos. Verifique sua internet e tente novamente.`);
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function ensureFreshAdminSession(force = false) {
    if (!state.user) throw new Error('Entre novamente na área de gerenciamento para continuar.');
    const current = state.user;
    const expiresAt = Number(current.expires_at) || Math.floor(Date.now()/1000) + Number(current.expires_in || 0);
    if (!force && expiresAt - Math.floor(Date.now()/1000) > 90) return current;
    if (state.refreshPromise) return state.refreshPromise;
    if (!current.refresh_token) throw new Error('Sua sessão administrativa expirou. Entre novamente para continuar.');
    state.refreshPromise = (async () => {
      const response = await fetchWithTimeout(`${config.supabase.url.replace(/\/$/,'')}/auth/v1/token?grant_type=refresh_token`, {
        method:'POST',
        headers:{apikey:config.supabase.anonKey,'Content-Type':'application/json'},
        body:JSON.stringify({refresh_token:current.refresh_token})
      },30000);
      if (!response.ok) {
        state.user = null;
        renderAdmin();
        setAdminStatus('Sua sessão administrativa expirou. Entre novamente antes de salvar as alterações.',true);
        throw new Error('Sua sessão administrativa expirou. Entre novamente para continuar.');
      }
      const refreshed = await response.json();
      state.user = {...current,...refreshed,expires_at:refreshed.expires_at || Math.floor(Date.now()/1000) + Number(refreshed.expires_in || 3600)};
      renderAdmin();
      return state.user;
    })();
    try { return await state.refreshPromise; }
    finally { state.refreshPromise = null; }
  }
  async function adminFetch(url, options = {}) {
    await ensureFreshAdminSession();
    const {timeoutMs = 45000,...fetchOptions} = options;
    const send = () => fetchWithTimeout(url,{...fetchOptions,headers:{...(fetchOptions.headers || {}),apikey:config.supabase.anonKey,Authorization:`Bearer ${state.user.access_token}`}},timeoutMs);
    let response = await send();
    if (response.status === 401 || response.status === 403) {
      const errorBody = (await response.clone().text()).toLowerCase();
      if (errorBody.includes('exp claim') || errorBody.includes('jwt expired') || errorBody.includes('token is expired')) {
        await ensureFreshAdminSession(true);
        response = await send();
      }
    }
    return response;
  }
  async function api(path, options={}) {
    const url = `${config.supabase.url.replace(/\/$/,'')}/rest/v1/${path}`;
    const jsonOptions = {...options,headers:{'Content-Type':'application/json',...(options.headers || {})}};
    const response = state.user ? await adminFetch(url,jsonOptions) : await fetchWithTimeout(url,{...jsonOptions,headers:{...authHeaders(),...(jsonOptions.headers || {})}},30000);
    const body = await response.text();
    if (!response.ok) throw new Error(`Supabase (${response.status}): ${(body || response.statusText).slice(0,350)}`);
    // PostgREST returns an empty body for Prefer: return=minimal (commonly HTTP 201 on insert).
    if (!body.trim()) return null;
    try { return JSON.parse(body); }
    catch { throw new Error('Supabase retornou uma resposta inválida ao salvar o imóvel.'); }
  }
  function setAdminStatus(text, error=false) {
    const element = $('#admin-status');
    if (!element) return;
    element.textContent = text;
    // The colour comes from the design tokens instead of a hard-coded hex, so it also works in dark mode.
    element.classList.toggle('is-error', Boolean(error));
    if (error) element.setAttribute('role', 'alert'); else element.removeAttribute('role');
  }
  function mediaUrl(path) { return `${config.supabase.url.replace(/\/$/,'')}/storage/v1/object/public/${config.supabase.bucket}/${path}`; }
  async function loadCatalog() {
    // Never wipe a form the administrator is filling in: the catalog refresh only updates the lists.

    if (LOCAL_PREVIEW) {
      try {
        const response = await fetch('/preview-api/properties', { cache: 'no-store' });
        if (!response.ok) throw new Error(`o servidor de pré-visualização respondeu ${response.status}. Rode "node tools/preview-server.js" e abra o endereço que ele indicar.`);
        state.properties = await response.json();
        setAdminStatus('Pré-visualização local: os dados são fictícios e ficam na memória do servidor de desenvolvimento.');
      } catch (error) {
        state.properties = [];
        setAdminStatus(`Pré-visualização local indisponível: ${error.message}`, true);
      }
      renderCategories(); renderProperties(); renderAdmin();
      return;
    }
    if (!hasSupabase()) {
      state.properties = [];
      renderCategories();
      renderProperties();
      setAdminStatus('O catálogo não está conectado: o arquivo config.js não carregou ou está sem a URL e a chave do Supabase. Recarregue a página com Ctrl + Shift + R; se o aviso continuar, confira se config.js está publicado no repositório.', true);
      return;
    }
    try { state.properties=await api(`${encodeURIComponent(config.supabase.table)}?select=*&order=created_at.desc`) || []; setAdminStatus(state.user ? `Conectado como ${state.user.email}.` : 'Catálogo conectado. Entre como administrador para gerenciar anúncios.'); }
    catch(e) { state.properties=[]; setAdminStatus(`Não foi possível carregar o catálogo. Confira tabela, políticas de leitura e conexão. ${e.message}`,true); }
    renderCategories(); renderProperties(); renderAdmin();
  }
  function login() {
    if (!hasSupabase()) {
      setAdminStatus('Não é possível entrar: config.js não carregou (sem URL/chave do Supabase). Recarregue com Ctrl + Shift + R.', true);
      return;
    }
    const dialog = $('#admin-login-dialog');
    const form = $('#admin-login-form');
    // Enter on the "Entrar" button fired submit twice and asked Supabase for two tokens.
    if (!form.dataset.bound) {
      form.addEventListener('submit', submitAdminLogin);
      form.dataset.bound = 'true';
    }
    $('#admin-login-error').textContent = '';
    dialog.showModal();
    form.elements.email.focus();
  }
  async function submitAdminLogin(event) { event.preventDefault(); if (event.currentTarget.dataset.submitting === 'true') return; const form=event.currentTarget; form.dataset.submitting='true'; const email=form.elements.email.value.trim(); const password=form.elements.password.value; const error=$('#admin-login-error'); const submit=form.querySelector('[type="submit"]'); error.textContent='Verificando acesso…'; submit.disabled=true; try { const r=await fetchWithTimeout(`${config.supabase.url.replace(/\/$/,'')}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:config.supabase.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})},30000); if(!r.ok)throw Error('Credenciais inválidas ou serviço indisponível.'); const session=await r.json(); if(!config.supabase.adminUserId || session.user?.id?.toLowerCase()!==config.supabase.adminUserId.toLowerCase()){await fetchWithTimeout(`${config.supabase.url.replace(/\/$/,'')}/auth/v1/logout`,{method:'POST',headers:{apikey:config.supabase.anonKey,Authorization:`Bearer ${session.access_token}`}},10000).catch(()=>{});throw Error('Esta conta não está autorizada a administrar o site.');} session.expires_at=session.expires_at || Math.floor(Date.now()/1000)+Number(session.expires_in||3600); state.user=session; form.reset(); $('#admin-login-dialog').close(); $('#admin-login').hidden=true; $('#admin-logout').hidden=false; $('#property-form').hidden=false; await loadCatalog(); }catch(e){error.textContent=e.message;}finally{form.elements.password.value='';submit.disabled=false;form.dataset.submitting='false';} }
  // Property statuses are stored in English in Supabase; the admin list shows them in Portuguese.
  const STATUS_LABELS = { draft: 'Rascunho', published: 'Publicado', reserved: 'Reservado', sold: 'Vendido' };
  function statusLabel(status) { return STATUS_LABELS[status] || status || ''; }

  function renderAdmin() {
    // In the local preview the admin session is simulated so the panel can be reviewed offline.
    if (LOCAL_PREVIEW) state.user = { local: true, email: 'preview@local' };
    // The login button is always offered (except in the offline preview), even when config.js is
    // missing: clicking it explains what is missing instead of leaving a dead admin panel.
    $('#admin-login').hidden = LOCAL_PREVIEW || !!state.user;
    $('#admin-login').disabled = !hasSupabase();
    $('#admin-logout').hidden = !state.user;
    $('#property-form').hidden = !state.user;
    renderHistory();
    const tools = $('#admin-property-tools');
    tools.hidden = !state.user;
    const categoryFilter = $('#admin-category-filter');
    if (categoryFilter.options.length < 2) categoryFilter.innerHTML = '<option value="">Todas as categorias</option>' + (config.categories || []).map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
    const query = $('#admin-search').value.trim().toLocaleLowerCase('pt-BR');
    const selectedCategory = categoryFilter.value;
    const selectedStatus = $('#admin-status-filter').value;
    const matches = state.properties.filter(p => (!query || `${p.title||''} ${p.code||''}`.toLocaleLowerCase('pt-BR').includes(query)) && (!selectedCategory || canonicalCategory(p.category) === selectedCategory) && (!selectedStatus || p.status === selectedStatus)).sort(propertyOrder);
    const filtered = Boolean(query || selectedCategory || selectedStatus);
    $('#admin-order-hint').textContent = filtered ? 'Limpe a busca e os filtros para reordenar a lista completa.' : matches.length > 1 ? 'Arraste pelo ícone para organizar. Os imóveis em destaque continuam no topo.' : '';
    $('#admin-list').innerHTML=state.user?(matches.length?matches.map((p,index)=>`<div class="admin-row" data-property-sort-item="${index}" data-featured="${Boolean(p.featured)}"><button class="property-drag-handle" type="button" data-property-drag="${esc(p.id)}" aria-label="Arrastar ${esc(p.title)} para reordenar" title="Arraste para organizar" ${filtered || matches.length<2 || state.orderSaving?'hidden':''}>⠿</button><div class="admin-row-main"><strong>${esc(p.title)}</strong><span>${esc(canonicalCategory(p.category)||'Imóvel')} · ${esc(statusLabel(p.status))} · ${esc(p.code||'Sem código')}</span></div><span class="admin-row-actions"><button class="text-button" data-copy-code="${esc(p.id)}">Copiar código</button><button class="text-button" data-edit="${esc(p.id)}">Editar</button><button class="text-button" data-delete="${esc(p.id)}">Excluir</button></span></div>`).join(''):'<p class="admin-list-empty">Nenhum imóvel corresponde a essa busca.</p>'):'';
    $$('[data-copy-code]').forEach(b=>b.onclick=async()=>{const p=state.properties.find(item=>String(item.id)===b.dataset.copyCode);if(!p?.code){setAdminStatus('Este imóvel ainda não tem código.',true);return;}try{await navigator.clipboard.writeText(p.code);setAdminStatus(`Código ${p.code} copiado.`);}catch{setAdminStatus('Não foi possível copiar o código neste navegador.',true);}});
    $$('[data-edit]').forEach(b=>b.onclick=()=>fillForm(state.properties.find(p=>String(p.id)===b.dataset.edit)));
    $$('[data-delete]').forEach(button => button.onclick = async () => {
      const property = state.properties.find(item => String(item.id) === button.dataset.delete);
      if (!property || !confirm(`Excluir “${property.title}”? Esta ação não pode ser desfeita.`)) return;
      button.disabled = true;
      const label = button.textContent;
      button.textContent = 'Excluindo…';
      pushHistory({ ...property }, 'Antes de excluir');
      try {
        if (LOCAL_PREVIEW) {
          await fetch(`/preview-api/properties?id=${encodeURIComponent(property.id)}`, { method: 'DELETE' });
        } else {
          await api(`${encodeURIComponent(config.supabase.table)}?id=eq.${encodeURIComponent(property.id)}`, { method: 'DELETE' });
        }
        await loadCatalog();
        setAdminStatus(`“${property.title}” excluído.`);
      } catch (error) {
        setAdminStatus(`Falha ao excluir: ${error.message}`, true);
        button.disabled = false;
        button.textContent = label;
      }
    });
    enablePropertyDragging($('#admin-list'));
  }
  function enablePropertyDragging(container) {
    if (!container || state.orderSaving) return;
    container.querySelectorAll('[data-property-drag]').forEach(handle => handle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      const source = handle.closest('.admin-row');
      if (!source) return;
      const from = Number(source.dataset.propertySortItem);
      const rect = source.getBoundingClientRect();
      const placeholder = document.createElement('div');
      placeholder.className = 'admin-sort-placeholder';
      placeholder.style.height = `${rect.height}px`;
      source.before(placeholder);
      Object.assign(source.style,{position:'fixed',left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,zIndex:'1000',pointerEvents:'none',margin:'0',transition:'none'});
      source.classList.add('property-row-dragging');
      container.classList.add('admin-sort-active');
      const offsetY = event.clientY - rect.top;
      const clear = () => { source.classList.remove('property-row-dragging'); ['position','left','top','width','zIndex','pointerEvents','margin','transition'].forEach(key=>source.style[key]='');container.classList.remove('admin-sort-active'); };
      const finish = cancelled => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', cancel);
        if (cancelled) { placeholder.replaceWith(source); clear(); return; }
        placeholder.replaceWith(source); clear();
        container.querySelectorAll('.admin-row').forEach((row,index)=>row.dataset.propertySortItem=String(index));
        const to = [...container.querySelectorAll('.admin-row')].indexOf(source);
        if (to !== from) savePropertyOrder(from,to);
      };
      const move = moveEvent => {
        source.style.top = `${moveEvent.clientY-offsetY}px`;
        const target = document.elementFromPoint(moveEvent.clientX,moveEvent.clientY)?.closest('.admin-row');
        if (!target || target===source || target.parentElement!==container || target.dataset.featured!==source.dataset.featured) return;
        const targetRect=target.getBoundingClientRect();
        container.insertBefore(placeholder,moveEvent.clientY>targetRect.top+targetRect.height/2?target.nextSibling:target);
      };
      const up=()=>finish(false), cancel=()=>finish(true);
      handle.addEventListener('pointermove',move); handle.addEventListener('pointerup',up); handle.addEventListener('pointercancel',cancel);
      try { handle.setPointerCapture(event.pointerId); } catch {}
    }));
  }
  async function savePropertyOrder(from,to) {
    if (state.orderSaving) return;
    const ordered=state.properties.slice().sort(propertyOrder);
    if (from<0 || to<0 || from>=ordered.length || to>=ordered.length || Boolean(ordered[from].featured)!==Boolean(ordered[to].featured)) { renderAdmin(); return; }
    const [moved]=ordered.splice(from,1); ordered.splice(to,0,moved);
    state.orderSaving=true; setAdminStatus('Salvando a nova ordem dos imóveis…'); renderAdmin();
    try {
      await api('rpc/reorder_properties',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({property_ids:ordered.map(property=>property.id)})});
      ordered.forEach((property,index)=>{property.display_order=index;});
      renderProperties(); renderAdmin();
      setAdminStatus('Nova ordem dos imóveis salva.');
    } catch(error) {
      await loadCatalog();
      setAdminStatus(`Não foi possível salvar a ordem dos imóveis. ${error.message}`,true);
    } finally { state.orderSaving=false; renderAdmin(); }
  }
  function setPropertyFormMode(editing, title = '') {
    $('#property-form-mode').hidden = !editing;
    $('#property-form-mode').textContent = editing ? `Editando imóvel: ${title}` : '';
    $('#property-form').querySelector('[type="submit"]').textContent = editing ? 'Salvar alterações' : 'Salvar imóvel';
    $('#clear-property-form').hidden = editing;
    $('#cancel-property-edit').hidden = !editing;
  }
  // ---------------------------------------------------------------- price builder (admin)
  const PRICE_ROW_TEMPLATE = (row = {}) => `
    <div class="price-row" data-price-row>
      <button type="button" class="price-row-handle" data-price-drag aria-label="Arrastar para reordenar" title="Arraste para reordenar"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="6" r="1.5"/><circle cx="16" cy="6" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/></svg></button>
      <label class="price-row-label">Etiqueta<input data-price-label maxlength="24" placeholder="Sinal" value="${esc(row.label || '')}"></label>
      <label class="price-row-text">Texto do valor<input data-price-text maxlength="70" placeholder="de R$ 20 mil" value="${esc(row.text || '')}"></label>
      <button type="button" class="price-row-star${row.highlight ? ' is-active' : ''}" data-price-highlight aria-pressed="${row.highlight ? 'true' : 'false'}" title="Destacar este valor" aria-label="Destacar este valor"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.6 5.6 6.1.8-4.5 4.3 1.1 6-5.3-3-5.3 3 1.1-6L3.3 9.4l6.1-.8Z"/></svg></button>
      <button type="button" class="price-row-remove" data-price-remove aria-label="Remover valor" title="Remover"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </div>`;
  function addPriceRow(row = {}, focus = false) {
    const host = $('#price-rows');
    if (!host) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = PRICE_ROW_TEMPLATE(row).trim();
    const element = wrapper.firstElementChild;
    host.append(element);
    if (!host.querySelector('[data-price-highlight].is-active')) element.querySelector('[data-price-highlight]').classList.add('is-active');
    if (focus) element.querySelector('[data-price-label]').focus();
    syncPriceRows();
  }
  function readPriceRows() {
    return $$('[data-price-row]', $('#price-rows')).map(row => ({
      label: row.querySelector('[data-price-label]').value.trim(),
      text: row.querySelector('[data-price-text]').value.trim(),
      highlight: row.querySelector('[data-price-highlight]').classList.contains('is-active'),
    })).filter(item => item.label || item.text);
  }
  function syncPriceRows() {
    const rows = $$('[data-price-row]', $('#price-rows'));
    const highlighted = rows.filter(row => row.querySelector('[data-price-highlight]').classList.contains('is-active'));
    // Only the first flagged row keeps the star, and the remove button is hidden on the last row.
    highlighted.slice(1).forEach(row => row.querySelector('[data-price-highlight]').classList.remove('is-active'));
    rows.forEach(row => {
      const star = row.querySelector('[data-price-highlight]');
      const active = star.classList.contains('is-active');
      star.setAttribute('aria-pressed', active ? 'true' : 'false');
      star.title = active ? 'Valor em destaque' : 'Destacar este valor';
      row.classList.toggle('is-highlighted', active);
      row.querySelector('[data-price-remove]').hidden = rows.length === 1;
    });
    const items = readPriceRows();
    const numeric = numericPriceOf(items);
    const preview = $('#price-numeric-preview');
    if (preview) preview.textContent = numeric ? money(numeric) : '—';
    // Keep the legacy columns in sync so old consumers and the ordering stay correct.
    const main = items.find(item => item.highlight) || items[0] || null;
    const secondary = items.find(item => item !== main) || null;
    const form = $('#property-form');
    if (form) {
      form.elements.price.value = numeric ?? '';
      form.elements.price_highlight_label.value = main ? `${main.label ? main.label + ' ' : ''}${main.text}`.trim() : '';
      form.elements.price_secondary_label.value = secondary ? `${secondary.label ? secondary.label + ' ' : ''}${secondary.text}`.trim() : '';
      form.elements.price_extra_label.value = '';
      form.elements.price_display.value = items.length > 1 ? 'both' : 'total';
      form.elements.price_highlight.value = main && main.label && /sinal|entrada/i.test(main.label) ? 'entry' : 'total';
      form.elements.entry_price.value = '';
      form.elements.entry_installments.value = '';
    }
  }
  function initPriceRows() {
    const host = $('#price-rows');
    if (!host) return;
    $('#add-price-row').addEventListener('click', () => addPriceRow({}, true));
    host.addEventListener('input', syncPriceRows);
    host.addEventListener('click', event => {
      const star = event.target.closest('[data-price-highlight]');
      if (star) {
        const row = star.closest('[data-price-row]');
        const wasActive = star.classList.contains('is-active');
        $$('[data-price-highlight]', host).forEach(other => other.classList.remove('is-active'));
        if (!wasActive) star.classList.add('is-active');
        row.classList.toggle('is-highlighted', !wasActive);
        syncPriceRows();
        return;
      }
      const remove = event.target.closest('[data-price-remove]');
      if (remove) {
        remove.closest('[data-price-row]').remove();
        syncPriceRows();
      }
    });
    // Drag to reorder, same gesture as the photo list.
    host.addEventListener('pointerdown', event => {
      const handle = event.target.closest('[data-price-drag]');
      if (!handle || event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      const row = handle.closest('[data-price-row]');
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const placeholder = document.createElement('div');
      placeholder.className = 'price-row-placeholder';
      placeholder.style.height = `${rect.height}px`;
      row.before(placeholder);
      row.classList.add('price-row-dragging');
      Object.assign(row.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, zIndex: '1000', pointerEvents: 'none', margin: '0' });
      const offsetY = event.clientY - rect.top;
      const move = moveEvent => {
        row.style.top = `${moveEvent.clientY - offsetY}px`;
        const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('[data-price-row]');
        if (!target || target === row || target.parentElement !== host) return;
        const targetRect = target.getBoundingClientRect();
        host.insertBefore(placeholder, moveEvent.clientY > targetRect.top + targetRect.height / 2 ? target.nextSibling : target);
      };
      const finish = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
        placeholder.replaceWith(row);
        row.classList.remove('price-row-dragging');
        ['position', 'left', 'top', 'width', 'zIndex', 'pointerEvents', 'margin'].forEach(key => { row.style[key] = ''; });
        syncPriceRows();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
      try { handle.setPointerCapture(event.pointerId); } catch {}
    });
  }

  // Legacy helper kept as a no-op: the price fields it used to toggle are now handled by the price
  // builder (initPriceRows / syncPriceRows). Kept so old call sites do not break.
  function syncPriceFields() {
    syncPriceRows();
  }
  function fillForm(p) { const f=$('#property-form'); f.reset(); f.elements.id.value=p.id; ['title','description','category','region','price','area','bedrooms','suites','bathrooms','parking','payment','status','price_display','entry_price','entry_label','entry_installments','entry_mode','price_highlight','price_highlight_label','price_secondary_label','price_extra_label'].forEach(k=>{if(f.elements[k])f.elements[k].value=p[k]??'';}); fillPriceRows(p); const highlightChoice=f.querySelector(`[name="price_highlight"][value="${['total','entry'].includes(p.price_highlight)?p.price_highlight:'auto'}"]`); if(highlightChoice) highlightChoice.checked=true; f.elements.code.value=p.code??''; f.elements.category.value=canonicalCategory(p.category); f.elements.features.value=propertyFeatures(p).join(', '); propertyFloorPlans(p).forEach(plan=>addFloorPlanRow(plan));f.elements.featured.checked=!!p.featured;state.pendingPhotos=orderedPropertyPhotos(p);state.coverPhoto=state.pendingPhotos[0]?.path||null;syncPriceFields();setPropertyFormMode(true,p.title);updatePropertyCodeHint();renderPhotoPreview();f.scrollIntoView({behavior:'smooth',block:'start'}); }
  function movePendingPhoto(from, to) {
    if (to < 0 || to >= state.pendingPhotos.length || from < 0 || from >= state.pendingPhotos.length) return;
    const [photo] = state.pendingPhotos.splice(from, 1);
    state.pendingPhotos.splice(to, 0, photo);
    state.coverPhoto = state.pendingPhotos[0]?.path || null;
    renderPhotoPreview();
  }
  function renderPhotoPreview() {
    const preview = $('#photo-preview');
    $('#photo-upload-count').textContent = `${state.pendingPhotos.length} ${state.pendingPhotos.length === 1 ? 'foto adicionada' : 'fotos adicionadas'}`;
    preview.innerHTML = `${state.pendingPhotos.length>1?'<p class="photo-order-hint">Arraste pela alça para reorganizar. A primeira foto é a capa; use as setas para ajustes precisos.</p>':''}${state.pendingPhotos.length ? state.pendingPhotos.map((p,i) => `<div class="photo-preview-item" data-photo-sort-item="${i}"><button type="button" class="photo-drag-handle photo-preview-drag" data-photo-drag="${i}" aria-label="Arrastar foto ${i+1} para reordenar" title="Segure e arraste para mudar a ordem"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="6" r="1.5"/><circle cx="16" cy="6" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/></svg></button><img src="${esc(p.url)}" alt="Foto ${i+1}"><span class="photo-order-label">Foto ${i+1}${p.path===state.coverPhoto?' · Capa':''}</span><div class="photo-order-actions"><button type="button" data-preview-photo-move="${i}" data-move-to="${i-1}" ${i===0?'disabled':''} aria-label="Mover foto ${i+1} para antes">↑</button><button type="button" data-preview-photo-move="${i}" data-move-to="${i+1}" ${i===state.pendingPhotos.length-1?'disabled':''} aria-label="Mover foto ${i+1} para depois">↓</button><button type="button" data-remove-photo="${i}">Remover</button></div><button type="button" class="text-button" data-cover-photo="${i}">Usar como capa</button></div>`).join('') : '<p class="photo-preview-empty">Nenhuma foto adicionada ainda. Use “Adicionar fotos” para selecionar imagens.</p>'}`;
    $$('[data-remove-photo]').forEach(button => button.onclick = () => { const [removed] = state.pendingPhotos.splice(Number(button.dataset.removePhoto),1); if (removed?.path === state.coverPhoto) state.coverPhoto = state.pendingPhotos[0]?.path || null; if (removed?.path?.startsWith('local-')) { URL.revokeObjectURL(removed.url); state.uploadFiles = state.uploadFiles.filter(item => item.localPath !== removed.path); } renderPhotoPreview(); });
    $$('[data-cover-photo]').forEach(button => button.onclick = () => movePendingPhoto(Number(button.dataset.coverPhoto),0));
    $$('[data-preview-photo-move]').forEach(button => button.onclick = () => movePendingPhoto(Number(button.dataset.previewPhotoMove),Number(button.dataset.moveTo)));
    enablePhotoDragging($('#photo-preview'), '.photo-preview-item', movePendingPhoto);
  }
  async function uploadPhotos(files, propertyId, onProgress = () => {}) {
    for (const {file} of files) {
      if (!ALLOWED_PROPERTY_PHOTO_TYPES.has(file.type)) throw Error(`Formato não permitido para “${file.name}”. Use JPEG, PNG, WebP, AVIF, HEIC ou HEIF.`);
      if (file.size > MAX_PROPERTY_PHOTO_SIZE) throw Error(`“${file.name}” excede o limite de 20 MB por foto.`);
    }
    const uploads = files.filter(({localPath}) => state.pendingPhotos.some(photo => photo.path === localPath));
    if (!uploads.length) return;
    let nextIndex = 0;
    let completed = 0;
    const results = new Array(uploads.length);
    const errors = [];
    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= uploads.length) return;
        const {file,localPath} = uploads[index];
        const localPhoto = state.pendingPhotos.find(photo => photo.path === localPath);
        const path = `${propertyId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
        try {
          onProgress(completed, uploads.length, file.name);
          const response = await adminFetch(`${config.supabase.url.replace(/\/$/,'')}/storage/v1/object/${config.supabase.bucket}/${path}`,{method:'POST',headers:{'Content-Type':file.type,'x-upsert':'true'},body:file,timeoutMs:120000});
          if (!response.ok) throw Error(`Falha ao enviar “${file.name}” (${response.status}): ${(await response.text()).slice(0,240)}`);
          results[index] = {localPath,localPhoto,path};
          completed++;
          onProgress(completed, uploads.length, '');
        } catch (error) {
          if (error.message.includes('120 segundos')) error = new Error(`O envio de “${file.name}” excedeu 2 minutos. Confira sua conexão e tente novamente; o anúncio ainda não foi gravado.`);
          errors.push(error);
        }
      }
    };
    await Promise.all(Array.from({length:Math.min(2,uploads.length)},worker));
    if (errors.length) {
      await Promise.all(results.filter(Boolean).map(({path}) => adminFetch(`${config.supabase.url.replace(/\/$/,'')}/storage/v1/object/${config.supabase.bucket}/${path}`,{method:'DELETE',timeoutMs:10000}).catch(()=>{})));
      throw errors[0];
    }
    for (const {localPath,localPhoto,path} of results) {
      const localIndex = state.pendingPhotos.findIndex(photo => photo.path === localPath);
      if (localIndex < 0) continue;
      state.pendingPhotos[localIndex] = {path,url:mediaUrl(path)};
      if (state.coverPhoto === localPath || !state.coverPhoto) state.coverPhoto = path;
      if (localPhoto?.url) URL.revokeObjectURL(localPhoto.url);
    }
    const uploadedPaths = new Set(uploads.map(({localPath}) => localPath));
    state.uploadFiles = state.uploadFiles.filter(({localPath}) => !uploadedPaths.has(localPath));
  }
  // Fixes found in the code sweep --------------------------------------------------------------
  // 1. The description is user typed and can contain line breaks; esc() kept them on one line.
  const escapeParagraphs = value => String(value ?? '')
    .split(/\n{2,}/)
    .map(paragraph => `<p>${esc(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');

  // New listings go to the end of their group (featured first, then manual order); an existing
  // listing keeps its place. The previous inline expression used Math.max(...) over an empty array
  // for the first listing, which produced -Infinity and an invalid SQL number.
  function nextDisplayOrder(id, featured) {
    const numbers = state.properties.map(property => Number(property.display_order)).filter(Number.isFinite);
    const existing = id ? state.properties.find(property => String(property.id) === String(id)) : null;
    if (existing && Boolean(existing.featured) === featured) return Number(existing.display_order) || 0;
    if (featured) {
      const featuredOrders = state.properties.filter(property => property.featured).map(property => Number(property.display_order)).filter(Number.isFinite);
      return (featuredOrders.length ? Math.min(...featuredOrders) : 1) - 1;
    }
    return numbers.length ? Math.max(...numbers) + 1 : 0;
  }
  // ---------------------------------------------------------------- undo
  // Every save keeps the previous version of the listing so a mistaken edit can be reverted from the
  // panel. Stored in localStorage: small, per browser, and never sent to the server.
  const HISTORY_KEY = 'dv-property-history';
  const HISTORY_LIMIT = 20;
  function readHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
  }
  function pushHistory(snapshot, action) {
    if (!snapshot?.id) return;
    const history = readHistory();
    history.unshift({ at: new Date().toISOString(), action, property: snapshot });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
    renderHistory();
  }
  function renderHistory() {
    const host = $('#admin-history');
    if (!host) return;
    const history = readHistory();
    host.hidden = !state.user;
    if (!history.length) {
      host.innerHTML = '<p class="field-hint">Nenhuma alteração recente para desfazer.</p>';
      return;
    }
    host.innerHTML = `<h4>Últimas alterações</h4><div class="history-list">${history.map((entry, index) => `
      <div class="history-row">
        <div class="history-copy"><strong>${esc(entry.property?.title || 'Imóvel')}</strong><span>${esc(entry.action)} · ${new Date(entry.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>
        <button type="button" class="text-button" data-history-restore="${index}">Restaurar</button>
      </div>`).join('')}</div>`;
    $$('[data-history-restore]', host).forEach(button => button.onclick = () => restoreHistory(Number(button.dataset.historyRestore)));
  }
  async function restoreHistory(index) {
    const entry = readHistory()[index];
    if (!entry?.property) return;
    if (!confirm(`Restaurar “${entry.property.title}” para a versão de ${new Date(entry.at).toLocaleString('pt-BR')}?`)) return;
    const property = entry.property;
    setAdminStatus('Restaurando versão anterior…');
    try {
      if (LOCAL_PREVIEW) {
        await fetch('/preview-api/properties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(property) });
      } else {
        const { id, created_at, ...payload } = property;
        await api(`${encodeURIComponent(config.supabase.table)}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload) });
      }
      await loadCatalog();
      setAdminStatus(`“${property.title}” restaurado.`);
    } catch (error) {
      setAdminStatus(`Não foi possível restaurar: ${error.message}`, true);
    }
  }

  async function saveProperty(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const submitLabel = submit.textContent;
    const formData = new FormData(form);
    const id = formData.get('id') || crypto.randomUUID();
    // Snapshot of the listing as it is in the catalog right now, before the edit lands.
    const previous = state.properties.find(property => String(property.id) === String(id));
    submit.disabled = true;
    submit.textContent = state.uploadFiles.length ? `Enviando fotos 0/${state.uploadFiles.length}…` : 'Salvando…';
    try {
      await uploadPhotos([...state.uploadFiles], id, (done,total,currentFile) => { submit.textContent = currentFile ? `Enviando ${done+1}/${total}: ${currentFile.slice(0,18)}…` : `Enviando fotos ${done}/${total}…`; });
      submit.textContent = 'Salvando anúncio…';
      // Only columns that exist in the table are sent. PostgREST rejects the whole request when one
    // column is missing (PGRST204 / 42703), and that was silently discarding every edit.
    const optional = ['price_items', 'entry_mode', 'price_highlight', 'price_highlight_label', 'price_secondary_label', 'price_extra_label'];
    const payload = {
        title: formData.get('title'), description: formData.get('description'), category: formData.get('category'), region: formData.get('region'),
        price: Number(formData.get('price')) || null, price_items: readPriceRows(), area: Number(formData.get('area')) || null,
        bedrooms: Number(formData.get('bedrooms')) || null, suites: Number(formData.get('suites')) || null,
        bathrooms: Number(formData.get('bathrooms')) || null, parking: Number(formData.get('parking')) || null,
        price_display:formData.get('price_display')||'total', entry_price:Number(formData.get('entry_price'))||null, entry_label:formData.get('entry_label')||'Entrada', entry_installments:Number(formData.get('entry_installments'))||null, entry_mode:formData.get('entry_mode')||'amount', price_highlight:formData.get('price_highlight')||'auto',
        price_highlight_label:String(formData.get('price_highlight_label')||'').trim()||null,
        price_secondary_label:String(formData.get('price_secondary_label')||'').trim()||null,
        price_extra_label:String(formData.get('price_extra_label')||'').trim()||null,
        features: { items:String(formData.get('features')).split(',').map(value => value.trim()).filter(Boolean), floor_plans:readFloorPlans() },
        payment: formData.get('payment'), code: formData.get('id') ? formData.get('code') : undefined, status: formData.get('status'),
        featured: formData.get('featured') === 'on', photos: state.pendingPhotos, cover: state.coverPhoto || state.pendingPhotos[0]?.path || null,
        display_order: nextDisplayOrder(formData.get('id'), formData.get('featured') === 'on')
      };
      const savePath = formData.get('id')
        ? `${encodeURIComponent(config.supabase.table)}?id=eq.${encodeURIComponent(id)}`
        : encodeURIComponent(config.supabase.table);
      if (LOCAL_PREVIEW) {
        const response = await fetch('/preview-api/properties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...payload }) });
        state.properties = await response.json();
        if (previous) pushHistory({ ...previous }, 'Antes de editar');
        form.reset(); clearPendingPhotos(); setPropertyFormMode(false); renderPhotoPreview();
        renderCategories(); renderProperties(); renderAdmin();
        setAdminStatus(`“${payload.title}” salvo na pré-visualização local.`);
        return;
      }
      const saveOptions = formData.get('id')
        ? {method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(payload)}
        : {method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({id,...payload})};
      // If the database has not been migrated yet, drop the optional columns and save the rest so the
      // edit is never lost; the status message explains what is missing.
      // `optionalUnavailable` lists the columns the database did not accept; it is declared here,
      // next to the retry that fills it. (It used to be referenced below without being declared in
      // this scope, which threw "optionalUnavailable is not defined" even after a successful save.)
      let savedRows;
      let optionalUnavailable = [];
      try {
        savedRows = await api(savePath, saveOptions);
      } catch (error) {
        const reason = String(error?.message ?? error ?? '');
        const missing = optional.filter(column => reason.includes(column));
        if (!missing.length) throw error;
        missing.forEach(column => { delete payload[column]; });
        const retryBody = formData.get('id') ? payload : { id, ...payload };
        savedRows = await api(savePath, { ...saveOptions, body: JSON.stringify(retryBody) });
        optionalUnavailable = missing;
      }
      const existingIndex = state.properties.findIndex(property => String(property.id) === String(id));
      const savedProperty = savedRows?.[0] || {...(existingIndex >= 0 ? state.properties[existingIndex] : {}),...payload,id};
      if (previous) pushHistory({ ...previous }, 'Antes de editar');
      if (existingIndex >= 0) state.properties[existingIndex] = savedProperty;
      else state.properties.unshift(savedProperty);
      form.reset(); clearPendingPhotos(); setPropertyFormMode(false); renderPhotoPreview();
      renderCategories(); renderProperties(); renderAdmin();
      const savedCode = savedProperty?.code || payload.code;
      const codeNote = savedCode ? ` Código ${savedCode}.` : ' O código será exibido na lista após a próxima atualização.';
      const schemaNote = optionalUnavailable.length
        ? ` Atenção: as colunas ${optionalUnavailable.join(' e ')} ainda não existem na tabela; rode as migrações 20261107120000_price_highlight_and_entry_mode.sql e 20261107130000_custom_price_labels.sql no Supabase para liberar o destaque de valor, a entrada por parcelas e os textos personalizados.`
        : '';
      setAdminStatus(`“${payload.title}” salvo como ${statusLabel(payload.status).toLowerCase()}.${codeNote}${schemaNote}`, Boolean(optionalUnavailable.length));
    } catch (error) {
      setAdminStatus(`Não foi possível salvar o imóvel. ${error.message}`, true);
    } finally {
      submit.disabled = false;
      // Restore what the button said when it was pressed: editing says "Salvar alterações",
      // creating says "Salvar imóvel". Reading form.elements.id here was wrong because the form is
      // reset after a successful save, which made the button say "Salvar imóvel" while editing.
      submit.textContent = submitLabel;
    }
  }
  function clearPendingPhotos() {
    state.pendingPhotos.forEach(photo => { if (photo.path?.startsWith('local-')) URL.revokeObjectURL(photo.url); });
    state.pendingPhotos = [];
    state.uploadFiles = [];
    state.coverPhoto = null;
  }
  function setupPasswordRecovery() {
    const params = new URLSearchParams([location.search.slice(1), location.hash.slice(1)].filter(Boolean).join('&'));
    const recoveryType = params.get('type');
    let accessToken = params.get('access_token');
    const recoveryError = params.get('error_description') || params.get('error_code');
    if (recoveryType !== 'recovery' && !recoveryError) return;

    const cleanQuery = new URLSearchParams(location.search);
    ['access_token','refresh_token','code','type','error','error_code','error_description','expires_in','token_type'].forEach(key => cleanQuery.delete(key));
    history.replaceState(null, '', `${location.pathname}${cleanQuery.size ? `?${cleanQuery}` : ''}`);

    const dialog = $('#password-reset-dialog');
    const form = $('#password-reset-form');
    const status = $('#password-reset-status');
    const submit = $('#password-reset-submit');
    dialog.addEventListener('cancel', event => event.preventDefault());
    if (!accessToken || recoveryType !== 'recovery') {
      status.textContent = recoveryError || 'Este link expirou ou já foi usado. Peça um novo e-mail em Supabase → Authentication → Users → seu usuário → Send password recovery.';
      submit.disabled = true;
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const data = new FormData(form);
      const password = String(data.get('password') || '');
      if (password !== data.get('passwordConfirm')) { status.textContent = 'As senhas não coincidem.'; return; }
      submit.disabled = true;
      status.textContent = 'Salvando sua nova senha…';
      try {
        const response = await fetchWithTimeout(`${config.supabase.url.replace(/\/$/,'')}/auth/v1/user`, {
          method: 'PUT',
          headers: { apikey: config.supabase.anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        },30000);
        if (!response.ok) throw new Error((await response.text()).slice(0, 250));
        accessToken = null;
        form.hidden = true;
        $('#password-reset-success').hidden = false;
        $('#password-reset-close').onclick = () => dialog.close();
      } catch (error) {
        status.textContent = `Não foi possível atualizar a senha. ${error.message}`;
        submit.disabled = false;
      }
    });
    dialog.showModal();
  }
  function setupAdmin() {
    $('#admin-login').onclick=login;
    // The submit handler is attached once, in login(), so a second click cannot double-bind it.
    $('#admin-login-cancel').onclick=()=>$('#admin-login-dialog').close();
    $('#admin-login-dialog').addEventListener('close',()=>{const form=$('#admin-login-form');if(!state.user)form.reset();});
    $('#admin-logout').onclick=async()=>{
      if (LOCAL_PREVIEW) { state.user=null; $('#property-form').hidden=true; await loadCatalog(); return; }
      try{await fetchWithTimeout(`${config.supabase.url.replace(/\/$/,'')}/auth/v1/logout`,{method:'POST',headers:{apikey:config.supabase.anonKey,Authorization:`Bearer ${state.user.access_token}`}},10000);}catch{}
      state.user=null;$('#property-form').reset();clearPendingPhotos();setPropertyFormMode(false);$('#property-form').hidden=true;await loadCatalog();
    };
    initPriceRows();
    addPriceRow({ label: 'Valor total', text: '', highlight: true });
    $('#property-form').addEventListener('submit',saveProperty);
    $('#property-form').elements.category.addEventListener('change',updatePropertyCodeHint);
    // Price display is now driven by the builder (initPriceRows); the legacy selects no longer exist.
    syncPriceFields();
    $('#admin-search').addEventListener('input',renderAdmin);
    $('#admin-category-filter').addEventListener('change',renderAdmin);
    $('#admin-status-filter').addEventListener('change',renderAdmin);
    $('#add-floor-plan').onclick=()=>addFloorPlanRow();
    const photoInput=$('#property-form').elements.photos;
    $('#add-property-photos').onclick=()=>photoInput.click();
    photoInput.addEventListener('change',event=>{
      for(const file of event.target.files){
        const url=URL.createObjectURL(file);
        const localPath=`local-${crypto.randomUUID()}`;
        state.pendingPhotos.push({path:localPath,url});
        state.uploadFiles.push({file,localPath});
      }
      event.target.value='';
      renderPhotoPreview();
    });
    $('#property-form').addEventListener('reset',()=>{
      clearPendingPhotos();
      $('#floor-plans-editor').replaceChildren();
      $('#price-rows').replaceChildren();
      addPriceRow({ label: 'Valor total', text: '', highlight: true });
      setTimeout(()=>{renderPhotoPreview();updatePropertyCodeHint();syncPriceFields();});
    });
    $('#cancel-property-edit').onclick=()=>{const form=$('#property-form');form.reset();setPropertyFormMode(false);renderPhotoPreview();};
    $('#preview-property').onclick=()=>{
      const f=$('#property-form');const fd=new FormData(f);
      const temp={id:'preview',title:fd.get('title')||'Pré-visualização',description:fd.get('description'),category:fd.get('category'),region:fd.get('region'),price:fd.get('price'),price_items:readPriceRows(),price_display:fd.get('price_display'),entry_price:fd.get('entry_price'),entry_label:fd.get('entry_label'),entry_installments:fd.get('entry_installments'),entry_mode:fd.get('entry_mode'),price_highlight:fd.get('price_highlight'),price_highlight_label:fd.get('price_highlight_label'),price_secondary_label:fd.get('price_secondary_label'),price_extra_label:fd.get('price_extra_label'),status:'published',photos:state.pendingPhotos,featured:fd.get('featured')==='on',bedrooms:fd.get('bedrooms'),area:fd.get('area'),features:{items:String(fd.get('features')).split(',').map(value=>value.trim()).filter(Boolean),floor_plans:readFloorPlans()},payment:fd.get('payment')};
      state.properties.unshift(temp);openProperty('preview');state.properties.shift();
    };
  }
  // Highlights the navigation item of the section in view, mirroring the active item of a sidebar.
  function initActiveNav() {
    const links = $$('#primary-nav a');
    if (!links.length || !('IntersectionObserver' in window)) return;
    const sections = links
      .map(link => document.querySelector(link.getAttribute('href')))
      .filter(Boolean);
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        links.forEach(link => {
          const active = link.getAttribute('href') === `#${id}`;
          link.classList.toggle('is-active', active);
          if (active) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    sections.forEach(section => observer.observe(section));
  }

  // Staggered entrance for bento cards: translateY(18px) -> 0, scale .985 -> 1, opacity 0 -> 1.
  function initStagger() {
    if (REDUCED_MOTION.matches) return;
    const groups = [
      $$('.hero-grid > *'),
      $$('.property-grid > *'),
      $$('.credit-grid > *'),
      $$('.about-grid > *'),
      $$('.contact-grid > *'),
    ];
    groups.forEach(nodes => nodes.forEach((node, index) => {
      node.style.setProperty('--stagger', `${Math.min(index, 8) * 70}ms`);
      node.classList.add('stagger');
    }));
  }

  // A compact sticky header after the hero, plus a subtle reveal for sections entering the viewport.
  function initChrome() {
    const header = $('#site-header');
    const onScroll = () => header?.classList.toggle('is-compact', window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    const targets = $$('.section-head, .property-grid, .credit-grid, .about-grid, .contact-grid');
    if (!('IntersectionObserver' in window) || REDUCED_MOTION.matches) {
      targets.forEach(target => target.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    targets.forEach(target => { target.classList.add('reveal'); observer.observe(target); });
  }
  // If config.js did not load, the page still renders, but it says so in the admin area instead of
  // pretending everything is fine.
  function warnMissingConfig() {
    if (window.SITE_CONFIG) return;
    const status = $('#admin-status');
    if (status) {
      status.textContent = 'config.js não carregou: sem ele o site não consulta o catálogo. Recarregue com Ctrl + Shift + R ou verifique se o arquivo está publicado.';
      status.classList.add('is-error');
    }
  }
  // Warns before the tab is closed with unsaved edits in the listing form.
  function initUnsavedGuard() {
    const form = $('#property-form');
    if (!form) return;
    let dirty = false;
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('submit', () => { dirty = false; });
    form.addEventListener('reset', () => { dirty = false; });
    window.addEventListener('beforeunload', event => {
      if (!dirty || form.hidden) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }
  function init() {
    // The page is a static shell that keeps working without config.js; every lookup below is
    // guarded so a missing element (or a stale cached HTML) cannot abort the whole script.
    const savedCategory = localStorage.getItem(CATEGORY_STORAGE_KEY);
    if (savedCategory === ALL_CATEGORIES) state.category = ALL_CATEGORIES;
    else if (savedCategory && (config.categories || []).some(category => canonicalCategory(savedCategory) === category)) state.category = canonicalCategory(savedCategory);
    initTheme();setupProfile();renderCategories();setupPasswordRecovery();
    $$('.modal-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
    $$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close();}));
    // The portrait in the "Sobre" section and the floating WhatsApp button are plain links now;
    // only the dialogs that still exist are wired here.
    // The Cohapar explanation can be opened from the credit section and from the category info bar.
    document.addEventListener('click',e=>{if(e.target.closest('.cohapar-info-trigger'))$('#cohapar-info-modal').showModal();});
    $('#property-modal')?.addEventListener('close',()=>{if(location.hash.startsWith('#imovel-'))history.replaceState(null,'',location.pathname+location.search);});
    $('.gallery-prev')?.addEventListener('click',()=>showLarge(state.galleryIndex-1));
    $('.gallery-next')?.addEventListener('click',()=>showLarge(state.galleryIndex+1));
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape')return;
      const viewer=$('#image-modal');
      if(!viewer?.open)return;
      if(e.key==='ArrowLeft')showLarge(state.galleryIndex-1);
      if(e.key==='ArrowRight')showLarge(state.galleryIndex+1);
    });
    warnMissingConfig();
    setupAdmin();
    initUnsavedGuard();
    initChrome();
    initActiveNav();
    loadCatalog().then(()=>{
      if(!location.hash.startsWith('#imovel-'))return;
      // openProperty resolves the id itself; decoding it here double-decoded ids with %.
      openProperty(location.hash.slice(8));
    });
  }
  init();
})();
