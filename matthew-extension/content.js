(() => {
  const GEN=(window.__matthewBridgeContentGen??0)+1; window.__matthewBridgeContentGen=GEN;
  const current=()=>window.__matthewBridgeContentGen===GEN;
  const TAG='__matthew_bridge';
  const DEFAULT_BRIDGE='http://127.0.0.1:8788';
  let controller=null;

  async function bridgeUrl(){
    try{const x=await chrome.storage.local.get('bridgeUrl');return(!x.bridgeUrl||x.bridgeUrl==='http://127.0.0.1:8787')?DEFAULT_BRIDGE:x.bridgeUrl;}
    catch{return DEFAULT_BRIDGE;}
  }
  async function post(path,body){
    try{await fetch(`${await bridgeUrl()}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}catch(e){console.warn('[matthew-content]',path,e?.message??e);}
  }
  function session(){
    const raw=localStorage.getItem('user');
    if(!raw)throw new Error('Matthew login data not found.');
    const u=JSON.parse(raw);
    const accessToken=u?.access_token||u?.accessToken;
    const sessionToken=u?.token||u?.session_token||u?.sessionToken;
    const assistantId=u?.defaultAssistant?.daid||u?.defaultAssistant?.id||u?.defaultAssistantId||'';
    if(!accessToken||!sessionToken)throw new Error('Matthew session token is missing.');
    return{accessToken,sessionToken,assistantId};
  }
  const wait=(ms)=>new Promise((_,reject)=>setTimeout(()=>reject(new Error(`timeout after ${ms}ms`)),ms));
  async function timedFetch(url,opt,ms=15000){
    const c=new AbortController(); const t=setTimeout(()=>c.abort(),ms);
    try{return await fetch(url,{...opt,signal:c.signal});}
    catch(e){if(e?.name==='AbortError')throw new Error(`Matthew API timeout after ${ms/1000}s`);throw e;}
    finally{clearTimeout(t);}
  }
  async function sendMessage(prompt,s,model){
    const f=new FormData();f.append('token',s.sessionToken);f.append('message',prompt);f.append('thread_id','newchat');f.append('tid','newchat');
    if(s.assistantId)f.append('aid',s.assistantId);f.append('uname','Matthew Bridge');f.append('uname_th','Matthew Bridge');if(model)f.append('model',model);
    const r=await timedFetch('/api/thread_sse_message',{method:'POST',credentials:'include',headers:{Authorization:`Bearer ${s.accessToken}`},body:f});
    const text=await r.text();if(!r.ok)throw new Error(`Matthew message API ${r.status}: ${text.slice(0,300)}`);
    let d;try{d=JSON.parse(text);}catch{throw new Error(`Matthew returned non-JSON: ${text.slice(0,200)}`);}
    const id=d?.new_thread?.thread_actual_id||d?.thread_actual_id||d?.thread_id||d?.new_thread?.thread_id;
    if(!id)throw new Error(`Matthew returned no thread id: ${text.slice(0,250)}`);return id;
  }
  async function ticket(thread,s){
    const r=await timedFetch('/api/thread_sse_ticket',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.accessToken}`},body:JSON.stringify({thread_id:thread})});
    const text=await r.text();if(!r.ok)throw new Error(`Matthew ticket API ${r.status}: ${text.slice(0,300)}`);
    let d;try{d=JSON.parse(text);}catch{throw new Error('Matthew ticket returned non-JSON.');}
    if(!d?.ticket)throw new Error('Matthew returned no stream ticket.');
    return `/api/thread_sse_response_stream?thread_id=${encodeURIComponent(thread)}&ticket=${encodeURIComponent(d.ticket)}`;
  }
  function promptOf(job){
    if(typeof job.prompt==='string')return job.prompt;
    return(job.messages||[]).map(m=>{const c=Array.isArray(m.content)?m.content.map(x=>x?.type==='text'?x.text:'').filter(Boolean).join('\n'):String(m.content??'');return c?`${m.role==='system'?'Instructions':m.role==='assistant'?'Assistant':'User'}: ${c}`:''}).filter(Boolean).join('\n\n');
  }
  async function run(job){
    const ac=new AbortController();controller=ac;
    const debug=m=>void post('/ext/debug',{jobId:job.jobId,message:m});
    try{
      debug('content-run-start');
      const s=session();debug(`session-ok assistant=${s.assistantId?'yes':'no'}`);
      const prompt=promptOf(job);if(!prompt.trim())throw new Error('No usable message content.');
      debug('message-start');const thread=await sendMessage(prompt,s,job.model);debug(`message-ok thread=${thread}`);
      const url=await ticket(thread,s);debug('ticket-ok');
      const r=await fetch(url,{credentials:'include',signal:ac.signal,headers:{Accept:'text/event-stream'}});
      if(!r.ok||!r.body)throw new Error(`Matthew SSE returned ${r.status}`);
      const reader=r.body.getReader();const decoder=new TextDecoder();let pending='',eventName='';let finished=false;
      for(;;){
        const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let cut;
        while((cut=pending.search(/\r?\n\r?\n/))!==-1){const sep=pending.slice(cut).match(/^\r?\n\r?\n/)[0];const frame=pending.slice(0,cut);pending=pending.slice(cut+sep.length);let ds=[];
          for(const line of frame.split(/\r?\n/)){if(line.startsWith('event:'))eventName=line.slice(6).trim();else if(line.startsWith('data:'))ds.push(line.slice(5).trim());}
          if(!ds.length){eventName='';continue;}const raw=ds.join('\n');if(raw==='[DONE]'){finished=true;eventName='';continue;}
          let d;try{d=JSON.parse(raw);}catch{d={message:raw};}if(eventName==='error'||d?.error)throw new Error(String(d?.error||d?.message||'Matthew stream error'));
          if(eventName==='complete'||eventName==='done'){finished=true;eventName='';continue;}
          const text=typeof d?.message==='string'?d.message:typeof d?.content==='string'?d.content:typeof d?.delta==='string'?d.delta:'';
          if(text)void post('/ext/chunk',{jobId:job.jobId,parts:[{kind:'text',text}]});eventName='';
        }
      }
      debug('stream-finished');void post('/ext/done',{jobId:job.jobId,finishReason:finished?'stop':'stop'});
    }catch(e){void post('/ext/error',{jobId:job.jobId,message:String(e?.message??e)});}
    finally{controller=null;}
  }
  async function connectBridge(){
    if(controller)return; // controller is only used for a running job; bridge stream is independent.
    try{
      const r=await fetch(`${await bridgeUrl()}/matthew/events`,{headers:{accept:'text/event-stream'},cache:'no-store'});
      if(!r.ok||!r.body)throw new Error(`bridge ${r.status}`);
      console.log('[matthew-content] bridge connected');
      const reader=r.body.getReader();const decoder=new TextDecoder();let pending='';
      for(;;){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let cut;
        while((cut=pending.search(/\r?\n\r?\n/))!==-1){const sep=pending.slice(cut).match(/^\r?\n\r?\n/)[0];const frame=pending.slice(0,cut);pending=pending.slice(cut+sep.length);let name='message',ds=[];
          for(const line of frame.split(/\r?\n/)){if(line.startsWith('event:'))name=line.slice(6).trim();else if(line.startsWith('data:'))ds.push(line.slice(5).trim());}
          if(name==='job'&&ds.length){try{const j=JSON.parse(ds.join('\n'));if(j?.jobId)void run(j);}catch(e){console.warn('[matthew-content] bad job',e);}}
        }
      }
    }catch(e){console.warn('[matthew-content] bridge',e?.message??e);}finally{setTimeout(connectBridge,1000);}
  }
  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
    if(msg?.type==='abort'){controller?.abort();sendResponse({ok:true});return true;}
    if(msg?.type==='ping'){sendResponse({ok:true});return true;}
  });
  let port;function keepAlive(){try{port=chrome.runtime.connect({name:'keepalive'});port.postMessage({t:Date.now()});}catch{setTimeout(keepAlive,1000);return;}
    const beat=setInterval(()=>{try{port.postMessage({t:Date.now()});}catch{}},20000);port.onDisconnect.addListener(()=>{clearInterval(beat);setTimeout(keepAlive,250);});}
  keepAlive();connectBridge();
})();
