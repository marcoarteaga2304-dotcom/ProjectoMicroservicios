-- Guarda el identificador del cobro de PayPal para poder reembolsar al cancelar un pedido.
-- Si tu base ya existe, ejecútalo una sola vez (ver README).
ALTER TABLE pedidos ADD COLUMN paypal_capture_id VARCHAR(64) NULL;
