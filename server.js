const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── MongoDB connection ───────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI environment variable is not set.');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error('MongoDB connection error:', err); process.exit(1); });

// ─── Schemas ──────────────────────────────────────────────────────────────────
const menuItemSchema = new mongoose.Schema({
  id:          { type: Number, required: true },
  name:        { type: String, required: true },
  description: { type: String, default: '' },
  price:       { type: Number, default: 0 },
  emoji:       { type: String, default: '🍽️' }
}, { _id: false });

const orderItemSchema = new mongoose.Schema({
  id:    Number,
  name:  String,
  price: Number,
  qty:   Number
}, { _id: false });

const orderSchema = new mongoose.Schema({
  id:           { type: String, required: true },
  items:        [orderItemSchema],
  customerName: { type: String, default: 'Anonymous' },
  note:         { type: String, default: '' },
  timestamp:    String,
  status:       { type: String, default: 'new' }
}, { _id: false });

const restaurantSchema = new mongoose.Schema({
  id:     { type: String, unique: true, required: true },  // the 8-char login code
  name:   { type: String, required: true },
  menu:   [menuItemSchema],
  orders: [orderSchema]
}, { timestamps: true });

const Restaurant = mongoose.model('Restaurant', restaurantSchema);

// ─── Routes ───────────────────────────────────────────────────────────────────

// Register a new restaurant
app.post('/api/restaurant', async (req, res) => {
  try {
    const { name } = req.body;
    const id = crypto.randomBytes(4).toString('hex');
    const restaurant = await Restaurant.create({ id, name: name || 'My Restaurant', menu: [], orders: [] });
    res.json({ id: restaurant.id, name: restaurant.name, menu: restaurant.menu, orders: restaurant.orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create restaurant' });
  }
});

// Get restaurant by ID (login)
app.get('/api/restaurant/:id', async (req, res) => {
  try {
    const r = await Restaurant.findOne({ id: req.params.id });
    if (!r) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({ id: r.id, name: r.name, menu: r.menu, orders: r.orders });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add a dish to the menu
app.post('/api/restaurant/:id/menu', async (req, res) => {
  try {
    const r = await Restaurant.findOne({ id: req.params.id });
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
    await r.save();
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add dish' });
  }
});

// Delete a dish from the menu
app.delete('/api/restaurant/:id/menu/:itemId', async (req, res) => {
  try {
    const r = await Restaurant.findOne({ id: req.params.id });
    if (!r) return res.status(404).json({ error: 'Restaurant not found' });

    r.menu = r.menu.filter(i => i.id !== parseInt(req.params.itemId));
    await r.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete dish' });
  }
});

// Place an order
app.post('/api/order/:restaurantId', async (req, res) => {
  try {
    const r = await Restaurant.findOne({ id: req.params.restaurantId });
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
    await r.save();

    io.to(`restaurant:${req.params.restaurantId}`).emit('new_order', order);
    res.json({ success: true, orderId: order.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join_restaurant', (restaurantId) => {
    socket.join(`restaurant:${restaurantId}`);
  });

  socket.on('update_order_status', async ({ restaurantId, orderId, status }) => {
    try {
      const r = await Restaurant.findOne({ id: restaurantId });
      if (!r) return;
      const order = r.orders.find(o => o.id === orderId);
      if (order) {
        order.status = status;
        await r.save();
        io.to(`restaurant:${restaurantId}`).emit('order_updated', { orderId, status });
      }
    } catch (err) {
      console.error('update_order_status error:', err);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
