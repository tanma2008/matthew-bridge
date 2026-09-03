const base=process.env.MATTHEW_BRIDGE_URL??'http://127.0.0.1:8787';
try{
  const r=await fetch(`${base}/health`);const d=await r.json();
  console.log(d.status==='ok'?'✓ bridge responding':'✗ bridge unhealthy');
  console.log(d.connected?'✓ extension connected':'✗ extension not connected');
  if(d.connected)console.log('  → open https://matthew.cmu.ac.th and keep the tab open');
  process.exit(d.status==='ok'&&d.connected?0:1);
}catch(e){console.log('✗ bridge unavailable');console.log(`  → start it with: npm run dev`);console.log(`  ${e.message}`);process.exit(1);}
