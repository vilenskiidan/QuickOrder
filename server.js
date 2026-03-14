const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// In-memory store: restaurantId -> { name, menu, orders[] }
const restaurants = {};

// Register a new restaurant
app.post('/api/restaurant', (req, res) => {
  const { name } = req.body;
  const id = crypto.randomBytes(4).toString('hex');
  restaurants[id] = { id, name: name || 'My Restaurant', menu: [], orders: [] };
  res.json({ id, ...restaurants[id] });
});

// Get restaurant by ID (also used for login)
app.get('/api/restaurant/:id', (req, res) => {
  const r = restaurants[req.params.id];
  if (!r) return res.status(404).json({ error: 'Restaurant not found' });
  res.json(r);
});

// Add a dish to the menu
app.post('/api/restaurant/:id/menu', (req, res) => {
  const r = restaurants[req.params.id];
  if (!r) return res.status(404).json({ error: 'Restaurant not found' });
  const { name, description, price } = req.body;
  if (!name) return res.status(400).json({ error: 'Dish name is required' });
  const item = {
    id: Date.now(),
    name: name.trim(),
    description: (description || '').trim(),
    price: parseFloat(price) || 0,
    emoji: '🍽️'
  };
  r.menu.push(item);
  res.json(item);
});

// Delete a dish from the menu
app.delete('/api/restaurant/:id/menu/:itemId', (req, res) => {
  const r = restaurants[req.params.id];
  if (!r) return res.status(404).json({ error: 'Restaurant not found' });
  const itemId = parseInt(req.params.itemId);
  r.menu = r.menu.filter(i => i.id !== itemId);
  res.json({ success: true });
});

// Place an order
app.post('/api/order/:restaurantId', (req, res) => {
  const r = restaurants[req.params.restaurantId];
  if (!r) return res.status(404).json({ error: 'Restaurant not found' });

  const order = {
    id: crypto.randomBytes(3).toString('hex').toUpperCase(),
    items: req.body.items,
    customerName: req.body.customerName || 'Anonymous',
    note: req.body.note || '',
    timestamp: new Date().toISOString(),
    status: 'new'
  };

  r.orders.push(order);
  io.to(`restaurant:${req.params.restaurantId}`).emit('new_order', order);
  res.json({ success: true, orderId: order.id });
});

// Socket.io
io.on('connection', (socket) => {
  socket.on('join_restaurant', (restaurantId) => {
    socket.join(`restaurant:${restaurantId}`);
  });

  socket.on('update_order_status', ({ restaurantId, orderId, status }) => {
    const r = restaurants[restaurantId];
    if (!r) return;
    const order = r.orders.find(o => o.id === orderId);
    if (order) {
      order.status = status;
      io.to(`restaurant:${restaurantId}`).emit('order_updated', { orderId, status });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
