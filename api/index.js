const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ==========================================
// SUPABASE CLIENT INITIALIZATION
// ==========================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase = null;
if (!supabaseUrl || !supabaseKey) {
  console.warn('WARNING: Supabase credentials are not configured in environment variables. Database features will be unavailable.');
} else {
  // Initializing Supabase client
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('Supabase client successfully initialized for URL:', supabaseUrl);
}

// Middleware to check if Supabase is initialized
app.use(['/api/auth', '/api/profile', '/api/reviews', '/api/playlists', '/api/friends', '/api/chat'], (req, res, next) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase credentials are not configured on the server. Please configure SUPABASE_URL and SUPABASE_KEY in Vercel settings.' });
  }
  next();
});

// ==========================================
// SPOTIFY TOKEN MANAGER (Client Credentials Flow)
// ==========================================
let cachedToken = null;
let tokenExpiresAt = 0;

async function getSpotifyToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 30000) {
    return cachedToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Spotify Client ID or Secret is not configured in .env');
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to retrieve Spotify access token: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in * 1000);

  return cachedToken;
}

// ==========================================
// SPOTIFY PROXY ENDPOINTS
// ==========================================
async function spotifyRequest(endpoint, queryParams = {}) {
  const token = await getSpotifyToken();
  const queryString = new URLSearchParams(queryParams).toString();
  const url = `https://api.spotify.com/v1/${endpoint}${queryString ? '?' + queryString : ''}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error ? errorData.error.message : 'Spotify API Error';
    throw { status: response.status, message };
  }

  return await response.json();
}

app.get('/api/spotify/search', async (req, res) => {
  try {
    const { q, type, limit, offset } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Search query parameter "q" is required' });
    }
    const data = await spotifyRequest('search', {
      q,
      type: type || 'track,album,artist',
      limit: limit || 20,
      offset: offset || 0
    });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

app.get('/api/spotify/tracks/:id', async (req, res) => {
  try {
    const data = await spotifyRequest(`tracks/${req.params.id}`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

app.get('/api/spotify/albums/:id', async (req, res) => {
  try {
    const data = await spotifyRequest(`albums/${req.params.id}`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

app.get('/api/spotify/artists/:id', async (req, res) => {
  try {
    const data = await spotifyRequest(`artists/${req.params.id}`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

app.get('/api/spotify/artists/:id/top-tracks', async (req, res) => {
  try {
    const market = req.query.market || 'US';
    const data = await spotifyRequest(`artists/${req.params.id}/top-tracks`, { market });
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

// ==========================================
// DB COLUMNS MAPPER LAYER (snake_case <-> camelCase)
// ==========================================
const mapReviewFromDB = (r) => ({
  id: r.id,
  username: r.username,
  itemId: r.item_id,
  itemType: r.item_type,
  itemName: r.item_name,
  itemArtist: r.item_artist,
  itemImage: r.item_image,
  rating: parseFloat(r.rating),
  liked: r.liked,
  reviewText: r.review_text,
  dateLogged: r.date_logged
});

const mapReviewToDB = (r) => ({
  id: r.id,
  username: r.username,
  item_id: r.itemId,
  item_type: r.itemType,
  item_name: r.itemName,
  item_artist: r.itemArtist,
  item_image: r.itemImage,
  rating: parseFloat(r.rating),
  liked: !!r.liked,
  review_text: r.reviewText,
  date_logged: r.dateLogged
});

const mapUserFromDB = (u) => ({
  username: u.username,
  displayName: u.display_name,
  bio: u.bio,
  avatar: u.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`,
  favorites: u.favorites || { tracks: [], albums: [], artists: [] }
});

// ==========================================
// PRODUCTION AUTHENTICATION ENDPOINTS
// ==========================================

// 1. User Registration / Signup
app.post('/api/auth/signup', async (req, res) => {
  const { username, displayName, password } = req.body;

  if (!username || !displayName || !password) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios (username, displayName, password)' });
  }

  const cleanUsername = username.trim().toLowerCase();

  try {
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('username')
      .eq('username', cleanUsername)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'Este nome de usuário já está cadastrado.' });
    }

    // Hash Password
    const passwordHash = bcrypt.hashSync(password, 10);
    const avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanUsername}`;

    // Insert user into Supabase table
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        username: cleanUsername,
        display_name: displayName.trim(),
        password_hash: passwordHash,
        avatar_url: avatarUrl
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    res.status(201).json({
      success: true,
      user: mapUserFromDB(newUser)
    });
  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ error: 'Erro interno ao realizar cadastro.' });
  }
});

// 2. User Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }

  const cleanUsername = username.trim().toLowerCase();

  try {
    // Select user where username matches
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', cleanUsername)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Nome de usuário não encontrado.' });
    }

    // Compare Password
    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }

    res.json({
      success: true,
      user: mapUserFromDB(user)
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ error: 'Erro interno ao realizar autenticação.' });
  }
});

// ==========================================
// SUPABASE LOCAL PROFILE & STATISTICS APIs
// ==========================================

// Get user profile details
app.get('/api/profile/:username', async (req, res) => {
  const { username } = req.params;
  const cleanUsername = username.trim().toLowerCase();

  try {
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('username', cleanUsername)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Query reviews for statistical analysis
    const { data: userReviews } = await supabase
      .from('reviews')
      .select('*')
      .eq('username', cleanUsername);

    const reviews = userReviews || [];
    const ratingStats = {
      '0.5': reviews.filter(r => parseFloat(r.rating) === 0.5).length,
      '1.0': reviews.filter(r => parseFloat(r.rating) === 1.0).length,
      '1.5': reviews.filter(r => parseFloat(r.rating) === 1.5).length,
      '2.0': reviews.filter(r => parseFloat(r.rating) === 2.0).length,
      '2.5': reviews.filter(r => parseFloat(r.rating) === 2.5).length,
      '3.0': reviews.filter(r => parseFloat(r.rating) === 3.0).length,
      '3.5': reviews.filter(r => parseFloat(r.rating) === 3.5).length,
      '4.0': reviews.filter(r => parseFloat(r.rating) === 4.0).length,
      '4.5': reviews.filter(r => parseFloat(r.rating) === 4.5).length,
      '5.0': reviews.filter(r => parseFloat(r.rating) === 5.0).length
    };

    res.json({
      user: mapUserFromDB(user),
      stats: {
        totalReviews: reviews.length,
        totalLikes: reviews.filter(r => r.liked).length,
        ratingsDistribution: ratingStats
      }
    });
  } catch (err) {
    console.error('Profile Retrieval Error:', err);
    res.status(500).json({ error: 'Erro ao carregar perfil.' });
  }
});

// Update Profile bio / displayName
app.post('/api/profile/:username/edit', async (req, res) => {
  const { username } = req.params;
  const { displayName, bio } = req.body;
  const cleanUsername = username.trim().toLowerCase();

  try {
    const { data: updatedUser, error } = await supabase
      .from('users')
      .update({
        display_name: displayName,
        bio: bio
      })
      .eq('username', cleanUsername)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, user: mapUserFromDB(updatedUser) });
  } catch (err) {
    console.error('Edit Profile Error:', err);
    res.status(500).json({ error: 'Erro ao salvar alterações no perfil.' });
  }
});

// Toggle Favorite Item (track, album, artist) on Profile highlights
app.post('/api/profile/:username/favorites', async (req, res) => {
  const { username } = req.params;
  const { id, name, artist, image, type } = req.body;
  const cleanUsername = username.trim().toLowerCase();

  if (!id || !name || !type) {
    return res.status(400).json({ error: 'Estrutura de item favorita inválida.' });
  }

  try {
    // Get current user favorites column
    const { data: user, error: fetchErr } = await supabase
      .from('users')
      .select('favorites')
      .eq('username', cleanUsername)
      .single();

    if (fetchErr || !user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const favorites = user.favorites || { tracks: [], albums: [], artists: [] };
    const listName = type === 'track' ? 'tracks' : (type === 'album' ? 'albums' : 'artists');

    if (!favorites[listName]) favorites[listName] = [];
    const existingIdx = favorites[listName].findIndex(item => item.id === id);

    let favorited = false;
    if (existingIdx > -1) {
      favorites[listName].splice(existingIdx, 1);
    } else {
      if (favorites[listName].length >= 5) {
        return res.status(400).json({ error: `Você só pode destacar até 5 ${listName} favoritos no perfil.` });
      }
      favorites[listName].push({ id, name, artist: artist || '', image: image || '', type });
      favorited = true;
    }

    // Save back to PostgreSQL JSONB
    const { error: updateErr } = await supabase
      .from('users')
      .update({ favorites })
      .eq('username', cleanUsername);

    if (updateErr) throw updateErr;

    res.json({ success: true, favorited, message: favorited ? 'Adicionado aos destaques' : 'Removido dos destaques' });
  } catch (err) {
    console.error('Favorites Toggle Error:', err);
    res.status(500).json({ error: 'Erro interno ao salvar item favorito.' });
  }
});

// ==========================================
// SUPABASE LOCAL REVIEWS APIs (CRUD)
// ==========================================

// Get reviews (with optional filtering)
app.get('/api/reviews', async (req, res) => {
  const { username, itemId, itemType } = req.query;

  try {
    let query = supabase.from('reviews').select('*');

    if (username) {
      query = query.eq('username', username.trim().toLowerCase());
    }
    if (itemId) {
      query = query.eq('item_id', itemId);
    }
    if (itemType) {
      query = query.eq('item_type', itemType);
    }

    // Order by date logged (newest first), falling back to creation timestamp
    const { data: dbReviews, error } = await query
      .order('date_logged', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;

    const mapped = (dbReviews || []).map(mapReviewFromDB);
    res.json(mapped);
  } catch (err) {
    console.error('Get Reviews Error:', err);
    res.status(500).json({ error: 'Erro ao carregar avaliações.' });
  }
});

// Create or update a review (Upsert)
app.post('/api/reviews', async (req, res) => {
  const { username, itemId, itemType, itemName, itemArtist, itemImage, rating, liked, reviewText, dateLogged } = req.body;

  if (!username || !itemId || !itemType || !itemName || rating === undefined) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes.' });
  }

  const cleanUsername = username.trim().toLowerCase();

  try {
    // Generate id if new, or check if review for this item by this user already exists to update
    const { data: existing } = await supabase
      .from('reviews')
      .select('id')
      .eq('username', cleanUsername)
      .eq('item_id', itemId)
      .maybeSingle();

    const id = existing ? existing.id : `rev_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const formattedDate = dateLogged || new Date().toISOString().split('T')[0];

    const dbRow = mapReviewToDB({
      id,
      username: cleanUsername,
      itemId,
      itemType,
      itemName,
      itemArtist,
      itemImage,
      rating,
      liked,
      reviewText,
      dateLogged: formattedDate
    });

    const { data: savedRow, error } = await supabase
      .from('reviews')
      .upsert(dbRow)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, review: mapReviewFromDB(savedRow) });
  } catch (err) {
    console.error('Post Review Error:', err);
    res.status(500).json({ error: 'Erro ao salvar avaliação.' });
  }
});

// Delete a review
app.delete('/api/reviews/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await supabase
      .from('reviews')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true, message: 'Avaliação excluída com sucesso.' });
  } catch (err) {
    console.error('Delete Review Error:', err);
    res.status(500).json({ error: 'Erro ao excluir avaliação.' });
  }
});

// ==========================================
// SUPABASE LOCAL PLAYLISTS APIs (CRUD)
// ==========================================

// Get playlists
app.get('/api/playlists', async (req, res) => {
  const { username } = req.query;

  try {
    let query = supabase.from('playlists').select('*');

    if (username) {
      query = query.eq('username', username.trim().toLowerCase());
    }

    const { data: dbPlaylists, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;
    res.json(dbPlaylists || []);
  } catch (err) {
    console.error('Get Playlists Error:', err);
    res.status(500).json({ error: 'Erro ao carregar playlists.' });
  }
});

// Get single playlist details
app.get('/api/playlists/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data: playlist, error } = await supabase
      .from('playlists')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !playlist) {
      return res.status(404).json({ error: 'Playlist não encontrada.' });
    }

    res.json(playlist);
  } catch (err) {
    console.error('Get Playlist Details Error:', err);
    res.status(500).json({ error: 'Erro ao carregar detalhes da playlist.' });
  }
});

// Create or update a playlist (Upsert)
app.post('/api/playlists', async (req, res) => {
  const { id, name, description, username, tracks } = req.body;

  if (!name || !username) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes.' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const playlistId = id || `list_${Date.now()}`;

  try {
    const { data: savedPlaylist, error } = await supabase
      .from('playlists')
      .upsert({
        id: playlistId,
        username: cleanUsername,
        name: name.trim(),
        description: description || '',
        tracks: tracks || []
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, playlist: savedPlaylist });
  } catch (err) {
    console.error('Post Playlist Error:', err);
    res.status(500).json({ error: 'Erro ao salvar playlist.' });
  }
});

// Delete a playlist
app.delete('/api/playlists/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await supabase
      .from('playlists')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true, message: 'Playlist excluída com sucesso.' });
  } catch (err) {
    console.error('Delete Playlist Error:', err);
    res.status(500).json({ error: 'Erro ao excluir playlist.' });
  }
});

// ==========================================
// SUPABASE SOCIAL & CHAT APIs
// ==========================================

// 1. Search users by display name or username to add as friends
app.get('/api/friends/search-users', async (req, res) => {
  const { q, currentUsername } = req.query;
  if (!q) {
    return res.json([]);
  }

  const cleanQuery = q.trim().toLowerCase();
  const cleanCurrent = currentUsername ? currentUsername.trim().toLowerCase() : '';

  try {
    // Select users whose username or display_name matches query
    // Exclude current user from results
    const { data: dbUsers, error } = await supabase
      .from('users')
      .select('username, display_name, avatar_url')
      .or(`username.ilike.%${cleanQuery}%,display_name.ilike.%${cleanQuery}%`)
      .neq('username', cleanCurrent)
      .limit(10);

    if (error) throw error;

    res.json(dbUsers || []);
  } catch (err) {
    console.error('Search Users Error:', err);
    res.status(500).json({ error: 'Erro ao pesquisar usuários.' });
  }
});

// 2. Get friends list (both accepted friends and pending received/sent requests)
app.get('/api/friends/list', async (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ error: 'Username é obrigatório.' });
  }
  const cleanUsername = username.trim().toLowerCase();

  try {
    // Query all friendships involving the current user
    const { data: dbFriendships, error } = await supabase
      .from('friendships')
      .select('*')
      .or(`sender_username.eq.${cleanUsername},receiver_username.eq.${cleanUsername}`);

    if (error) throw error;

    res.json(dbFriendships || []);
  } catch (err) {
    console.error('List Friendships Error:', err);
    res.status(500).json({ error: 'Erro ao carregar lista de amizades.' });
  }
});

// 3. Send friend request
app.post('/api/friends/request', async (req, res) => {
  const { senderUsername, receiverUsername } = req.body;
  if (!senderUsername || !receiverUsername) {
    return res.status(400).json({ error: 'Sender e Receiver são obrigatórios.' });
  }

  const cleanSender = senderUsername.trim().toLowerCase();
  const cleanReceiver = receiverUsername.trim().toLowerCase();

  if (cleanSender === cleanReceiver) {
    return res.status(400).json({ error: 'Você não pode adicionar a si mesmo.' });
  }

  try {
    // Insert pending friendship relation
    const { data, error } = await supabase
      .from('friendships')
      .insert({
        sender_username: cleanSender,
        receiver_username: cleanReceiver,
        status: 'pending'
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return res.status(400).json({ error: 'Uma solicitação ou amizade entre estes usuários já existe.' });
      }
      throw error;
    }

    res.json({ success: true, friendship: data });
  } catch (err) {
    console.error('Friend Request Error:', err);
    res.status(500).json({ error: 'Erro ao enviar solicitação de amizade.' });
  }
});

// 4. Accept friend request
app.post('/api/friends/accept', async (req, res) => {
  const { senderUsername, receiverUsername } = req.body;
  if (!senderUsername || !receiverUsername) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes.' });
  }

  const cleanSender = senderUsername.trim().toLowerCase();
  const cleanReceiver = receiverUsername.trim().toLowerCase();

  try {
    // Update friendship status to accepted
    const { data, error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('sender_username', cleanSender)
      .eq('receiver_username', cleanReceiver)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, friendship: data });
  } catch (err) {
    console.error('Accept Friend Error:', err);
    res.status(500).json({ error: 'Erro ao aceitar solicitação.' });
  }
});

// 5. Decline request or Unfriend
app.post('/api/friends/decline', async (req, res) => {
  const { userA, userB } = req.body;
  if (!userA || !userB) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes.' });
  }

  const cleanA = userA.trim().toLowerCase();
  const cleanB = userB.trim().toLowerCase();

  try {
    // Delete friendship relation regardless of who sent it
    const { error } = await supabase
      .from('friendships')
      .delete()
      .or(`and(sender_username.eq.${cleanA},receiver_username.eq.${cleanB}),and(sender_username.eq.${cleanB},receiver_username.eq.${cleanA})`);

    if (error) throw error;

    res.json({ success: true, message: 'Amizade desfeita ou solicitação recusada com sucesso.' });
  } catch (err) {
    console.error('Decline Friend Error:', err);
    res.status(500).json({ error: 'Erro ao remover amizade.' });
  }
});

// 6. Get direct chat messages history with a specific friend
app.get('/api/chat/messages', async (req, res) => {
  const { user, friend } = req.query;
  if (!user || !friend) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes.' });
  }

  const cleanUser = user.trim().toLowerCase();
  const cleanFriend = friend.trim().toLowerCase();

  try {
    // Retrieve conversation history order by date
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_username.eq.${cleanUser},receiver_username.eq.${cleanFriend}),and(sender_username.eq.${cleanFriend},receiver_username.eq.${cleanUser})`)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json(messages || []);
  } catch (err) {
    console.error('Get Messages Error:', err);
    res.status(500).json({ error: 'Erro ao carregar mensagens.' });
  }
});

// Get all messages involving the user for notifications
app.get('/api/chat/all-messages', async (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ error: 'Username é obrigatório.' });
  }

  const cleanUsername = username.trim().toLowerCase();

  try {
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .or(`sender_username.eq.${cleanUsername},receiver_username.eq.${cleanUsername}`)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json(messages || []);
  } catch (err) {
    console.error('Get All Messages Error:', err);
    res.status(500).json({ error: 'Erro ao carregar mensagens.' });
  }
});

// 7. Send chat message (with optional playlist ID)
app.post('/api/chat/messages', async (req, res) => {
  const { senderUsername, receiverUsername, messageText, playlistId } = req.body;
  if (!senderUsername || !receiverUsername) {
    return res.status(400).json({ error: 'Remetente e Destinatário são obrigatórios.' });
  }

  const cleanSender = senderUsername.trim().toLowerCase();
  const cleanReceiver = receiverUsername.trim().toLowerCase();

  try {
    // Insert new message
    const { data, error } = await supabase
      .from('messages')
      .insert({
        sender_username: cleanSender,
        receiver_username: cleanReceiver,
        message_text: messageText || '',
        playlist_id: playlistId || null
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, message: data });
  } catch (err) {
    console.error('Send Message Error:', err);
    res.status(500).json({ error: 'Erro ao enviar mensagem.' });
  }
});

// Wildcard fallback to serve index.html for SPA router
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start listening
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`Musicboxd Server running on http://localhost:${PORT}`);
  console.log(`Serving static files from ./public`);
  console.log(`Connected to Supabase PostgreSQL database.`);
  console.log(`====================================================`);
});

module.exports = app;
