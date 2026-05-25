/* ==========================================================================
   MUSICBOXD - APPLICATION LOGIC & ROUTER
   Vanilla JavaScript Single Page Application (SPA) Client
   ========================================================================== */

// CONSTANTES DO ESTADO GLOBAL
const STATE = {
  currentUser: 'matheus',
  currentView: 'dashboard',
  routeParams: {},
  searchDebounceTimer: null,
  activeRating: 0, // Nota selecionada no modal (0.5 - 5.0)
  playlistTracks: [] // Músicas temporárias sendo adicionadas à playlist em edição
};

// INICIALIZADOR DO APLICATIVO
document.addEventListener('DOMContentLoaded', () => {
  setupSPAInterceptors();
  setupGlobalSearch();
  setupModalListeners();
  setupStarRatingSelector();
  
  // Renderizar a rota inicial
  handleCurrentRoute();
  
  // Monitorar botões voltar/avançar do navegador
  window.addEventListener('popstate', () => {
    handleCurrentRoute();
  });
});

// ==========================================
// 1. ROTAS E NAVEGAÇÃO SPA (Single Page Router)
// ==========================================

function navigateTo(url) {
  window.history.pushState(null, '', url);
  handleCurrentRoute();
}

function setupSPAInterceptors() {
  // Interceptar clicks em links marcados
  document.body.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    
    const href = link.getAttribute('href');
    // Verificar se é uma rota interna
    if (href && href.startsWith('/') && !href.startsWith('/api') && link.target !== '_blank') {
      e.preventDefault();
      navigateTo(href);
    }
  });

  // Fechar menu mobile ao clicar fora ou nos links
  const mobileMenu = document.getElementById('mobile-menu');
  const mobileToggle = document.getElementById('mobile-toggle');
  
  mobileToggle.addEventListener('click', () => {
    mobileMenu.classList.toggle('active');
  });

  document.querySelectorAll('.mobile-link').forEach(link => {
    link.addEventListener('click', () => {
      mobileMenu.classList.remove('active');
    });
  });
}

function handleCurrentRoute() {
  const path = window.location.pathname;
  let view = 'dashboard';
  let params = {};

  // Atualizar links ativos na navegação
  updateNavActiveLinks(path);

  // Roteador regex simples
  if (path === '/' || path === '') {
    view = 'dashboard';
  } else if (path.startsWith('/search') || path.startsWith('/buscar')) {
    view = 'search';
    const queryParams = new URLSearchParams(window.location.search);
    params.q = queryParams.get('q') || '';
  } else if (path.startsWith('/playlists')) {
    const parts = path.split('/');
    if (parts[2]) {
      view = 'playlist-details';
      params.id = parts[2];
    } else {
      view = 'playlists';
    }
  } else if (path.startsWith('/recomendacoes')) {
    view = 'recommendations';
  } else if (path.startsWith('/perfil/')) {
    view = 'profile';
    params.username = path.split('/')[2] || 'matheus';
  } else if (path.startsWith('/track/') || path.startsWith('/album/') || path.startsWith('/artist/')) {
    const parts = path.split('/');
    view = 'details';
    params.type = parts[1]; // track, album, artist
    params.id = parts[2];
  } else {
    // Rota não encontrada - Redirecionar para home
    view = 'dashboard';
  }

  STATE.currentView = view;
  STATE.routeParams = params;
  
  renderView(view, params);
}

function updateNavActiveLinks(path) {
  document.querySelectorAll('.nav-link, .mobile-link').forEach(link => {
    link.classList.remove('active');
    const viewName = link.getAttribute('data-view');
    
    if (path === '/' && viewName === 'dashboard') {
      link.classList.add('active');
    } else if (path.startsWith('/playlists') && viewName === 'playlists') {
      link.classList.add('active');
    } else if (path.startsWith('/recomendacoes') && viewName === 'recommendations') {
      link.classList.add('active');
    } else if (path.startsWith('/perfil') && viewName === 'profile') {
      link.classList.add('active');
    }
  });
}

// ==========================================
// 2. FUNÇÕES AUXILIARES DA API (fetch)
// ==========================================

async function apiFetch(endpoint, options = {}) {
  try {
    const response = await fetch(endpoint, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Erro de API: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Erro ao chamar ${endpoint}:`, error);
    showToast(error.message || 'Erro de conexão com o servidor', 'warning');
    throw error;
  }
}

// Sistema de Notificação Toast
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = '<i class="fa-solid fa-circle-check"></i>';
  if (type === 'warning') icon = '<i class="fa-solid fa-triangle-exclamation"></i>';
  if (type === 'info') icon = '<i class="fa-solid fa-circle-info"></i>';

  toast.innerHTML = `${icon} <span>${message}</span>`;
  container.appendChild(toast);

  // Remover após 3 segundos
  setTimeout(() => {
    toast.style.animation = 'slideInRight 0.3s ease reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ==========================================
// 3. BARRA DE PESQUISA E AUTOCOMPLETE
// ==========================================

function setupGlobalSearch() {
  const searchInput = document.getElementById('global-search-input');
  const autocompleteContainer = document.getElementById('search-autocomplete-results');

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    
    clearTimeout(STATE.searchDebounceTimer);
    if (!query) {
      autocompleteContainer.style.display = 'none';
      return;
    }

    STATE.searchDebounceTimer = setTimeout(async () => {
      try {
        const results = await apiFetch(`/api/spotify/search?q=${encodeURIComponent(query)}&limit=5`);
        renderAutocomplete(results);
      } catch (err) {
        autocompleteContainer.style.display = 'none';
      }
    }, 400);
  });

  // Fechar autocomplete ao clicar fora
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.header-search')) {
      autocompleteContainer.style.display = 'none';
    }
  });

  // Interceptar submit de busca ao apertar Enter
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const query = searchInput.value.trim();
      if (query) {
        autocompleteContainer.style.display = 'none';
        navigateTo(`/search?q=${encodeURIComponent(query)}`);
      }
    }
  });

  // Mobile Search
  const mobileInput = document.getElementById('mobile-search-input');
  mobileInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const query = mobileInput.value.trim();
      if (query) {
        navigateTo(`/search?q=${encodeURIComponent(query)}`);
      }
    }
  });
}

function renderAutocomplete(results) {
  const container = document.getElementById('search-autocomplete-results');
  container.innerHTML = '';

  const items = [];
  
  if (results.tracks && results.tracks.items) {
    results.tracks.items.slice(0, 3).forEach(t => items.push({ ...t, typeName: 'track', badge: 'Música' }));
  }
  if (results.albums && results.albums.items) {
    results.albums.items.slice(0, 2).forEach(a => items.push({ ...a, typeName: 'album', badge: 'Álbum' }));
  }
  if (results.artists && results.artists.items) {
    results.artists.items.slice(0, 2).forEach(art => items.push({ ...art, typeName: 'artist', badge: 'Artista' }));
  }

  if (items.length === 0) {
    container.innerHTML = '<div class="autocomplete-item"><p style="color:var(--text-muted); font-size: 13px;">Nenhum resultado encontrado</p></div>';
    container.style.display = 'block';
    return;
  }

  items.forEach(item => {
    let coverImg = 'https://placehold.co/80';
    if (item.images && item.images.length > 0) coverImg = item.images[0].url;
    else if (item.album && item.album.images && item.album.images.length > 0) coverImg = item.album.images[0].url;

    const sub = item.typeName === 'track' 
      ? item.artists.map(a => a.name).join(', ') 
      : (item.typeName === 'album' ? item.artists.map(a => a.name).join(', ') : 'Gênero(s): ' + (item.genres ? item.genres.slice(0, 2).join(', ') : 'N/A'));

    const el = document.createElement('div');
    el.className = 'autocomplete-item';
    el.innerHTML = `
      <img src="${coverImg}" class="autocomplete-cover ${item.typeName === 'artist' ? 'artist-round' : ''}" alt="${item.name}">
      <div class="autocomplete-info">
        <div class="autocomplete-name">${item.name}</div>
        <div class="autocomplete-sub">${sub}</div>
      </div>
      <span class="autocomplete-badge">${item.badge}</span>
    `;

    el.addEventListener('click', () => {
      container.style.display = 'none';
      document.getElementById('global-search-input').value = '';
      navigateTo(`/${item.typeName}/${item.id}`);
    });

    container.appendChild(el);
  });

  container.style.display = 'block';
}

// ==========================================
// 4. INJEÇÃO DINÂMICA DE VISUALIZAÇÕES (SPA VIEWS)
// ==========================================

async function renderView(view, params) {
  const container = document.getElementById('app-view');
  
  // Exibir loading inicial
  container.innerHTML = `
    <div class="view-loading">
      <div class="spinner"></div>
      <p>Consultando Spotify...</p>
    </div>
  `;

  try {
    switch (view) {
      case 'dashboard':
        await renderDashboardView(container);
        break;
      case 'search':
        await renderSearchView(container, params.q);
        break;
      case 'details':
        await renderDetailsView(container, params.type, params.id);
        break;
      case 'playlists':
        await renderPlaylistsView(container);
        break;
      case 'playlist-details':
        await renderPlaylistDetailsView(container, params.id);
        break;
      case 'recommendations':
        await renderRecommendationsView(container);
        break;
      case 'profile':
        await renderProfileView(container, params.username);
        break;
    }
  } catch (error) {
    container.innerHTML = `
      <div style="text-align:center; padding: 60px 20px;">
        <i class="fa-solid fa-circle-exclamation" style="font-size: 50px; color: var(--color-orange); margin-bottom: 20px;"></i>
        <h2>Erro ao carregar página</h2>
        <p style="color: var(--text-secondary); margin-top: 8px;">${error.message || 'Erro desconhecido'}</p>
        <button class="btn btn-secondary" onclick="navigateTo('/')" style="margin-top: 20px;">Voltar ao Início</button>
      </div>
    `;
  }
}

// 4.1 VIEW: DASHBOARD
async function renderDashboardView(container) {
  // Carregar dados de popularidade usando buscas reais no Spotify
  const [popTracks, popAlbums, reviews] = await Promise.all([
    apiFetch('/api/spotify/search?q=year:2026%20genre:pop&type=track&limit=6'),
    apiFetch('/api/spotify/search?q=year:2025-2026&type=album&limit=6'),
    apiFetch('/api/reviews')
  ]);

  const trackItems = popTracks.tracks?.items || [];
  const albumItems = popAlbums.albums?.items || [];

  container.innerHTML = `
    <!-- Seção de Boas-vindas -->
    <div class="dashboard-hero">
      <h1 class="hero-title">Ame música. Salve notas. <span>Musicboxd.</span></h1>
      <p class="hero-subtitle">A plataforma social para compartilhar e avaliar suas descobertas musicais baseada no Spotify Web API.</p>
    </div>

    <!-- Álbuns Populares Recentes -->
    <div class="section-header">
      <h2 class="section-title"><i class="fa-solid fa-record-vinyl"></i> Álbuns em Destaque</h2>
      <a href="/recomendacoes" class="btn btn-secondary">Encontrar Mais <i class="fa-solid fa-arrow-right"></i></a>
    </div>
    <div class="music-grid">
      ${albumItems.map(album => renderMusicGridCard(album, 'album')).join('')}
    </div>

    <!-- Músicas Populares Recentes -->
    <div class="section-header">
      <h2 class="section-title"><i class="fa-solid fa-music"></i> Músicas em Destaque</h2>
    </div>
    <div class="music-grid" style="margin-bottom: 40px;">
      ${trackItems.map(track => renderMusicGridCard(track, 'track')).join('')}
    </div>

    <!-- Atividade e Reviews Recentes -->
    <div class="section-header">
      <h2 class="section-title"><i class="fa-solid fa-comments"></i> Avaliações Populares</h2>
    </div>
    <div class="reviews-list">
      ${reviews.length === 0 
        ? '<div class="glassmorphism" style="padding:40px; border-radius: var(--border-radius-md); text-align:center; color: var(--text-muted);">Nenhuma avaliação adicionada ainda. Seja o primeiro a avaliar uma música!</div>'
        : reviews.slice(0, 4).map(rev => renderReviewRowCard(rev)).join('')
      }
    </div>
  `;

  setupCardActionListeners();
}

function renderMusicGridCard(item, type) {
  let coverImg = 'https://placehold.co/180';
  if (item.images && item.images.length > 0) coverImg = item.images[0].url;
  else if (item.album && item.album.images && item.album.images.length > 0) coverImg = item.album.images[0].url;

  const artistName = item.artists ? item.artists.map(a => a.name).join(', ') : '';
  const typeLabel = type === 'track' ? 'Música' : (type === 'album' ? 'Álbum' : 'Artista');

  return `
    <div class="music-card ${type === 'artist' ? 'artist-card' : ''}" data-id="${item.id}" data-type="${type}" data-name="${escapeHTML(item.name)}" data-artist="${escapeHTML(artistName)}" data-image="${coverImg}">
      <div class="card-image-wrap">
        <img src="${coverImg}" class="card-image" alt="${item.name}">
        <div class="card-overlay">
          <button class="overlay-btn btn-log" title="Avaliar / Escrever Review"><i class="fa-solid fa-pen"></i></button>
          <button class="overlay-btn btn-favorite" title="Favoritar"><i class="fa-regular fa-heart"></i></button>
        </div>
      </div>
      <div class="card-info">
        <a href="/${type}/${item.id}" class="card-title" title="${item.name}">${item.name}</a>
        <span class="card-artist">${artistName}</span>
        <div class="card-meta">
          <span class="card-badge">${typeLabel}</span>
        </div>
      </div>
    </div>
  `;
}

function renderReviewRowCard(rev) {
  const starsHtml = '★'.repeat(Math.floor(rev.rating)) + (rev.rating % 1 !== 0 ? '½' : '') + '☆'.repeat(5 - Math.ceil(rev.rating));
  const heartHtml = rev.liked ? '<i class="fa-solid fa-heart review-heart-icon" title="Favorito"></i>' : '';

  return `
    <div class="review-row-card glassmorphism">
      <img src="${rev.itemImage}" class="review-item-cover ${rev.itemType === 'artist' ? 'artist-round' : ''}" alt="${rev.itemName}" onclick="navigateTo('/${rev.itemType}/${rev.itemId}')">
      <div class="review-content-wrap">
        <div class="review-meta-header">
          <div class="review-user-info">
            <img src="https://api.dicebear.com/7.x/bottts/svg?seed=${rev.username}" class="review-avatar" alt="${rev.username}">
            <a href="/perfil/${rev.username}" class="review-user-name">${rev.username === 'matheus' ? 'Matheus Pestana' : rev.username}</a>
            <span class="review-date">${formatDate(rev.dateLogged)}</span>
          </div>
          <div class="review-stars-score">
            ${starsHtml} ${heartHtml}
          </div>
        </div>
        <div class="review-item-title">
          <a href="/${rev.itemType}/${rev.itemId}">${rev.itemName}</a>
          ${rev.itemArtist ? `<span class="artist">de ${rev.itemArtist}</span>` : ''}
        </div>
        <p class="review-text">${escapeHTML(rev.reviewText)}</p>
      </div>
    </div>
  `;
}

// 4.2 VIEW: BUSCA E FILTROS
async function renderSearchView(container, query) {
  if (!query) {
    container.innerHTML = `
      <div style="text-align:center; padding: 60px 0;">
        <h2>Buscar músicas, álbuns ou artistas</h2>
        <p style="color:var(--text-secondary); margin-top:8px;">Digite no campo superior para pesquisar...</p>
      </div>
    `;
    return;
  }

  // Chamar proxy Spotify Search
  const results = await apiFetch(`/api/spotify/search?q=${encodeURIComponent(query)}`);

  const tracks = results.tracks?.items || [];
  const albums = results.albums?.items || [];
  const artists = results.artists?.items || [];

  container.innerHTML = `
    <div class="section-header" style="margin-top: 20px;">
      <div>
        <h2 class="section-title"><i class="fa-solid fa-magnifying-glass"></i> Resultados para "${escapeHTML(query)}"</h2>
        <p style="color: var(--text-secondary); font-size: 14px; margin-top: 4px;">Encontramos resultados em todas as categorias da API do Spotify.</p>
      </div>
    </div>

    <div class="profile-tabs" style="margin-bottom: 24px;">
      <button class="tab-btn active" data-search-tab="tracks">Músicas (${tracks.length})</button>
      <button class="tab-btn" data-search-tab="albums">Álbuns (${albums.length})</button>
      <button class="tab-btn" data-search-tab="artists">Artistas (${artists.length})</button>
    </div>

    <!-- Grade de Músicas -->
    <div class="search-tab-content active" id="search-tab-tracks">
      ${tracks.length === 0 
        ? '<p style="color:var(--text-muted);">Nenhuma música encontrada.</p>'
        : `<div class="music-grid">${tracks.map(t => renderMusicGridCard(t, 'track')).join('')}</div>`
      }
    </div>

    <!-- Grade de Álbuns -->
    <div class="search-tab-content" id="search-tab-albums" style="display:none;">
      ${albums.length === 0 
        ? '<p style="color:var(--text-muted);">Nenhum álbum encontrado.</p>'
        : `<div class="music-grid">${albums.map(a => renderMusicGridCard(a, 'album')).join('')}</div>`
      }
    </div>

    <!-- Grade de Artistas -->
    <div class="search-tab-content" id="search-tab-artists" style="display:none;">
      ${artists.length === 0 
        ? '<p style="color:var(--text-muted);">Nenhum artista encontrado.</p>'
        : `<div class="music-grid">${artists.map(art => renderMusicGridCard(art, 'artist')).join('')}</div>`
      }
    </div>
  `;

  // Ouvintes de abas
  document.querySelectorAll('[data-search-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-search-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.getAttribute('data-search-tab');
      document.querySelectorAll('.search-tab-content').forEach(el => el.style.display = 'none');
      document.getElementById(`search-tab-${target}`).style.display = 'block';
    });
  });

  setupCardActionListeners();
}

// 4.3 VIEW: DETALHES DO ITEM (Música/Álbum/Artista)
async function renderDetailsView(container, type, id) {
  // Carregar dados principais e reviews locais ao mesmo tempo
  const [details, reviews] = await Promise.all([
    apiFetch(`/api/spotify/${type}s/${id}`),
    apiFetch(`/api/reviews?itemId=${id}`)
  ]);

  let coverImg = 'https://placehold.co/300';
  if (details.images && details.images.length > 0) coverImg = details.images[0].url;
  else if (details.album && details.album.images && details.album.images.length > 0) coverImg = details.album.images[0].url;

  const name = details.name;
  const artistName = type === 'artist' ? '' : (details.artists ? details.artists.map(a => a.name).join(', ') : '');

  // Calcular estatísticas das notas locais para o histograma de avaliações
  const totalRatings = reviews.length;
  const averageRating = totalRatings > 0 ? (reviews.reduce((acc, r) => acc + r.rating, 0) / totalRatings).toFixed(1) : 'S/N';
  const totalLikes = reviews.filter(r => r.liked).length;

  const distribution = {
    '0.5': reviews.filter(r => r.rating === 0.5).length,
    '1.0': reviews.filter(r => r.rating === 1.0).length,
    '1.5': reviews.filter(r => r.rating === 1.5).length,
    '2.0': reviews.filter(r => r.rating === 2.0).length,
    '2.5': reviews.filter(r => r.rating === 2.5).length,
    '3.0': reviews.filter(r => r.rating === 3.0).length,
    '3.5': reviews.filter(r => r.rating === 3.5).length,
    '4.0': reviews.filter(r => r.rating === 4.0).length,
    '4.5': reviews.filter(r => r.rating === 4.5).length,
    '5.0': reviews.filter(r => r.rating === 5.0).length
  };

  // Encontrar nota máxima na distribuição para calcular alturas das barras do histograma proporcionalmente
  const maxInDist = Math.max(...Object.values(distribution), 1);

  // Relação de tipo em Português
  const typeLabel = type === 'track' ? 'Música' : (type === 'album' ? 'Álbum' : 'Artista');

  // Código HTML da sidebar de faixas (se for álbum) ou faixas populares (se for artista)
  let extraContentHtml = '';
  if (type === 'album' && details.tracks && details.tracks.items) {
    extraContentHtml = `
      <div class="tracklist-container">
        <h3 class="tracklist-title">Faixas do Álbum</h3>
        ${details.tracks.items.map(t => `
          <div class="track-row" onclick="navigateTo('/track/${t.id}')">
            <div class="track-row-left">
              <span class="track-num">${t.track_number}</span>
              <span class="track-name">${t.name}</span>
            </div>
            <span class="track-duration">${formatDuration(t.duration_ms)}</span>
          </div>
        `).join('')}
      </div>
    `;
  } else if (type === 'artist') {
    // Buscar músicas populares do artista
    const topTracks = await apiFetch(`/api/spotify/artists/${id}/top-tracks`);
    extraContentHtml = `
      <div class="tracklist-container">
        <h3 class="tracklist-title">Músicas mais Populares</h3>
        ${(topTracks.tracks || []).slice(0, 8).map((t, idx) => `
          <div class="track-row" onclick="navigateTo('/track/${t.id}')">
            <div class="track-row-left">
              <span class="track-num">${idx + 1}</span>
              <span class="track-name">${t.name}</span>
            </div>
            <span class="track-duration">${formatDuration(t.duration_ms)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Spotify Embed
  const embedType = type === 'track' ? 'track' : (type === 'album' ? 'album' : 'artist');
  const embedHtml = `
    <div class="spotify-embed-container">
      <iframe src="https://open.spotify.com/embed/${embedType}/${id}?utm_source=generator&theme=0" width="100%" height="${type === 'track' ? '80' : '380'}" frameborder="0" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>
    </div>
  `;

  container.innerHTML = `
    <div class="details-container">
      
      <!-- Lado Esquerdo: Capa e Mídia -->
      <div class="details-sidebar-left">
        <img src="${coverImg}" class="details-cover ${type === 'artist' ? 'artist-round' : ''}" alt="${name}">
        ${type !== 'artist' ? embedHtml : ''}
      </div>

      <!-- Centro: Informações do Item e Reviews -->
      <div class="details-main-content">
        <div class="details-header">
          <span class="details-type-badge">${typeLabel}</span>
          <h1 class="details-title">${name}</h1>
          ${artistName ? `<div class="details-artist-row">de <a href="/artist/${details.artists[0].id}">${artistName}</a></div>` : ''}
          <div class="details-meta-row">
            ${details.release_date ? `<span>Lançamento: ${formatReleaseDate(details.release_date, details.release_date_precision)}</span>` : ''}
            ${details.total_tracks ? `<span>${details.total_tracks} faixas</span>` : ''}
            ${details.followers ? `<span>${details.followers.total.toLocaleString()} seguidores</span>` : ''}
          </div>
        </div>

        ${extraContentHtml}

        <!-- Seção de Comentários / Reviews -->
        <div class="section-header" style="margin-top: 40px; margin-bottom: 16px;">
          <h3 class="section-title"><i class="fa-solid fa-comments"></i> Opinião da Comunidade (${totalRatings})</h3>
        </div>
        <div class="reviews-list">
          ${reviews.length === 0
            ? '<div class="glassmorphism" style="padding: 30px; text-align:center; color: var(--text-muted); border-radius: var(--border-radius-md);">Nenhuma review escrita para este item ainda. Seja o primeiro a escrever!</div>'
            : reviews.map(r => renderReviewRowCard(r)).join('')
          }
        </div>
      </div>

      <!-- Lado Direito: Caixa de Ações, Histograma de Avaliações -->
      <div class="details-sidebar-right">
        
        <!-- Caixa de Ações -->
        <div class="action-box glassmorphism">
          <button class="btn btn-primary action-btn-main" id="details-log-btn">
            <i class="fa-solid fa-pen"></i> Avaliar / Log
          </button>
          
          <button class="btn btn-secondary action-btn-main" id="details-playlist-btn">
            <i class="fa-solid fa-plus"></i> Add à Playlist
          </button>
          
          <div class="action-stats">
            <div class="action-stat-row">
              <span>Nota Média:</span>
              <strong>${averageRating} ★</strong>
            </div>
            <div class="action-stat-row">
              <span>Curtidas:</span>
              <span><i class="fa-solid fa-heart"></i> ${totalLikes}</span>
            </div>
            <div class="action-stat-row">
              <span>Avaliações:</span>
              <span>${totalRatings}</span>
            </div>
          </div>
        </div>

        <!-- Histograma de Distribuição (Letterboxd) -->
        <div class="rating-histogram-box glassmorphism">
          <h4 class="histogram-title">Distribuição de Notas</h4>
          <div class="histogram-chart">
            ${Object.entries(distribution).map(([score, count]) => {
              const heightPct = count > 0 ? (count / maxInDist) * 100 : 2;
              return `<div class="histogram-bar" style="height: ${heightPct}%" data-score="${score}" data-count="${count}"></div>`;
            }).join('')}
          </div>
          <div class="histogram-labels">
            <span>0.5★</span>
            <span>5.0★</span>
          </div>
        </div>

      </div>

    </div>
  `;

  // Configurar botões de ações
  document.getElementById('details-log-btn').addEventListener('click', () => {
    openLogModal({
      id,
      type,
      name,
      artist: artistName,
      image: coverImg
    });
  });

  // Evento para adicionar à playlist
  document.getElementById('details-playlist-btn').addEventListener('click', () => {
    if (type !== 'track') {
      showToast('Apenas músicas individuais podem ser adicionadas a listas de reprodução.', 'warning');
      return;
    }
    openPlaylistModalWithTrack({
      id,
      name,
      artist: artistName,
      image: coverImg,
      duration: formatDuration(details.duration_ms)
    });
  });
}

// 4.4 VIEW: PLAYLISTS
async function renderPlaylistsView(container) {
  const playlists = await apiFetch('/api/playlists');

  container.innerHTML = `
    <div class="section-header" style="margin-top: 20px;">
      <div>
        <h2 class="section-title"><i class="fa-solid fa-list-ul"></i> Suas Playlists</h2>
        <p style="color:var(--text-secondary); font-size:14px; margin-top: 4px;">Crie listas temáticas e organize suas faixas favoritas.</p>
      </div>
      <button class="btn btn-primary" id="btn-create-playlist"><i class="fa-solid fa-plus"></i> Criar Nova Playlist</button>
    </div>

    ${playlists.length === 0
      ? `
        <div class="glassmorphism" style="padding: 60px 20px; text-align: center; border-radius: var(--border-radius-lg); margin-top: 20px;">
          <i class="fa-solid fa-list-ul" style="font-size: 50px; color: var(--text-muted); margin-bottom: 20px;"></i>
          <h3>Nenhuma playlist criada ainda</h3>
          <p style="color: var(--text-secondary); margin-top: 8px;">Crie sua primeira playlist e comece a adicionar músicas do Spotify!</p>
          <button class="btn btn-primary" onclick="openPlaylistModal()" style="margin-top: 20px;">Criar Playlist</button>
        </div>
      `
      : `
        <div class="music-grid">
          ${playlists.map(p => `
            <div class="music-card" onclick="navigateTo('/playlists/${p.id}')" style="cursor:pointer;">
              <div class="card-image-wrap">
                <div class="playlist-banner-cover" style="width:100%; height:100%; font-size: 40px; border-radius:0;">
                  <i class="fa-solid fa-music"></i>
                </div>
              </div>
              <div class="card-info">
                <span class="card-title">${escapeHTML(p.name)}</span>
                <span class="card-artist">${p.tracks.length} músicas</span>
                <div class="card-meta">
                  <span class="card-badge" style="color: var(--color-green); border-color: rgba(0, 224, 84, 0.2);">Playlist</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `
    }
  `;

  document.getElementById('btn-create-playlist')?.addEventListener('click', () => openPlaylistModal());
}

// 4.5 VIEW: DETALHES DE UMA PLAYLIST
async function renderPlaylistDetailsView(container, playlistId) {
  const playlist = await apiFetch(`/api/playlists/${playlistId}`);

  container.innerHTML = `
    <div class="playlist-banner-header glassmorphism">
      <div class="playlist-banner-cover">
        <i class="fa-solid fa-compact-disc"></i>
      </div>
      <div class="playlist-banner-info">
        <h2>${escapeHTML(playlist.name)}</h2>
        <p class="playlist-banner-desc">${escapeHTML(playlist.description) || 'Sem descrição cadastrada.'}</p>
        <div class="playlist-banner-author">
          <img src="https://api.dicebear.com/7.x/bottts/svg?seed=${playlist.username}" class="review-avatar" alt="Criador">
          <span>Criado por <strong>${playlist.username === 'matheus' ? 'Matheus Pestana' : playlist.username}</strong></span>
          <span>•</span>
          <span>${playlist.tracks.length} músicas</span>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <button class="btn btn-secondary" id="btn-edit-playlist"><i class="fa-solid fa-pencil"></i> Editar</button>
        <button class="btn btn-secondary" id="btn-delete-playlist" style="color: #ff4d4d; border-color: rgba(255, 77, 77, 0.2);"><i class="fa-solid fa-trash"></i> Excluir</button>
      </div>
    </div>

    <div class="tracklist-container glassmorphism" style="padding: 20px; border-radius: var(--border-radius-lg);">
      <h3 class="tracklist-title">Músicas da Lista</h3>
      ${playlist.tracks.length === 0
        ? '<p class="empty-list-message" style="padding: 30px 0;">Esta playlist está vazia. Adicione músicas clicando no botão "Editar" acima!</p>'
        : playlist.tracks.map((t, idx) => `
          <div class="track-row" onclick="navigateTo('/track/${t.id}')">
            <div class="track-row-left">
              <span class="track-num">${idx + 1}</span>
              <img src="${t.image}" style="width: 32px; height:32px; object-fit:cover; border-radius:4px;" alt="Capa">
              <div>
                <span class="track-name">${t.name}</span>
                <div style="font-size:11px; color:var(--text-secondary);">${t.artist}</div>
              </div>
            </div>
            <span class="track-duration">${t.duration}</span>
          </div>
        `).join('')
      }
    </div>
  `;

  document.getElementById('btn-edit-playlist').addEventListener('click', () => {
    openPlaylistModal(playlist);
  });

  document.getElementById('btn-delete-playlist').addEventListener('click', async () => {
    if (confirm('Tem certeza absoluta de que deseja excluir esta playlist?')) {
      await apiFetch(`/api/playlists/${playlistId}`, { method: 'DELETE' });
      showToast('Playlist excluída com sucesso!', 'info');
      navigateTo('/playlists');
    }
  });
}

// 4.6 VIEW: RECOMENDAÇÕES DA API DO SPOTIFY
async function renderRecommendationsView(container) {
  // Obter gêneros de sementes disponíveis
  const genresData = await apiFetch('/api/spotify/genres');
  const availableGenres = genresData.genres || ['rock', 'pop', 'electronic', 'hip-hop', 'jazz', 'dance', 'classical', 'indie'];

  // Gêneros selecionados por padrão
  const popularSeeds = ['electronic', 'pop', 'rock', 'hip-hop', 'indie', 'alternative', 'jazz', 'lo-fi'];

  container.innerHTML = `
    <div class="section-header" style="margin-top: 20px;">
      <div>
        <h2 class="section-title"><i class="fa-solid fa-wand-magic-sparkles"></i> Descubra Seu Próximo Favorito</h2>
        <p style="color:var(--text-secondary); font-size:14px; margin-top: 4px;">Utilize o motor de inteligência e recomendação do Spotify para gerar um grid exclusivo com base no seu humor ou gênero.</p>
      </div>
    </div>

    <!-- Filtros de Recomendação -->
    <div class="recs-settings-box glassmorphism">
      <form id="recs-form-element" class="recs-form">
        <div class="form-group">
          <label class="form-label" for="recs-genre">Gênero Principal:</label>
          <select id="recs-genre" class="form-input" style="height:42px;">
            ${popularSeeds.map(g => `<option value="${g}">${g.toUpperCase()}</option>`).join('')}
            <option disabled>---------------</option>
            ${availableGenres.filter(g => !popularSeeds.includes(g)).map(g => `<option value="${g}">${g}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="recs-limit">Quantidade:</label>
          <select id="recs-limit" class="form-input" style="height:42px;">
            <option value="12">12 Músicas</option>
            <option value="24" selected>24 Músicas</option>
            <option value="48">48 Músicas</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Foco das Recomendações:</label>
          <span style="font-size:12px; color:var(--text-muted); display:block; margin-top:8px;">Baseado em tendências atuais de rádio</span>
        </div>

        <button type="submit" class="btn btn-primary" style="height:42px; min-width: 140px;">
          <i class="fa-solid fa-rotate"></i> Gerar Recomendações
        </button>
      </form>
    </div>

    <div id="recs-results-container">
      <!-- Músicas serão renderizadas aqui -->
    </div>
  `;

  const recsForm = document.getElementById('recs-form-element');
  recsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await generateRecommendations();
  });

  // Gerar recomendações iniciais automaticamente
  await generateRecommendations();
}

async function generateRecommendations() {
  const container = document.getElementById('recs-results-container');
  container.innerHTML = `
    <div class="view-loading">
      <div class="spinner"></div>
      <p>Gerando recomendações personalizadas...</p>
    </div>
  `;

  const genre = document.getElementById('recs-genre').value;
  const limit = document.getElementById('recs-limit').value;

  try {
    const data = await apiFetch(`/api/spotify/recommendations?seed_genres=${genre}&limit=${limit}`);
    const tracks = data.tracks || [];

    if (tracks.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:40px;">Nenhuma recomendação encontrada para os parâmetros selecionados. Tente mudar o gênero.</p>';
      return;
    }

    container.innerHTML = `
      <div class="music-grid">
        ${tracks.map(t => renderMusicGridCard(t, 'track')).join('')}
      </div>
    `;
    
    setupCardActionListeners();
  } catch (err) {
    container.innerHTML = '<p style="color:var(--color-orange); text-align:center; padding:40px;">Erro ao gerar recomendações.</p>';
  }
}

// 4.7 VIEW: PERFIL DO USUÁRIO
async function renderProfileView(container, username) {
  const profileData = await apiFetch(`/api/profile/${username}`);
  const user = profileData.user;
  const stats = profileData.stats;

  // Carregar todos os reviews e playlists deste usuário
  const [reviews, playlists] = await Promise.all([
    apiFetch(`/api/reviews?username=${username}`),
    apiFetch(`/api/playlists?username=${username}`)
  ]);

  // Encontrar nota máxima no histograma de perfil
  const maxInDist = Math.max(...Object.values(stats.ratingsDistribution), 1);

  // Configuração padrão de favoritos do Matheus Pestana
  const favTracks = user.favorites?.tracks || [];
  const favAlbums = user.favorites?.albums || [];
  const favArtists = user.favorites?.artists || [];

  container.innerHTML = `
    <div class="profile-header-card glassmorphism">
      <img src="${user.avatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=' + username}" class="profile-avatar-big" alt="${user.displayName}">
      <div class="profile-info-wrap">
        <div class="profile-name-row">
          <h2 class="profile-name">${escapeHTML(user.displayName)}</h2>
          <span class="profile-username">@${escapeHTML(user.username)}</span>
        </div>
        <p class="profile-bio">${escapeHTML(user.bio) || 'Sem biografia escrita ainda.'}</p>
      </div>
      ${username === 'matheus' ? '<button class="btn btn-secondary" id="btn-edit-profile"><i class="fa-solid fa-pencil"></i> Editar Perfil</button>' : ''}
    </div>

    <!-- Histórico de Estatísticas Grid -->
    <div class="profile-stats-row">
      <div class="stat-card glassmorphism">
        <div class="stat-val">${stats.totalReviews}</div>
        <div class="stat-label">Avaliações</div>
      </div>
      <div class="stat-card glassmorphism">
        <div class="stat-val"><i class="fa-solid fa-heart"></i> ${stats.totalLikes}</div>
        <div class="stat-label">Curtidas</div>
      </div>
      <div class="stat-card glassmorphism">
        <div class="stat-val">${playlists.length}</div>
        <div class="stat-label">Playlists</div>
      </div>
      
      <!-- Mini Histograma no Perfil -->
      <div class="stat-card glassmorphism" style="display:flex; flex-direction:column; padding: 10px;">
        <div class="histogram-chart" style="height:40px; margin-bottom: 2px;">
          ${Object.entries(stats.ratingsDistribution).map(([score, count]) => {
            const heightPct = count > 0 ? (count / maxInDist) * 100 : 2;
            return `<div class="histogram-bar" style="height: ${heightPct}%" data-score="${score}" data-count="${count}"></div>`;
          }).join('')}
        </div>
        <div class="stat-label" style="font-size:10px;">Curva de Notas</div>
      </div>
    </div>

    <!-- Seção de Favoritos Selecionados (Destaque do Perfil) -->
    <div class="favorites-row-section">
      <div class="section-header" style="margin-top: 0; margin-bottom: 16px;">
        <h3 class="section-title"><i class="fa-solid fa-star"></i> Destaques do Perfil (Músicas e Álbuns)</h3>
      </div>
      
      <div class="favorites-grid">
        ${[...favTracks, ...favAlbums].slice(0, 5).map(item => `
          <div class="music-card" onclick="navigateTo('/${item.type}/${item.id}')" style="cursor:pointer; padding:8px;">
            <div class="card-image-wrap" style="margin-bottom:6px;">
              <img src="${item.image}" class="card-image" alt="${item.name}">
            </div>
            <div class="card-info">
              <span class="card-title" style="font-size:12px; margin-bottom:2px;">${item.name}</span>
              <span class="card-artist" style="font-size:10px;">${item.artist}</span>
            </div>
          </div>
        `).join('')}
        ${[...favTracks, ...favAlbums].length === 0 
          ? '<div class="glassmorphism" style="grid-column: 1 / -1; padding: 20px; text-align:center; color: var(--text-muted); border-radius: var(--border-radius-md);">Nenhum item destacado no perfil ainda. Adicione clicando no coração nas capas de música!</div>' 
          : ''
        }
      </div>
    </div>

    <!-- Abas de Atividades -->
    <div class="profile-tabs">
      <button class="tab-btn active" data-profile-tab="reviews">Avaliações (${reviews.length})</button>
      <button class="tab-btn" data-profile-tab="playlists">Playlists (${playlists.length})</button>
    </div>

    <!-- Conteúdo da Aba Reviews -->
    <div class="profile-tab-content active" id="profile-tab-reviews">
      <div class="reviews-list">
        ${reviews.length === 0
          ? '<p style="color:var(--text-muted); text-align:center; padding: 30px;">Nenhuma avaliação adicionada.</p>'
          : reviews.map(r => renderReviewRowCard(r)).join('')
        }
      </div>
    </div>

    <!-- Conteúdo da Aba Playlists -->
    <div class="profile-tab-content" id="profile-tab-playlists" style="display:none;">
      ${playlists.length === 0
        ? '<p style="color:var(--text-muted); text-align:center; padding: 30px;">Nenhuma playlist criada.</p>'
        : `
          <div class="music-grid">
            ${playlists.map(p => `
              <div class="music-card" onclick="navigateTo('/playlists/${p.id}')" style="cursor:pointer;">
                <div class="card-image-wrap">
                  <div class="playlist-banner-cover" style="width:100%; height:100%; font-size: 40px; border-radius:0;">
                    <i class="fa-solid fa-music"></i>
                  </div>
                </div>
                <div class="card-info">
                  <span class="card-title">${escapeHTML(p.name)}</span>
                  <span class="card-artist">${p.tracks.length} músicas</span>
                </div>
              </div>
            `).join('')}
          </div>
        `
      }
    </div>
  `;

  // Ouvinte de Abas do Perfil
  document.querySelectorAll('[data-profile-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-profile-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.getAttribute('data-profile-tab');
      document.querySelectorAll('.profile-tab-content').forEach(el => el.style.display = 'none');
      document.getElementById(`profile-tab-${target}`).style.display = 'block';
    });
  });

  // Configurar Modal de Editar Perfil
  if (username === 'matheus') {
    document.getElementById('btn-edit-profile').addEventListener('click', () => {
      openProfileModal(user);
    });
  }
}

// ==========================================
// 5. EVENTOS DO MODAL DE LOGS/AVALIAÇÃO
// ==========================================

function setupModalListeners() {
  // Modal de Logs Close
  document.getElementById('log-modal-close').addEventListener('click', () => closeOverlay('log-modal'));
  
  // Submit do formulário de Avaliação
  const logForm = document.getElementById('log-form');
  logForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const rating = STATE.activeRating;
    if (rating === 0) {
      showToast('Por favor, selecione uma nota de 0.5 a 5.0 estrelas!', 'warning');
      return;
    }

    const payload = {
      username: STATE.currentUser,
      itemId: document.getElementById('log-item-id').value,
      itemType: document.getElementById('log-item-type').value,
      itemName: document.getElementById('log-item-name').textContent,
      itemArtist: document.getElementById('log-item-artist').textContent,
      itemImage: document.getElementById('log-item-image').value,
      rating: rating,
      liked: document.getElementById('log-liked').checked,
      reviewText: document.getElementById('log-review').value,
      dateLogged: document.getElementById('log-date').value
    };

    await apiFetch('/api/reviews', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    closeOverlay('log-modal');
    showToast('Avaliação salva com sucesso!', 'success');
    
    // Atualizar visualização atual para atualizar os dados
    renderView(STATE.currentView, STATE.routeParams);
  });

  // Botão Excluir Review
  document.getElementById('log-delete-btn').addEventListener('click', async () => {
    const itemId = document.getElementById('log-item-id').value;
    
    if (confirm('Deseja realmente remover sua avaliação para este item?')) {
      // Buscar reviews do usuário para encontrar a ID
      const userReviews = await apiFetch(`/api/reviews?username=${STATE.currentUser}&itemId=${itemId}`);
      if (userReviews.length > 0) {
        await apiFetch(`/api/reviews/${userReviews[0].id}`, { method: 'DELETE' });
        closeOverlay('log-modal');
        showToast('Avaliação removida com sucesso.', 'info');
        renderView(STATE.currentView, STATE.routeParams);
      }
    }
  });

  // Modal de Editar Perfil Close e Submit
  document.getElementById('profile-modal-close').addEventListener('click', () => closeOverlay('profile-modal'));
  document.getElementById('profile-cancel-btn').addEventListener('click', () => closeOverlay('profile-modal'));
  
  const profileForm = document.getElementById('profile-form');
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const displayName = document.getElementById('profile-name').value;
    const bio = document.getElementById('profile-bio').value;

    await apiFetch(`/api/profile/${STATE.currentUser}/edit`, {
      method: 'POST',
      body: JSON.stringify({ displayName, bio })
    });

    closeOverlay('profile-modal');
    showToast('Perfil atualizado com sucesso!', 'success');
    renderView(STATE.currentView, STATE.routeParams);
  });

  // Modal de Criar/Editar Playlist Close e Submit
  document.getElementById('playlist-modal-close').addEventListener('click', () => closeOverlay('playlist-modal'));
  document.getElementById('playlist-cancel-btn').addEventListener('click', () => closeOverlay('playlist-modal'));

  const playlistForm = document.getElementById('playlist-form');
  playlistForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('playlist-edit-id').value;
    const name = document.getElementById('playlist-name-input').value;
    const description = document.getElementById('playlist-desc-input').value;

    const payload = {
      username: STATE.currentUser,
      name,
      description,
      tracks: STATE.playlistTracks
    };

    if (id) payload.id = id;

    await apiFetch('/api/playlists', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    closeOverlay('playlist-modal');
    showToast(id ? 'Playlist atualizada com sucesso!' : 'Playlist criada com sucesso!', 'success');
    navigateTo(id ? `/playlists/${id}` : '/playlists');
  });

  // Autocomplete de Busca de músicas dentro do Modal de Playlists
  setupPlaylistTrackSearch();
}

function setupCardActionListeners() {
  // Configurar clicks de ações rápidas nas grades de cards
  document.querySelectorAll('.music-card').forEach(card => {
    const id = card.getAttribute('data-id');
    const type = card.getAttribute('data-type');
    const name = card.getAttribute('data-name');
    const artist = card.getAttribute('data-artist');
    const image = card.getAttribute('data-image');

    // Botão rápido Log/Avaliar
    card.querySelector('.btn-log')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openLogModal({ id, type, name, artist, image });
    });

    // Botão rápido Favorito (destaque do perfil)
    const favBtn = card.querySelector('.btn-favorite');
    
    // Verificar se já está favoritado
    checkIfFavorited(id, type).then(isFav => {
      if (isFav) {
        favBtn.querySelector('i').className = 'fa-solid fa-heart';
        favBtn.classList.add('btn-like-active');
      }
    });

    favBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const response = await apiFetch(`/api/profile/${STATE.currentUser}/favorites`, {
          method: 'POST',
          body: JSON.stringify({ id, name, artist, image, type })
        });
        
        if (response.favorited) {
          favBtn.querySelector('i').className = 'fa-solid fa-heart';
          favBtn.classList.add('btn-like-active');
          showToast('Adicionado aos Destaques do Perfil!', 'success');
        } else {
          favBtn.querySelector('i').className = 'fa-regular fa-heart';
          favBtn.classList.remove('btn-like-active');
          showToast('Removido dos Destaques do Perfil.', 'info');
        }
      } catch (err) {
        // Tratar erro de limite
      }
    });
  });
}

async function checkIfFavorited(id, type) {
  try {
    const profile = await apiFetch(`/api/profile/${STATE.currentUser}`);
    const listName = type === 'track' ? 'tracks' : (type === 'album' ? 'albums' : 'artists');
    const favList = profile.user.favorites?.[listName] || [];
    return favList.some(item => item.id === id);
  } catch (err) {
    return false;
  }
}

// 5.1 ABRE MODAL DE AVALIAÇÃO
async function openLogModal(item) {
  document.getElementById('log-item-id').value = item.id;
  document.getElementById('log-item-type').value = item.type;
  document.getElementById('log-item-image').value = item.image;
  document.getElementById('log-item-cover').src = item.image;
  document.getElementById('log-item-name').textContent = item.name;
  document.getElementById('log-item-artist').textContent = item.artist ? `de ${item.artist}` : '';
  
  const typeBadge = document.getElementById('log-item-badge');
  typeBadge.textContent = item.type === 'track' ? 'Música' : (item.type === 'album' ? 'Álbum' : 'Artista');

  // Definir data padrão como hoje no fuso local
  const todayStr = new Date().toISOString().split('T')[0];
  document.getElementById('log-date').value = todayStr;

  // Limpar formulário antes de consultar
  STATE.activeRating = 0;
  updateStarsUI(0);
  document.getElementById('log-liked').checked = false;
  document.getElementById('heart-icon').className = 'fa-regular fa-heart';
  document.getElementById('log-review').value = '';
  document.getElementById('log-delete-btn').style.display = 'none';

  // Verificar se usuário já avaliou e pré-carregar
  try {
    const existing = await apiFetch(`/api/reviews?username=${STATE.currentUser}&itemId=${item.id}`);
    if (existing.length > 0) {
      const rev = existing[0];
      STATE.activeRating = rev.rating;
      updateStarsUI(rev.rating);
      document.getElementById('log-liked').checked = rev.liked;
      document.getElementById('heart-icon').className = rev.liked ? 'fa-solid fa-heart active' : 'fa-regular fa-heart';
      document.getElementById('log-review').value = rev.reviewText;
      document.getElementById('log-date').value = rev.dateLogged;
      document.getElementById('log-delete-btn').style.display = 'block';
    }
  } catch (err) {
    // Falha silenciosa
  }

  // Lógica do botão Curtir do formulário
  const heartIcon = document.getElementById('heart-icon');
  const likeCheckbox = document.getElementById('log-liked');
  
  // Remover ouvinte antigo e adicionar novo
  const newHeart = heartIcon.cloneNode(true);
  heartIcon.parentNode.replaceChild(newHeart, heartIcon);

  newHeart.addEventListener('click', () => {
    likeCheckbox.checked = !likeCheckbox.checked;
    if (likeCheckbox.checked) {
      newHeart.className = 'fa-solid fa-heart active';
    } else {
      newHeart.className = 'fa-regular fa-heart';
    }
  });

  openOverlay('log-modal');
}

// 5.2 ABRE MODAL DE PERFIL
function openProfileModal(user) {
  document.getElementById('profile-name').value = user.displayName;
  document.getElementById('profile-bio').value = user.bio || '';
  openOverlay('profile-modal');
}

// 5.3 ABRE MODAL DE CRIAR/EDITAR PLAYLIST
function openPlaylistModal(playlist = null) {
  const title = document.getElementById('playlist-modal-title');
  const submitBtn = document.getElementById('playlist-submit-btn');

  if (playlist) {
    title.textContent = 'Editar Playlist';
    submitBtn.textContent = 'Atualizar Playlist';
    document.getElementById('playlist-edit-id').value = playlist.id;
    document.getElementById('playlist-name-input').value = playlist.name;
    document.getElementById('playlist-desc-input').value = playlist.description;
    STATE.playlistTracks = [...playlist.tracks];
  } else {
    title.textContent = 'Criar Playlist';
    submitBtn.textContent = 'Criar Playlist';
    document.getElementById('playlist-edit-id').value = '';
    document.getElementById('playlist-name-input').value = '';
    document.getElementById('playlist-desc-input').value = '';
    STATE.playlistTracks = [];
  }

  renderPlaylistTracksEditor();
  openOverlay('playlist-modal');
}

// 5.4 CRIA PLAYLIST E ADICIONA MÚSICA INSTANTANEAMENTE (Fluxo Rápido da Música de detalhes)
function openPlaylistModalWithTrack(track) {
  openPlaylistModal();
  STATE.playlistTracks.push(track);
  renderPlaylistTracksEditor();
}

function setupPlaylistTrackSearch() {
  const input = document.getElementById('playlist-track-search-input');
  const resultsContainer = document.getElementById('playlist-search-results');
  let searchTimer;

  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(searchTimer);
    
    if (!query) {
      resultsContainer.style.display = 'none';
      return;
    }

    searchTimer = setTimeout(async () => {
      try {
        const results = await apiFetch(`/api/spotify/search?q=${encodeURIComponent(query)}&type=track&limit=5`);
        renderPlaylistTrackAutocomplete(results.tracks?.items || []);
      } catch (err) {
        resultsContainer.style.display = 'none';
      }
    }, 300);
  });

  // Fechar ao clicar fora
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.playlist-add-track-search')) {
      resultsContainer.style.display = 'none';
    }
  });
}

function renderPlaylistTrackAutocomplete(tracks) {
  const container = document.getElementById('playlist-search-results');
  container.innerHTML = '';

  if (tracks.length === 0) {
    container.innerHTML = '<div class="autocomplete-item"><p style="color:var(--text-muted); font-size:12px;">Nenhuma faixa encontrada</p></div>';
    container.style.display = 'block';
    return;
  }

  tracks.forEach(track => {
    let coverImg = 'https://placehold.co/60';
    if (track.album && track.album.images && track.album.images.length > 0) {
      coverImg = track.album.images[0].url;
    }
    const artist = track.artists.map(a => a.name).join(', ');

    const el = document.createElement('div');
    el.className = 'autocomplete-item';
    el.innerHTML = `
      <img src="${coverImg}" class="autocomplete-cover" alt="${track.name}">
      <div class="autocomplete-info">
        <div class="autocomplete-name" style="font-size:13px;">${track.name}</div>
        <div class="autocomplete-sub" style="font-size:11px;">${artist}</div>
      </div>
    `;

    el.addEventListener('click', () => {
      container.style.display = 'none';
      document.getElementById('playlist-track-search-input').value = '';
      
      // Adicionar à lista temporária
      const alreadyInList = STATE.playlistTracks.some(t => t.id === track.id);
      if (alreadyInList) {
        showToast('Esta música já foi adicionada à playlist.', 'info');
        return;
      }

      STATE.playlistTracks.push({
        id: track.id,
        name: track.name,
        artist,
        image: coverImg,
        duration: formatDuration(track.duration_ms)
      });

      renderPlaylistTracksEditor();
    });

    container.appendChild(el);
  });

  container.style.display = 'block';
}

function renderPlaylistTracksEditor() {
  const container = document.getElementById('playlist-added-tracks-container');
  container.innerHTML = '';

  if (STATE.playlistTracks.length === 0) {
    container.innerHTML = '<p class="empty-list-message">Nenhuma música adicionada ainda.</p>';
    return;
  }

  STATE.playlistTracks.forEach((track, index) => {
    const el = document.createElement('div');
    el.className = 'playlist-track-row';
    el.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; min-width:0;">
        <span style="font-size:11px; color:var(--text-muted); width:15px; text-align:right;">${index + 1}</span>
        <img src="${track.image}" style="width:28px; height:28px; object-fit:cover; border-radius:4px;" alt="Capa">
        <div style="min-width:0;">
          <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.name}</div>
          <div style="font-size:10px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${track.artist}</div>
        </div>
      </div>
      <button type="button" class="playlist-track-remove" data-index="${index}"><i class="fa-solid fa-trash-can"></i></button>
    `;

    el.querySelector('.playlist-track-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      STATE.playlistTracks.splice(index, 1);
      renderPlaylistTracksEditor();
    });

    container.appendChild(el);
  });
}

// ==========================================
// 6. DETECÇÃO INTERATIVA DE MEIA-ESTRELA (MÓDULO RATING)
// ==========================================

function setupStarRatingSelector() {
  const starBtns = document.querySelectorAll('.star-btn');
  const ratingValueLabel = document.getElementById('rating-value');

  starBtns.forEach(btn => {
    const value = parseInt(btn.getAttribute('data-value'));

    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      // Se mouse está na metade esquerda do ícone da estrela
      const isHalf = (e.clientX - rect.left) < (rect.width / 2);
      const score = isHalf ? value - 0.5 : value;
      
      highlightStarsUI(score);
      ratingValueLabel.textContent = `${score.toFixed(1)} ★`;
    });

    btn.addEventListener('mouseleave', () => {
      // Restaurar ao estado de clique fixado
      updateStarsUI(STATE.activeRating);
    });

    btn.addEventListener('click', (e) => {
      const rect = btn.getBoundingClientRect();
      const isHalf = (e.clientX - rect.left) < (rect.width / 2);
      const score = isHalf ? value - 0.5 : value;
      
      STATE.activeRating = score;
      updateStarsUI(score);
      showToast(`Nota definida para ${score.toFixed(1)} estrelas!`, 'info');
    });
  });
}

function highlightStarsUI(score) {
  const starBtns = document.querySelectorAll('.star-btn');
  starBtns.forEach(btn => {
    const value = parseInt(btn.getAttribute('data-value'));
    btn.className = 'fa-regular fa-star star-btn'; // Reset
    
    if (value <= score) {
      btn.className = 'fa-solid fa-star star-btn filled highlighted';
    } else if (value - 0.5 === score) {
      btn.className = 'fa-solid fa-star-half-stroke star-btn filled highlighted';
    }
  });
}

function updateStarsUI(score) {
  const starBtns = document.querySelectorAll('.star-btn');
  const ratingValueLabel = document.getElementById('rating-value');
  
  if (score === 0) {
    ratingValueLabel.textContent = 'Sem nota';
    starBtns.forEach(btn => btn.className = 'fa-regular fa-star star-btn');
    return;
  }

  ratingValueLabel.textContent = `${score.toFixed(1)} ★`;

  starBtns.forEach(btn => {
    const value = parseInt(btn.getAttribute('data-value'));
    btn.className = 'fa-regular fa-star star-btn';
    
    if (value <= score) {
      btn.className = 'fa-solid fa-star star-btn filled';
    } else if (value - 0.5 === score) {
      btn.className = 'fa-solid fa-star-half-stroke star-btn filled';
    }
  });
}

// ==========================================
// 7. INTERFACING / MODAL HELPERS (Abre/Fecha)
// ==========================================

function openOverlay(id) {
  const modal = document.getElementById(id);
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeOverlay(id) {
  const modal = document.getElementById(id);
  modal.classList.remove('active');
  document.body.style.overflow = '';
}

// ==========================================
// 8. FORMATADORES DE DADOS (Utilitários)
// ==========================================

function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatReleaseDate(dateStr, precision) {
  if (!dateStr) return '';
  if (precision === 'year') return dateStr;
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' });
}
