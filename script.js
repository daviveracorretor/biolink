(() => {
  'use strict';
  const config = window.SITE_CONFIG || {};
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const MAX_PROPERTY_PHOTO_SIZE = 20 * 1024 * 1024;
  const ALLOWED_PROPERTY_PHOTO_TYPES = new Set(['image/jpeg','image/png','image/webp','image/avif','image/heic','image/heif']);
  const ALL_CATEGORIES = '__all__';
  const CATEGORY_STORAGE_KEY = 'dv-property-category';
  const state = { properties: [], category: ALL_CATEGORIES, gallery: [], galleryIndex: 0, galleryTitle: '', galleryRequestId: 0, pendingPhotos: [], uploadFiles: [], coverPhoto: null, cardSlideshowCleanups: [], refreshPromise: null, user: null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hasSupabase = () => Boolean(config.supabase?.url && config.supabase?.anonKey);
  const wa = (message = 'Olá, Davi! Gostaria de conversar sobre imóveis em Cascavel.') => config.whatsapp ? `https://wa.me/${encodeURIComponent(config.whatsapp)}?text=${encodeURIComponent(message)}` : '#admin';
  const money = n => n ? `A partir de ${Number(n).toLocaleString('pt-BR', { style:'currency', currency:'BRL', maximumFractionDigits:2 })}` : 'Consulte condições';
  const propertyOrder = (a,b) => Number(Boolean(b.featured))-Number(Boolean(a.featured)) || Number(a.display_order ?? Number.MAX_SAFE_INTEGER)-Number(b.display_order ?? Number.MAX_SAFE_INTEGER) || String(b.created_at||'').localeCompare(String(a.created_at||''));
  function propertyPriceMarkup(property, className) {
    const mode = ['entry','both'].includes(property.price_display) ? property.price_display : 'total';
    const total = Number(property.price) > 0;
    const entry = Number(property.entry_price) > 0;
    const entryName = property.entry_label === 'Sinal' ? 'Sinal' : 'Entrada';
    const installments = Number(property.entry_installments) > 0 ? `<small>${esc(entryName)} em até ${esc(property.entry_installments)}x</small>` : '';
    const totalLine = total ? `<span class="price-line">${mode==='both'?'<span class="price-kind">Valor total</span>':''}${money(property.price)}</span>` : '';
    const entryLine = entry ? `<span class="price-line"><span class="price-kind">${esc(entryName)}</span>${money(property.entry_price)}${installments}</span>` : '';
    if (mode === 'entry' && entry) return `<div class="${className} price-lines">${entryLine}</div>`;
    if (mode === 'both') return `<div class="${className} price-lines">${totalLine}${entryLine}${!total && !entry ? '<span class="price-line">Consulte condições</span>':''}</div>`;
    return `<div class="${className} price-lines">${totalLine || '<span class="price-line">Consulte condições</span>'}</div>`;
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
    document.documentElement.dataset.theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const button = $('#theme-toggle');
    const updateButton = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      document.querySelector('meta[name="theme-color"]').content = dark ? '#191C27' : '#F8F9FA';
      button.setAttribute('aria-label', dark ? 'Ativar tema claro' : 'Ativar tema escuro');
      button.title = dark ? 'Ativar tema claro' : 'Ativar tema escuro';
      button.querySelector('span').textContent = dark ? '☀' : '☾';
      $$('.brand-mark').forEach(mark => { mark.src = dark ? mark.dataset.darkSrc : mark.dataset.lightSrc; });
    };
    updateButton();
    button.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next; localStorage.setItem('dv-theme', next);
      updateButton();
    });
  }
  function setupProfile() {
    if (config.profileImage) {
      $('#avatar').innerHTML = `<img src="${esc(config.profileImage)}" alt="Davi Vera">`;
      $('#avatar img').addEventListener('error', event => event.currentTarget.remove(), { once:true });
    }
    const insta = $('#instagram-link');
    if (config.instagram) { insta.href = config.instagram; insta.target = '_blank'; insta.rel = 'noopener'; } else insta.hidden = true;
    ['whatsapp-link','simulate-link','buyer-link','owner-link','about-contact'].forEach(id => {
      const el = document.getElementById(id);
      const text = id === 'owner-link' ? 'Olá, Davi! Tenho um imóvel em Cascavel e gostaria de conversar sobre anunciar.' : id === 'simulate-link' ? 'Olá, Davi! Gostaria de fazer uma simulação de crédito imobiliário.' : undefined;
      el.href = wa(text); if (!config.whatsapp) el.title = 'Configure o WhatsApp em config.js';
    });
    if (config.spotlight?.visible === false) $('#spotlight').hidden = true;
    else { $('#spotlight h2').textContent = config.spotlight?.title || $('#spotlight h2').textContent; $('#spotlight .spotlight-description').textContent = config.spotlight?.description || $('#spotlight .spotlight-description').textContent; $('#simulate-link').textContent = config.spotlight?.button || 'Fazer simulação'; }
    $('#year').textContent = new Date().getFullYear();
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
    host.hidden = available.length === 0;
    host.innerHTML = available.length ? [`<button class="category-chip category-chip-all ${state.category === ALL_CATEGORIES ? 'active':''}" type="button" data-category="${ALL_CATEGORIES}" aria-pressed="${state.category === ALL_CATEGORIES}">${state.category === ALL_CATEGORIES ? '<span class="category-check" aria-hidden="true">✓</span>':''}Todos</button>`, ...available.map(c => `<button class="category-chip category-chip-${categoryKey(c).replace(/[^a-z0-9]+/g, '-')} ${state.category === c ? 'active':''}" type="button" data-category="${esc(c)}" aria-pressed="${state.category === c}">${state.category === c ? '<span class="category-check" aria-hidden="true">✓</span>':''}${esc(c)}</button>`)].join('') : '';
    host.onclick = e => { const b = e.target.closest('[data-category]'); if (b) { state.category = b.dataset.category; localStorage.setItem(CATEGORY_STORAGE_KEY, state.category); renderCategories(); renderProperties(); } };
    const info = $('#category-info');
    if (info) {
      info.hidden = state.category !== 'Cohapar';
      info.innerHTML = state.category === 'Cohapar' ? '<button class="cohapar-info-trigger" type="button" aria-haspopup="dialog" aria-controls="cohapar-info-modal"><span class="cohapar-info-icon" aria-hidden="true">i</span><span><strong>Conheça o Cohapar</strong><small>Entenda como funciona e veja o que é necessário.</small></span><span class="cohapar-info-arrow" aria-hidden="true">↗</span></button>' : '';
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
    state.cardSlideshowCleanups.forEach(cleanup => cleanup());
    state.cardSlideshowCleanups = [];
    const list = filteredProperties().sort(propertyOrder); const grid = $('#property-grid');
    $('#listing-count').textContent = `${list.length} ${list.length === 1 ? 'imóvel' : 'imóveis'}`;
    $('#empty-state').hidden = list.length > 0; grid.innerHTML = list.map(p => {
      const photos = orderedPropertyPhotos(p).filter(photo => photo?.url);
      const initialIndex = 0;
      const cover = photos[0]?.url || p.cover_url || '';
      const tags = [p.featured ? '<span class="badge">DESTAQUE</span>':'', p.status === 'reserved' ? '<span class="badge status">RESERVADO</span>':'', p.status === 'sold' ? '<span class="badge status">VENDIDO</span>':''].join('');
      const category = canonicalCategory(p.category) || 'Imóvel';
      const categoryClass = `category-${categoryKey(category).replace(/[^a-z0-9]+/g, '-')}`;
      const facts = [p.bedrooms ? `${esc(p.bedrooms)} quartos`:'', p.area ? `${decimal(p.area)} m²`:'', p.parking ? `${esc(p.parking)} vagas`:'' ].filter(Boolean).join(' · ');
      const morePhotos = photos.length > 1 ? `<button type="button" class="card-more-photos" aria-label="Ver todas as ${photos.length} fotos de ${esc(p.title)}">Ver mais fotos <span aria-hidden="true">↗</span></button>` : '';
      return `<article class="property-card" tabindex="0" role="button" data-id="${esc(p.id)}"><div class="property-image">${cover ? `<img src="${esc(cover)}" alt="${esc(p.title)}" data-photo-index="${initialIndex}" loading="lazy">`:''}<div class="property-badges">${tags}</div><span class="property-category-badge ${categoryClass}">${esc(category)}</span>${morePhotos}</div><div class="property-copy"><h3>${esc(p.title)}</h3><p class="property-region">${esc(p.region || 'Cascavel, PR')}</p>${propertyPriceMarkup(p,'property-price')}${facts ? `<p class="property-meta">${facts}</p>`:''}</div></article>`;
    }).join('');
    $$('.property-card', grid).forEach(card => { card.onclick = () => openProperty(card.dataset.id); card.onkeydown = e => { if (e.target.closest('.card-more-photos')) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProperty(card.dataset.id); } }; });
    $$('.card-more-photos', grid).forEach(button => button.onclick = event => { event.preventDefault(); event.stopPropagation(); openProperty(button.closest('.property-card').dataset.id); });
    $$('.property-card', grid).forEach(card => {
      const property = state.properties.find(item => String(item.id) === card.dataset.id);
      const photos = orderedPropertyPhotos(property).filter(photo => photo?.url).slice(0, 5);
      const image = $('.property-image img', card);
      if (!image || photos.length < 2) return;
      let inView = false;
      let timer = null;
      let loadingNext = false;
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
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
          if (!reducedMotion) image.classList.add('card-photo-enter');
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
  function modalPhotoMarkup(p) {
    const photos = orderedPropertyPhotos(p).filter(photo => photo?.url);
    if (!photos.length && p.cover_url) return `<div class="modal-photo-item"><img src="${esc(p.cover_url)}" alt="${esc(p.title)} — foto 1" data-photo-index="0" loading="lazy"></div>`;
    return photos.map((photo,i) => `<div class="modal-photo-item" data-photo-sort-item="${i}"><img src="${esc(photo.url)}" alt="${esc(p.title)} — foto ${i+1}" data-photo-index="${i}" loading="lazy">${state.user && String(p.id) !== 'preview' && photos.length > 1 ? `<div class="modal-photo-order"><button type="button" class="photo-drag-handle" data-photo-drag="${i}" aria-label="Arrastar foto ${i+1} para reordenar" title="Arraste para mudar a ordem"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="6" r="1.5"/><circle cx="16" cy="6" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/></svg></button><button type="button" data-modal-photo-move="${i}" data-move-to="${i-1}" ${i===0?'disabled':''} aria-label="Mover foto ${i+1} para antes">↑</button><button type="button" data-modal-photo-move="${i}" data-move-to="${i+1}" ${i===photos.length-1?'disabled':''} aria-label="Mover foto ${i+1} para depois">↓</button></div>`:''}</div>`).join('');
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
    const facts = [['Área',p.area && `${decimal(p.area)} m²`],['Quartos',p.bedrooms],['Suítes',p.suites],['Banheiros',p.bathrooms],['Vagas',p.parking]].filter(x=>x[1]);
    const features = propertyFeatures(p); const floorPlans = propertyFloorPlans(p);
    const url = new URL(location.href); url.hash = `imovel-${encodeURIComponent(p.id)}`;
    const contact = wa(`Olá, Davi! Tenho interesse no imóvel ${p.title}${p.code ? ` (código ${p.code})`:''}.`);
    $('#modal-content').innerHTML = `<div class="modal-gallery">${modalPhotoMarkup(p)}</div>${state.user && String(p.id) !== 'preview' && p.photos?.length > 1 ? '<p class="photo-order-hint">Administrador: arraste a alça ⠿ para reordenar. A primeira foto será a capa; a ordem é salva automaticamente.</p>':''}<div class="modal-copy"><p class="eyebrow">${esc(canonicalCategory(p.category))} · ${esc(p.region || 'Cascavel, PR')}</p><h2>${esc(p.title)}</h2>${propertyPriceMarkup(p,'modal-price')}${p.code ? `<p>Código do anúncio: ${esc(p.code)}</p>`:''}<div class="modal-facts">${facts.map(x=>`<span>${esc(x[0])}: ${esc(x[1])}</span>`).join('')}</div><p>${esc(p.description || '')}</p>${features.length ? `<h3>Diferenciais</h3><p>${esc(features.join(' · '))}</p>`:''}${floorPlans.length ? `<h3>Plantas disponíveis</h3><ul class="modal-floor-plans">${floorPlans.map(floorPlanLabel).filter(Boolean).map(plan=>`<li>${esc(plan)}</li>`).join('')}</ul>`:''}${p.payment ? `<h3>Condições de pagamento</h3><p>${esc(p.payment)}</p>`:''}<div class="share-actions"><a class="button button-primary" href="${esc(contact)}" ${config.whatsapp?'target="_blank" rel="noopener"':''}>Falar sobre este imóvel ↗</a><button class="button button-secondary" id="copy-property-link">Copiar link</button><button class="button button-secondary" id="share-property">Compartilhar</button></div></div>`;
    $$('.modal-gallery img').forEach(img => img.onclick = () => showLarge(Number(img.dataset.photoIndex)));
    $$('[data-modal-photo-move]').forEach(button => button.onclick = () => movePropertyPhoto(p, Number(button.dataset.modalPhotoMove), Number(button.dataset.moveTo)));
    if (state.user && String(p.id) !== 'preview') enablePhotoDragging($('.modal-gallery'), '.modal-photo-item', (from,to) => movePropertyPhoto(p,from,to));
    $('#copy-property-link').onclick = async () => { await navigator.clipboard.writeText(url.href); $('#copy-property-link').textContent = 'Link copiado'; };
    $('#share-property').onclick = async () => { if (navigator.share) await navigator.share({title:p.title,url:url.href}); else { await navigator.clipboard.writeText(url.href); $('#share-property').textContent = 'Link copiado'; } };
    if (!$('#property-modal').open) $('#property-modal').showModal(); history.replaceState(null,'',url); track(p.id);
  }
  function showLarge(index) {
    if (!state.gallery.length) return;
    state.galleryIndex = (index + state.gallery.length) % state.gallery.length;
    const source = state.gallery[state.galleryIndex];
    const image = $('#large-image');
    const dialog = $('#image-modal');
    const requestId = ++state.galleryRequestId;
    $('#gallery-count').textContent = `${state.galleryIndex + 1} / ${state.gallery.length}`;
    $('.gallery-prev').hidden = state.gallery.length < 2;
    $('.gallery-next').hidden = state.gallery.length < 2;
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
  function setAdminStatus(text, error=false) { const e=$('#admin-status'); e.textContent=text; e.style.color=error?'#b2483c':''; }
  function mediaUrl(path) { return `${config.supabase.url.replace(/\/$/,'')}/storage/v1/object/public/${config.supabase.bucket}/${path}`; }
  async function loadCatalog() {
    if (!hasSupabase()) { state.properties=[]; renderCategories(); renderProperties(); setAdminStatus('O catálogo ainda não está conectado. Para publicar imóveis, configure o Supabase, o ID da sua conta administradora e as políticas de acesso descritas no README.'); return; }
    try { state.properties=await api(`${encodeURIComponent(config.supabase.table)}?select=*&order=created_at.desc`) || []; setAdminStatus(state.user ? `Conectado como ${state.user.email}.` : 'Catálogo conectado. Entre como administrador para gerenciar anúncios.'); }
    catch(e) { state.properties=[]; setAdminStatus(`Não foi possível carregar o catálogo. Confira tabela, políticas de leitura e conexão. ${e.message}`,true); }
    renderCategories(); renderProperties(); renderAdmin();
  }
  function login() { const dialog=$('#admin-login-dialog'); $('#admin-login-error').textContent=''; dialog.showModal(); $('#admin-login-form').elements.email.focus(); }
  async function submitAdminLogin(event) { event.preventDefault(); const form=event.currentTarget; const email=form.elements.email.value.trim(); const password=form.elements.password.value; const error=$('#admin-login-error'); const submit=form.querySelector('[type="submit"]'); error.textContent='Verificando acesso…'; submit.disabled=true; try { const r=await fetchWithTimeout(`${config.supabase.url.replace(/\/$/,'')}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:config.supabase.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})},30000); if(!r.ok)throw Error('Credenciais inválidas ou serviço indisponível.'); const session=await r.json(); if(!config.supabase.adminUserId || session.user?.id?.toLowerCase()!==config.supabase.adminUserId.toLowerCase()){await fetchWithTimeout(`${config.supabase.url.replace(/\/$/,'')}/auth/v1/logout`,{method:'POST',headers:{apikey:config.supabase.anonKey,Authorization:`Bearer ${session.access_token}`}},10000).catch(()=>{});throw Error('Esta conta não está autorizada a administrar o site.');} session.expires_at=session.expires_at || Math.floor(Date.now()/1000)+Number(session.expires_in||3600); state.user=session; form.reset(); $('#admin-login-dialog').close(); $('#admin-login').hidden=true; $('#admin-logout').hidden=false; $('#property-form').hidden=false; await loadCatalog(); }catch(e){error.textContent=e.message;}finally{form.elements.password.value='';submit.disabled=false;} }
  function renderAdmin() {
    $('#admin-login').hidden=!hasSupabase()||!config.supabase.adminUserId||!!state.user; $('#admin-logout').hidden=!state.user; $('#property-form').hidden=!state.user;
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
    $('#admin-list').innerHTML=state.user?(matches.length?matches.map((p,index)=>`<div class="admin-row" data-property-sort-item="${index}" data-featured="${Boolean(p.featured)}"><button class="property-drag-handle" type="button" data-property-drag="${esc(p.id)}" aria-label="Arrastar ${esc(p.title)} para reordenar" title="Arraste para organizar" ${filtered || matches.length<2 || state.orderSaving?'hidden':''}>⠿</button><div class="admin-row-main"><strong>${esc(p.title)}</strong><span>${esc(canonicalCategory(p.category)||'Imóvel')} · ${esc(p.status)} · ${esc(p.code||'Sem código')}</span></div><span class="admin-row-actions"><button class="text-button" data-copy-code="${esc(p.id)}">Copiar código</button><button class="text-button" data-edit="${esc(p.id)}">Editar</button><button class="text-button" data-delete="${esc(p.id)}">Excluir</button></span></div>`).join(''):'<p class="admin-list-empty">Nenhum imóvel corresponde a essa busca.</p>'):'';
    $$('[data-copy-code]').forEach(b=>b.onclick=async()=>{const p=state.properties.find(item=>String(item.id)===b.dataset.copyCode);if(!p?.code){setAdminStatus('Este imóvel ainda não tem código.',true);return;}try{await navigator.clipboard.writeText(p.code);setAdminStatus(`Código ${p.code} copiado.`);}catch{setAdminStatus('Não foi possível copiar o código neste navegador.',true);}});
    $$('[data-edit]').forEach(b=>b.onclick=()=>fillForm(state.properties.find(p=>String(p.id)===b.dataset.edit)));
    $$('[data-delete]').forEach(b=>b.onclick=async()=>{const p=state.properties.find(x=>String(x.id)===b.dataset.delete);if(!confirm(`Excluir “${p.title}”? Esta ação não pode ser desfeita.`))return;try{await api(`${encodeURIComponent(config.supabase.table)}?id=eq.${encodeURIComponent(p.id)}`,{method:'DELETE'});await loadCatalog();}catch(e){setAdminStatus(`Falha ao excluir: ${e.message}`,true);}});
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
  function syncPriceFields() {
    const form=$('#property-form'), mode=form.elements.price_display.value;
    const entryVisible=mode==='entry'||mode==='both';
    const totalRequired=mode==='total'||mode==='both';
    $('#price-entry-fields').hidden=!entryVisible;
    form.elements.price.required=totalRequired;
    form.elements.entry_price.required=entryVisible;
  }
  function fillForm(p) { const f=$('#property-form'); f.reset(); f.elements.id.value=p.id; ['title','description','category','region','price','area','bedrooms','suites','bathrooms','parking','payment','status','price_display','entry_price','entry_label','entry_installments'].forEach(k=>{if(f.elements[k])f.elements[k].value=p[k]??'';}); f.elements.price_display.value=p.price_display||'total'; f.elements.entry_label.value=p.entry_label||'Entrada'; f.elements.code.value=p.code??''; f.elements.category.value=canonicalCategory(p.category); f.elements.features.value=propertyFeatures(p).join(', '); propertyFloorPlans(p).forEach(plan=>addFloorPlanRow(plan));f.elements.featured.checked=!!p.featured;state.pendingPhotos=orderedPropertyPhotos(p);state.coverPhoto=state.pendingPhotos[0]?.path||null;syncPriceFields();setPropertyFormMode(true,p.title);updatePropertyCodeHint();renderPhotoPreview();f.scrollIntoView({behavior:'smooth',block:'start'}); }
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
  async function saveProperty(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const id = formData.get('id') || crypto.randomUUID();
    submit.disabled = true;
    submit.textContent = state.uploadFiles.length ? `Enviando fotos 0/${state.uploadFiles.length}…` : 'Salvando…';
    try {
      await uploadPhotos([...state.uploadFiles], id, (done,total,currentFile) => { submit.textContent = currentFile ? `Enviando ${done+1}/${total}: ${currentFile.slice(0,18)}…` : `Enviando fotos ${done}/${total}…`; });
      submit.textContent = 'Salvando anúncio…';
      const payload = {
        title: formData.get('title'), description: formData.get('description'), category: formData.get('category'), region: formData.get('region'),
        price: Number(formData.get('price')) || null, area: Number(formData.get('area')) || null,
        bedrooms: Number(formData.get('bedrooms')) || null, suites: Number(formData.get('suites')) || null,
        bathrooms: Number(formData.get('bathrooms')) || null, parking: Number(formData.get('parking')) || null,
        price_display:formData.get('price_display')||'total', entry_price:Number(formData.get('entry_price'))||null, entry_label:formData.get('entry_label')||'Entrada', entry_installments:Number(formData.get('entry_installments'))||null,
        features: { items:String(formData.get('features')).split(',').map(value => value.trim()).filter(Boolean), floor_plans:readFloorPlans() },
        payment: formData.get('payment'), code: formData.get('id') ? formData.get('code') : undefined, status: formData.get('status'),
        featured: formData.get('featured') === 'on', photos: state.pendingPhotos, cover: state.coverPhoto || state.pendingPhotos[0]?.path || null,
        display_order:(()=>{const old=state.properties.find(property=>String(property.id)===String(id));if(old){if(!old.featured&&formData.get('featured')==='on')return Math.min(0,...state.properties.filter(property=>property.featured).map(property=>Number(property.display_order)||0))-1;return Number(old.display_order)||0;}if(formData.get('featured')==='on')return Math.min(0,...state.properties.filter(property=>property.featured).map(property=>Number(property.display_order)||0))-1;return Math.max(-1,...state.properties.map(property=>Number(property.display_order)||0))+1;})()
      };
      const savePath = formData.get('id')
        ? `${encodeURIComponent(config.supabase.table)}?id=eq.${encodeURIComponent(id)}`
        : encodeURIComponent(config.supabase.table);
      const saveOptions = formData.get('id')
        ? {method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(payload)}
        : {method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({id,...payload})};
      const savedRows = await api(savePath,saveOptions);
      const existingIndex = state.properties.findIndex(property => String(property.id) === String(id));
      const savedProperty = savedRows?.[0] || {...(existingIndex >= 0 ? state.properties[existingIndex] : {}),...payload,id};
      if (existingIndex >= 0) state.properties[existingIndex] = savedProperty;
      else state.properties.unshift(savedProperty);
      form.reset(); clearPendingPhotos(); setPropertyFormMode(false); renderPhotoPreview();
      renderCategories(); renderProperties(); renderAdmin();
      const savedCode = savedProperty?.code || payload.code;
      setAdminStatus(`“${payload.title}” salvo como ${payload.status}.${savedCode ? ` Código ${savedCode}.` : ' O código será exibido na lista após a próxima atualização.'}`);
    } catch (error) {
      setAdminStatus(`Não foi possível salvar o imóvel. ${error.message}`, true);
    } finally {
      submit.disabled = false;
      submit.textContent = form.elements.id.value ? 'Salvar alterações' : 'Salvar imóvel';
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
    $('#admin-login-form').addEventListener('submit',submitAdminLogin);
    $('#admin-login-cancel').onclick=()=>$('#admin-login-dialog').close();
    $('#admin-login-dialog').addEventListener('close',()=>{const form=$('#admin-login-form');if(!state.user)form.reset();});
    $('#admin-logout').onclick=async()=>{
      try{await fetchWithTimeout(`${config.supabase.url.replace(/\/$/,'')}/auth/v1/logout`,{method:'POST',headers:{apikey:config.supabase.anonKey,Authorization:`Bearer ${state.user.access_token}`}},10000);}catch{}
      state.user=null;$('#property-form').reset();clearPendingPhotos();setPropertyFormMode(false);$('#property-form').hidden=true;await loadCatalog();
    };
    $('#property-form').addEventListener('submit',saveProperty);
    $('#property-form').elements.category.addEventListener('change',updatePropertyCodeHint);
    $('#property-form').elements.price_display.addEventListener('change',syncPriceFields);
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
      setTimeout(()=>{renderPhotoPreview();updatePropertyCodeHint();syncPriceFields();});
    });
    $('#cancel-property-edit').onclick=()=>{const form=$('#property-form');form.reset();setPropertyFormMode(false);renderPhotoPreview();};
    $('#preview-property').onclick=()=>{
      const f=$('#property-form');const fd=new FormData(f);
      const temp={id:'preview',title:fd.get('title')||'Pré-visualização',description:fd.get('description'),category:fd.get('category'),region:fd.get('region'),price:fd.get('price'),price_display:fd.get('price_display'),entry_price:fd.get('entry_price'),entry_label:fd.get('entry_label'),entry_installments:fd.get('entry_installments'),status:'published',photos:state.pendingPhotos,featured:fd.get('featured')==='on',bedrooms:fd.get('bedrooms'),area:fd.get('area'),features:{items:String(fd.get('features')).split(',').map(value=>value.trim()).filter(Boolean),floor_plans:readFloorPlans()},payment:fd.get('payment')};
      state.properties.unshift(temp);openProperty('preview');state.properties.shift();
    };
  }
  function init() {
    const savedCategory = localStorage.getItem(CATEGORY_STORAGE_KEY);
    if (savedCategory === ALL_CATEGORIES) state.category = ALL_CATEGORIES;
    else if (savedCategory && (config.categories || []).some(category => canonicalCategory(savedCategory) === category)) state.category = canonicalCategory(savedCategory);
    initTheme();setupProfile();renderCategories();setupPasswordRecovery();
    $$('.modal-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());[$('#property-modal'),$('#image-modal'),$('#about-modal'),$('#cohapar-info-modal')].forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close();}));$('#avatar').addEventListener('click',()=>$('#about-modal').showModal());$('#category-info').addEventListener('click',e=>{if(e.target.closest('.cohapar-info-trigger'))$('#cohapar-info-modal').showModal();});$('#property-modal').addEventListener('close',()=>{if(location.hash.startsWith('#imovel-'))history.replaceState(null,'',location.pathname+location.search);});
    $('.gallery-prev').onclick=()=>showLarge(state.galleryIndex-1);$('.gallery-next').onclick=()=>showLarge(state.galleryIndex+1);document.addEventListener('keydown',e=>{if(e.key==='Escape')return;if($('#image-modal').open&&e.key==='ArrowLeft')showLarge(state.galleryIndex-1);if($('#image-modal').open&&e.key==='ArrowRight')showLarge(state.galleryIndex+1);});
    setupAdmin();loadCatalog().then(()=>{if(location.hash.startsWith('#imovel-'))openProperty(decodeURIComponent(location.hash.slice(8)));});
  }
  init();
})();
