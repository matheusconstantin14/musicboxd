const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// SPOTIFY TOKEN MANAGER (Client Credentials Flow)
// ==========================================
let cachedToken = null;
let tokenExpiresAt = 0;

async function getSpotifyToken() {
  const now = Date.now();
  // Buffer token expiry by 30 seconds to be safe
  if (cachedToken && now < tokenExpiresAt - 30000) {
    return cachedToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Spotify Client ID or Secret is not configured in .env');
  }

  console.log('Fetching new Spotify Access Token...');
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
  
  console.log('Spotify Token successfully retrieved and cached.');
  return cachedToken;
}

// ==========================================
// DATABASE UTILITIES (db.json helper methods)
// ==========================================
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      // Return a blank template if the file was deleted
      return { users: [], reviews: [], playlists: [] };
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading JSON database:', err);
    return { users: [], reviews: [], playlists: [] };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing to JSON database:', err);
    return false;
  }
}

// ==========================================
// SPOTIFY PROXY ENDPOINTS
// ==========================================

// Helper function to query Spotify Web API
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

// Search endpoint (tracks, albums, artists)
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
    console.error('Search Proxy Error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

// Single Track details
app.get('/api/spotify/tracks/:id', async (req, res) => {
  try {
    const data = await spotifyRequest(`tracks/${req.params.id}`);
    res.json(data);
  } catch (err) {
    console.error('Track Proxy Error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

// Single Album details (with tracks)
app.get('/api/spotify/albums/:id', async (req, res) => {
  try {
    const data = await spotifyRequest(`albums/${req.params.id}`);
    res.json(data);
  } catch (err) {
    console.error('Album Proxy Error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

// Single Artist details
app.get('/api/spotify/artists/:id', async (req, res) => {
  try {
    const data = await spotifyRequest(`artists/${req.params.id}`);
    res.json(data);
  } catch (err) {
    console.error('Artist Proxy Error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

// Artist's Top Tracks
app.get('/api/spotify/artists/:id/top-tracks', async (req, res) => {
  try {
    const market = req.query.market || 'US';
    const data = await spotifyRequest(`artists/${req.params.id}/top-tracks`, { market });
    res.json(data);
  } catch (err) {
    console.error('Artist Top Tracks Proxy Error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

// Recommendations Endpoint
app.get('/api/spotify/recommendations', async (req, res) => {
  try {
    const { seed_artists, seed_genres, seed_tracks, limit } = req.query;
    
    // We need at least one seed type
    if (!seed_artists && !seed_genres && !seed_tracks) {
      return res.status(400).json({ error: 'At least one seed (artists, genres, or tracks) is required' });
    }

    const params = { limit: limit || 12 };
    if (seed_artists) params.seed_artists = seed_artists;
    if (seed_genres) params.seed_genres = seed_genres;
    if (seed_tracks) params.seed_tracks = seed_tracks;

    const data = await spotifyRequest('recommendations', params);
    res.json(data);
  } catch (err) {
    console.error('Recommendations Proxy Error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

// Recommendation Genres (static list or queried from Spotify)
app.get('/api/spotify/genres', async (req, res) => {
  try {
    const data = await spotifyRequest('recommendations/available-genre-seeds');
    res.json(data);
  } catch (err) {
    console.error('Genre Seeds Proxy Error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});


// ==========================================
// LOCAL DATABASE API ENDPOINTS (Musicboxd Logic)
// ==========================================

// Get user profile details
app.get('/api/profile/:username', (req, res) => {
  const { username } = req.params;
  const db = readDB();
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Get ratings and reviews for stats calculations
  const userReviews = db.reviews.filter(r => r.username.toLowerCase() === username.toLowerCase());
  
  res.json({
    user,
    stats: {
      totalReviews: userReviews.length,
      totalLikes: userReviews.filter(r => r.liked).length,
      ratingsDistribution: {
        '0.5': userReviews.filter(r => r.rating === 0.5).length,
        '1.0': userReviews.filter(r => r.rating === 1.0).length,
        '1.5': userReviews.filter(r => r.rating === 1.5).length,
        '2.0': userReviews.filter(r => r.rating === 2.0).length,
        '2.5': userReviews.filter(r => r.rating === 2.5).length,
        '3.0': userReviews.filter(r => r.rating === 3.0).length,
        '3.5': userReviews.filter(r => r.rating === 3.5).length,
        '4.0': userReviews.filter(r => r.rating === 4.0).length,
        '4.5': userReviews.filter(r => r.rating === 4.5).length,
        '5.0': userReviews.filter(r => r.rating === 5.0).length
      }
    }
  });
});

// Update Profile bio / displayName
app.post('/api/profile/:username/edit', (req, res) => {
  const { username } = req.params;
  const { displayName, bio } = req.body;
  const db = readDB();
  const userIdx = db.users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());

  if (userIdx === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  db.users[userIdx].displayName = displayName || db.users[userIdx].displayName;
  db.users[userIdx].bio = bio !== undefined ? bio : db.users[userIdx].bio;

  writeDB(db);
  res.json({ success: true, user: db.users[userIdx] });
});

// Toggle Favorite Item (track, album, artist)
app.post('/api/profile/:username/favorites', (req, res) => {
  const { username } = req.params;
  const { id, name, artist, image, type } = req.body; // type is 'track', 'album', or 'artist'

  if (!id || !name || !type) {
    return res.status(400).json({ error: 'Invalid item structure' });
  }

  const db = readDB();
  const userIdx = db.users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());

  if (userIdx === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  const favorites = db.users[userIdx].favorites;
  const listName = type === 'track' ? 'tracks' : (type === 'album' ? 'albums' : 'artists');
  
  if (!favorites[listName]) {
    favorites[listName] = [];
  }

  const existingIdx = favorites[listName].findIndex(item => item.id === id);

  if (existingIdx > -1) {
    // Remove if already favorited
    favorites[listName].splice(existingIdx, 1);
    writeDB(db);
    return res.json({ success: true, favorited: false, message: 'Removed from favorites' });
  } else {
    // Max 5 favorites for visual grid styling
    if (favorites[listName].length >= 5) {
      return res.status(400).json({ error: `You can only select up to 5 favorite ${listName} for your profile page.` });
    }
    // Add to favorites
    favorites[listName].push({ id, name, artist: artist || '', image: image || '', type });
    writeDB(db);
    return res.json({ success: true, favorited: true, message: 'Added to favorites' });
  }
});

// Get all reviews (with optional filtering)
app.get('/api/reviews', (req, res) => {
  const { username, itemId, itemType } = req.query;
  const db = readDB();
  let filteredReviews = db.reviews;

  if (username) {
    filteredReviews = filteredReviews.filter(r => r.username.toLowerCase() === username.toLowerCase());
  }
  if (itemId) {
    filteredReviews = filteredReviews.filter(r => r.itemId === itemId);
  }
  if (itemType) {
    filteredReviews = filteredReviews.filter(r => r.itemType === itemType);
  }

  // Sort by date logged (newest first)
  filteredReviews.sort((a, b) => new Date(b.dateLogged) - new Date(a.dateLogged));

  res.json(filteredReviews);
});

// Create or update a review
app.post('/api/reviews', (req, res) => {
  const { username, itemId, itemType, itemName, itemArtist, itemImage, rating, liked, reviewText, dateLogged } = req.body;

  if (!username || !itemId || !itemType || !itemName || rating === undefined) {
    return res.status(400).json({ error: 'Missing required parameters (username, itemId, itemType, itemName, rating)' });
  }

  const db = readDB();

  // Find if review for this item by this user already exists (Update)
  const existingIdx = db.reviews.findIndex(r => r.username.toLowerCase() === username.toLowerCase() && r.itemId === itemId);
  const formattedDate = dateLogged || new Date().toISOString().split('T')[0];

  const reviewObject = {
    id: existingIdx > -1 ? db.reviews[existingIdx].id : `rev_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    username,
    itemId,
    itemType,
    itemName,
    itemArtist: itemArtist || '',
    itemImage: itemImage || '',
    rating: parseFloat(rating),
    liked: !!liked,
    reviewText: reviewText || '',
    dateLogged: formattedDate
  };

  if (existingIdx > -1) {
    db.reviews[existingIdx] = reviewObject;
  } else {
    db.reviews.unshift(reviewObject);
  }

  writeDB(db);
  res.json({ success: true, review: reviewObject });
});

// Delete a review
app.delete('/api/reviews/:id', (req, res) => {
  const { id } = req.params;
  const db = readDB();
  const initialLen = db.reviews.length;
  db.reviews = db.reviews.filter(r => r.id !== id);

  if (db.reviews.length === initialLen) {
    return res.status(404).json({ error: 'Review not found' });
  }

  writeDB(db);
  res.json({ success: true, message: 'Review successfully deleted' });
});

// Get playlists
app.get('/api/playlists', (req, res) => {
  const { username } = req.query;
  const db = readDB();
  let filteredPlaylists = db.playlists;

  if (username) {
    filteredPlaylists = filteredPlaylists.filter(p => p.username.toLowerCase() === username.toLowerCase());
  }

  res.json(filteredPlaylists);
});

// Get single playlist details
app.get('/api/playlists/:id', (req, res) => {
  const db = readDB();
  const playlist = db.playlists.find(p => p.id === req.params.id);

  if (!playlist) {
    return res.status(404).json({ error: 'Playlist not found' });
  }

  res.json(playlist);
});

// Create or update a playlist
app.post('/api/playlists', (req, res) => {
  const { id, name, description, username, tracks } = req.body;

  if (!name || !username) {
    return res.status(400).json({ error: 'Playlist name and owner username are required' });
  }

  const db = readDB();
  let playlistObject;

  if (id) {
    // Update existing
    const existingIdx = db.playlists.findIndex(p => p.id === id);
    if (existingIdx === -1) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    
    playlistObject = {
      ...db.playlists[existingIdx],
      name,
      description: description || '',
      tracks: tracks || []
    };
    db.playlists[existingIdx] = playlistObject;
  } else {
    // Create new
    playlistObject = {
      id: `list_${Date.now()}`,
      name,
      description: description || '',
      username,
      tracks: tracks || [],
      likes: 0
    };
    db.playlists.unshift(playlistObject);
  }

  writeDB(db);
  res.json({ success: true, playlist: playlistObject });
});

// Delete a playlist
app.delete('/api/playlists/:id', (req, res) => {
  const { id } = req.params;
  const db = readDB();
  const initialLen = db.playlists.length;
  db.playlists = db.playlists.filter(p => p.id !== id);

  if (db.playlists.length === initialLen) {
    return res.status(404).json({ error: 'Playlist not found' });
  }

  writeDB(db);
  res.json({ success: true, message: 'Playlist successfully deleted' });
});

// Wildcard fallback to serve index.html for React-like client routers
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start listening
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`Musicboxd Server running on http://localhost:${PORT}`);
  console.log(`Serving static files from ./public`);
  console.log(`Using database file: ${DB_FILE}`);
  console.log(`====================================================`);
});
