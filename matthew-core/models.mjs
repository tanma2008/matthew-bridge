const base = process.env.MATTHEW_BRIDGE_URL ?? 'http://127.0.0.1:8787';
const res = await fetch(`${base}/v1/models`);
if (!res.ok) { console.error(`bridge returned ${res.status}`); process.exit(1); }
const data = await res.json();
for (const model of data.data ?? []) console.log(`${model.id}${model.reasoning ? '  [reasoning]' : ''}`);
