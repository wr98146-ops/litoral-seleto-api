-- ============================================================
-- LITORAL SELETO — Schema do banco de dados (PostgreSQL)
-- ============================================================
-- Como usar:
--   1. Crie um banco vazio (local, Supabase, Neon, Railway etc.)
--   2. Rode este arquivo inteiro: psql "SUA_CONNECTION_STRING" -f litoral-seleto-schema.sql
--   3. Pronto — todas as tabelas, relações e índices estarão criados.
--
-- Observações importantes:
--   - Sem cancelamento e sem reembolso, conforme solicitado:
--     não existem status CANCELLED nem REFUNDED em nenhuma tabela.
--   - Os dado dos cartões devem ser armazenado aqui (Apenas os cartões de crédito com número do cartão, data de validade e código de segurança).
--     A tabela "payments" guarda só o resultado da transação do gateway.
--   - Use isso junto com variáveis de ambiente (.env) no seu backend
--     para as credenciais do gateway de pagamento — nunca no banco.
-- ============================================================

-- Extensão para gerar UUIDs automaticamente
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- USERS
-- ------------------------------------------------------------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(150) NOT NULL,
  email         VARCHAR(200) NOT NULL UNIQUE,
  phone         VARCHAR(30),
  password_hash TEXT NOT NULL,          -- nunca salve senha em texto puro
  country       VARCHAR(60),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- HOTELS
-- ------------------------------------------------------------
CREATE TABLE hotels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  country     VARCHAR(60) NOT NULL,
  state       VARCHAR(100),
  city        VARCHAR(100) NOT NULL,
  address     VARCHAR(255),
  latitude    NUMERIC(9,6),
  longitude   NUMERIC(9,6),
  stars       SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  rating      NUMERIC(2,1) DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  featured    BOOLEAN NOT NULL DEFAULT false,
  status      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hotels_country_city ON hotels (country, city);
CREATE INDEX idx_hotels_featured     ON hotels (featured) WHERE featured = true;
CREATE INDEX idx_hotels_stars        ON hotels (stars);

-- ------------------------------------------------------------
-- ROOMS
-- ------------------------------------------------------------
CREATE TABLE rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name        VARCHAR(150) NOT NULL,
  description TEXT,
  capacity    SMALLINT NOT NULL DEFAULT 2,
  beds        SMALLINT NOT NULL DEFAULT 1,
  size        NUMERIC(6,2),              -- em m²
  price       NUMERIC(10,2) NOT NULL,    -- preço por noite
  available   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rooms_hotel_id ON rooms (hotel_id);

-- ------------------------------------------------------------
-- HOTEL_IMAGES  (fotos do hotel e/ou de um quarto específico)
-- ------------------------------------------------------------
CREATE TABLE hotel_images (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id   UUID REFERENCES hotels(id) ON DELETE CASCADE,
  room_id    UUID REFERENCES rooms(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  category   VARCHAR(30) NOT NULL DEFAULT 'hotel'
             CHECK (category IN ('hotel','quartos','suites','piscina','praia','restaurante','lazer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (hotel_id IS NOT NULL OR room_id IS NOT NULL)
);

CREATE INDEX idx_hotel_images_hotel_id ON hotel_images (hotel_id);
CREATE INDEX idx_hotel_images_room_id  ON hotel_images (room_id);

-- ------------------------------------------------------------
-- AMENITIES + HOTEL_AMENITIES (N:N)
-- ------------------------------------------------------------
CREATE TABLE amenities (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE hotel_amenities (
  hotel_id   UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  amenity_id INTEGER NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
  PRIMARY KEY (hotel_id, amenity_id)
);

-- ------------------------------------------------------------
-- CART_ITEMS  (carrinho — antes da finalização da compra)
-- ------------------------------------------------------------
CREATE TABLE cart_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hotel_id   UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  check_in   DATE NOT NULL,
  check_out  DATE NOT NULL,
  guests     SMALLINT NOT NULL DEFAULT 1,
  rooms_qty  SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (check_out > check_in)
);

CREATE INDEX idx_cart_items_user_id ON cart_items (user_id);

-- ------------------------------------------------------------
-- RESERVATIONS  (sem CANCELLED — conforme solicitado)
-- ------------------------------------------------------------
CREATE TABLE reservations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  hotel_id    UUID NOT NULL REFERENCES hotels(id) ON DELETE RESTRICT,
  room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  check_in    DATE NOT NULL,
  check_out   DATE NOT NULL,
  guests      SMALLINT NOT NULL DEFAULT 1,
  rooms       SMALLINT NOT NULL DEFAULT 1,
  total_price NUMERIC(10,2) NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (check_out > check_in)
);

CREATE INDEX idx_reservations_user_id  ON reservations (user_id);
CREATE INDEX idx_reservations_hotel_id ON reservations (hotel_id);
CREATE INDEX idx_reservations_status   ON reservations (status);

-- ------------------------------------------------------------
-- PAYMENTS  (sem REFUNDED — conforme solicitado)
-- ------------------------------------------------------------
CREATE TABLE payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  provider       VARCHAR(40) NOT NULL,     -- ex: 'mercado_pago', 'stripe', 'pagbank'
  transaction_id VARCHAR(150),             -- id retornado pelo gateway
  amount         NUMERIC(10,2) NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING', 'PAID', 'FAILED')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_reservation_id ON payments (reservation_id);
CREATE INDEX idx_payments_status         ON payments (status);

-- ------------------------------------------------------------
-- REVIEWS
-- ------------------------------------------------------------
CREATE TABLE reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hotel_id       UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  rating         SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reviews_hotel_id ON reviews (hotel_id);

-- ------------------------------------------------------------
-- Gatilho para manter "updated_at" de payments sempre atual
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Fim do script.
-- Próximos passos sugeridos:
--   - Popular "amenities" com valores fixos (Wi-Fi, Piscina, Praia, etc.)
--   - Conectar seu backend (Next.js/API) a este banco via ORM (Prisma, Drizzle) ou driver direto (pg)
--   - Nunca gravar dados de cartão aqui — isso fica só no gateway de pagamento
-- ============================================================
