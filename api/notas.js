const { sql } = require('@vercel/postgres');
function date(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;return new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;}
function month(s,n){const [y,m,d]=s.split('-').map(Number);const first=new Date(Date.UTC(y,m-1+n,1));const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();first.setUTCDate(Math.min(d,last));return first.toISOString().slice(0,10);}
module.exports=async(req,res)=>{try{
await sql`CREATE TABLE IF NOT EXISTS notas (id SERIAL PRIMARY KEY,veiculo TEXT,placa TEXT,nf TEXT,valor NUMERIC,vencimento DATE,agendado DATE,pagoem DATE,forma TEXT,obs TEXT,parcelaatual INTEGER DEFAULT 1,parcelatotal INTEGER DEFAULT 1)`;
await sql`ALTER TABLE notas ADD COLUMN IF NOT EXISTS origem TEXT`;
await sql`ALTER TABLE notas ADD COLUMN IF NOT EXISTS valortotal NUMERIC`;
await sql`ALTER TABLE notas ADD COLUMN IF NOT EXISTS grupo TEXT`;
if(req.method==='GET'){const {rows}=await sql`SELECT * FROM notas ORDER BY vencimento ASC NULLS LAST,id ASC`;return res.status(200).json(rows);}
const b=req.body||{};
if(req.method==='POST'){
const total=Math.round(Number(b.valorTotal)*100),n=Number(b.parcelaTotal),v=b.vencimento;
if(!String(b.veiculo||'').trim()||!String(b.nf||'').trim()||!Number.isSafeInteger(total)||total<=0||!Number.isInteger(n)||n<1||n>120||total<n||!date(v)||!['financeira','associacao'].includes(b.origem)||(b.agendado&&!date(b.agendado)))return res.status(400).json({error:'Confira veículo, NF, origem, total, parcelas (1 a 120) e datas.'});
const group=require('crypto').randomUUID(),base=Math.floor(total/n);
const entries=Array.from({length:n},(_,i)=>({veiculo:String(b.veiculo).trim(),placa:String(b.placa||'').toUpperCase(),nf:String(b.nf).trim(),valor:(i===n-1?total-base*(n-1):base)/100,vencimento:month(v,i),agendado:i===0?(b.agendado||null):null,obs:String(b.obs||''),parcelaatual:i+1,parcelatotal:n,origem:b.origem,valortotal:total/100,grupo:group}));
const {rows}=await sql`INSERT INTO notas (veiculo,placa,nf,valor,vencimento,agendado,obs,parcelaatual,parcelatotal,origem,valortotal,grupo) SELECT x.veiculo,x.placa,x.nf,x.valor,x.vencimento,x.agendado,x.obs,x.parcelaatual,x.parcelatotal,x.origem,x.valortotal,x.grupo FROM jsonb_to_recordset(${JSON.stringify(entries)}::jsonb) AS x(veiculo text,placa text,nf text,valor numeric,vencimento date,agendado date,obs text,parcelaatual integer,parcelatotal integer,origem text,valortotal numeric,grupo text) RETURNING *`;
return res.status(201).json(rows);
}
if(req.method==='PUT'){
if(!Number.isInteger(Number(b.id))||Number(b.id)<1)return res.status(400).json({error:'ID inválido.'});
let result;
if(b.acao==='pagar'){
if(!date(b.pagoEm))return res.status(400).json({error:'Data inválida.'});
result=await sql`UPDATE notas SET pagoem=${b.pagoEm},forma=${String(b.forma||'PIX')} WHERE id=${b.id} RETURNING *`;
}else if(b.acao==='reabrir'){
result=await sql`UPDATE notas SET pagoem=NULL,forma='' WHERE id=${b.id} RETURNING *`;
}else if(b.acao==='gerar'){
const base=(await sql`SELECT * FROM notas WHERE id=${b.id}`).rows[0];
if(!base)return res.status(404).json({error:'Parcela não encontrada.'});
const n=Number(base.parcelatotal||1);
if(n<=1)return res.status(400).json({error:'Esta nota está configurada como parcela única.'});
const existentes=(await sql`SELECT COALESCE(MAX(parcelaatual),0) AS maior FROM notas WHERE nf=${base.nf} AND veiculo=${base.veiculo} AND parcelatotal=${n}`).rows[0].maior;
if(existentes>=n)return res.status(200).json({criadas:0});
const totalCentavos=Math.round(Number(base.valortotal!=null?base.valortotal:Number(base.valor)*n)*100),baseCent=Math.floor(totalCentavos/n),grupo=require('crypto').randomUUID();
const faltam=Array.from({length:n-existentes},(_,k)=>({veiculo:base.veiculo,placa:base.placa,nf:base.nf,valor:(existentes+k+1===n?totalCentavos-baseCent*(n-1):baseCent)/100,vencimento:month(String(base.vencimento).slice(0,10),existentes+k),agendado:null,obs:base.obs||'',parcelaatual:existentes+k+1,parcelatotal:n,origem:base.origem,valortotal:totalCentavos/100,grupo}));
const criadas=await sql`INSERT INTO notas (veiculo,placa,nf,valor,vencimento,agendado,obs,parcelaatual,parcelatotal,origem,valortotal,grupo) SELECT x.veiculo,x.placa,x.nf,x.valor,x.vencimento,x.agendado,x.obs,x.parcelaatual,x.parcelatotal,x.origem,x.valortotal,x.grupo FROM jsonb_to_recordset(${JSON.stringify(faltam)}::jsonb) AS x(veiculo text,placa text,nf text,valor numeric,vencimento date,agendado date,obs text,parcelaatual integer,parcelatotal integer,origem text,valortotal numeric,grupo text) RETURNING *`;
return res.status(201).json({criadas:criadas.rows.length,notas:criadas.rows});
}else{
if(!String(b.veiculo||'').trim()||!String(b.nf||'').trim()||!(Number(b.valor)>0)||!Number.isFinite(Number(b.valor))||!date(b.vencimento)||(b.agendado&&!date(b.agendado))||(b.origem!=null&&!['financeira','associacao'].includes(b.origem)))return res.status(400).json({error:'Confira os campos da parcela.'});
result=await sql`UPDATE notas SET veiculo=${String(b.veiculo).trim()},placa=${String(b.placa||'').toUpperCase()},nf=${String(b.nf).trim()},valor=${Number(b.valor)},vencimento=${b.vencimento},agendado=${b.agendado||null},obs=${String(b.obs||'')},origem=${b.origem||null} WHERE id=${b.id} RETURNING *`;
}
if(!result.rows.length)return res.status(404).json({error:'Parcela não encontrada.'});return res.status(200).json(result.rows[0]);
}
if(req.method==='DELETE'){if(!Number.isInteger(Number(b.id))||Number(b.id)<1)return res.status(400).json({error:'ID inválido.'});await sql`DELETE FROM notas WHERE id=${b.id}`;return res.status(200).json({ok:true});}
res.setHeader('Allow','GET, POST, PUT, DELETE');return res.status(405).json({error:'Método não permitido.'});
}catch(e){console.error(e);return res.status(500).json({error:'Não foi possível concluir. Recarregue a lista antes de tentar novamente.'});}};
