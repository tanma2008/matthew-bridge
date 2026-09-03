const args=process.argv.slice(2);
const prompt=args.join(' ').trim();
if(!prompt||args.includes('--help')){
  console.log('Usage: npm run matthew -- "your prompt"');
  process.exit(prompt?0:1);
}
const base=process.env.MATTHEW_BRIDGE_URL??'http://127.0.0.1:8787';
const res=await fetch(`${base}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:process.env.MATTHEW_MODEL??'gpt-5.5',stream:true,messages:[{role:'user',content:prompt}]})});
if(!res.ok){console.error(await res.text());process.exit(1);}
const reader=res.body.getReader();const decoder=new TextDecoder();let buf='';
for(;;){const {value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});let i;
  while((i=buf.indexOf('\n\n'))>=0){const frame=buf.slice(0,i);buf=buf.slice(i+2);for(const line of frame.split('\n')){if(!line.startsWith('data: ')||line==='data: [DONE]')continue;try{const d=JSON.parse(line.slice(6));const t=d.choices?.[0]?.delta?.content;if(t)process.stdout.write(t);}catch{}}}
}
process.stdout.write('\n');
