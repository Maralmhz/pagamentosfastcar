const {createPool}=require('@vercel/postgres');
const crypto=require('crypto');
const cents=v=>Math.round(Number(v)*100);
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
function token(rows){return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
async function read(client,id){
const base=(await client.query('SELECT * FROM notas WHERE id=$1',[id])).rows[0];if(!base)fail('Nota não encontrada.',404);
const n=Number(base.parcelatotal||1);if(!Number.isInteger(n)||n<2||n>120)fail('Esta nota não tem parcelamento válido (2 a 120 parcelas).');
let rows;
const select="SELECT *,to_char(vencimento,'YYYY-MM-DD') AS vencimento,to_char(pagoem,'YYYY-MM-DD') AS pagoem,to_char(agendado,'YYYY-MM-DD') AS agendado FROM notas ";
if(base.grupo){rows=(await client.query(select+'WHERE grupo=$1 ORDER BY id',[base.grupo])).rows;}
else{rows=(await client.query(select+"WHERE grupo IS NULL AND nf IS NOT DISTINCT FROM $1 AND veiculo IS NOT DISTINCT FROM $2 AND COALESCE(placa,'')=COALESCE($3,'') AND parcelatotal=$4 ORDER BY id",[base.nf,base.veiculo,base.placa,n])).rows;}
const seen=new Set();for(const r of rows){const k=Number(r.parcelaatual||1);if(Number(r.parcelatotal)!==n||!Number.isInteger(k)||k<1||k>n||seen.has(k))fail('Há parcelas conflitantes ou repetidas. Revise esta nota antes de gerar outras.');if(!Number.isSafeInteger(cents(r.valor))||cents(r.valor)<=0)fail('Uma parcela existente tem valor inválido. Revise antes de continuar.');seen.add(k);}
const missing=Array.from({length:n},(_,i)=>i+1).filter(k=>!seen.has(k));
return {base,rows,n,missing,token:token(rows)};
}
module.exports=async(req,res)=>{
res.setHeader('Cache-Control','no-store');if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Método não permitido.'});
const id=Number(req.method==='GET'?req.query.id:req.body?.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:'ID inválido.'});
let pool,client,transaction=false;
try{
pool=createPool();client=await pool.connect();
if(req.method==='POST'){await client.query('BEGIN');transaction=true;await client.query("SET LOCAL lock_timeout='8s'");await client.query('LOCK TABLE notas IN SHARE ROW EXCLUSIVE MODE');}
const p=await read(client,id);
if(req.method==='GET')return res.status(200).json({id,n:p.n,rows:p.rows,missing:p.missing,token:p.token});
const b=req.body;
if(b.token!==p.token)fail('A nota mudou desde a conferência. Feche e abra novamente o gerador.',409);
if(!p.missing.length)fail('Todas as parcelas já existem. Recarregue a lista.',409);
const total=cents(b.total);if(!Number.isSafeInteger(total)||total<=0||total>999999999999)fail('Informe um valor total válido.');
if(!Array.isArray(b.items)||b.items.length!==p.missing.length)fail('O plano de parcelas está incompleto.');
const seen=new Set();let sum=p.rows.reduce((v,r)=>v+cents(r.valor),0);
for(const i of b.items){const k=Number(i.numero),v=cents(i.valor);if(!p.missing.includes(k)||seen.has(k)||!Number.isSafeInteger(v)||v<=0||!validDate(i.vencimento))fail('Confira os números, valores e datas de todas as parcelas.');seen.add(k);sum+=v;}
if(sum!==total)fail('A soma das parcelas existentes e novas deve ser igual ao total da nota.');
const group=p.base.grupo||crypto.randomUUID();
for(const i of b.items){await client.query('INSERT INTO notas (veiculo,placa,nf,valor,vencimento,agendado,pagoem,forma,obs,parcelaatual,parcelatotal,origem,valortotal,grupo) VALUES ($1,$2,$3,$4,$5,NULL,NULL,\'\',$6,$7,$8,$9,$10,$11)',[p.base.veiculo,p.base.placa,p.base.nf,cents(i.valor)/100,i.vencimento,p.base.obs||'',Number(i.numero),p.n,p.base.origem||null,total/100,group]);}
await client.query('UPDATE notas SET grupo=$1,valortotal=$2 WHERE id=ANY($3::int[])',[group,total/100,p.rows.map(r=>r.id)]);
await client.query('COMMIT');transaction=false;return res.status(201).json({criadas:b.items.length});
}catch(e){if(transaction&&client)await client.query('ROLLBACK').catch(()=>{});console.error(e);return res.status(e.status||500).json({error:e.status?e.message:'Falha ao gerar parcelas. Nenhuma alteração desta tentativa foi confirmada. Reabra a conferência e tente novamente.'});}
finally{if(client)client.release();if(pool)await pool.end().catch(()=>{});}
};
