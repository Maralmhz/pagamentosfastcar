const { sql } = require('@vercel/postgres');

async function ensureTable() {
  await sql`CREATE TABLE IF NOT EXISTS notas (
    id SERIAL PRIMARY KEY,
    veiculo TEXT,
    placa TEXT,
    nf TEXT,
    valor NUMERIC,
    vencimento DATE,
    agendado DATE,
    pagoem DATE,
    forma TEXT,
    obs TEXT
  )`;
}

module.exports = async function handler(req, res) {
  try {
    await ensureTable();

    if (req.method === 'GET') {
      const { rows } = await sql`SELECT * FROM notas ORDER BY id ASC`;
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      const { veiculo, placa, nf, valor, vencimento, agendado, obs } = req.body;
      const { rows } = await sql`
        INSERT INTO notas (veiculo, placa, nf, valor, vencimento, agendado, pagoem, forma, obs)
        VALUES (${veiculo}, ${placa}, ${nf}, ${valor}, ${vencimento || null}, ${agendado || null}, NULL, '', ${obs || ''})
        RETURNING *`;
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'PUT') {
      const { id, veiculo, placa, nf, valor, vencimento, agendado, obs, pagoEm, forma } = req.body;
      const { rows } = await sql`
        UPDATE notas SET
          veiculo = ${veiculo},
          placa = ${placa},
          nf = ${nf},
          valor = ${valor},
          vencimento = ${vencimento || null},
          agendado = ${agendado || null},
          obs = ${obs || ''},
          pagoem = ${pagoEm || null},
          forma = ${forma || ''}
        WHERE id = ${id}
        RETURNING *`;
      return res.status(200).json(rows[0]);
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      await sql`DELETE FROM notas WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
