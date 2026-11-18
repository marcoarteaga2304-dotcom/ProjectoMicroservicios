-- Ejecuta este script UNA vez sobre tu base glowcosmetics_db (después de importar glowcosmetics_db.sql)

-- MyISAM no soporta transacciones; las necesitamos para descontar stock y registrar pedidos de forma segura
ALTER TABLE usuarios ENGINE=InnoDB;
ALTER TABLE pedidos  ENGINE=InnoDB;

-- Roles de usuario
ALTER TABLE usuarios ADD COLUMN rol ENUM('comprador','admin') NOT NULL DEFAULT 'comprador';

-- Detalle de productos comprados e id de orden de PayPal
ALTER TABLE pedidos ADD COLUMN productos JSON NULL, ADD COLUMN paypal_order_id VARCHAR(64) NULL;

-- Los productos ahora viven en la base de datos (así el administrador puede editarlos)
CREATE TABLE IF NOT EXISTS productos (
  id INT NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(150) NOT NULL,
  categoria ENUM('Rostro','Ojos','Labios') NOT NULL,
  precio DECIMAL(10,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  imagen VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO productos (id, nombre, categoria, precio, stock, imagen) VALUES
(1,'Rare Beauty Liquid Blush - Tono: Believe','Rostro',989,8,'/img/Rare Beauty Liquid Blush – Tono Believe.jpeg'),
(2,'Rare Beauty Liquid Blush - Tono: Encourage','Rostro',1068,5,'/img/Rare Beauty Liquid Blush – Tono Encourage.jpeg'),
(3,'Rare Beauty Liquid Blush - Tono: Bliss','Rostro',655,10,'/img/Rare Beauty Liquid Blush – Tono Bliss.jpeg'),
(4,'Rare Beauty Bronzer - Tono: Power Boost','Rostro',765,6,'/img/Rare Beauty Bronzer – Tono Power Boost.jpeg'),
(5,'Rare Beauty Highlighter - Tono: Outshine','Rostro',715,7,'/img/Rare Beauty Highlighter – Tono Outshine.jpeg'),
(6,'Rare Beauty Powder Blush - Tono: Happy','Rostro',720,4,'/img/Rare Beauty Powder Blush – Tono Happy.jpeg'),
(7,'Rare Beauty Liquid Eyeshadow - Tono: Hope','Ojos',640,12,'/img/Rare Beauty Liquid Eyeshadow – Tono Hope.jpeg'),
(8,'Rare Beauty Liquid Eyeshadow - Tono: Wonder','Ojos',640,9,'/img/Rare Beauty Liquid Eyeshadow – Tono Wonder.jpeg'),
(9,'Rare Beauty Liquid Eyeshadow - Tono: Honesty','Ojos',640,10,'/img/Rare Beauty Liquid Eyeshadow – Tono Honesty.jpeg'),
(10,'Rare Beauty Brow Gel - Tono: Clear','Ojos',560,15,'/img/Rare Beauty Brow Gel – Tono Clear.png'),
(11,'Rare Beauty Brow Gel - Tono: Soft Blonde','Ojos',560,8,'/img/Rare Beauty Brow Gel – Tono Soft Blonde.png'),
(12,'Rare Beauty Mascara - Tono: Black','Ojos',610,14,'/img/Rare Beauty Mascara – Tono Black.png'),
(13,'Rare Beauty Lip Tint - Tono: 520 W','Labios',700,10,'/img/Rare Beauty Lip Tint – Tono 520 W.png'),
(14,'Rare Beauty Lip Tint - Tono: 270 N','Labios',700,7,'/img/Rare Beauty Lip Tint – Tono 270 N.png'),
(15,'Rare Beauty Lip Tint - Tono: 370 N','Labios',700,6,'/img/Rare Beauty Lip Tint – Tono 370 N.png'),
(16,'Rare Beauty Lipstick - Tono: Bold','Labios',510,11,'/img/Rare Beauty Lipstick – Tono Bold.png'),
(17,'Rare Beauty Lip Oil - Tono: Serenity','Labios',640,8,'/img/Rare Beauty Lip Oil – Tono Serenity.png'),
(18,'Rare Beauty Lip Oil - Tono: Affection','Labios',640,5,'/img/Rare Beauty Lip Oil – Tono Affection.png');
