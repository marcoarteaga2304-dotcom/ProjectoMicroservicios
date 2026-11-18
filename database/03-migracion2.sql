-- Ejecuta este script UNA vez, DESPUÉS de migracion.sql, sobre glowcosmetics_db

-- Dirección guardada en el perfil del usuario
ALTER TABLE usuarios ADD COLUMN direccion JSON NULL;

-- Productos: descripción, color de muestra (tono) y activar/desactivar en vez de borrar
ALTER TABLE productos
  ADD COLUMN descripcion TEXT NULL,
  ADD COLUMN color_hex VARCHAR(7) NULL,
  ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1;

-- Pedidos: estado, dirección de envío y desglose del cobro
ALTER TABLE pedidos
  ADD COLUMN estado ENUM('Pagado','Enviado','Entregado','Cancelado') NOT NULL DEFAULT 'Pagado',
  ADD COLUMN direccion JSON NULL,
  ADD COLUMN subtotal DECIMAL(10,2) NULL,
  ADD COLUMN descuento DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN envio DECIMAL(10,2) NULL,
  ADD COLUMN cupon VARCHAR(30) NULL;

CREATE TABLE favoritos (
  usuario_email VARCHAR(100) NOT NULL,
  producto_id INT NOT NULL,
  PRIMARY KEY (usuario_email, producto_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE resenas (
  id INT NOT NULL AUTO_INCREMENT,
  producto_id INT NOT NULL,
  usuario_email VARCHAR(100) NOT NULL,
  calificacion TINYINT NOT NULL,
  comentario VARCHAR(500) NULL,
  fecha TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_resena (producto_id, usuario_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE cupones (
  id INT NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(30) NOT NULL,
  tipo ENUM('porcentaje','fijo') NOT NULL,
  valor DECIMAL(10,2) NOT NULL,
  compra_minima DECIMAL(10,2) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Bolsa guardada en el servidor (se conserva al cambiar de dispositivo)
CREATE TABLE carritos (
  usuario_email VARCHAR(100) NOT NULL,
  items JSON NOT NULL,
  actualizado TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Órdenes de PayPal pendientes (sobreviven a un reinicio del servidor)
CREATE TABLE paypal_ordenes (
  order_id VARCHAR(64) NOT NULL,
  usuario_email VARCHAR(100) NOT NULL,
  carrito JSON NOT NULL,
  direccion JSON NOT NULL,
  cupon VARCHAR(30) NULL,
  total DECIMAL(10,2) NOT NULL,
  creado TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Recuperación de contraseña (se guarda solo el hash del token)
CREATE TABLE recuperacion (
  id INT NOT NULL AUTO_INCREMENT,
  usuario_email VARCHAR(100) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expira DATETIME NOT NULL,
  usado TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Cupón de ejemplo: 10% en compras desde $500
INSERT INTO cupones (codigo, tipo, valor, compra_minima) VALUES ('BIENVENIDA10', 'porcentaje', 10, 500);
