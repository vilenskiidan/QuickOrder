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

// Create/get a restaurant session
app.post('/api/restaurant', (req, res) => {
  const { name, menu } = req.body;
  const id = crypto.randomBytes(4).toString('hex');
  restaurants[id] = { id, name: name || 'My Restaurant', menu: menu || defaultMenu, orders: [] };
  res.json({ id, ...restaurants[id] });
});

app.get('/api/restaurant/:id', (req, res) => {
  const r = restaurants[req.params.id];
  if (!r) return res.status(404).json({ error: 'Restaurant not found' });
  res.json(r);
});

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
  // Push to restaurant's socket room
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

const defaultMenu = [
  { id: 1, name: 'Margherita Pizza', price: 12, category: 'Pizza', emoji: '🍕' },
  { id: 2, name: 'Pepperoni Pizza', price: 14, category: 'Pizza', emoji: '🍕' },
  { id: 3, name: 'Caesar Salad', price: 9, category: 'Salads', emoji: '🥗' },
  { id: 4, name: 'Greek Salad', price: 8, category: 'Salads', emoji: '🥗' },
  { id: 5, name: 'Cheeseburger', price: 13, category: 'Burgers', emoji: '🍔' },
  { id: 6, name: 'Veggie Burger', price: 11, category: 'Burgers', emoji: '🍔' },
  { id: 7, name: 'Cola', price: 3, category: 'Drinks', emoji: '🥤' },
  { id: 8, name: 'Lemonade', price: 4, category: 'Drinks', emoji: '🍋' },
];

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
