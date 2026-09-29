require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // serve o site em http://hoteis.com/

const isDemoMode = !process.env.PAYMENT_ACCESS_TOKEN;

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', demoMode: isDemoMode });
});

// ============================================================
// CONVIDADO (login simplificado de demonstração, sem senha real)
// Cria (ou reaproveita) um usuário pelo e-mail, para poder ligar
// carrinho/reservas a uma pessoa real na tabela "users".
// ============================================================
app.post('/convidado', async (req, res) => {
  try {
    const { name, email, phone, country } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Nome e e-mail são obrigatórios.' });

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.json({ id: existing.rows[0].id });
    }
    const created = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, country)
       VALUES ($1, $2, $3, 'DEMO_SEM_SENHA', $4) RETURNING id`,
      [name, email, phone || null, country || null]
    );
    res.status(201).json({ id: created.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar convidado.' });
  }
});

// ============================================================
// HOTÉIS
// ============================================================

// Listar hotéis (com filtros opcionais via query string)
// Exemplo: /hoteis?country=Brasil&city=Maragogi&stars=5
app.get('/hoteis', async (req, res) => {
  try {
    const { country, city, stars, minPrice, maxPrice, sort } = req.query;
    const conditions = [`h.status = 'ACTIVE'`];
    const values = [];

    if (country) { values.push(country); conditions.push(`h.country = $${values.length}`); }
    if (city)    { values.push(city);    conditions.push(`h.city = $${values.length}`); }
    if (stars)   { values.push(stars);   conditions.push(`h.stars = $${values.length}`); }

    let orderBy = 'h.featured DESC, h.rating DESC';
    if (sort === 'menor-preco') orderBy = 'preco_minimo ASC';
    if (sort === 'maior-preco') orderBy = 'preco_minimo DESC';
    if (sort === 'avaliacao')   orderBy = 'h.rating DESC';

    const query = `
      SELECT h.*, MIN(r.price) AS preco_minimo
      FROM hotels h
      LEFT JOIN rooms r ON r.hotel_id = h.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY h.id
      ${minPrice ? `HAVING MIN(r.price) >= ${Number(minPrice)}` : ''}
      ${maxPrice ? `${minPrice ? 'AND' : 'HAVING'} MIN(r.price) <= ${Number(maxPrice)}` : ''}
      ORDER BY ${orderBy}
    `;

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar hotéis.' });
  }
});

// Detalhe de um hotel (com imagens e comodidades)
app.get('/hoteis/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const hotel = await pool.query('SELECT * FROM hotels WHERE id = $1', [id]);
    if (hotel.rows.length === 0) return res.status(404).json({ error: 'Hotel não encontrado.' });

    const images = await pool.query(
      'SELECT * FROM hotel_images WHERE hotel_id = $1 ORDER BY category',
      [id]
    );
    const amenities = await pool.query(
      `SELECT a.name FROM amenities a
       JOIN hotel_amenities ha ON ha.amenity_id = a.id
       WHERE ha.hotel_id = $1`,
      [id]
    );

    res.json({
      ...hotel.rows[0],
      images: images.rows,
      amenities: amenities.rows.map(a => a.name),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar o hotel.' });
  }
});

// Quartos de um hotel
app.get('/hoteis/:id/quartos', async (req, res) => {
  try {
    const { id } = req.params;
    const rooms = await pool.query(
      'SELECT * FROM rooms WHERE hotel_id = $1 AND available = true ORDER BY price',
      [id]
    );
    res.json(rooms.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar quartos.' });
  }
});

// ============================================================
// CARRINHO
// ============================================================

// Adicionar item ao carrinho
app.post('/carrinho', async (req, res) => {
  try {
    const { user_id, hotel_id, room_id, check_in, check_out, guests, rooms_qty } = req.body;
    if (!user_id || !hotel_id || !room_id || !check_in || !check_out) {
      return res.status(400).json({ error: 'Campos obrigatórios faltando.' });
    }
    const result = await pool.query(
      `INSERT INTO cart_items (user_id, hotel_id, room_id, check_in, check_out, guests, rooms_qty)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [user_id, hotel_id, room_id, check_in, check_out, guests || 1, rooms_qty || 1]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao adicionar ao carrinho.' });
  }
});

// Ver carrinho de um usuário (com dados do hotel e quarto)
app.get('/carrinho/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      `SELECT c.*, h.name AS hotel_name, h.city, r.name AS room_name, r.price
       FROM cart_items c
       JOIN hotels h ON h.id = c.hotel_id
       JOIN rooms r ON r.id = c.room_id
       WHERE c.user_id = $1
       ORDER BY c.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar carrinho.' });
  }
});

// Remover item do carrinho
app.delete('/carrinho/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM cart_items WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao remover item do carrinho.' });
  }
});

// ============================================================
// RESERVAS  (sem cancelamento, conforme definido)
// ============================================================

// Criar reserva (normalmente a partir de um item do carrinho, no checkout)
app.post('/reservas', async (req, res) => {
  try {
    const { user_id, hotel_id, room_id, check_in, check_out, guests, rooms, total_price, cart_item_id } = req.body;
    if (!user_id || !hotel_id || !room_id || !check_in || !check_out || !total_price) {
      return res.status(400).json({ error: 'Campos obrigatórios faltando.' });
    }

    const result = await pool.query(
      `INSERT INTO reservations (user_id, hotel_id, room_id, check_in, check_out, guests, rooms, total_price, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING') RETURNING *`,
      [user_id, hotel_id, room_id, check_in, check_out, guests || 1, rooms || 1, total_price]
    );

    // Se a reserva veio do carrinho, remove o item de lá
    if (cart_item_id) {
      await pool.query('DELETE FROM cart_items WHERE id = $1', [cart_item_id]);
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar reserva.' });
  }
});

// Reservas de um usuário (Minhas reservas)
app.get('/reservas/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      `SELECT res.*, h.name AS hotel_name, h.city, h.address, r.name AS room_name,
              p.status AS payment_status
       FROM reservations res
       JOIN hotels h ON h.id = res.hotel_id
       JOIN rooms r ON r.id = res.room_id
       LEFT JOIN payments p ON p.reservation_id = res.id
       WHERE res.user_id = $1
       ORDER BY res.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar reservas.' });
  }
});

// ============================================================
// PAGAMENTOS  (MODO DEMONSTRAÇÃO até um gateway real ser configurado)
// ============================================================

app.post('/pagamentos', async (req, res) => {
  try {
    const { reservation_id, provider, amount } = req.body;
    if (!reservation_id || !amount) {
      return res.status(400).json({ error: 'Campos obrigatórios faltando.' });
    }

    if (isDemoMode) {
      // MODO DEMONSTRAÇÃO: simula aprovação instantânea, sem gateway real.
      const payment = await pool.query(
        `INSERT INTO payments (reservation_id, provider, transaction_id, amount, status)
         VALUES ($1, $2, $3, $4, 'PAID') RETURNING *`,
        [reservation_id, provider || 'demo', `DEMO-${Date.now()}`, amount]
      );
      await pool.query(`UPDATE reservations SET status = 'CONFIRMED' WHERE id = $1`, [reservation_id]);
      return res.status(201).json({ demoMode: true, payment: payment.rows[0] });
    }

    // A partir daqui entraria a chamada real ao gateway (Mercado Pago, Stripe, etc.)
    // usando as variáveis PAYMENT_PROVIDER / PAYMENT_ACCESS_TOKEN do .env.
    res.status(501).json({ error: 'Gateway de pagamento real ainda não configurado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao processar pagamento.' });
  }
});

// Webhook para quando o gateway real de pagamento confirmar o pagamento
app.post('/api/payment/webhook', async (req, res) => {
  try {
    const { reservation_id, status, transaction_id } = req.body;
    await pool.query(
      `UPDATE payments SET status = $1, transaction_id = $2 WHERE reservation_id = $3`,
      [status, transaction_id, reservation_id]
    );
    if (status === 'PAID') {
      await pool.query(`UPDATE reservations SET status = 'CONFIRMED' WHERE id = $1`, [reservation_id]);
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao processar webhook.' });
  }
});

// ============================================================
app.listen(process.env.PORT || 3333, () => {
  console.log(`Litoral Seleto API rodando na porta ${process.env.PORT || 3333}`);
  console.log(isDemoMode ? '⚠️  Rodando em MODO DEMONSTRAÇÃO (sem gateway de pagamento real).' : '✅ Gateway de pagamento configurado.');
});
